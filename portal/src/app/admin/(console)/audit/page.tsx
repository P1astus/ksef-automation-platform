import { requireOperator, auditOperator } from '@/lib/operator-auth';
import { listOperatorAudit } from '@/lib/admin-data';

export const dynamic = 'force-dynamic';

const fmtDate = (v: string) => new Date(v).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });

export default async function OperatorAuditPage() {
    const session = await requireOperator();
    await auditOperator({ operatorId: session.operatorId, email: session.email, action: 'view_operator_audit' });
    const entries = await listOperatorAudit();

    return (
        <section>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: '0 0 6px' }}>Dziennik audytu operatorów</h1>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-muted)' }}>Ostatnie 250 zdarzeń. Widok jest tylko do odczytu.</p>
            <div style={{ overflowX: 'auto', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead><tr style={{ textAlign: 'left', color: 'var(--text-subtle)', fontSize: 11.5 }}>
                        {['Czas', 'Operator', 'Zdarzenie', 'Firma', 'IP', 'Szczegóły'].map(h => <th key={h} style={{ padding: '10px 12px' }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                        {entries.map(entry => <tr key={entry.id} style={{ borderTop: '1px solid var(--border)' }}>
                            <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{fmtDate(entry.created_at)}</td>
                            <td style={{ padding: '10px 12px' }}>{entry.operator_email ?? '—'}</td>
                            <td style={{ padding: '10px 12px', fontWeight: 600 }}>{entry.action}</td>
                            <td style={{ padding: '10px 12px' }}>{entry.firm_id ?? '—'}</td>
                            <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>{entry.ip ?? '—'}</td>
                            <td style={{ padding: '10px 12px', maxWidth: 280, overflowWrap: 'anywhere' }}>{entry.details ? JSON.stringify(entry.details) : '—'}</td>
                        </tr>)}
                        {entries.length === 0 && <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--text-subtle)' }}>Brak zdarzeń</td></tr>}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
