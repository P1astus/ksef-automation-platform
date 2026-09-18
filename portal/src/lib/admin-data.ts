import { query } from './db';

// Read-only queries for the vendor console. Deliberately expose operational
// metadata and counts only - never password hashes, reset tokens, stored KSeF
// tokens/certificates, Stripe ids, or invoice content.

export interface FirmSummary {
    id: number;
    firm_name: string;
    admin_email: string;
    subscription_tier: string | null;
    subscription_status: string | null;
    is_active: boolean;
    trial_expires_at: string | null;
    max_clients: number | null;
    created_at: string;
    clients: number;
    invoices: number;
    members: number;
    offline_open: number;
    offline_overdue: number;
    clients_sync_errors: number;
    last_sync: string | null;
}

const FIRM_SUMMARY_SQL = `
    SELECT f.id, f.firm_name, f.admin_email, f.subscription_tier, f.subscription_status, f.is_active,
           f.trial_expires_at, f.max_clients, f.created_at,
           (SELECT COUNT(*) FROM clients c WHERE c.firm_id = f.id)::int AS clients,
           (SELECT COUNT(*) FROM invoices i WHERE i.firm_id = f.id)::int AS invoices,
           (SELECT COUNT(*) FROM firm_users u WHERE u.firm_id = f.id AND u.is_active)::int AS members,
           (SELECT COUNT(*) FROM offline_invoices o WHERE o.firm_id = f.id AND o.uploaded_to_ksef = false)::int AS offline_open,
           (SELECT COUNT(*) FROM offline_invoices o WHERE o.firm_id = f.id AND o.uploaded_to_ksef = false AND o.upload_deadline < NOW())::int AS offline_overdue,
           (SELECT COUNT(*) FROM clients c WHERE c.firm_id = f.id AND c.last_sync_error IS NOT NULL)::int AS clients_sync_errors,
           (SELECT MAX(c.last_sync_success) FROM clients c WHERE c.firm_id = f.id) AS last_sync
    FROM firms f`;

// Firms with overdue offline24 uploads first - the legally urgent ones.
export async function listFirms(limit = 500): Promise<FirmSummary[]> {
    const res = await query(`${FIRM_SUMMARY_SQL} ORDER BY offline_overdue DESC, clients_sync_errors DESC, f.created_at DESC LIMIT $1`, [limit]);
    return res.rows;
}

export interface FleetTotals {
    firms: number;
    active_firms: number;
    trialing: number;
    offline_overdue: number;
    clients: number;
}

export async function fleetTotals(): Promise<FleetTotals> {
    const res = await query(`
        SELECT (SELECT COUNT(*) FROM firms)::int AS firms,
               (SELECT COUNT(*) FROM firms WHERE is_active)::int AS active_firms,
               (SELECT COUNT(*) FROM firms WHERE subscription_status = 'trial' AND (trial_expires_at IS NULL OR trial_expires_at > NOW()))::int AS trialing,
               (SELECT COUNT(*) FROM offline_invoices WHERE uploaded_to_ksef = false AND upload_deadline < NOW())::int AS offline_overdue,
               (SELECT COUNT(*) FROM clients)::int AS clients`);
    return res.rows[0];
}

export interface FirmDetail {
    firm: FirmSummary;
    clients: Array<{ id: number; client_name: string | null; nip: string; auth_method: string | null; sync_enabled: boolean; last_sync_success: string | null; last_sync_error: string | null; anonymized_at: string | null }>;
    members: Array<{ id: number; email: string; role: string; is_active: boolean; created_at: string }>;
    invoicesByStatus: Array<{ processing_status: string; count: number }>;
    offlineQueue: Array<{ id: number; client_nip: string; invoice_number: string; offline_mode: string; upload_deadline: string }>;
}

export async function getFirmDetail(firmId: number): Promise<FirmDetail | null> {
    const firmRes = await query(`${FIRM_SUMMARY_SQL} WHERE f.id = $1`, [firmId]);
    if (!firmRes.rows[0]) return null;
    const [clients, members, byStatus, offline] = await Promise.all([
        query(`SELECT id, client_name, nip, auth_method, sync_enabled, last_sync_success, last_sync_error, anonymized_at
               FROM clients WHERE firm_id = $1 ORDER BY client_name NULLS LAST, id LIMIT 500`, [firmId]),
        query(`SELECT id, email, role, is_active, created_at FROM firm_users WHERE firm_id = $1 ORDER BY created_at`, [firmId]),
        query(`SELECT processing_status, COUNT(*)::int AS count FROM invoices WHERE firm_id = $1 GROUP BY processing_status ORDER BY processing_status`, [firmId]),
        query(`SELECT id, client_nip, invoice_number, offline_mode, upload_deadline
               FROM offline_invoices WHERE firm_id = $1 AND uploaded_to_ksef = false ORDER BY upload_deadline ASC LIMIT 50`, [firmId]),
    ]);
    return { firm: firmRes.rows[0], clients: clients.rows, members: members.rows, invoicesByStatus: byStatus.rows, offlineQueue: offline.rows };
}
