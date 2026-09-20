import { query } from '@/lib/db';
import { buildJobs } from '@/lib/jobs/registry';
import { loadJobHealth } from '@/lib/jobs/dashboard';
import RunJobButton from './RunJobButton';

const fmt = (value: unknown) => value ? new Date(String(value)).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' }) : '—';
const cell = { padding: '9px 10px', verticalAlign: 'top' as const };

export default async function JobHealthDashboard({ firmId }: { firmId: number | null }) {
    const data = await loadJobHealth({ query }, firmId);
    const jobs = buildJobs(process.env);
    const newest = data.occurrences[0]?.scheduled_for ? new Date(data.occurrences[0].scheduled_for).getTime() : 0;
    const workerStale = !newest || Date.now() - newest > 30 * 60_000;

    return (
        <div>
            <div style={{ marginBottom: 22 }}>
                <h1 style={{ fontSize: 24, margin: 0 }}>Stan automatyzacji</h1>
                <p style={{ color: 'var(--text-muted)', margin: '6px 0 0', fontSize: 13 }}>Kolejka zadań, alerty systemowe i ostatnie pomiary usług.</p>
            </div>

            {workerStale && <div style={{ background: 'var(--error-dim)', border: '1px solid var(--error)', color: 'var(--error)', borderRadius: 10, padding: 14, marginBottom: 18, fontWeight: 700 }}>
                Brak aktywności workera w ostatnich 30 minutach. Sprawdź usługę ksef_worker i zmienne JOBS_ENABLED / JOBS_SHADOW.
            </div>}

            <section style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: 16 }}>Uruchom zadanie</h2>
                <div style={{ display: 'grid', gap: 8 }}>
                    {jobs.map(job => <div key={job.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 9, padding: '10px 12px' }}>
                        <code style={{ fontSize: 12 }}>{job.name}</code><RunJobButton jobName={job.name} />
                    </div>)}
                </div>
            </section>

            <section style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: 16 }}>Ostatnie wykonania</h2>
                <div style={{ overflowX: 'auto', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}><thead><tr>{['Zadanie', 'Plan', 'Stan', 'Próby', 'Zakończono', 'Ostatni błąd'].map(h => <th key={h} style={{ ...cell, textAlign: 'left', color: 'var(--text-subtle)' }}>{h}</th>)}</tr></thead>
                        <tbody>{data.occurrences.map(row => <tr key={row.id} style={{ borderTop: '1px solid var(--border)' }}>
                            <td style={cell}>{row.job_name}{row.shadow ? ' (shadow)' : ''}</td><td style={cell}>{fmt(row.scheduled_for)}</td>
                            <td style={cell}>{row.state}</td><td style={cell}>{row.attempts} / {row.max_attempts}</td>
                            <td style={cell}>{fmt(row.finished_at)}</td><td style={{ ...cell, color: row.last_error ? 'var(--error)' : undefined, maxWidth: 360 }}>{row.last_error || '—'}</td>
                        </tr>)}</tbody></table>
                    {data.occurrences.length === 0 && <p style={{ padding: 14, color: 'var(--text-muted)' }}>Brak zarejestrowanych wykonań.</p>}
                </div>
            </section>

            <section style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: 16 }}>Zdrowie usług</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                    {data.health.map(row => <div key={row.id} style={{ background: 'var(--bg-surface)', border: `1px solid ${row.status === 'ok' || row.status === 'healthy' ? 'var(--border)' : 'var(--error)'}`, borderRadius: 10, padding: 13 }}>
                        <strong>{row.check_type}</strong><div style={{ marginTop: 5, color: row.status === 'ok' || row.status === 'healthy' ? 'var(--success)' : 'var(--error)' }}>{row.status}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 5 }}>{fmt(row.checked_at)}</div>
                        {row.details && <pre style={{ fontSize: 10.5, whiteSpace: 'pre-wrap', margin: '8px 0 0', color: 'var(--text-muted)' }}>{JSON.stringify(row.details, null, 2)}</pre>}
                    </div>)}
                </div>
                {data.health.length === 0 && <p style={{ color: 'var(--error)' }}>Brak pomiarów zdrowia, w tym SMTP.</p>}
            </section>

            <section>
                <h2 style={{ fontSize: 16 }}>Alerty systemowe</h2>
                <div style={{ display: 'grid', gap: 9 }}>{data.alerts.map(row => <div key={row.id} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 13 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><strong>{row.subject}</strong><span style={{ fontSize: 11.5 }}>{row.severity}</span></div>
                    <p style={{ margin: '7px 0', fontSize: 12.5 }}>{row.message}</p>
                    <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{row.source} · {fmt(row.created_at)}</div>
                    {row.delivery_error && <div style={{ marginTop: 7, color: 'var(--error)', fontSize: 12 }}>Błąd dostarczenia alertu: {row.delivery_error}</div>}
                </div>)}</div>
                {data.alerts.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Brak alertów.</p>}
            </section>
        </div>
    );
}
