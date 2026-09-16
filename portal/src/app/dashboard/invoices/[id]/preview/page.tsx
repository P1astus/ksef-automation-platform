'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CheckCircle, XCircle, FileCode, AlertCircle, FileDown, FileEdit } from 'lucide-react';
import { parseFa3Lines } from '@/lib/parse-fa3-lines';

interface InvoiceData {
    id: number;
    invoice_number: string;
    ksef_number: string;
    direction: string;
    processing_status: string;
    seller_name: string;
    buyer_name: string;
    seller_nip: string;
    buyer_nip: string;
    net_amount: string;
    vat_amount: string;
    gross_amount: string;
    currency: string;
    issue_date: string;
    raw_xml: string | null;
    corrects_invoice_id: number | null;
    correction_reason: string | null;
    ksef_rejection_reason: string | null;
}

// Parse simple XML key-value fields for display
function extractXmlField(xml: string, tag: string): string {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`));
    return m ? m[1].trim() : '';
}

// This used to match "WierszFaktury", a tag the builder has never actually
// emitted in FA(3) or the FA(2)-era code before it (real names: FaWiersz
// now, FakturaWiersz before), so this table always rendered empty. Fixed by
// switching to the shared parseFa3Lines() - see lib/parse-fa3-lines.ts for
// what it extracts and why there's no "vat"/"gross" column to recover.
function parseXmlLines(xml: string) {
    return parseFa3Lines(xml).map(l => ({
        name: l.name || '—',
        qty: l.qty || '—',
        unit: l.unit || '—',
        netPrice: l.netPrice || '—',
        net: l.net || '—',
        vatRate: l.vatRate || '—',
    }));
}

export default function InvoicePreviewPage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
    const [invoice, setInvoice] = useState<InvoiceData | null>(null);
    const [loading, setLoading] = useState(true);
    const [showRaw, setShowRaw] = useState(false);
    const [updating, setUpdating] = useState(false);
    const [error, setError] = useState('');
    const [upoLoading, setUpoLoading] = useState(false);

    const downloadUpo = async () => {
        setUpoLoading(true);
        setError('');
        try {
            const res = await fetch(`/api/invoices/${id}/upo`);
            const d = await res.json();
            if (!res.ok) { setError(d.error || 'Nie udało się pobrać UPO'); return; }
            const blob = new Blob([d.upoXml], { type: 'application/xml' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `UPO-${invoice?.ksef_number || id}.xml`;
            a.click();
            URL.revokeObjectURL(url);
        } catch {
            setError('Błąd połączenia z serwerem');
        } finally {
            setUpoLoading(false);
        }
    };

    useEffect(() => {
        fetch(`/api/invoices/${id}/xml`)
            .then(r => r.ok ? r.json() : null)
            .then(data => { if (data) setInvoice(data); else router.push('/dashboard/invoices'); })
            .finally(() => setLoading(false));
    }, [id, router]);

    const setStatus = async (status: string) => {
        setUpdating(true);
        setError('');
        const res = await fetch(`/api/invoices/${id}/xml`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ processing_status: status }),
        });
        if (res.ok) {
            router.push('/dashboard/invoices');
        } else {
            const d = await res.json().catch(() => ({}));
            setError(d.error || 'Błąd');
            setUpdating(false);
        }
    };

    if (loading) return <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 14 }}>Ładowanie...</div>;
    if (!invoice) return null;

    const fmt = (v: string | null) => v ? Number(v).toLocaleString('pl-PL', { minimumFractionDigits: 2 }) : '0,00';
    const xmlLines = invoice.raw_xml ? parseXmlLines(invoice.raw_xml) : [];

    const statusColors: Record<string, { bg: string; color: string; label: string }> = {
        new: { bg: 'rgba(99,102,241,0.1)', color: 'var(--accent-hover)', label: 'Nowa' },
        classified: { bg: 'rgba(34,197,94,0.1)', color: 'var(--success)', label: 'Zaklasyfikowana' },
        sent: { bg: 'rgba(99,102,241,0.1)', color: '#6366f1', label: 'Wysłana do KSeF' },
        rejected: { bg: 'var(--error-dim)', color: 'var(--error)', label: 'Odrzucona przez KSeF' },
        exported_jpk: { bg: 'rgba(14,165,233,0.1)', color: '#0ea5e9', label: 'Uwzględniona w JPK' },
        error: { bg: 'var(--error-dim)', color: 'var(--error)', label: 'Błąd' },
    };
    const statusStyle = statusColors[invoice.processing_status] || statusColors.new;

    return (
        <div style={{ maxWidth: 860, padding: '28px 0' }}>
            <Link href="/dashboard/invoices" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none', marginBottom: 20 }}>
                <ArrowLeft size={14} /> Powrót do faktur
            </Link>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, gap: 16 }}>
                <div>
                    <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: '0 0 6px', letterSpacing: '-0.4px' }}>
                        Podgląd faktury
                    </h1>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="mono" style={{ fontSize: 13, color: 'var(--text-subtle)' }}>
                            {invoice.invoice_number || invoice.ksef_number || `#${id}`}
                        </span>
                        <span style={{ fontSize: 11.5, fontWeight: 700, background: statusStyle.bg, color: statusStyle.color, padding: '3px 10px', borderRadius: 100 }}>
                            {statusStyle.label}
                        </span>
                        <span style={{ fontSize: 11.5, fontWeight: 700, background: invoice.direction === 'sales' ? 'rgba(34,197,94,0.1)' : 'var(--accent-dim)', color: invoice.direction === 'sales' ? 'var(--success)' : 'var(--accent-hover)', padding: '3px 10px', borderRadius: 100 }}>
                            {invoice.direction === 'sales' ? 'Sprzedaż' : 'Zakup'}
                        </span>
                        {invoice.corrects_invoice_id && (
                            <span style={{ fontSize: 11.5, fontWeight: 700, background: 'rgba(245,158,11,0.12)', color: '#f59e0b', padding: '3px 10px', borderRadius: 100 }}>
                                Korekta
                            </span>
                        )}
                    </div>
                    {invoice.corrects_invoice_id && invoice.correction_reason && (
                        <div style={{ fontSize: 12.5, color: 'var(--text-subtle)', marginTop: 8 }}>
                            Powód korekty: {invoice.correction_reason}
                        </div>
                    )}
                    {invoice.processing_status === 'rejected' && invoice.ksef_rejection_reason && (
                        <div style={{ fontSize: 12.5, color: 'var(--error)', marginTop: 8 }}>
                            Powód odrzucenia przez KSeF: {invoice.ksef_rejection_reason}
                        </div>
                    )}
                </div>
                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <a
                        href={`/api/invoices/${id}/pdf`}
                        className="btn-secondary"
                        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, textDecoration: 'none' }}
                    >
                        <FileDown size={14} /> Pobierz PDF
                    </a>
                    {invoice.ksef_number && (
                        <button
                            onClick={downloadUpo}
                            disabled={upoLoading}
                            className="btn-secondary"
                            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
                        >
                            <FileDown size={14} /> {upoLoading ? 'Pobieranie...' : 'Pobierz UPO'}
                        </button>
                    )}
                    {invoice.ksef_number && invoice.direction === 'sales' && !invoice.corrects_invoice_id && (
                        <Link
                            href={`/dashboard/invoices/new?correctingId=${invoice.id}`}
                            className="btn-secondary"
                            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, textDecoration: 'none' }}
                        >
                            <FileEdit size={14} /> Wystaw korektę
                        </Link>
                    )}
                    <button
                        onClick={() => setStatus('error')}
                        disabled={updating}
                        className="btn-secondary"
                        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--error)', borderColor: 'rgba(239,68,68,0.4)' }}
                    >
                        <XCircle size={14} /> Odrzuć
                    </button>
                    <button
                        onClick={() => setStatus('classified')}
                        disabled={updating}
                        className="btn-primary"
                        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
                    >
                        <CheckCircle size={14} /> Zatwierdź
                    </button>
                </div>
            </div>

            {error && (
                <div style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 10, background: 'var(--error-dim)', border: '1px solid rgba(239,68,68,0.25)', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <AlertCircle size={14} color="var(--error)" />
                    <span style={{ fontSize: 13, color: 'var(--error)' }}>{error}</span>
                </div>
            )}

            {/* Parties */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
                {[
                    { title: 'Sprzedawca', name: invoice.seller_name, nip: invoice.seller_nip },
                    { title: 'Nabywca', name: invoice.buyer_name, nip: invoice.buyer_nip },
                ].map(({ title, name, nip }) => (
                    <div key={title} style={{ background: 'var(--bg-surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '20px 24px' }}>
                        <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>{title}</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{name || '—'}</div>
                        {nip && <div className="mono" style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>NIP: {nip}</div>}
                    </div>
                ))}
            </div>

            {/* Amounts */}
            <div style={{ background: 'var(--bg-surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '20px 24px', marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>Kwoty</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
                    {[
                        { label: 'Data wystawienia', value: invoice.issue_date ? new Date(invoice.issue_date).toLocaleDateString('pl-PL') : '—' },
                        { label: 'Netto', value: `${fmt(invoice.net_amount)} ${invoice.currency || 'PLN'}` },
                        { label: 'VAT', value: `${fmt(invoice.vat_amount)} ${invoice.currency || 'PLN'}` },
                        { label: 'Brutto', value: `${fmt(invoice.gross_amount)} ${invoice.currency || 'PLN'}`, bold: true },
                    ].map(({ label, value, bold }) => (
                        <div key={label}>
                            <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginBottom: 4 }}>{label}</div>
                            <div style={{ fontSize: bold ? 17 : 14, fontWeight: bold ? 800 : 600, color: bold ? 'var(--text)' : 'var(--text-muted)' }}>{value}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Line items (if parsed from XML) */}
            {xmlLines.length > 0 && (
                <div style={{ background: 'var(--bg-surface)', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden', marginBottom: 20 }}>
                    <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                        Pozycje faktury ({xmlLines.length})
                    </div>
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Nazwa towaru/usługi</th>
                                <th style={{ textAlign: 'right' }}>Ilość</th>
                                <th>J.m.</th>
                                <th style={{ textAlign: 'right' }}>Cena netto</th>
                                <th style={{ textAlign: 'center' }}>Stawka VAT</th>
                                <th style={{ textAlign: 'right' }}>Wartość netto</th>
                            </tr>
                        </thead>
                        <tbody>
                            {xmlLines.map((line, i) => (
                                <tr key={i}>
                                    <td style={{ fontWeight: 500, color: 'var(--text)' }}>{line.name}</td>
                                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{line.qty}</td>
                                    <td style={{ color: 'var(--text-muted)' }}>{line.unit}</td>
                                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{line.netPrice}</td>
                                    <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{line.vatRate}</td>
                                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text)' }}>{line.net}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Raw XML toggle */}
            {invoice.raw_xml && (
                <div style={{ background: 'var(--bg-surface)', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden' }}>
                    <button
                        onClick={() => setShowRaw(v => !v)}
                        style={{ width: '100%', padding: '14px 24px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', textAlign: 'left' }}
                    >
                        <FileCode size={15} /> {showRaw ? 'Ukryj' : 'Pokaż'} surowy XML KSeF
                    </button>
                    {showRaw && (
                        <pre style={{ margin: 0, padding: '0 24px 20px', fontSize: 11.5, color: 'var(--text-subtle)', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                            {invoice.raw_xml}
                        </pre>
                    )}
                </div>
            )}
        </div>
    );
}
