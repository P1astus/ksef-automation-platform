import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import LogoutButton from './LogoutButton';
import TrialBanner from './TrialBanner';
import PaywallOverlay from './PaywallOverlay';
import {
    LayoutDashboard,
    Users,
    FileText,
    CreditCard,
    Settings,
    Bell,
    Search,
    Zap,
    FileCheck,
    UsersRound,
} from 'lucide-react';

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await getSession();
    if (!session) redirect('/login?session=ended');

    const result = await query(
        'SELECT firm_name, trial_expires_at, subscription_tier, subscription_status, onboarding_complete FROM firms WHERE id = $1',
        [session.firmId]
    );
    const firm = result.rows[0];
    const firmName = firm?.firm_name || 'KSeF Auto';

    // Redirect to onboarding if not completed
    const headersList = await headers();
    const pathname = headersList.get('x-invoke-path') || headersList.get('x-pathname') || '';
    if (firm && !firm.onboarding_complete && !pathname.includes('/onboarding')) {
        redirect('/dashboard/onboarding');
    }

    const trialExpiresAt = firm?.trial_expires_at ? new Date(firm.trial_expires_at) : null;
    const subscriptionTier = firm?.subscription_tier || 'start';
    const subscriptionStatus = firm?.subscription_status || 'trial';
    const daysLeft = trialExpiresAt
        ? Math.ceil((trialExpiresAt.getTime() - Date.now()) / 86400000)
        : 999;

    // Determine if paywall should be shown (allow billing page so they can pay)
    const isBillingPage = pathname.includes('/billing');
    const trialExpired = subscriptionStatus === 'trial' && daysLeft <= 0;
    const canceled = subscriptionStatus === 'canceled';
    const showPaywall = (trialExpired || canceled) && !isBillingPage;
    const paywallReason: 'expired' | 'canceled' = canceled ? 'canceled' : 'expired';

    const initials = firmName
        .split(' ')
        .slice(0, 2)
        .map((w: string) => w[0] ?? '')
        .join('')
        .toUpperCase();

    const nav = [
        { href: '/dashboard',               label: 'Dashboard',    Icon: LayoutDashboard },
        { href: '/dashboard/clients',       label: 'Klienci',      Icon: Users },
        { href: '/dashboard/invoices',      label: 'Faktury',      Icon: FileText },
        { href: '/dashboard/jpk',           label: 'JPK V7M',      Icon: FileCheck },
        { href: '/dashboard/billing',       label: 'Rozliczenia',  Icon: CreditCard },
        { href: '/dashboard/settings',         label: 'Ustawienia',   Icon: Settings },
        { href: '/dashboard/settings/team',    label: 'Zespół',       Icon: UsersRound },
        { href: '/dashboard/settings/ksef',    label: 'Tokeny KSeF',  Icon: Zap },
    ];

    return (
        <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-base)' }}>

            {/* ── Sidebar ── */}
            <aside style={{
                width: 'var(--sidebar-width)',
                background: 'var(--bg-sidebar)',
                borderRight: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                position: 'fixed',
                top: 0, left: 0, bottom: 0,
                zIndex: 40,
            }}>
                {/* Logo */}
                <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                            width: 34, height: 34, borderRadius: 8,
                            background: 'var(--accent)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0,
                        }}>
                            <Zap size={17} color="#fff" strokeWidth={2.5} />
                        </div>
                        <div>
                            <div style={{ fontWeight: 800, fontSize: 14.5, color: 'var(--text)', letterSpacing: '-0.3px' }}>
                                KSeF Auto
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-subtle)', fontWeight: 500 }}>
                                Platforma KSeF
                            </div>
                        </div>
                    </div>
                </div>

                {/* Nav */}
                <nav style={{ flex: 1, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <div className="label-caps" style={{ padding: '4px 8px 8px' }}>
                        Menu
                    </div>
                    {nav.map(({ href, label, Icon }) => (
                        <Link key={href} href={href} className="sidebar-link">
                            <Icon size={16} strokeWidth={2} style={{ flexShrink: 0 }} />
                            {label}
                        </Link>
                    ))}
                </nav>

                {/* User footer */}
                <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                        <div style={{
                            width: 32, height: 32, borderRadius: '50%',
                            background: 'var(--accent-dim)',
                            border: '1px solid var(--accent)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'var(--accent)', fontSize: 11, fontWeight: 700, flexShrink: 0,
                        }}>{initials}</div>
                        <div style={{ overflow: 'hidden', flex: 1 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {firmName}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {session.adminEmail}
                            </div>
                        </div>
                    </div>
                    <LogoutButton />
                </div>
            </aside>

            {/* ── Main area ── */}
            <div style={{ marginLeft: 'var(--sidebar-width)', flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

                {/* Top bar */}
                <header style={{
                    background: 'var(--bg-base)',
                    borderBottom: '1px solid var(--border)',
                    padding: '0 28px',
                    height: 58,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    position: 'sticky', top: 0, zIndex: 30,
                    backdropFilter: 'blur(8px)',
                }}>
                    {/* Search */}
                    <div style={{ position: 'relative', width: 260 }}>
                        <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)' }} />
                        <input
                            placeholder="Szukaj..."
                            style={{
                                width: '100%', padding: '7px 12px 7px 32px',
                                border: '1px solid var(--border)', borderRadius: 6,
                                fontSize: 13, color: 'var(--text)',
                                background: 'var(--bg-surface)',
                            }}
                        />
                    </div>

                    {/* Right */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <button style={{
                            width: 34, height: 34, borderRadius: 7,
                            border: '1px solid var(--border)',
                            background: 'var(--bg-surface)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer', color: 'var(--text-muted)',
                            transition: 'all 0.15s ease',
                        }}>
                            <Bell size={15} />
                        </button>
                        <div style={{
                            width: 32, height: 32, borderRadius: '50%',
                            background: 'var(--accent-dim)',
                            border: '1px solid var(--accent)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'var(--accent)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                        }}>{initials}</div>
                    </div>
                </header>

                {/* Trial banner */}
                <TrialBanner daysLeft={daysLeft} tier={subscriptionTier} />

                {/* Paywall overlay */}
                {showPaywall && <PaywallOverlay reason={paywallReason} />}

                {/* Page content */}
                <main style={{ flex: 1, padding: '0 28px 32px', maxWidth: 1400 }}>
                    {children}
                </main>

                <footer style={{ padding: '14px 28px', borderTop: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                        KSeF Auto © 2025 · Automatyzacja KSeF dla biur rachunkowych
                    </span>
                </footer>
            </div>
        </div>
    );
}
