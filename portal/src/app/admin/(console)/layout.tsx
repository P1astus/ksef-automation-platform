import Link from 'next/link';
import { requireOperator } from '@/lib/operator-auth';

export const dynamic = 'force-dynamic';

// The one guard for everything under /admin except /admin/login (which lives
// outside this route group). No operator session -> login.
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
    const session = await requireOperator();
    return (
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: '24px 16px' }}>
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 8 }}>
                <nav style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    <Link href="/admin" style={{ fontWeight: 800, fontSize: 16, color: 'var(--text)' }}>Konsola operatora</Link>
                    <Link href="/admin/audit" style={{ fontSize: 13, color: 'var(--accent-hover)' }}>Dziennik audytu</Link>
                </nav>
                <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                    {session.email} · <a href="/admin/logout" style={{ color: 'var(--accent-hover)' }}>Wyloguj</a>
                </span>
            </header>
            {children}
        </div>
    );
}
