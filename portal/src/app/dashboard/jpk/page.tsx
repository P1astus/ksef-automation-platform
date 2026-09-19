'use client';

import { useState, useEffect } from 'react';
import { FileCheck, Download, RefreshCw, ChevronDown, Send } from 'lucide-react';
import PlanErrorLink from '@/app/dashboard/PlanErrorLink';
import { interpretApiFailure } from '@/lib/plan-errors';

interface Client {
    id: number;
    nip: string;
    client_name: string;
}

interface JpkStats {
    invoiceCount: number;
    salesCount: number;
    purchCount: number;
    totalNet: string;
    totalVat: string;
    totalGross: string;
}

interface HistoryEntry {
    client_nip: string;
    period: string;
    status: string;
    created_at: string;
}

interface TestSubmission {
    id: number;
    client_nip: string;
    period: string;
    reference_number?: string | null;
    status: string;
    gateway_code?: number | null;
    gateway_description?: string | null;
    gateway_details?: string | null;
    created_at: string;
}

function getPrevMonth(): string {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 7);
}

function PouczeniaNotice() {
    return (
        <div
            role="note"
            style={{ background: 'rgba(245,158,11,0.14)', border: '2px solid #f59e0b', borderRadius: 10, padding: '14px 16px', color: 'var(--text)', fontSize: 14, lineHeight: 1.5 }}
        >
            <strong style={{ fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                ⚠ Pouczenia (Pouczenia = 1) — wstawione automatycznie, wymaga potwierdzenia księgowego
            </strong>
            <div style={{ marginTop: 6 }}>
                <strong>To jest jedynie propozycja naszego oprogramowania.</strong> Plik zawiera potwierdzenie
                zapoznania się z pouczeniem o odpowiedzialności karnej skarbowej za podanie nieprawdy lub zatajenie
                prawdy. Oprogramowanie wstawia je samo — <strong>księgowy musi je przeczytać i potwierdzić przed
                złożeniem pliku w urzędzie</strong>. Nie składaj pliku bez sprawdzenia danych i tego oświadczenia.
            </div>
        </div>
    );
}

export default function JpkPage() {
    const [clients, setClients] = useState<Client[]>([]);
    const [selectedNip, setSelectedNip] = useState('');
    const [period, setPeriod] = useState(getPrevMonth());
    const [correction, setCorrection] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [stats, setStats] = useState<JpkStats | null>(null);
    const [xmlBlob, setXmlBlob] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [planError, setPlanError] = useState(false);
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [testGatewayEnabled, setTestGatewayEnabled] = useState(false);
    const [submissions, setSubmissions] = useState<TestSubmission[]>([]);
    const [sendingTest, setSendingTest] = useState(false);
    const [testGatewayError, setTestGatewayError] = useState('');

    useEffect(() => {
        fetch('/api/clients').then(r => r.json()).then(d => {
            const list: Client[] = Array.isArray(d.clients) ? d.clients : [];
            setClients(list);
            if (list.length > 0) setSelectedNip(list[0].nip);
        }).catch(() => {});
    }, []);

    useEffect(() => {
        if (!selectedNip) return;
        fetch(`/api/jpk/generate?clientNip=${encodeURIComponent(selectedNip)}`)
            .then(r => r.json())
            .then(d => setHistory(Array.isArray(d.history) ? d.history : []))
            .catch(() => {});
        fetch(`/api/jpk/test-gateway?clientNip=${encodeURIComponent(selectedNip)}`)
            .then(r => r.json())
            .then(d => {
                setTestGatewayEnabled(d.enabled === true);
                setSubmissions(Array.isArray(d.submissions) ? d.submissions : []);
            })
            .catch(() => {});
    }, [selectedNip]);

    async function generate() {
        if (!selectedNip || !period) return;
        setGenerating(true);
        setError('');
        setPlanError(false);
        setStats(null);
        setXmlBlob(null);
        try {
            const res = await fetch('/api/jpk/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientNip: selectedNip, period, correction }),
            });
            const data = await res.json();
            if (!res.ok) {
                const failure = interpretApiFailure(res.status, data, 'Błąd generowania');
                setPlanError(failure.isPlanError);
                throw new Error(failure.message);
            }
            setStats(data.stats);
            setXmlBlob(data.xml);
            // Refresh history
            const histRes = await fetch(`/api/jpk/generate?clientNip=${encodeURIComponent(selectedNip)}`);
            const histData = await histRes.json();
            setHistory(Array.isArray(histData.history) ? histData.history : []);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Błąd');
        } finally {
            setGenerating(false);
        }
    }

    function downloadXml() {
        if (!xmlBlob) return;
        const blob = new Blob([xmlBlob], { type: 'application/xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `JPK_V7M_${selectedNip}_${period}.xml`;
        a.click();
        URL.revokeObjectURL(url);
    }

    async function sendToMfTestGateway() {
        if (!selectedNip || !period || !xmlBlob) return;
        setSendingTest(true);
        setTestGatewayError('');
        try {
            const res = await fetch('/api/jpk/test-gateway', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientNip: selectedNip, period }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Błąd wysyłki do bramki testowej MF');
            const hist = await fetch(`/api/jpk/test-gateway?clientNip=${encodeURIComponent(selectedNip)}`);
            const histData = await hist.json();
            setSubmissions(Array.isArray(histData.submissions) ? histData.submissions : []);
        } catch (err: unknown) {
            setTestGatewayError(err instanceof Error ? err.message : 'Błąd wysyłki do bramki testowej MF');
        } finally {
            setSendingTest(false);
        }
    }

    const selectedClient = clients.find(c => c.nip === selectedNip);

    return (
        <div style={{ paddingTop: 28, maxWidth: 900 }}>
            {/* Header */}
            <div style={{ marginBottom: 28 }}>
                <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: 0, letterSpacing: '-0.4px' }}>JPK V7M</h1>
                <p style={{ margin: '4px 0 0', fontSize: 13.5, color: 'var(--text-muted)' }}>
                    Generuj pliki JPK_V7M do wysyłki do Urzędu Skarbowego
                </p>
            </div>

            <div style={{ marginBottom: 24 }}><PouczeniaNotice /></div>

            {/* Generator panel */}
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, marginBottom: 24 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 16, alignItems: 'flex-end' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>Klient</label>
                        <div style={{ position: 'relative' }}>
                            <select
                                value={selectedNip}
                                onChange={e => setSelectedNip(e.target.value)}
                                style={{ width: '100%', appearance: 'none', paddingRight: 32 }}
                            >
                                <option value="">-- wybierz klienta --</option>
                                {clients.map(c => (
                                    <option key={c.id} value={c.nip}>{c.client_name} ({c.nip})</option>
                                ))}
                            </select>
                            <ChevronDown size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)', pointerEvents: 'none' }} />
                        </div>
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>Okres (miesiąc)</label>
                        <input
                            type="month"
                            value={period}
                            onChange={e => setPeriod(e.target.value)}
                            style={{ width: '100%' }}
                        />
                    </div>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        <input type="checkbox" checked={correction} onChange={e => setCorrection(e.target.checked)} />
                        Korekta (CelZłożenia = 2)
                    </label>
                    <button
                        onClick={generate}
                        disabled={generating || !selectedNip}
                        className="btn-primary"
                        style={{ display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}
                    >
                        {generating
                            ? <><RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} /> Generuję…</>
                            : <><FileCheck size={15} /> Generuj JPK_V7M</>}
                    </button>
                </div>

                {error && (
                    <div style={{ marginTop: 16, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', color: '#ef4444', fontSize: 13 }}>
                        {error}<PlanErrorLink show={planError} />
                    </div>
                )}
            </div>

            {/* Stats + download */}
            {stats && (
                <div style={{ marginBottom: 24 }}><PouczeniaNotice /></div>
            )}
            {stats && (
                <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, marginBottom: 24 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
                        <div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>
                                JPK_V7M gotowy — {period}
                            </div>
                            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                                {selectedClient?.client_name} ({selectedNip})
                            </div>
                        </div>
                        <button onClick={downloadXml} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <Download size={15} /> Pobierz XML
                        </button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                        {[
                            { label: 'Sprzedaż', value: stats.salesCount, unit: 'faktur' },
                            { label: 'Zakupy', value: stats.purchCount, unit: 'faktur' },
                            { label: 'Łącznie', value: stats.invoiceCount, unit: 'faktur' },
                        ].map(item => (
                            <div key={item.label} style={{ background: 'var(--bg-base)', borderRadius: 8, padding: '14px 18px', textAlign: 'center' }}>
                                <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)' }}>{item.value}</div>
                                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{item.label} ({item.unit})</div>
                            </div>
                        ))}
                    </div>

                    <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                        {[
                            { label: 'Razem netto', value: stats.totalNet },
                            { label: 'Razem VAT', value: stats.totalVat },
                            { label: 'Razem brutto', value: stats.totalGross },
                        ].map(item => (
                            <div key={item.label} style={{ background: 'var(--bg-base)', borderRadius: 8, padding: '12px 18px' }}>
                                <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginBottom: 4 }}>{item.label}</div>
                                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{item.value} PLN</div>
                            </div>
                        ))}
                    </div>

                    <div style={{ marginTop: 20, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Bramka testowa Ministerstwa Finansów</div>
                        <p style={{ margin: '6px 0 12px', fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                            Opcjonalna, ręczna wysyłka wyłącznie do środowiska TEST MF. Nie składa deklaracji produkcyjnej.
                            Złożenie pliku w urzędzie skarbowym pozostaje odpowiedzialnością księgowego.
                        </p>
                        {testGatewayEnabled ? (
                            <button onClick={sendToMfTestGateway} disabled={sendingTest} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                                {sendingTest ? <><RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} /> Wysyłam i sprawdzam status…</> : <><Send size={15} /> Wyślij do bramki testowej MF</>}
                            </button>
                        ) : (
                            <div style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>Integracja testowa jest wyłączona przez konfigurację serwera.</div>
                        )}
                        {testGatewayError && (
                            <div style={{ marginTop: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', color: '#ef4444', fontSize: 13, whiteSpace: 'pre-wrap' }}>
                                {testGatewayError}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {submissions.length > 0 && (
                <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, marginBottom: 24 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>Wysyłki do bramki testowej MF</div>
                    {submissions.map(s => (
                        <div key={s.id} style={{ borderTop: '1px solid var(--border)', padding: '12px 0', fontSize: 12.5 }}>
                            <div style={{ color: 'var(--text)', fontWeight: 700 }}>{s.period} — {s.status}{s.gateway_code != null ? ` (kod MF ${s.gateway_code})` : ''}</div>
                            {s.reference_number && <div style={{ color: 'var(--text-muted)', marginTop: 3 }}>Numer referencyjny MF: <code>{s.reference_number}</code></div>}
                            {(s.gateway_description || s.gateway_details) && <div style={{ color: '#ef4444', marginTop: 5, whiteSpace: 'pre-wrap' }}>{[s.gateway_description, s.gateway_details].filter(Boolean).join('\n')}</div>}
                        </div>
                    ))}
                </div>
            )}

            {/* History */}
            {history.length > 0 && (
                <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>Historia generowań</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                            <tr style={{ color: 'var(--text-subtle)', fontSize: 11.5 }}>
                                <th style={{ textAlign: 'left', fontWeight: 600, padding: '0 0 8px' }}>Klient NIP</th>
                                <th style={{ textAlign: 'left', fontWeight: 600, padding: '0 0 8px' }}>Okres</th>
                                <th style={{ textAlign: 'left', fontWeight: 600, padding: '0 0 8px' }}>Status</th>
                                <th style={{ textAlign: 'left', fontWeight: 600, padding: '0 0 8px' }}>Data</th>
                            </tr>
                        </thead>
                        <tbody>
                            {history.map((h, i) => (
                                <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                                    <td style={{ padding: '10px 0', color: 'var(--text)', fontFamily: 'monospace', fontSize: 12 }}>{h.client_nip}</td>
                                    <td style={{ padding: '10px 0', color: 'var(--text)', fontWeight: 600 }}>{h.period}</td>
                                    <td style={{ padding: '10px 0' }}>
                                        <span style={{ fontSize: 11, fontWeight: 700, background: 'rgba(34,197,94,0.1)', color: '#22c55e', padding: '2px 8px', borderRadius: 100 }}>
                                            {h.status}
                                        </span>
                                    </td>
                                    <td style={{ padding: '10px 0', color: 'var(--text-muted)', fontSize: 12 }}>
                                        {new Date(h.created_at).toLocaleString('pl-PL')}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
