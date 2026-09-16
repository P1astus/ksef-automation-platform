import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { query } from '@/lib/db';
import { createSession } from '@/lib/auth';
import { sendWelcome } from '@/lib/email';
import { PLAN_MAX_CLIENTS } from '@/lib/plans';

function generateSlug(firmName: string): string {
    const map: Record<string, string> = {
        ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n',
        ó: 'o', ś: 's', ź: 'z', ż: 'z',
    };
    const base = firmName
        .toLowerCase()
        .replace(/[ąćęłńóśźż]/g, (c) => map[c] || c)
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    const suffix = Math.floor(1000 + Math.random() * 9000);
    return `${base}-${suffix}`;
}

export async function POST(request: Request) {
    try {
        const { firm_name, firm_nip, admin_email, password, plan } = await request.json();

        // Validate required fields
        if (!firm_name || !admin_email || !password) {
            return NextResponse.json(
                { error: 'Nazwa firmy, e-mail i hasło są wymagane' },
                { status: 400 }
            );
        }

        if (password.length < 8) {
            return NextResponse.json(
                { error: 'Hasło musi mieć co najmniej 8 znaków' },
                { status: 400 }
            );
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(admin_email)) {
            return NextResponse.json(
                { error: 'Nieprawidłowy adres e-mail' },
                { status: 400 }
            );
        }

        if (firm_nip && !/^\d{10}$/.test(firm_nip.replace(/[-\s]/g, ''))) {
            return NextResponse.json(
                { error: 'NIP musi mieć 10 cyfr' },
                { status: 400 }
            );
        }

        // Check email uniqueness
        const existing = await query(
            'SELECT id FROM firms WHERE admin_email = $1',
            [admin_email.toLowerCase()]
        );
        if (existing.rows.length > 0) {
            return NextResponse.json(
                { error: 'Konto z tym adresem e-mail już istnieje' },
                { status: 409 }
            );
        }

        const subscriptionTier = PLAN_MAX_CLIENTS[plan] ? plan : 'start';
        const maxClients = PLAN_MAX_CLIENTS[subscriptionTier];
        const passwordHash = await bcrypt.hash(password, 10);

        // Try inserting with a unique slug (retry once on collision)
        let firm: { id: number } | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
            const slug = generateSlug(firm_name);
            try {
                const result = await query(
                    `INSERT INTO firms
                        (firm_name, firm_nip, slug, admin_email, admin_password_hash,
                         subscription_tier, max_clients, trial_expires_at, is_active)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + INTERVAL '30 days', true)
                     RETURNING id`,
                    [
                        firm_name.trim(),
                        firm_nip ? firm_nip.replace(/[-\s]/g, '') : null,
                        slug,
                        admin_email.toLowerCase(),
                        passwordHash,
                        subscriptionTier,
                        maxClients,
                    ]
                );
                firm = result.rows[0];
                break;
            } catch (err: any) {
                if (err.code === '23505' && attempt < 2) continue; // slug collision, retry
                throw err;
            }
        }

        if (!firm) throw new Error('Failed to create account after retries');

        await createSession(firm.id, admin_email.toLowerCase());
        sendWelcome(admin_email.toLowerCase(), firm_name.trim()).catch(() => {}); // fire-and-forget

        return NextResponse.json({ success: true, redirectUrl: '/dashboard/onboarding' });

    } catch (error) {
        console.error('Register error:', error);
        return NextResponse.json(
            { error: 'Błąd serwera — spróbuj ponownie' },
            { status: 500 }
        );
    }
}
