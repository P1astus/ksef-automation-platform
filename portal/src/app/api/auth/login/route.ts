import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { query } from '@/lib/db';
import { createSession } from '@/lib/auth';
import { tierHasFeature } from '@/lib/plans';
import { consumeRateLimit, rateLimitResponse, requestIp } from '@/lib/rate-limit';

export async function POST(request: Request) {
    try {
        const { email, password } = await request.json();

        if (!email || !password) {
            return NextResponse.json(
                { error: 'Email and password are required' },
                { status: 400 }
            );
        }

        const ipLimit = await consumeRateLimit('login-ip', requestIp(request), 30, 15 * 60 * 1000);
        if (!ipLimit.allowed) return rateLimitResponse(ipLimit);
        const emailLimit = await consumeRateLimit('login-email', String(email), 10, 15 * 60 * 1000);
        if (!emailLimit.allowed) return rateLimitResponse(emailLimit);

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
        // Joins firms.is_active too — a deactivated firm previously only
        // locked out the owner login path above; an invited member's own
        // is_active flag says nothing about the firm's, so they could log in
        // (and stay logged in, since nothing re-checks per request) after a
        // billing lapse or ops deactivation indefinitely.
        const memberResult = await query(
            `SELECT fu.id, fu.firm_id, fu.password_hash, fu.role, fu.is_active, f.subscription_tier
             FROM firm_users fu JOIN firms f ON f.id = fu.firm_id
             WHERE fu.email = $1 AND f.is_active = true`,
            [email]
        );

        let blockedByPlan = false;
        for (const member of memberResult.rows) {
            if (!member.is_active) continue;
            // Team seats are a Biznes+ feature; a downgraded firm's members are locked out
            // (getSession() enforces the same for sessions that already exist).
            if (!tierHasFeature(member.subscription_tier, 'team')) {
                // Only reveal the plan reason once the password is right.
                if (await bcrypt.compare(password, member.password_hash)) blockedByPlan = true;
                continue;
            }
            if (await bcrypt.compare(password, member.password_hash)) {
                await createSession(member.firm_id, email, member.role, member.id);
                return NextResponse.json({ success: true, redirectUrl: '/dashboard' });
            }
        }

        if (blockedByPlan) {
            return NextResponse.json(
                { error: 'Plan Twojego biura nie obejmuje kont zespołu. Skontaktuj się z właścicielem konta.', code: 'PLAN_UPGRADE_REQUIRED', feature: 'team' },
                { status: 403 }
            );
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
