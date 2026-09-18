'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { readApiFailure } from '@/lib/plan-errors';
import { ArrowLeft, Clock, AlertTriangle, Upload, CheckCircle, WifiOff } from 'lucide-react';

interface OfflineInvoice {
    id: number;
    invoice_number: string;
    ksef_number: string | null;
    issue_date: string;
    seller_name: string;
    buyer_name: string;
    gross_amount: string;
    currency: string;
    offline_mode: string | null;
    offline_upload_deadline: string | null;
    client_name: string;
}

const MODE_LABELS: Record<string, { label: string; color: string }> = {
    offline24:    { label: 'OFFLINE-24H', color: '#f59e0b' },
    unavailability: { label: 'AWARIA',     color: '#ef4444' },
    emergency:    { label: 'AWARYJNA',    color: '#ef4444' },
    total_outage: { label: 'AWARIA TOTAL', color: '#dc2626' },
};

function Countdown({ deadline }: { deadline: string | null }) {
    const [remaining, setRemaining] = useState('');
    const [urgent, setUrgent] = useState(false);

    useEffect(() => {
        if (!deadline) { setRemaining('Brak terminu'); return; }
        const update = () => {
            const diff = new Date(deadline).getTime() - Date.now();
            if (diff <= 0) { setRemaining('Termin minął!'); setUrgent(true); return; }
            const h = Math.floor(diff / 3600000);
            const m = Math.floor((diff % 3600000) / 60000);
            setRemaining(`${h}h ${m}min`);
            setUrgent(diff < 4 * 3600000);
        };
        update();
        const t = setInterval(update, 30000);
        return () => clearInterval(t);
    }, [deadline]);

    return (
        <span style={{ fontWeight: 700, fontSize: 13, color: urgent ? 'var(--error)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Clock size={12} style={{ color: urgent ? 'var(--error)' : undefined }} /> {remaining}
        </span>
    );
}

export default function OfflineInvoicesPage() {
    const [invoices, setInvoices] = useState<OfflineInvoice[]>([]);
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState<number | null>(null);
    const [sent, setSent] = useState<Set<number>>(new Set());
    const [errors, setErrors] = useState<Record<number, string>>({});

    const load = async () => {
        const res = await fetch('/api/invoices/offline');
        const data = await res.json();
        setInvoices(data.invoices || []);
        setLoading(false);
    };

    useEffect(() => { load(); }, []);

    const handleSend = async (invoice: OfflineInvoice) => {
        setSending(invoice.id);
        setErrors(prev => { const e = { ...prev }; delete e[invoice.id]; return e; });
        const res = await fetch('/api/ksef/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoiceIds: [invoice.id] }),
        });
        setSending(null);
        if (res.ok) {
            setSent(prev => new Set(prev).add(invoice.id));
        } else {
            const failure = await readApiFailure(res, 'Błąd wysyłki');
            setErrors(prev => ({ ...prev, [invoice.id]: failure.message }));
        }
    };

    const visible = invoices.filter(i => !sent.has(i.id));

    if (loading) return <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 14 }}>Ładowanie...</div>;

    return (
        <div style={{ maxWidth: 900, padding: '28px 0' }}>
            <Link href="/dashboard/invoices" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none', marginBottom: 20 }}>
                <ArrowLeft size={14} /> Powrót do faktur
            </Link>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                <WifiOff size={20} color="var(--error)" />
                <div>
                    <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: 0, letterSpacing: '-0.4px' }}>
                        Kolejka offline
                    </h1>
                    <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
                        Faktury wystawione w trybie offline — wymagają wysłania do KSeF przed upływem terminu
                    </p>
                </div>
            </div>

            {visible.length === 0 ? (
                <div style={{ background: 'var(--bg-surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '64px 24px', textAlign: 'center' }}>
                    <CheckCircle size={36} color="var(--success)" style={{ margin: '0 auto 16px', display: 'block' }} />
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Brak faktur offline</div>
                    <div style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>Wszystkie faktury zostały wysłane do KSeF.</div>
                </div>
            ) : (
                <>
                    <div style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 10, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', display: 'flex', gap: 10, alignItems: 'center' }}>
                        <AlertTriangle size={15} color="#f59e0b" />
                        <span style={{ fontSize: 13, fontWeight: 500, color: '#92400e' }}>
                            {visible.length} {visible.length === 1 ? 'faktura wymaga' : 'faktur wymaga'} wysłania. Przekroczenie terminu = naruszenie przepisów KSeF.
                        </span>
                    </div>

                    <div style={{ background: 'var(--bg-surface)', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden' }}>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Nr faktury</th>
                                    <th>Klient</th>
                                    <th>Nabywca</th>
                                    <th style={{ textAlign: 'right' }}>Kwota brutto</th>
                                    <th>Tryb</th>
                                    <th>Termin</th>
                                    <th>Akcja</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visible.map(inv => {
                                    const mode = MODE_LABELS[inv.offline_mode || ''] || { label: inv.offline_mode || 'OFFLINE', color: '#94a3b8' };
                                    const isSending = sending === inv.id;
                                    const err = errors[inv.id];
                                    return (
                                        <tr key={inv.id}>
                                            <td style={{ fontWeight: 700, color: 'var(--text)' }}>
                                                {inv.invoice_number || inv.ksef_number || `#${inv.id}`}
                                            </td>
                                            <td style={{ color: 'var(--text-muted)' }}>{inv.client_name}</td>
                                            <td style={{ color: 'var(--text-subtle)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {inv.buyer_name || inv.seller_name}
                                            </td>
                                            <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                                                {inv.gross_amount ? `${Number(inv.gross_amount).toLocaleString('pl-PL', { minimumFractionDigits: 2 })} ${inv.currency || 'PLN'}` : '—'}
                                            </td>
                                            <td>
                                                <span style={{ fontSize: 11, fontWeight: 700, background: `${mode.color}22`, color: mode.color, border: `1px solid ${mode.color}44`, padding: '3px 8px', borderRadius: 100 }}>
                                                    {mode.label}
                                                </span>
                                            </td>
                                            <td style={{ whiteSpace: 'nowrap' }}>
                                                <Countdown deadline={inv.offline_upload_deadline} />
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                    <button
                                                        onClick={() => handleSend(inv)}
                                                        disabled={isSending}
                                                        className="btn-primary"
                                                        style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '6px 12px', opacity: isSending ? 0.7 : 1 }}
                                                    >
                                                        <Upload size={12} style={{ animation: isSending ? 'pulse 1s infinite' : 'none' }} />
                                                        {isSending ? 'Wysyłanie...' : 'Wyślij do KSeF'}
                                                    </button>
                                                    {err && <span style={{ fontSize: 11, color: 'var(--error)', fontWeight: 600 }}>{err}</span>}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}
