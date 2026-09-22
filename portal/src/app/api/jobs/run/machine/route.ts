import { capabilities } from '@/lib/deployment';
import { requireLicenceWrite } from '@/lib/entitlements';
import { NextResponse } from 'next/server';
import { safeEqual } from '@/lib/auth';
import { query } from '@/lib/db';
import { enqueueManual } from '@/lib/jobs/manual';

export async function POST(request: Request) {
    const secret = process.env.JOB_SECRET;
    if (!secret) return NextResponse.json({ error: 'JOB_SECRET is not configured' }, { status: 503 });
    if (!safeEqual(request.headers.get('authorization') || '', `Bearer ${secret}`)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (capabilities().accessProvider === 'licence') {
        const firm = await query('SELECT id FROM firms WHERE is_active = true LIMIT 1');
        if (firm.rows[0]) { const licenceError = await requireLicenceWrite(firm.rows[0].id); if (licenceError) return licenceError; }
    }
    const body = await request.json().catch(() => ({}));
    if (typeof body.jobName !== 'string' || !body.jobName) {
        return NextResponse.json({ error: 'jobName is required' }, { status: 400 });
    }
    try {
        const queued = await enqueueManual({ query }, body.jobName);
        return NextResponse.json(queued, { status: 202 });
    } catch (error) {
        if (error instanceof Error && error.message.startsWith('Job unavailable:')) {
            return NextResponse.json({ error: error.message }, { status: 503 });
        }
        if (error instanceof Error && error.message.startsWith('Unknown job:')) {
            return NextResponse.json({ error: error.message }, { status: 404 });
        }
        throw error;
    }
}
