import { NextResponse } from 'next/server';
import { clearOperatorCookie, getOperatorSession, auditOperator } from '@/lib/operator-auth';

export async function POST() {
    const session = await getOperatorSession();
    if (session) await auditOperator({ operatorId: session.operatorId, email: session.email, action: 'logout' });
    await clearOperatorCookie();
    return NextResponse.json({ ok: true });
}
