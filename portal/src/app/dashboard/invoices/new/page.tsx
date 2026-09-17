'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Trash2, Send, ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { isZeroVatRate, type InvoiceLine, type ExemptionBasis } from '@/lib/ksef-invoice-builder';

const VAT_RATES: { label: string; value: InvoiceLine['vatRate'] }[] = [
    { label: '23%', value: '23' },
    { label: '8%', value: '8' },
    { label: '5%', value: '5' },
    { label: '0% (krajowe)', value: '0' },
    { label: '0% WDT', value: '0-wdt' },
    { label: '0% eksport', value: '0-export' },
    { label: 'zw.', value: 'zw' },
];

const EXEMPTION_TYPES: { label: string; value: ExemptionBasis['type'] }[] = [
    { label: 'Przepis ustawy o VAT', value: 'ustawa' },
    { label: 'Dyrektywa 2006/112/WE', value: 'dyrektywa' },
    { label: 'Inna podstawa prawna', value: 'inna' },
];

interface Client {
    id: number;
    nip: string;
    client_name: string;
    street?: string | null;
    city?: string | null;
    postal_code?: string | null;
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
        const vatAmt = isZeroVatRate(l.vatRate) ? 0 : round2(lineNet * (parseFloat(l.vatRate) / 100));
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

const OFFLINE_MODES: { label: string; value: string }[] = [
    { label: 'Offline-24 (przerwa w działaniu KSeF)', value: 'offline24' },
    { label: 'Niedostępność KSeF (planowana)', value: 'unavailability' },
    { label: 'Awaria KSeF', value: 'emergency' },
    { label: 'Całkowita awaria (tryb offline)', value: 'total_outage' },
];

export default function NewInvoicePage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const correctingId = searchParams.get('correctingId');
    const [clients, setClients] = useState<Client[]>([]);
    const [buyerNip, setBuyerNip] = useState('');
    const [buyerName, setBuyerName] = useState('');
    const [buyerStreet, setBuyerStreet] = useState('');
    const [buyerCity, setBuyerCity] = useState('');
    const [buyerPostalCode, setBuyerPostalCode] = useState('');
    const [buyerCountryCode, setBuyerCountryCode] = useState('PL');
    const [exemptionType, setExemptionType] = useState<ExemptionBasis['type']>('ustawa');
    const [exemptionText, setExemptionText] = useState('');
    const [nipStatus, setNipStatus] = useState<'idle' | 'loading' | 'found' | 'not_found'>('idle');
    const [sellerClientId, setSellerClientId] = useState('');
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [dueDate, setDueDate] = useState('');
    const [lines, setLines] = useState<InvoiceLine[]>([{ ...DEFAULT_LINE }]);
    const [sending, setSending] = useState(false);
    const [result, setResult] = useState<{ ksefReferenceNumber?: string; error?: string; queuedOffline?: boolean } | null>(null);
    const [isOffline, setIsOffline] = useState(false);
    const [offlineMode, setOfflineMode] = useState('offline24');
    const [correctionReason, setCorrectionReason] = useState('');
    const [correctingNumber, setCorrectingNumber] = useState('');
    const [loadingOriginal, setLoadingOriginal] = useState(!!correctingId);

    useEffect(() => {
        fetch('/api/clients').then(r => r.json()).then(d => {
            setClients(Array.isArray(d.clients) ? d.clients : []);
        }).catch(() => {});
    }, []);

    // Pre-fill from the invoice being corrected — an editable starting point,
    // not a locked-in copy. The corrected lines the user ends up submitting
    // (not these original ones) are what invoices/create/route.ts sends as
    // the new invoice's FaWiersz; the original ones only feed the delta math.
    useEffect(() => {
        if (!correctingId) return;
        fetch(`/api/invoices/${correctingId}/xml`).then(r => r.ok ? r.json() : null).then(data => {
            if (!data) return;
            setCorrectingNumber(data.invoice_number || '');
            setBuyerNip(data.buyer_nip || '');
            setBuyerName(data.buyer_name || '');
            setBuyerStreet(data.buyer_street || '');
            setBuyerCity(data.buyer_city || '');
            setBuyerPostalCode(data.buyer_postal_code || '');
            if (Array.isArray(data.invoice_lines) && data.invoice_lines.length > 0) {
                setLines(data.invoice_lines);
            }
            const original = clients.find(c => c.nip === data.seller_nip);
            if (original) setSellerClientId(String(original.id));
        }).finally(() => setLoadingOriginal(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [correctingId, clients.length]);

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
        if (!buyerStreet.trim() || !buyerCity.trim() || !buyerPostalCode.trim()) { alert('Wpisz adres nabywcy (ulica, kod pocztowy, miasto) — wymagany przez schemat FA(3)'); return; }
        const sellerClient = clients.find(c => c.id === parseInt(sellerClientId));
        if (sellerClient && (!sellerClient.street || !sellerClient.city || !sellerClient.postal_code)) {
            alert(`Klient "${sellerClient.client_name}" nie ma uzupełnionego adresu — uzupełnij go w karcie klienta przed wystawieniem faktury`);
            return;
        }
        if (!invoiceNumber) { alert('Wpisz numer faktury'); return; }
        if (lines.length === 0) { alert('Dodaj przynajmniej jedną pozycję'); return; }
        if (correctingId && !correctionReason.trim()) { alert('Podaj powód korekty'); return; }
        const hasExemptLine = lines.some(l => l.vatRate === 'zw');
        if (hasExemptLine && !exemptionText.trim()) { alert('Wpisz podstawę prawną zwolnienia dla pozycji zwolnionej z VAT (zw.)'); return; }

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
                    buyerStreet,
                    buyerCity,
                    buyerPostalCode,
                    buyerCountryCode,
                    lines,
                    totals,
                    offlineMode: isOffline ? offlineMode : undefined,
                    correctingInvoiceId: correctingId ? parseInt(correctingId) : undefined,
                    correctionReason: correctingId ? correctionReason : undefined,
                    exemptionBasis: hasExemptLine ? { type: exemptionType, text: exemptionText.trim() } : undefined,
                }),
            });
            if (!saveRes.ok) {
                const errData = await saveRes.json().catch(() => ({}));
                throw new Error(errData.error || 'Błąd zapisu faktury');
            }
            const saved = await saveRes.json();

            // Offline: KSeF isn't reachable right now, so there's nothing to
            // send yet - the invoice sits in the offline queue (with its
            // upload deadline already ticking) until it's pushed from there.
            if (isOffline) {
                setResult({ queuedOffline: true });
                return;
            }

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

    if (result?.ksefReferenceNumber || result?.queuedOffline) {
        return (
            <div style={{ paddingTop: 40, maxWidth: 580 }}>
                <div style={{ background: 'var(--bg-surface)', border: `1px solid ${result.queuedOffline ? '#f59e0b' : '#22c55e'}`, borderRadius: 12, padding: 32, textAlign: 'center' }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>{result.queuedOffline ? '🕒' : '✅'}</div>
                    <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>
                        {result.queuedOffline ? 'Faktura zapisana w trybie offline' : 'Faktura wysłana do KSeF!'}
                    </h2>
                    {result.queuedOffline ? (
                        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
                            KSeF nie jest teraz dostępny — faktura czeka w kolejce offline. Termin wysyłki już biegnie.
                        </div>
                    ) : (
                        <>
                            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>Numer referencyjny KSeF:</div>
                            <div style={{ fontFamily: 'monospace', fontSize: 13, background: 'var(--bg-base)', padding: '8px 16px', borderRadius: 6, marginBottom: 24 }}>{result.ksefReferenceNumber}</div>
                        </>
                    )}
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                        <button className="btn-secondary" onClick={() => { setResult(null); setLines([{ ...DEFAULT_LINE }]); setBuyerNip(''); setBuyerName(''); setBuyerStreet(''); setBuyerCity(''); setBuyerPostalCode(''); setBuyerCountryCode('PL'); setExemptionText(''); setInvoiceNumber(''); setIsOffline(false); }}>
                            Wystaw kolejną
                        </button>
                        <Link href={result.queuedOffline ? '/dashboard/invoices/offline' : '/dashboard/invoices'} className="btn-primary" style={{ textDecoration: 'none', padding: '9px 20px', borderRadius: 7 }}>
                            {result.queuedOffline ? 'Kolejka offline' : 'Wróć do faktur'}
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
                <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', margin: 0 }}>
                    {correctingId ? 'Wystaw korektę' : 'Wystaw fakturę'}
                </h1>
            </div>

            {correctingId && (
                <div style={{ background: 'var(--accent-dim)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: 'var(--text)' }}>
                    {loadingOriginal
                        ? 'Wczytywanie oryginalnej faktury…'
                        : <>Korekta faktury <strong>{correctingNumber || `#${correctingId}`}</strong> — pozycje poniżej są edytowalną kopią oryginału; zmień je na stan po korekcie.</>}
                </div>
            )}

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
                        {(() => {
                            const selected = clients.find(c => c.id === parseInt(sellerClientId));
                            if (!selected) return null;
                            if (!selected.street || !selected.city || !selected.postal_code) {
                                return (
                                    <div style={{ fontSize: 11.5, color: '#f59e0b' }}>
                                        Brak adresu — <Link href={`/dashboard/clients/${selected.id}`} style={{ color: '#f59e0b', textDecoration: 'underline' }}>uzupełnij w karcie klienta</Link> przed wysyłką
                                    </div>
                                );
                            }
                            return (
                                <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
                                    {selected.street}, {selected.postal_code} {selected.city}
                                </div>
                            );
                        })()}
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
                            style={{ width: '100%', marginBottom: 12 }}
                            required
                        />
                        <label style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 4 }}>Ulica i numer*</label>
                        <input
                            value={buyerStreet}
                            onChange={e => setBuyerStreet(e.target.value)}
                            placeholder="ul. Przykładowa 12/3"
                            style={{ width: '100%', marginBottom: 12 }}
                            required
                        />
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
                            <div>
                                <label style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 4 }}>Kod pocztowy*</label>
                                <input
                                    value={buyerPostalCode}
                                    onChange={e => setBuyerPostalCode(e.target.value)}
                                    placeholder="00-001"
                                    style={{ width: '100%' }}
                                    required
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 4 }}>Miasto*</label>
                                <input
                                    value={buyerCity}
                                    onChange={e => setBuyerCity(e.target.value)}
                                    placeholder="Warszawa"
                                    style={{ width: '100%' }}
                                    required
                                />
                            </div>
                        </div>
                        <label style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)', margin: '12px 0 4px' }}>Kraj (kod ISO)*</label>
                        <input
                            value={buyerCountryCode}
                            onChange={e => setBuyerCountryCode(e.target.value.toUpperCase().slice(0, 2))}
                            placeholder="PL"
                            maxLength={2}
                            style={{ width: 70 }}
                            required
                        />
                        {buyerCountryCode !== 'PL' && (
                            <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 6 }}>
                                Nabywca spoza Polski — jeśli sprzedaż kwalifikuje się jako WDT lub eksport, wybierz odpowiednią stawkę 0% w pozycjach poniżej.
                            </div>
                        )}
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

                    {correctingId && (
                        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                            <label style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 4 }}>Powód korekty*</label>
                            <textarea
                                value={correctionReason}
                                onChange={e => setCorrectionReason(e.target.value)}
                                placeholder="np. korekta ilości towaru, błędna stawka VAT..."
                                rows={2}
                                style={{ width: '100%', resize: 'vertical' }}
                                required
                            />
                        </div>
                    )}

                    <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text)', cursor: 'pointer' }}>
                            <input type="checkbox" checked={isOffline} onChange={e => setIsOffline(e.target.checked)} />
                            KSeF niedostępny — wystawiam w trybie offline
                        </label>
                        {isOffline && (
                            <div style={{ marginTop: 10 }}>
                                <label style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 4 }}>Tryb offline</label>
                                <select value={offlineMode} onChange={e => setOfflineMode(e.target.value)} style={{ width: '100%', maxWidth: 320 }}>
                                    {OFFLINE_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                </select>
                                <div style={{ fontSize: 11.5, color: '#f59e0b', marginTop: 6 }}>
                                    Faktura trafi do kolejki offline zamiast wysyłki do KSeF. Termin wysyłki: koniec następnego dnia roboczego.
                                </div>
                            </div>
                        )}
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

                    {lines.some(l => l.vatRate === 'zw') && (
                        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-subtle)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                Podstawa zwolnienia z VAT (zw.)*
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 4 }}>Rodzaj podstawy</label>
                                    <select value={exemptionType} onChange={e => setExemptionType(e.target.value as ExemptionBasis['type'])} style={{ width: '100%' }}>
                                        {EXEMPTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 4 }}>Treść podstawy prawnej*</label>
                                    <input
                                        value={exemptionText}
                                        onChange={e => setExemptionText(e.target.value)}
                                        placeholder="np. art. 113 ust. 1 ustawy o VAT"
                                        style={{ width: '100%' }}
                                        required
                                    />
                                </div>
                            </div>
                        </div>
                    )}

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
                        {sending
                            ? 'Zapisywanie…'
                            : isOffline
                                ? <><Send size={15} /> Zapisz w trybie offline</>
                                : <><Send size={15} /> Wyślij do KSeF</>}
                    </button>
                </div>
            </form>
        </div>
    );
}
