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

        // Find the firm by admin email
        const result = await query(
            'SELECT id, admin_password_hash, is_active FROM firms WHERE admin_email = $1',
            [email]
        );

        if (result.rows.length === 0) {
            return NextResponse.json(
                { error: 'Invalid email or password' },
                { status: 401 }
            );
        }

        const firm = result.rows[0];

        if (!firm.is_active) {
            return NextResponse.json(
                { error: 'This account has been deactivated' },
                { status: 403 }
            );
        }

        // Check password
        console.log('Login attempt:', email);
        console.log('Provided password length:', password.length);
        console.log('Hash from DB:', firm.admin_password_hash);
        console.log('Hash length:', firm.admin_password_hash?.length);

        const isValid = await bcrypt.compare(password, firm.admin_password_hash);

        if (!isValid) {
            console.log('Password comparison failed for', email);
            return NextResponse.json(
                { error: 'Invalid email or password' },
                { status: 401 }
            );
        }

        // Create session cookie
        await createSession(firm.id, email);

        return NextResponse.json({ success: true, redirectUrl: '/dashboard' });

    } catch (error) {
        console.error('Login error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
