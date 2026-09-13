import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET() {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Ensure table exists (idempotent)
    await query(`
        CREATE TABLE IF NOT EXISTS activity_log (
            id SERIAL PRIMARY KEY,
            firm_id INT NOT NULL,
            event_type VARCHAR(50) NOT NULL,
            description TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    const result = await query(`
        SELECT id, event_type, description, created_at
        FROM activity_log
        WHERE firm_id = $1
        ORDER BY created_at DESC
        LIMIT 15
    `, [session.firmId]);

    return NextResponse.json({ activity: result.rows });
}
