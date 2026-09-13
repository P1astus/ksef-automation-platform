import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function POST() {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await query(
        'UPDATE firms SET onboarding_complete = true WHERE id = $1',
        [session.firmId]
    );

    return NextResponse.json({ success: true });
}
