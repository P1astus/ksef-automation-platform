'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Send, ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import type { InvoiceLine } from '@/lib/ksef-invoice-builder';

const VAT_RATES: { label: string; value: InvoiceLine['vatRate'] }[] = [
    { label: '23%', value: '23' },
    { label: '8%', value: '8' },
    { label: '5%', value: '5' },
    { label: '0%', value: '0' },
    { label: 'zw.', value: 'zw' },
];

interface Client {
    id: number;
    nip: string;
    client_name: string;
}

interface Totals {
    totalNet: number;
    totalVat: number;
    totalGross: number;
}

function round2(n: number) { return Math.round(n * 100) / 100; }

function computeTotals(lines: InvoiceLine[]): Totals {
    let net = 0, vat = 0;
    for (const l of lines) {
        const lineNet = round2(l.netPrice * l.qty);
        const vatAmt = l.vatRate === 'zw' ? 0 : round2(lineNet * (parseFloat(l.vatRate) / 100));
        net += lineNet;
        vat += vatAmt;
    }
    return {
        totalNet: round2(net),
        totalVat: round2(vat),
        totalGross: round2(net + vat),
    };
}

const DEFAULT_LINE: InvoiceLine = { name: '', qty: 1, unit: 'szt.', netPrice: 0, vatRate: '23' };

export default function NewInvoicePage() {
    const router = useRouter();
    const [clients, setClients] = useState<Client[]>([]);
    const [buyerNip, setBuyerNip] = useState('');
    const [buyerName, setBuyerName] = useState('');
    const [nipStatus, setNipStatus] = useState<'idle' | 'loading' | 'found' | 'not_found'>('idle');
    const [sellerClientId, setSellerClientId] = useState('');
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [dueDate, setDueDate] = useState('');
    const [lines, setLines] = useState<InvoiceLine[]>([{ ...DEFAULT_LINE }]);
    const [sending, setSending] = useState(false);
    const [result, setResult] = useState<{ ksefReferenceNumber?: string; error?: string } | null>(null);

    useEffect(() => {
        fetch('/api/clients').then(r => r.json()).then(d => {
            setClients(Array.isArray(d.clients) ? d.clients : []);
        }).catch(() => {});
    }, []);

    // Auto-fill buyer name from GUS
    useEffect(() => {
        if (buyerNip.length !== 10) { setNipStatus('idle'); return; }
        setNipStatus('loading');
        const t = setTimeout(async () => {
            try {
                const res = await fetch(`/api/gus?nip=${buyerNip}`);
                const data = await res.json();
                if (data.found && data.name) { setBuyerName(data.name); setNipStatus('found'); }
                else setNipStatus('not_found');
            } catch { setNipStatus('not_found'); }
        }, 400);
        return () => clearTimeout(t);
    }, [buyerNip]);

    const totals = computeTotals(lines);

    function updateLine(i: number, field: keyof InvoiceLine, value: string | number) {
        setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: value } : l));
    }
    function addLine() { setLines(prev => [...prev, { ...DEFAULT_LINE }]); }
    function removeLine(i: number) { setLines(prev => prev.filter((_, idx) => idx !== i)); }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!sellerClientId) { alert('Wybierz klienta sprzedającego (token KSeF)'); return; }
        if (!buyerNip || !buyerName) { alert('Wpisz NIP i nazwę nabywcy'); return; }
        if (!invoiceNumber) { alert('Wpisz numer faktury'); return; }
        if (lines.length === 0) { alert('Dodaj przynajmniej jedną pozycję'); return; }

        setSending(true);
        setResult(null);
        try {
            // 1. Save invoice to DB
            const saveRes = await fetch('/api/invoices/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clientId: parseInt(sellerClientId),
                    invoiceNumber,
                    issueDate,
                    dueDate,
                    buyerNip,
                    buyerName,
                    lines,
                    totals,
                }),
            });
            if (!saveRes.ok) throw new Error('Błąd zapisu faktury');
            const saved = await saveRes.json();

            // 2. Send to KSeF
            const sendRes = await fetch('/api/ksef/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ invoiceIds: [saved.id] }),
            });
            const sendData = await sendRes.json();
            const first = sendData.results?.[0];
            if (first?.ksefReferenceNumber) {
                setResult({ ksefReferenceNumber: first.ksefReferenceNumber });
            } else {
                setResult({ error: first?.error || 'Nieznany błąd KSeF' });
            }
        } catch (err: unknown) {
            setResult({ error: err instanceof Error ? err.message : 'Błąd wysyłki' });
        } finally {
            setSending(false);
        }
    }

    if (result?.ksefReferenceNumber) {
        return (
            <div style={{ paddingTop: 40, maxWidth: 580 }}>
                <div style={{ background: 'var(--bg-surface)', border: '1px solid #22c55e', borderRadius: 12, padding: 32, textAlign: 'center' }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
                    <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>Faktura wysłana do KSeF!</h2>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>Numer referencyjny KSeF:</div>
                    <div style={{ fontFamily: 'monospace', fontSize: 13, background: 'var(--bg-base)', padding: '8px 16px', borderRadius: 6, marginBottom: 24 }}>{result.ksefReferenceNumber}</div>
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                        <button className="btn-secondary" onClick={() => { setResult(null); setLines([{ ...DEFAULT_LINE }]); setBuyerNip(''); setBuyerName(''); setInvoiceNumber(''); }}>
                            Wystaw kolejną
                        </button>
                        <Link href="/dashboard/invoices" className="btn-primary" style={{ textDecoration: 'none', padding: '9px 20px', borderRadius: 7 }}>
                            Wróć do faktur
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div style={{ paddingTop: 28, maxWidth: 900 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                <Link href="/dashboard/invoices" style={{ color: 'var(--text-subtle)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, textDecoration: 'none' }}>
                    <ChevronLeft size={16} /> Faktury
                </Link>
                <span style={{ color: 'var(--border)' }}>/</span>
                <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', margin: 0 }}>Wystaw fakturę</h1>
            </div>

            {result?.error && (
                <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '12px 16px', marginBottom: 20, color: '#ef4444', fontSize: 13 }}>
                    Błąd: {result.error}
                </div>
            )}

            <form onSubmit={handleSubmit}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
                    {/* Seller (our client with KSeF token) */}
                    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-subtle)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Sprzedawca</div>
                        <label style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 4 }}>Klient (token KSeF)*</label>
                        <select
                            value={sellerClientId}
                            onChange={e => setSellerClientId(e.target.value)}
                            style={{ width: '100%', marginBottom: 12 }}
                            required
                        >
                            <option value="">-- wybierz klienta --</option>
                            {clients.map(c => (
                                <option key={c.id} value={c.id}>{c.client_name} ({c.nip})</option>
                            ))}
                        </select>
                    </div>

                    {/* Buyer */}
                    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-subtle)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Nabywca</div>
                        <label style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 4 }}>NIP nabywcy*</label>
                        <div style={{ position: 'relative', marginBottom: 4 }}>
                            <input
                                value={buyerNip}
                                onChange={e => setBuyerNip(e.target.value.replace(/\D/g, '').slice(0, 10))}
                                placeholder="1234567890"
                                style={{ width: '100%' }}
                                required
                            />
                        </div>
                        {nipStatus === 'loading' && <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginBottom: 8 }}>Sprawdzam NIP…</div>}
                        {nipStatus === 'found' && <div style={{ fontSize: 11, color: '#22c55e', marginBottom: 8 }}>✓ Znaleziono w rejestrze VAT</div>}
                        {nipStatus === 'not_found' && <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 8 }}>Brak w rejestrze VAT</div>}
                        <label style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 4 }}>Nazwa nabywcy*</label>
                        <input
                            value={buyerName}
                            onChange={e => setBuyerName(e.target.value)}
                            placeholder="Nazwa firmy"
                            style={{ width: '100%' }}
                            required
                        />
                    </div>
                </div>

                {/* Invoice details */}
                <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, marginBottom: 20 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-subtle)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Dane faktury</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                        <div>
                            <label style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 4 }}>Numer faktury*</label>
                            <input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="FV/2025/001" style={{ width: '100%' }} required />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 4 }}>Data wystawienia*</label>
                            <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} style={{ width: '100%' }} required />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 4 }}>Termin płatności</label>
                            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={{ width: '100%' }} />
                        </div>
                    </div>
                </div>

                {/* Line items */}
                <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, marginBottom: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Pozycje</div>
                        <button type="button" onClick={addLine} className="btn-secondary" style={{ fontSize: 12, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 5 }}>
                            <Plus size={13} /> Dodaj pozycję
                        </button>
                    </div>

                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr style={{ color: 'var(--text-subtle)', fontSize: 11.5 }}>
                                    <th style={{ textAlign: 'left', fontWeight: 600, padding: '0 0 8px', width: '35%' }}>Nazwa</th>
                                    <th style={{ textAlign: 'right', fontWeight: 600, padding: '0 8px 8px', width: 60 }}>Ilość</th>
                                    <th style={{ textAlign: 'left', fontWeight: 600, padding: '0 8px 8px', width: 60 }}>J.m.</th>
                                    <th style={{ textAlign: 'right', fontWeight: 600, padding: '0 8px 8px', width: 100 }}>Cena netto</th>
                                    <th style={{ textAlign: 'center', fontWeight: 600, padding: '0 8px 8px', width: 70 }}>VAT</th>
                                    <th style={{ textAlign: 'right', fontWeight: 600, padding: '0 0 8px', width: 100 }}>Wartość netto</th>
                                    <th style={{ width: 32 }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {lines.map((l, i) => {
                                    const lineNet = round2(l.netPrice * l.qty);
                                    return (
                                        <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                                            <td style={{ padding: '8px 0' }}>
                                                <input value={l.name} onChange={e => updateLine(i, 'name', e.target.value)} placeholder="Nazwa usługi / towaru" style={{ width: '100%' }} required />
                                            </td>
                                            <td style={{ padding: '8px 8px' }}>
                                                <input type="number" value={l.qty} min={0.001} step={0.001} onChange={e => updateLine(i, 'qty', parseFloat(e.target.value) || 0)} style={{ width: '100%', textAlign: 'right' }} />
                                            </td>
                                            <td style={{ padding: '8px 8px' }}>
                                                <input value={l.unit} onChange={e => updateLine(i, 'unit', e.target.value)} style={{ width: '100%' }} />
                                            </td>
                                            <td style={{ padding: '8px 8px' }}>
                                                <input type="number" value={l.netPrice} min={0} step={0.01} onChange={e => updateLine(i, 'netPrice', parseFloat(e.target.value) || 0)} style={{ width: '100%', textAlign: 'right' }} />
                                            </td>
                                            <td style={{ padding: '8px 8px' }}>
                                                <select value={l.vatRate} onChange={e => updateLine(i, 'vatRate', e.target.value as InvoiceLine['vatRate'])} style={{ width: '100%' }}>
                                                    {VAT_RATES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                                                </select>
                                            </td>
                                            <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 600, color: 'var(--text)' }}>
                                                {lineNet.toFixed(2)}
                                            </td>
                                            <td style={{ padding: '8px 0 8px 8px' }}>
                                                {lines.length > 1 && (
                                                    <button type="button" onClick={() => removeLine(i)} style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', padding: 4, display: 'flex' }}>
                                                        <Trash2 size={14} />
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* Totals */}
                    <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                        <div style={{ width: 260 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>
                                <span>Razem netto</span><span>{totals.totalNet.toFixed(2)} PLN</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
                                <span>VAT</span><span>{totals.totalVat.toFixed(2)} PLN</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>
                                <span>Do zapłaty</span><span>{totals.totalGross.toFixed(2)} PLN</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                    <Link href="/dashboard/invoices" className="btn-secondary" style={{ textDecoration: 'none', padding: '9px 20px', borderRadius: 7, fontSize: 13 }}>
                        Anuluj
                    </Link>
                    <button type="submit" disabled={sending} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        {sending ? 'Wysyłanie…' : <><Send size={15} /> Wyślij do KSeF</>}
                    </button>
                </div>
            </form>
        </div>
    );
}
