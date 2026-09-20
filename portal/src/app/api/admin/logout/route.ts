import { NextResponse } from 'next/server';
import { clearOperatorCookie, getOperatorSession, auditOperator } from '@/lib/operator-auth';
import { requireCapability } from '@/lib/capability-guard';

export async function POST() {
    const off = requireCapability('operatorConsole');
    if (off) return off;
    const session = await getOperatorSession();
    if (session) await auditOperator({ operatorId: session.operatorId, email: session.email, action: 'logout' });
    await clearOperatorCookie();
    return NextResponse.json({ ok: true });
}
