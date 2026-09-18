import { NextResponse } from 'next/server';
import { verifyOperatorLogin, setOperatorCookie, auditOperator, clientIp } from '@/lib/operator-auth';

export async function POST(request: Request) {
    const body = await request.json().catch(() => ({}));
    const email = typeof body.email === 'string' ? body.email : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) return NextResponse.json({ error: 'Podaj e-mail i hasło' }, { status: 400 });

    const result = await verifyOperatorLogin(email, password, await clientIp());
    if (!result.ok) {
        await auditOperator({ operatorId: null, email: email.trim().toLowerCase(), action: result.reason === 'throttled' ? 'login_throttled' : 'login_failed' });
        return result.reason === 'throttled'
            ? NextResponse.json({ error: 'Zbyt wiele prób. Spróbuj ponownie później.' }, { status: 429 })
            : NextResponse.json({ error: 'Nieprawidłowy e-mail lub hasło' }, { status: 401 });
    }
    await setOperatorCookie(result.operatorId, result.email);
    await auditOperator({ operatorId: result.operatorId, email: result.email, action: 'login' });
    return NextResponse.json({ ok: true });
}
