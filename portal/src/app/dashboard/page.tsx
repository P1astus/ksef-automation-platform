import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { InvoiceAreaChart, ClientBarChart } from './Charts';
import { AnalyticsCards } from './AnalyticsCards';
import {
    Users, FileText, TrendingUp, TrendingDown, BarChart2,
    Plus, Search, List, ChevronRight, Zap, CheckCircle, AlertCircle,
    RefreshCw, Download, UserPlus, Key, Activity,
} from 'lucide-react';

export default async function DashboardPage() {
    const session = await getSession();
    if (!session) redirect('/login');

    const firmRes = await query('SELECT firm_name, max_clients, subscription_tier FROM firms WHERE id = $1', [session.firmId]);
    const firm = firmRes.rows[0];

    const clientsRes = await query('SELECT COUNT(*) as count FROM clients WHERE firm_id = $1', [session.firmId]);
    const clientCount = parseInt(clientsRes.rows[0].count);

    // Anchored directly on invoices.firm_id, not a client_nip join — a NIP
    // can belong to more than one firm since D1, so a join without firm_id
    // in the ON clause could pull in another firm's invoices for a shared
    // NIP (invoices already carries its own firm_id, no join needed at all).
    const invoiceRes = await query(`
        SELECT processing_status, COUNT(*) as count
        FROM invoices i
        WHERE i.firm_id = $1 GROUP BY processing_status
    `, [session.firmId]);
    const stats = invoiceRes.rows.reduce((acc: Record<string, number>, row: { processing_status: string; count: string }) => {
        acc[row.processing_status] = parseInt(row.count); return acc;
    }, {});
    const totalInvoices = (Object.values(stats) as number[]).reduce((a, b) => a + b, 0) || 0;

    const weekRes = await query(`
        SELECT TO_CHAR(i.created_at::date, 'DD.MM') as day, COUNT(*) as count
        FROM invoices i
        WHERE i.firm_id = $1 AND i.created_at >= NOW() - INTERVAL '7 days'
        GROUP BY i.created_at::date ORDER BY i.created_at::date
    `, [session.firmId]);

    const today = new Date();
    const chartData = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - (6 - i));
        const label = d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
        const found = weekRes.rows.find((r: { day: string; count: string }) => r.day === label);
        return { day: label, count: found ? parseInt(found.count) : 0 };
    });

    const dirRes = await query(`
        SELECT direction, COUNT(*) as count
        FROM invoices i
        WHERE i.firm_id = $1 GROUP BY direction
    `, [session.firmId]);
    const barData = [
        { name: 'Sprzedaż', value: parseInt(dirRes.rows.find((r: { direction: string }) => r.direction === 'sales')?.count || '0') },
        { name: 'Zakup', value: parseInt(dirRes.rows.find((r: { direction: string }) => r.direction === 'purchase')?.count || '0') },
    ];

    const clientUsagePct = Math.round((clientCount / firm.max_clients) * 100);
    const tierLabel: Record<string, string> = { start: 'Start', biznes: 'Biznes', pro: 'Pro', enterprise: 'Enterprise' };
    const tier = firm.subscription_tier || 'start';

    const metrics = [
        {
            label: 'Aktywni klienci',
            value: clientCount,
            sub: `z ${firm.max_clients} dostępnych`,
            Icon: Users,
            trend: null,
            gradient: 'card-stat-violet',
            iconColor: '#a78bfa',
        },
        {
            label: 'Pobrane faktury',
            value: totalInvoices.toLocaleString('pl'),
            sub: 'łącznie w bazie',
            Icon: FileText,
            trend: null,
            gradient: 'card-stat-indigo',
            iconColor: '#818cf8',
        },
        {
            label: 'Faktury sprzedaży',
            value: barData[0].value.toLocaleString('pl'),
            sub: 'wystawione',
            Icon: TrendingUp,
            trend: 'up',
            gradient: 'card-stat-emerald',
            iconColor: '#34d399',
        },
        {
            label: 'Faktury zakupu',
            value: barData[1].value.toLocaleString('pl'),
            sub: 'otrzymane',
            Icon: TrendingDown,
            trend: 'down',
            gradient: 'card-stat-rose',
            iconColor: '#fb7185',
        },
        {
            label: 'Limit klientów',
            value: `${clientUsagePct}%`,
            sub: 'wykorzystania',
            Icon: BarChart2,
            trend: clientUsagePct > 80 ? 'warn' : null,
            gradient: clientUsagePct > 80 ? 'card-stat-amber' : 'card-stat-indigo',
            iconColor: clientUsagePct > 80 ? '#fbbf24' : '#818cf8',
        },
    ];

    const quickActions = [
        { href: '/dashboard/clients',  Icon: Plus,   label: 'Dodaj nowego klienta' },
        { href: '/dashboard/invoices', Icon: Search, label: 'Przeglądaj faktury' },
        { href: '/dashboard/clients',  Icon: List,   label: 'Lista klientów' },
    ];

    // Real health data from system_health table (written by n8n health-check workflow every 15 min)
    const healthRes = await query(`
        SELECT DISTINCT ON (check_type) check_type, status, checked_at
        FROM system_health
        ORDER BY check_type, checked_at DESC
    `);
    const healthMap: Record<string, { ok: boolean; stale: boolean }> = {};
    const staleThreshold = Date.now() - 30 * 60 * 1000; // 30 min
    for (const row of healthRes.rows) {
        healthMap[row.check_type] = {
            ok: row.status === 'ok' || row.status === 'healthy',
            stale: new Date(row.checked_at).getTime() < staleThreshold,
        };
    }

    // Activity feed
    let activityRows: { id: number; event_type: string; description: string; created_at: string }[] = [];
    try {
        await query(`CREATE TABLE IF NOT EXISTS activity_log (
            id SERIAL PRIMARY KEY, firm_id INT NOT NULL, event_type VARCHAR(50) NOT NULL,
            description TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
        )`);
        const actRes = await query(
            `SELECT id, event_type, description, created_at FROM activity_log WHERE firm_id = $1 ORDER BY created_at DESC LIMIT 8`,
            [session.firmId]
        );
        activityRows = actRes.rows;
    } catch { /* table may not exist yet */ }

    const SERVICE_KEYS: { key: string; label: string }[] = [
        { key: 'ksef_api',   label: 'Synchronizacja KSeF' },
        { key: 'database',   label: 'Baza danych' },
        { key: 'n8n',        label: 'Scheduler n8n' },
        { key: 'xades',      label: 'XAdES Sidecar' },
    ];
    const services = SERVICE_KEYS.map(({ key, label }) => {
        const entry = healthMap[key];
        if (!entry) return { label, ok: null as boolean | null, stale: false }; // no data yet
        return { label, ok: entry.stale ? null : entry.ok, stale: entry.stale };
    });

    return (
        <div>
            {/* ── Page header ── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '28px 0 24px' }}>
                <div>
                    <h1 style={{ fontSize: 21, fontWeight: 800, color: 'var(--text)', margin: 0, letterSpacing: '-0.4px' }}>
                        Dashboard
                    </h1>
                    <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-subtle)' }}>
                        {new Date().toLocaleDateString('pl-PL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                    </p>
                </div>
                <span style={{
                    background: 'var(--accent-dim)', color: 'var(--accent-hover)',
                    fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 100,
                    border: '1px solid rgba(99,102,241,0.25)',
                }}>
                    Plan {tierLabel[tier] || tier}
                </span>
            </div>

            {/* ── Metric cards ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
                {metrics.map((m, i) => (
                    <div key={i} className={`card-stat ${m.gradient}`}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
                            <div style={{
                                width: 36, height: 36, borderRadius: 8,
                                background: `${m.iconColor}18`,
                                border: `1px solid ${m.iconColor}30`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                color: m.iconColor, flexShrink: 0,
                            }}>
                                <m.Icon size={17} strokeWidth={2} />
                            </div>
                            {m.trend === 'warn' && (
                                <span className="badge-down" style={{ fontSize: 10 }}>Wysoki</span>
                            )}
                        </div>
                        <div style={{ fontSize: 27, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.8px', lineHeight: 1, marginBottom: 6 }}>
                            {m.value}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
                            {m.label}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>
                            {m.sub}
                        </div>
                    </div>
                ))}
            </div>

            {/* ── Analytics ── */}
            <AnalyticsCards />

            {/* ── Charts ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, marginBottom: 16 }}>
                <div style={{
                    background: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--border)', padding: '20px 24px',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                        <div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Aktywność faktur</div>
                            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>Ostatnie 7 dni</div>
                        </div>
                        <span style={{
                            fontSize: 10, fontWeight: 600, color: 'var(--accent-hover)',
                            background: 'var(--accent-dim)', border: '1px solid rgba(99,102,241,0.2)',
                            padding: '3px 10px', borderRadius: 100,
                        }}>Tygodniowy</span>
                    </div>
                    <InvoiceAreaChart data={chartData} />
                </div>

                <div style={{
                    background: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--border)', padding: '20px 24px',
                }}>
                    <div style={{ marginBottom: 20 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Typy faktur</div>
                        <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>Sprzedaż vs Zakup</div>
                    </div>
                    <ClientBarChart data={barData} />
                </div>
            </div>

            {/* ── Bottom row ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {/* Quick actions + Activity feed */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {/* Quick actions */}
                    <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', padding: '20px 24px' }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>Szybkie akcje</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {quickActions.map(({ href, Icon, label }) => (
                                <Link key={label} href={href} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', textDecoration: 'none', background: 'var(--bg-base)', transition: 'all 0.15s ease' }}>
                                    <div className="icon-box icon-box-sm"><Icon size={14} strokeWidth={2} /></div>
                                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>{label}</span>
                                    <ChevronRight size={14} style={{ marginLeft: 'auto', color: 'var(--text-subtle)' }} />
                                </Link>
                            ))}
                        </div>
                    </div>

                    {/* Activity feed */}
                    <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', padding: '20px 24px', flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                            <Activity size={14} style={{ color: 'var(--accent)' }} />
                            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Ostatnia aktywność</span>
                        </div>
                        {activityRows.length === 0 ? (
                            <p style={{ fontSize: 13, color: 'var(--text-subtle)', margin: 0 }}>Brak aktywności — zacznij dodawać klientów.</p>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {activityRows.map((row) => {
                                    const iconMap: Record<string, React.ReactNode> = {
                                        client_added: <UserPlus size={12} />,
                                        sync_triggered: <RefreshCw size={12} />,
                                        export: <Download size={12} />,
                                        token_saved: <Key size={12} />,
                                    };
                                    const icon = iconMap[row.event_type] ?? <Activity size={12} />;
                                    const ago = (() => {
                                        const diff = Date.now() - new Date(row.created_at).getTime();
                                        if (diff < 60000) return 'przed chwilą';
                                        if (diff < 3600000) return `${Math.floor(diff / 60000)} min temu`;
                                        if (diff < 86400000) return `${Math.floor(diff / 3600000)} godz. temu`;
                                        return `${Math.floor(diff / 86400000)} dni temu`;
                                    })();
                                    return (
                                        <div key={row.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                                            <div style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', flexShrink: 0, marginTop: 1 }}>
                                                {icon}
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 500, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.description}</div>
                                                <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>{ago}</div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* System status */}
                <div style={{
                    background: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--border)', padding: '20px 24px',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                        <div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Status systemu</div>
                            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>
                                {services.every(s => s.ok === true)
                                    ? 'Wszystkie serwisy online'
                                    : services.some(s => s.ok === false)
                                    ? 'Wykryto problemy'
                                    : 'Oczekiwanie na dane'}
                            </div>
                        </div>
                        <div className="icon-box">
                            <Zap size={16} strokeWidth={2} />
                        </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {services.map((item) => {
                            const color = item.ok === true ? 'var(--success)' : item.ok === false ? 'var(--error)' : 'var(--text-subtle)';
                            return (
                                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <div style={{
                                        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                                        background: color,
                                        boxShadow: item.ok === true ? '0 0 6px var(--success)' : item.ok === false ? '0 0 6px var(--error)' : 'none',
                                        animation: item.ok === true ? 'pulse-dot 2.5s ease-in-out infinite' : 'none',
                                    }} />
                                    <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>{item.label}</span>
                                    {item.ok === true && <CheckCircle size={13} style={{ marginLeft: 'auto', color: 'var(--success)' }} />}
                                    {item.ok === false && <AlertCircle size={13} style={{ marginLeft: 'auto', color: 'var(--error)' }} />}
                                    {item.ok === null && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-subtle)' }}>—</span>}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* ── Empty state ── */}
            {clientCount === 0 && (
                <div style={{
                    marginTop: 20,
                    background: 'var(--bg-surface)',
                    border: '1px dashed var(--border-hover)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '40px 32px',
                    textAlign: 'center',
                }}>
                    <div style={{ marginBottom: 14 }}>
                        <div className="icon-box" style={{ width: 48, height: 48, borderRadius: 12, margin: '0 auto' }}>
                            <Users size={22} strokeWidth={1.5} />
                        </div>
                    </div>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', margin: '0 0 8px' }}>
                        Zacznij korzystać z platformy
                    </h3>
                    <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: 380, marginLeft: 'auto', marginRight: 'auto' }}>
                        Dodaj pierwszego klienta (NIP), a system automatycznie zacznie pobierać jego faktury z KSeF.
                    </p>
                    <Link href="/dashboard/clients" className="btn-primary" style={{ display: 'inline-flex' }}>
                        <Plus size={15} />
                        Dodaj pierwszego klienta
                    </Link>
                </div>
            )}
        </div>
    );
}
