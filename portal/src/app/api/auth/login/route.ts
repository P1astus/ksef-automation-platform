import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { query } from '@/lib/db';
import { createSession } from '@/lib/auth';

export async function POST(request: Request) {
    try {
        const { email, password } = await request.json();

        if (!email || !password) {
            return NextResponse.json(
                { error: 'Email and password are required' },
                { status: 400 }
            );
        }

        // Find the firm by admin email — the owner login path.
        const result = await query(
            'SELECT id, admin_password_hash, is_active FROM firms WHERE admin_email = $1',
            [email]
        );

        if (result.rows.length > 0) {
            const firm = result.rows[0];

            if (!firm.is_active) {
                return NextResponse.json(
                    { error: 'This account has been deactivated' },
                    { status: 403 }
                );
            }

            const isValid = await bcrypt.compare(password, firm.admin_password_hash);
            if (!isValid) {
                return NextResponse.json(
                    { error: 'Invalid email or password' },
                    { status: 401 }
                );
            }

            await createSession(firm.id, email, 'owner', null);
            return NextResponse.json({ success: true, redirectUrl: '/dashboard' });
        }

        // Not a firm owner — try an invited team member. firm_users.email is
        // only unique per-firm (UNIQUE(firm_id, email)), so this can match
        // more than one row across different firms; bcrypt.compare against
        // each is the only way to know which one (if any) is this login.
        const memberResult = await query(
            'SELECT id, firm_id, password_hash, role, is_active FROM firm_users WHERE email = $1',
            [email]
        );

        for (const member of memberResult.rows) {
            if (!member.is_active) continue;
            if (await bcrypt.compare(password, member.password_hash)) {
                await createSession(member.firm_id, email, member.role, member.id);
                return NextResponse.json({ success: true, redirectUrl: '/dashboard' });
            }
        }

        return NextResponse.json(
            { error: 'Invalid email or password' },
            { status: 401 }
        );

    } catch (error) {
        console.error('Login error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
