import Link from 'next/link';
import { requireOperator, auditOperator } from '@/lib/operator-auth';
import { listFirms, fleetTotals } from '@/lib/admin-data';

export const dynamic = 'force-dynamic';

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' }) : '—');

export default async function AdminOverviewPage() {
    const session = await requireOperator();
    await auditOperator({ operatorId: session.operatorId, email: session.email, action: 'view_firm_list' });
    const [firms, totals] = await Promise.all([listFirms(), fleetTotals()]);

    const stat = (label: string, value: number, alert = false) => (
        <div style={{ background: 'var(--bg-surface)', border: `1px solid ${alert ? 'var(--error)' : 'var(--border)'}`, borderRadius: 12, padding: '14px 18px' }}>
            <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: alert ? 'var(--error)' : 'var(--text)' }}>{value}</div>
        </div>
    );

    return (
        <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
                {stat('Firmy', totals.firms)}
                {stat('Aktywne', totals.active_firms)}
                {stat('W okresie próbnym', totals.trialing)}
                {stat('Klienci', totals.clients)}
                {stat('Offline24 po terminie', totals.offline_overdue, totals.offline_overdue > 0)}
            </div>

            <div style={{ overflowX: 'auto', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                        <tr style={{ textAlign: 'left', color: 'var(--text-subtle)', fontSize: 11.5 }}>
                            {['Firma', 'Plan', 'Status', 'Klienci', 'Faktury', 'Offline (po terminie)', 'Błędy sync', 'Ostatni sync'].map(h => <th key={h} style={{ padding: '10px 12px' }}>{h}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {firms.map(f => (
                            <tr key={f.id} style={{ borderTop: '1px solid var(--border)' }}>
                                <td style={{ padding: '10px 12px' }}>
                                    <Link href={`/admin/firms/${f.id}`} style={{ fontWeight: 700, color: 'var(--text)' }}>{f.firm_name}</Link>
                                    <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>{f.admin_email}</div>
                                </td>
                                <td style={{ padding: '10px 12px' }}>{f.subscription_tier ?? '—'}</td>
                                <td style={{ padding: '10px 12px' }}>
                                    {f.is_active ? (f.subscription_status ?? '—') : <span style={{ color: 'var(--error)' }}>nieaktywna</span>}
                                    {f.subscription_status === 'trial' && f.trial_expires_at && <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>do {fmtDate(f.trial_expires_at)}</div>}
                                </td>
                                <td style={{ padding: '10px 12px' }}>{f.clients}{f.max_clients != null ? ` / ${f.max_clients}` : ''}</td>
                                <td style={{ padding: '10px 12px' }}>{f.invoices}</td>
                                <td style={{ padding: '10px 12px', color: f.offline_overdue > 0 ? 'var(--error)' : undefined, fontWeight: f.offline_overdue > 0 ? 700 : 400 }}>
                                    {f.offline_open} ({f.offline_overdue})
                                </td>
                                <td style={{ padding: '10px 12px', color: f.clients_sync_errors > 0 ? 'var(--error)' : undefined }}>{f.clients_sync_errors}</td>
                                <td style={{ padding: '10px 12px' }}>{fmtDate(f.last_sync)}</td>
                            </tr>
                        ))}
                        {firms.length === 0 && <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: 'var(--text-subtle)' }}>Brak firm</td></tr>}
                    </tbody>
                </table>
            </div>
        </>
    );
}
