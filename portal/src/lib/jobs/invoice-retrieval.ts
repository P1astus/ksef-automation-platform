import type { Job, JobContext, JobFailure, JobResult } from './types';
import type { Db } from './queue';

// Port of workflow 04 (n8n "KSeF - Invoice Retrieval v2") together with workflow 02 (its KSeF authentication, whose
// unauthenticated token-minting webhook is gone). Every 30 minutes, for each sync-enabled client and each direction
// (sales = KSeF Subject1, purchases = Subject2): pull invoice metadata from KSeF and store the new ones.
//
// What the workflow got wrong, and what this does instead:
//   * It advanced the high-water mark to NOW() (the wall clock) after the first invoice, ignoring `hasMore` and
//     `isTruncated`. A window that was not fully read still moved the mark, so invoices were skipped for good.
//     Here the mark moves only when a window has been read to its end, and only to KSeF's own
//     `permanentStorageHwmDate` (the watermark up to which KSeF guarantees every invoice is already visible).
//   * It read a single page of 100. Here pages are followed, and a truncated result (10 000 records) narrows the range
//     from the last record, as the API documents. A truncation that cannot make progress FAILS the client loudly.
//   * The rows and the mark were separate writes. Here one SQL statement inserts the rows and advances the mark, so
//     they commit together or not at all (a mark is never ahead of its rows), with a compare-and-set on the old mark.
//   * Dedup was SELECT-then-INSERT on a global ksef_number. Here the database enforces it:
//     UNIQUE (firm_id, client_nip, ksef_number) + ON CONFLICT DO NOTHING.
//   * It opened a KSeF online session per client that nothing used. Querying needs only the access token.
//   * Sales and purchases share nothing: each has its own mark (`hwm_sales`, `hwm_purchases`) and window.
//
// IDEMPOTENCY BOUNDARY: safe to re-run. Rows already stored are skipped by the unique key; the mark is a compare-and-set,
// so a repeat cannot move it backwards or past unread data. A crash between fetch and commit loses nothing: the mark did
// not move, the next run re-reads the window.
// SHADOW: authenticates and reads from KSeF (read-only), counts what it WOULD insert against the database, and writes
// nothing: no rows, no mark, no sync status, no alerts.

/** KSeF caps a query range at 3 months. Stay clearly under it. */
const MAX_WINDOW_MS = 89 * 24 * 3_600_000;
const PAGE_SIZE = 250;
/** First sync of a client (no mark yet): same default as the workflow. */
const FIRST_SYNC_LOOKBACK_MS = 7 * 24 * 3_600_000;
const MAX_PAGES_PER_WINDOW = 400; // 400 x 250 = 100 000 records; a runaway loop is a bug, not something to iterate through

export type Direction = 'sales' | 'purchase';
const SUBJECT = { sales: 'Subject1', purchase: 'Subject2' } as const;

export interface MetadataPage {
    invoices: any[];
    hasMore: boolean;
    isTruncated: boolean;
    permanentStorageHwmDate?: string;
}

/** The KSeF calls the job needs, injected so the job is testable and never imports a network client itself. */
export interface KsefPort {
    authenticate(nip: string, token: string): Promise<string>;
    query(accessToken: string, o: { subjectType: 'Subject1' | 'Subject2'; dateFrom: string; dateTo: string; pageOffset: number; pageSize: number }): Promise<MetadataPage>;
    terminate(accessToken: string): Promise<void>;
}

export interface InvoiceRetrievalDeps {
    ksef: KsefPort;
    /** Decrypts clients.ksef_token_encrypted (context = the client's credential AAD). Throws MissingCredentialKeyError-like errors. */
    decryptToken(stored: string, clientId: number): string;
}

export interface ClientRow {
    id: number;
    nip: string;
    firm_id: number;
    client_name: string;
    auth_method: string;
    ksef_token_encrypted: string | null;
    last_sync_error?: string | null;
    hwm_sales: Date | string | null;
    hwm_purchases: Date | string | null;
}

export interface DirectionOutcome {
    direction: Direction;
    fetched: number;
    inserted: number;
    windows: number;
    hwm: string | null;
}

export const CERTIFICATE_SYNC_UNSUPPORTED = 'KSeF certificate authentication is not supported by this worker: the sidecar only has a server JPK signing key. Configure a KSeF token for invoice retrieval.';

export class RetrievalError extends Error {}
/** A misconfiguration that would fail every client the same way: abort the run instead of alerting once per client. */
export class RetrievalConfigError extends Error {}

const iso = (ms: number) => new Date(ms).toISOString();
const toMs = (v: Date | string) => new Date(v).getTime();
const message = (err: unknown) => (err as Error)?.message ?? String(err);

// ---- mapping KSeF metadata -> invoices row -------------------------------------------------------------------------

function mapInvoice(inv: any) {
    const buyer = inv.buyer?.identifier;
    const issue = typeof inv.issueDate === 'string' ? inv.issueDate.slice(0, 10) : null;
    return {
        ksef_number: inv.ksefNumber,
        invoice_number: String(inv.invoiceNumber ?? ''),
        invoice_type: inv.invoiceType ?? null,
        seller_nip: inv.seller?.nip ?? null,
        seller_name: inv.seller?.name ?? null,
        buyer_nip: buyer?.value ?? null,
        buyer_name: inv.buyer?.name ?? null,
        net_amount: inv.netAmount ?? 0,
        vat_amount: inv.vatAmount ?? 0,
        gross_amount: inv.grossAmount ?? 0,
        currency: inv.currency || 'PLN',
        issue_date: issue,
        acquisition_date: inv.acquisitionDate ?? null,
        permanent_storage_date: inv.permanentStorageDate ?? null,
        jpk_period: issue ? issue.slice(0, 7) : null,
    };
}

// ---- the atomic commit ---------------------------------------------------------------------------------------------
// One statement: insert the rows AND advance the mark. A data-modifying CTE always runs, and both parts belong to one
// statement, so they are atomic. The mark moves only if it still holds the value this run started from.
// Two literals (one per mark column) instead of an interpolated column name.

// The mark is compared at millisecond precision: a JS Date cannot carry the microseconds an older writer (n8n's NOW()) stored, so
// comparing the raw column would never match a legacy mark. Truncating the column side keeps the compare-and-set honest.
const COMMIT_SALES_SQL = `
    WITH ins AS (
        INSERT INTO invoices (firm_id, client_nip, ksef_number, invoice_number, invoice_type, direction, seller_nip, seller_name,
                              buyer_nip, buyer_name, net_amount, vat_amount, gross_amount, currency, issue_date,
                              ksef_acquisition_date, ksef_permanent_storage_date, jpk_period, jpk_marker)
        SELECT $2::int, $3::text, x.ksef_number, x.invoice_number, x.invoice_type, 'sales', x.seller_nip, x.seller_name,
               x.buyer_nip, x.buyer_name, x.net_amount, x.vat_amount, x.gross_amount, x.currency, x.issue_date,
               x.acquisition_date, x.permanent_storage_date, x.jpk_period, 'NrKSeF'
          FROM jsonb_to_recordset($1::jsonb) AS x(ksef_number text, invoice_number text, invoice_type text, seller_nip text,
               seller_name text, buyer_nip text, buyer_name text, net_amount numeric, vat_amount numeric, gross_amount numeric,
               currency text, issue_date date, acquisition_date timestamptz, permanent_storage_date timestamptz, jpk_period text)
        ON CONFLICT (firm_id, client_nip, ksef_number) DO NOTHING
        RETURNING 1
    ), adv AS (
        UPDATE clients SET hwm_sales = $4::timestamptz
         WHERE id = $5::int AND firm_id = $2::int AND date_trunc('milliseconds', hwm_sales) IS NOT DISTINCT FROM $6::timestamptz
        RETURNING 1
    )
    SELECT (SELECT count(*) FROM ins)::int AS inserted, (SELECT count(*) FROM adv)::int AS advanced`;

const COMMIT_PURCHASE_SQL = `
    WITH ins AS (
        INSERT INTO invoices (firm_id, client_nip, ksef_number, invoice_number, invoice_type, direction, seller_nip, seller_name,
                              buyer_nip, buyer_name, net_amount, vat_amount, gross_amount, currency, issue_date,
                              ksef_acquisition_date, ksef_permanent_storage_date, jpk_period, jpk_marker)
        SELECT $2::int, $3::text, x.ksef_number, x.invoice_number, x.invoice_type, 'purchase', x.seller_nip, x.seller_name,
               x.buyer_nip, x.buyer_name, x.net_amount, x.vat_amount, x.gross_amount, x.currency, x.issue_date,
               x.acquisition_date, x.permanent_storage_date, x.jpk_period, 'NrKSeF'
          FROM jsonb_to_recordset($1::jsonb) AS x(ksef_number text, invoice_number text, invoice_type text, seller_nip text,
               seller_name text, buyer_nip text, buyer_name text, net_amount numeric, vat_amount numeric, gross_amount numeric,
               currency text, issue_date date, acquisition_date timestamptz, permanent_storage_date timestamptz, jpk_period text)
        ON CONFLICT (firm_id, client_nip, ksef_number) DO NOTHING
        RETURNING 1
    ), adv AS (
        UPDATE clients SET hwm_purchases = $4::timestamptz
         WHERE id = $5::int AND firm_id = $2::int AND date_trunc('milliseconds', hwm_purchases) IS NOT DISTINCT FROM $6::timestamptz
        RETURNING 1
    )
    SELECT (SELECT count(*) FROM ins)::int AS inserted, (SELECT count(*) FROM adv)::int AS advanced`;

const EXISTING_SQL = `
    SELECT count(*)::int AS existing FROM invoices
     WHERE firm_id = $1 AND client_nip = $2 AND ksef_number = ANY($3::text[])`;

// ---- reading one window ------------------------------------------------------------------------------------------

interface WindowRead {
    invoices: any[];
    /** The watermark to advance to once these rows are committed. */
    hwmMs: number;
}

/**
 * Read [from, to] to its END, following pages and narrowing after a truncation. Returns only a complete read; anything
 * else throws, so the caller can never commit a partial window together with an advanced mark.
 */
async function readWindow(ksef: KsefPort, token: string, subject: 'Subject1' | 'Subject2', fromMs: number, toMs_: number, signal: AbortSignal, log: (m: string) => void): Promise<WindowRead> {
    const byNumber = new Map<string, any>();
    let cursorFrom = fromMs;
    let offset = 0;
    let serverHwm: string | undefined;

    for (let pages = 0; ; pages++) {
        if (signal.aborted) throw new RetrievalError('aborted (timeout or lost lease) while reading KSeF');
        if (pages >= MAX_PAGES_PER_WINDOW) throw new RetrievalError(`window ${iso(fromMs)}..${iso(toMs_)} still not finished after ${MAX_PAGES_PER_WINDOW} pages`);

        const page = await ksef.query(token, { subjectType: subject, dateFrom: iso(cursorFrom), dateTo: iso(toMs_), pageOffset: offset, pageSize: PAGE_SIZE });
        for (const inv of page.invoices ?? []) {
            if (!inv?.ksefNumber) throw new RetrievalError('KSeF returned an invoice without a ksefNumber');
            byNumber.set(inv.ksefNumber, inv);
        }
        if (page.permanentStorageHwmDate) serverHwm = page.permanentStorageHwmDate;

        if (!page.isTruncated) {
            if (!page.hasMore) break;
            offset += 1;
            continue;
        }

        // Truncated: narrow the range to start at the last record's date and restart paging.
        const last = page.invoices[page.invoices.length - 1];
        const lastMs = last?.permanentStorageDate ? toMs(last.permanentStorageDate) : NaN;
        if (!Number.isFinite(lastMs) || lastMs <= cursorFrom) {
            throw new RetrievalError(`KSeF result truncated at ${iso(cursorFrom)} and cannot be narrowed (last record date ${last?.permanentStorageDate ?? 'missing'}); nothing was stored or advanced`);
        }
        log(`window truncated at 10 000 records; continuing from ${iso(lastMs)}`);
        cursorFrom = lastMs;
        offset = 0;
    }

    // Where the mark may move: KSeF's own watermark, never past the window's end, never backwards.
    if (!serverHwm || !Number.isFinite(toMs(serverHwm))) {
        throw new RetrievalError('KSeF returned no valid permanentStorageHwmDate; nothing was stored or advanced');
    }
    const hwm = Math.min(toMs(serverHwm), toMs_);
    return { invoices: [...byNumber.values()], hwmMs: Math.max(hwm, fromMs) };
}

// ---- one client, one direction -------------------------------------------------------------------------------------

export async function syncDirection(
    ctx: JobContext, deps: InvoiceRetrievalDeps, client: ClientRow, token: string, direction: Direction
): Promise<DirectionOutcome> {
    const oldMark = direction === 'sales' ? client.hwm_sales : client.hwm_purchases;
    // Captured BEFORE any query: an invoice stored while we read can only be later than this and is read next run.
    const windowEnd = ctx.now().getTime();
    let from = oldMark ? toMs(oldMark) : windowEnd - FIRST_SYNC_LOOKBACK_MS;
    let committedMark: Date | string | null = oldMark;
    const out: DirectionOutcome = { direction, fetched: 0, inserted: 0, windows: 0, hwm: oldMark ? new Date(oldMark).toISOString() : null };

    while (from < windowEnd) {
        const to = Math.min(from + MAX_WINDOW_MS, windowEnd);
        const read = await readWindow(deps.ksef, token, SUBJECT[direction], from, to, ctx.signal, ctx.log);
        if (ctx.signal.aborted) throw new RetrievalError('aborted before committing KSeF rows');
        const rows = read.invoices.map(mapInvoice);
        out.windows++;
        out.fetched += rows.length;

        if (ctx.shadow) {
            const existing = rows.length
                ? (await ctx.db.query(EXISTING_SQL, [client.firm_id, client.nip, rows.map(r => r.ksef_number)])).rows[0].existing
                : 0;
            out.inserted += rows.length - existing;
            break; // shadow moves no mark, so a further window would only re-read the same range
        }

        const res = await ctx.db.query((direction === 'sales' ? COMMIT_SALES_SQL : COMMIT_PURCHASE_SQL), [
            JSON.stringify(rows), client.firm_id, client.nip, iso(read.hwmMs), client.id,
            committedMark ? new Date(committedMark).toISOString() : null,
        ]);
        const { inserted, advanced } = res.rows[0];
        out.inserted += inserted;
        if (!advanced) {
            // Someone else moved the mark since we read it (rows are stored regardless - they are idempotent).
            // Stop rather than chain windows off a stale value.
            ctx.log(`${client.nip} ${direction}: mark changed under us; stopping this direction for this run`);
            break;
        }
        committedMark = new Date(read.hwmMs);
        out.hwm = committedMark.toISOString();

        if (to >= windowEnd) break;        // last window done
        if (read.hwmMs <= from) break;     // no progress: never spin
        from = read.hwmMs;
    }
    return out;
}

// ---- the job ---------------------------------------------------------------------------------------------------------

export interface RetrievalScope {
    /** Manual run for one client only (from POST /api/clients/[id]/sync). Absent = every sync-enabled client. */
    clientId?: number;
    firmId?: number;
}

export async function retrieveForClient(ctx: JobContext, deps: InvoiceRetrievalDeps, client: ClientRow) {
    if (client.auth_method === 'certificate') throw new RetrievalError(CERTIFICATE_SYNC_UNSUPPORTED);
    if (!client.ksef_token_encrypted) {
        throw new RetrievalError('no KSeF token is configured for this client');
    }
    const token = deps.decryptToken(client.ksef_token_encrypted, client.id);
    const access = await deps.ksef.authenticate(client.nip, token);
    try {
        // Each direction has its own mark and window, so one failing does not stop the other; the failure is still reported.
        const outcomes: DirectionOutcome[] = [];
        const errors: string[] = [];
        for (const direction of ['sales', 'purchase'] as const) {
            try {
                outcomes.push(await syncDirection(ctx, deps, client, access, direction));
            } catch (err) {
                errors.push(`${direction}: ${message(err)}`);
            }
        }
        if (errors.length) throw new RetrievalError(errors.join(' | '));
        return outcomes;
    } finally {
        // Best effort, like the workflow's Close Session. terminate() never throws.
        await deps.ksef.terminate(access).catch(() => {});
    }
}

async function recordStatus(db: Db, client: ClientRow, error: string | null) {
    if (error === null) {
        await db.query('UPDATE clients SET last_sync_success = NOW(), last_sync_error = NULL WHERE id = $1 AND firm_id = $2', [client.id, client.firm_id]);
    } else {
        await db.query('UPDATE clients SET last_sync_error = $1 WHERE id = $2 AND firm_id = $3', [error.slice(0, 1000), client.id, client.firm_id]);
    }
}

export function invoiceRetrievalJob(deps: InvoiceRetrievalDeps): Job {
    return {
        name: 'invoice-retrieval',
        schedule: { kind: 'every', minutes: 30 },
        timeoutMs: 25 * 60_000,
        maxAttempts: 2,
        lookbackMinutes: 60,
        async run(ctx): Promise<JobResult> {
            const scope: RetrievalScope = (ctx.payload as RetrievalScope | null) ?? {};
            // A client-specific, firm-scoped manual run overrides the scheduled-sync switch.
            const clients = await ctx.db.query(
                `SELECT id, nip, firm_id, client_name, auth_method, ksef_token_encrypted, hwm_sales, hwm_purchases, last_sync_error
                   FROM clients
                  WHERE (sync_enabled = true OR ($1::int IS NOT NULL AND $2::int IS NOT NULL))
                    AND ($1::int IS NULL OR id = $1::int)
                    AND ($2::int IS NULL OR firm_id = $2::int)
                  ORDER BY firm_id, id`,
                [scope.clientId ?? null, scope.firmId ?? null]
            );

            const failures: JobFailure[] = [];
            const perClient: unknown[] = [];
            let processed = 0;
            let skipped = 0;
            for (const client of clients.rows as ClientRow[]) {
                if (ctx.signal.aborted) throw new Error('invoice-retrieval aborted (timeout or lost lease)');
                try {
                    if (client.auth_method === 'certificate') {
                        if (!ctx.shadow && client.last_sync_error !== CERTIFICATE_SYNC_UNSUPPORTED) {
                            await recordStatus(ctx.db, client, CERTIFICATE_SYNC_UNSUPPORTED);
                        }
                        perClient.push({ nip: client.nip, status: 'certificate-auth-unsupported' });
                        skipped++;
                        continue;
                    }
                    const outcomes = await retrieveForClient(ctx, deps, client);
                    perClient.push({ nip: client.nip, outcomes });
                    if (!ctx.shadow) await recordStatus(ctx.db, client, null);
                    processed++;
                } catch (err: any) {
                    if (ctx.signal.aborted) throw err;
                    if (err instanceof RetrievalConfigError || err?.name === 'MissingCredentialKeyError') throw err;
                    const text = message(err);
                    failures.push({ subject: `client ${client.client_name} (${client.nip})`, error: text, firmId: client.firm_id, clientNip: client.nip });
                    if (!ctx.shadow) {
                        // Visible on the client, not just in an alert. A failure to record this must not hide the failure itself.
                        await recordStatus(ctx.db, client, text).catch(e => ctx.log(`could not record sync error for ${client.nip}: ${message(e)}`));
                    }
                }
            }
            return { processed, skipped, failures, detail: { clients: clients.rows.length, perClient } };
        },
    };
}
