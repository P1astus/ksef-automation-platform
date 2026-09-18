'use client';

import { useState, useEffect } from 'react';
import { FileCheck, Download, RefreshCw, ChevronDown } from 'lucide-react';
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

function getPrevMonth(): string {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 7);
}

export default function JpkPage() {
    const [clients, setClients] = useState<Client[]>([]);
    const [selectedNip, setSelectedNip] = useState('');
    const [period, setPeriod] = useState(getPrevMonth());
    const [generating, setGenerating] = useState(false);
    const [stats, setStats] = useState<JpkStats | null>(null);
    const [xmlBlob, setXmlBlob] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [planError, setPlanError] = useState(false);
    const [history, setHistory] = useState<HistoryEntry[]>([]);

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
                body: JSON.stringify({ clientNip: selectedNip, period }),
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
