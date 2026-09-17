import { query } from '@/lib/db';

// activity_log is never created by the base schema or any tracked
// migration — only lazily by dashboard/page.tsx and api/activity/route.ts
// (both `CREATE TABLE IF NOT EXISTS`, same shape below). Round 11 fix: this
// function is called from clients/[id]/erase, clients/[id]/request-
// documents, team/route.ts, invoice creation, and OCR approve/reject —  on
// a fresh DB where neither of those two lazy-creators has run yet, the very
// first call here failed against a genuinely missing table and the
// surrounding catch swallowed it, silently losing that log entry forever.
export async function logActivity(firmId: number, eventType: string, description: string) {
    try {
        await query(`
            CREATE TABLE IF NOT EXISTS activity_log (
                id SERIAL PRIMARY KEY,
                firm_id INT NOT NULL,
                event_type VARCHAR(50) NOT NULL,
                description TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await query(
            `INSERT INTO activity_log (firm_id, event_type, description) VALUES ($1, $2, $3)`,
            [firmId, eventType, description]
        );
    } catch {
        // Non-critical — never let activity logging break main flow
    }
}
