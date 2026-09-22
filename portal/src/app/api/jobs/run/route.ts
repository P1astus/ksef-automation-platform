import { requireLicenceWrite } from '@/lib/entitlements';
import { NextResponse } from 'next/server';
import { getSession, sessionRole } from '@/lib/auth';
import { getOperatorSession } from '@/lib/operator-auth';
import { query } from '@/lib/db';
import { verifySameOrigin } from '@/lib/csrf';
import { resolveDeployment } from '@/lib/deployment';
import { enqueueManual } from '@/lib/jobs/manual';

export async function POST(request: Request) {
    const origin = verifySameOrigin(request);
    if (!origin.ok) return NextResponse.json({ error: origin.error }, { status: 403 });

    const [tenant, operator] = await Promise.all([getSession(), getOperatorSession()]);
    if (!operator && (!tenant || sessionRole(tenant) !== 'owner')) {
        return NextResponse.json({ error: tenant ? 'Brak uprawnień do tej operacji' : 'Unauthorized' }, { status: tenant ? 403 : 401 });
    }


    const licenceError = tenant ? await requireLicenceWrite(tenant.firmId) : null;
    if (licenceError) return licenceError;
    if (!operator && resolveDeployment(process.env).operatorConsole) {
        return NextResponse.json({ error: 'Global jobs require an operator session; use client sync for your firm' }, { status: 403 });
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
