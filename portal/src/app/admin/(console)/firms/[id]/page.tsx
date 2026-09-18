import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOperator, auditOperator } from '@/lib/operator-auth';
import { getFirmDetail } from '@/lib/admin-data';

export const dynamic = 'force-dynamic';

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' }) : '—');

export default async function AdminFirmPage({ params }: { params: Promise<{ id: string }> }) {
    const session = await requireOperator();
    const { id } = await params;
    const firmId = /^\d+$/.test(id) ? parseInt(id, 10) : NaN;
    if (!Number.isSafeInteger(firmId)) notFound();

    const detail = await getFirmDetail(firmId);
    if (!detail) notFound();
    await auditOperator({ operatorId: session.operatorId, email: session.email, action: 'view_firm', firmId });

    const { firm } = detail;
    const card = { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', marginBottom: 16, overflowX: 'auto' as const };
    const th = { padding: '8px 10px', textAlign: 'left' as const, fontSize: 11.5, color: 'var(--text-subtle)' };
    const td = { padding: '8px 10px', borderTop: '1px solid var(--border)', fontSize: 13 };

    return (
        <>
            <Link href="/admin" style={{ fontSize: 13, color: 'var(--text-muted)' }}>← Wszystkie firmy</Link>
            <h1 style={{ fontSize: 20, fontWeight: 800, margin: '8px 0 16px' }}>{firm.firm_name}</h1>

            <div style={card}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, fontSize: 13 }}>
                    {[
                        ['Właściciel', firm.admin_email],
                        ['Plan', firm.subscription_tier ?? '—'],
                        ['Status', firm.is_active ? (firm.subscription_status ?? '—') : 'nieaktywna'],
                        ['Okres próbny do', fmtDate(firm.trial_expires_at)],
                        ['Limit klientów', firm.max_clients != null ? `${firm.clients} / ${firm.max_clients}` : String(firm.clients)],
                        ['Faktury', String(firm.invoices)],
                        ['Użytkownicy zespołu', String(firm.members)],
                        ['Założona', fmtDate(firm.created_at)],
                    ].map(([k, v]) => (
                        <div key={k}><div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>{k}</div><div style={{ fontWeight: 600 }}>{v}</div></div>
                    ))}
                </div>
            </div>

            <div style={card}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Kolejka offline ({detail.offlineQueue.length})</div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>{['Faktura', 'NIP klienta', 'Tryb', 'Termin wysyłki'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                    <tbody>
                        {detail.offlineQueue.map(o => {
                            const overdue = new Date(o.upload_deadline).getTime() < Date.now();
                            return (
                                <tr key={o.id}>
                                    <td style={td}>{o.invoice_number}</td><td style={td}>{o.client_nip}</td><td style={td}>{o.offline_mode}</td>
                                    <td style={{ ...td, color: overdue ? 'var(--error)' : undefined, fontWeight: overdue ? 700 : 400 }}>{fmtDate(o.upload_deadline)}{overdue ? ' - PO TERMINIE' : ''}</td>
                                </tr>
                            );
                        })}
                        {detail.offlineQueue.length === 0 && <tr><td colSpan={4} style={{ ...td, color: 'var(--text-subtle)' }}>Brak oczekujących</td></tr>}
                    </tbody>
                </table>
            </div>

            <div style={card}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Klienci ({detail.clients.length})</div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>{['Nazwa', 'NIP', 'Uwierzytelnianie', 'Sync', 'Ostatni udany sync', 'Ostatni błąd'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                    <tbody>
                        {detail.clients.map(c => (
                            <tr key={c.id}>
                                <td style={td}>{c.anonymized_at ? '(zanonimizowany)' : (c.client_name ?? '—')}</td>
                                <td style={td}>{c.nip}</td><td style={td}>{c.auth_method ?? '—'}</td>
                                <td style={td}>{c.sync_enabled ? 'włączony' : 'wyłączony'}</td>
                                <td style={td}>{fmtDate(c.last_sync_success)}</td>
                                <td style={{ ...td, color: c.last_sync_error ? 'var(--error)' : undefined }}>{c.last_sync_error ?? '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
                <div style={card}>
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>Faktury wg statusu</div>
                    {detail.invoicesByStatus.map(s => <div key={s.processing_status} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}><span>{s.processing_status}</span><b>{s.count}</b></div>)}
                    {detail.invoicesByStatus.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-subtle)' }}>Brak faktur</div>}
                </div>
                <div style={card}>
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>Zespół</div>
                    {detail.members.map(m => <div key={m.id} style={{ fontSize: 13, padding: '3px 0' }}>{m.email} · {m.role}{m.is_active ? '' : ' (nieaktywny)'}</div>)}
                    {detail.members.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-subtle)' }}>Tylko właściciel</div>}
                </div>
            </div>
        </>
    );
}
