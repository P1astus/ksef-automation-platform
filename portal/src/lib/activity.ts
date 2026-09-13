import { query } from '@/lib/db';

export async function logActivity(firmId: number, eventType: string, description: string) {
    try {
        await query(
            `INSERT INTO activity_log (firm_id, event_type, description) VALUES ($1, $2, $3)`,
            [firmId, eventType, description]
        );
    } catch {
        // Non-critical — never let activity logging break main flow
    }
}
