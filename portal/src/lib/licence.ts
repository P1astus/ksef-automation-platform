import { createPublicKey, verify, KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isPlanId, PLAN_MAX_CLIENTS, PlanId } from './plans';
import { query } from './db';

export interface LicencePayload {
    version: 1;
    firm_name: string;
    firm_nip: string;
    plan: PlanId;
    max_clients: number;
    issued_at: string;
    expires_on: string;
}
export class LicenceError extends Error {
    constructor(message: string) { super(message); this.name = 'LicenceError'; }
}
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const B64 = /^[A-Za-z0-9_-]+$/;

export function licencePublicKey(path = process.env.LICENCE_PUBLIC_KEY_PATH): KeyObject {
    const encoded = process.env.LICENCE_PUBLIC_KEY_BASE64;
    if (!path && !encoded) throw new LicenceError('LICENCE_PUBLIC_KEY_PATH or LICENCE_PUBLIC_KEY_BASE64 is required in licence mode');
    try {
        const material = path ? readFileSync(path) : Buffer.from(encoded!, 'base64');
        const key = createPublicKey(material);
        if (key.asymmetricKeyType !== 'ed25519') throw new Error('expected Ed25519');
        return key;
    } catch { throw new LicenceError('Licence public key must be valid Ed25519 PEM'); }
}

export function verifyLicence(blob: string, key: KeyObject, now = new Date()): LicencePayload {
    if (typeof blob !== 'string' || blob.length > 16384) throw new LicenceError('Malformed licence file');
    let parsed: unknown;
    try { parsed = JSON.parse(blob); } catch { throw new LicenceError('Malformed licence file'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new LicenceError('Malformed licence file');
    const envelope = parsed as Record<string, unknown>;
    if (Object.keys(envelope).sort().join(',') !== 'payload,signature' || typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string' || !B64.test(envelope.payload) || !B64.test(envelope.signature)) throw new LicenceError('Malformed licence file');
    const payloadBytes = Buffer.from(envelope.payload, 'base64url');
    const signature = Buffer.from(envelope.signature, 'base64url');
    if (signature.length !== 64 || !verify(null, payloadBytes, key, signature)) throw new LicenceError('Invalid licence signature');
    let value: unknown;
    try { value = JSON.parse(payloadBytes.toString('utf8')); } catch { throw new LicenceError('Invalid licence payload'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LicenceError('Invalid licence payload');
    const p = value as Record<string, unknown>;
    if (Object.keys(p).sort().join(',') !== 'expires_on,firm_name,firm_nip,issued_at,max_clients,plan,version' || p.version !== 1 || typeof p.firm_name !== 'string' || !p.firm_name.trim() || typeof p.firm_nip !== 'string' || !/^\d{10}$/.test(p.firm_nip) || !isPlanId(p.plan) || !Number.isSafeInteger(p.max_clients) || (p.max_clients as number) <= 0 || (p.max_clients as number) > PLAN_MAX_CLIENTS[p.plan] || typeof p.issued_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(p.issued_at) || !Number.isFinite(Date.parse(p.issued_at)) || new Date(p.issued_at).toISOString() !== p.issued_at || typeof p.expires_on !== 'string' || !ISO_DAY.test(p.expires_on) || new Date(`${p.expires_on}T00:00:00.000Z`).toISOString().slice(0, 10) !== p.expires_on) throw new LicenceError('Invalid licence payload');
    if (now.getTime() < Date.parse(p.issued_at)) throw new LicenceError('System clock is before licence issue date');
    return p as unknown as LicencePayload;
}
export function licenceExpiresAt(p: LicencePayload): Date { return new Date(Date.parse(`${p.expires_on}T00:00:00.000Z`) + 86400000); }
export function licenceExpired(p: LicencePayload, now = new Date()): boolean { return now >= licenceExpiresAt(p); }
export function licenceWarningDays(p: LicencePayload, now = new Date()): number | null {
    const days = Math.ceil((licenceExpiresAt(p).getTime() - now.getTime()) / 86400000);
    return days <= 30 ? Math.max(0, days) : null;
}
export async function loadFirmLicence(firmId: number, now = new Date()): Promise<{ payload: LicencePayload | null; state: 'licence_missing' | 'licence_expired' | 'ok' }> {
    const res = await query(`SELECT f.firm_nip, f.firm_name, f.subscription_tier, f.subscription_status,
        f.max_clients, f.trial_expires_at, l.signed_blob
        FROM firms f LEFT JOIN firm_licences l ON l.firm_id = f.id WHERE f.id = $1`, [firmId]);
    const row = res.rows[0];
    if (!row?.signed_blob) return { payload: null, state: 'licence_missing' };
    const payload = verifyLicence(row.signed_blob, licencePublicKey(), now);
    if (payload.firm_nip !== row.firm_nip) throw new LicenceError('Licence NIP does not match firm NIP');
    if (payload.firm_name !== row.firm_name) throw new LicenceError('Licence firm name does not match');
    const expiresAt = licenceExpiresAt(payload);
    const expired = licenceExpired(payload, now);
    // These columns serve existing plan/cap readers. Repair them from the signature on every check;
    // changing an unsigned DB column must never raise a tier/cap or postpone expiry.
    const repaired = await query(`UPDATE firms SET subscription_tier = $2, max_clients = $3,
        trial_expires_at = $4, subscription_status = $5 WHERE id = $1 AND (
        subscription_tier IS DISTINCT FROM $2 OR max_clients IS DISTINCT FROM $3 OR
        trial_expires_at IS DISTINCT FROM $4 OR subscription_status IS DISTINCT FROM $5)
        RETURNING id`, [firmId, payload.plan, payload.max_clients, expiresAt, expired ? 'canceled' : 'active']);
    if (expired) {
        await query(`INSERT INTO audit_log (firm_id, action, workflow_name, details, success)
            SELECT $1, 'licence_expired', 'licence', $2::jsonb, true
            WHERE NOT EXISTS (
                SELECT 1 FROM audit_log
                WHERE firm_id = $1 AND action = 'licence_expired'
                  AND details->>'expires_on' = $3
            )`, [firmId, JSON.stringify({ expires_on: payload.expires_on }), payload.expires_on]);
    }
    return { payload, state: expired ? 'licence_expired' : 'ok' };
}
export async function assertLicenceStartup(): Promise<void> {
    const key = licencePublicKey();
    const res = await query('SELECT f.firm_nip, f.firm_name, l.signed_blob FROM firm_licences l JOIN firms f ON f.id = l.firm_id');
    for (const row of res.rows) {
        const p = verifyLicence(row.signed_blob, key);
        if (p.firm_nip !== row.firm_nip) throw new LicenceError('Licence NIP does not match firm NIP');
        if (p.firm_name !== row.firm_name) throw new LicenceError('Licence firm name does not match');
    }
}

export async function refreshLicenceStates(now = new Date()): Promise<void> {
    const firms = await query('SELECT id FROM firms WHERE is_active = true');
    for (const firm of firms.rows) await loadFirmLicence(firm.id, now);
}
