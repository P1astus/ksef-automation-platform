'use client';
import { readApiFailure, BILLING_HREF } from '@/lib/plan-errors';

import { useState } from 'react';
import { FileText, CheckCircle, Circle, Eye } from 'lucide-react';
import Link from 'next/link';
import DownloadButton from './DownloadButton';

interface InvoiceTableProps {
    invoices: any[];
    onRefresh?: () => void;
}

export default function InvoiceTable({ invoices, onRefresh }: InvoiceTableProps) {
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [isExporting, setIsExporting] = useState(false);
    const [exportSystem, setExportSystem] = useState('optima');
    const [paymentStatuses, setPaymentStatuses] = useState<Record<number, string>>({});

    const getPaymentStatus = (invoice: any) => paymentStatuses[invoice.id] ?? (invoice.payment_status || 'unpaid');

    const togglePayment = async (invoice: any) => {
        const current = getPaymentStatus(invoice);
        const next = current === 'paid' ? 'unpaid' : 'paid';
        setPaymentStatuses(prev => ({ ...prev, [invoice.id]: next }));
        await fetch(`/api/invoices/${invoice.id}/payment`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payment_status: next }),
        }).catch(() => {
            setPaymentStatuses(prev => ({ ...prev, [invoice.id]: current }));
        });
    };

    const toggleSelectAll = () => {
        setSelectedIds(selectedIds.size === invoices.length ? new Set() : new Set(invoices.map(i => i.id)));
    };

    const toggleSelectOne = (id: number) => {
        const newSet = new Set(selectedIds);
        newSet.has(id) ? newSet.delete(id) : newSet.add(id);
        setSelectedIds(newSet);
    };

    const handleExport = async () => {
        if (selectedIds.size === 0) return;
        setIsExporting(true);
        const dateStr = new Date().toISOString().split('.')[0].replace(/:/g, '-').replace('T', '_');
        const ext = exportSystem === 'csv' ? 'csv' : exportSystem === 'optima' ? 'xml' : exportSystem === 'insert' ? 'epp' : 'txt';
        const filename = `${exportSystem}-export_${dateStr}.${ext}`;
        try {
            const resp = await fetch('/api/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ invoiceIds: Array.from(selectedIds), system: exportSystem })
            });
            if (!resp.ok) {
                const failure = await readApiFailure(resp, `Błąd eksportu do ${exportSystem}`);
                if (failure.isPlanError) {
                    if (confirm(`❌ ${failure.message}\n\nPrzejść do zakładki Rozliczenia?`)) window.location.href = BILLING_HREF;
                } else {
                    alert(`❌ ${failure.message}`);
                }
                return;
            }
            const text = await resp.text();
            if ('showSaveFilePicker' in window) {
                try {
                    const fileHandle = await (window as any).showSaveFilePicker({ suggestedName: filename, types: [{ description: 'Plik eksportu', accept: { 'text/plain': ['.txt', '.xml', '.epp'] } }] });
                    const writable = await fileHandle.createWritable();
                    await writable.write(text); await writable.close(); return;
                } catch (e: any) { if (e.name === 'AbortError') return; }
            }
            const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl; a.download = filename; a.style.display = 'none';
            document.body.appendChild(a); a.click();
            setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(blobUrl); }, 200);
        } catch (err) {
            console.error(err); alert('Wystąpił błąd podczas eksportu.');
        } finally { setIsExporting(false); }
    };

    return (
        <div style={{ background: 'var(--bg-surface)', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden' }}>
            {selectedIds.size > 0 && (
                <div style={{ padding: '12px 20px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-muted)' }}>
                        Zaznaczono: <b style={{ color: 'var(--text)' }}>{selectedIds.size}</b>
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <select value={exportSystem} onChange={(e) => setExportSystem(e.target.value)}
                            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg-surface)', color: 'var(--text)', fontWeight: 500 }}>
                            <option value="csv">CSV (Excel / arkusz)</option>
                            <option value="optima">Comarch ERP Optima (XML)</option>
                            <option value="symfonia">Symfonia ERP</option>
                            <option value="insert">Insert (Rewizor / Rachmistrz)</option>
                        </select>
                        <button onClick={handleExport} disabled={isExporting} className="btn-primary" style={{ opacity: isExporting ? 0.7 : 1 }}>
                            {isExporting ? 'Generowanie...' : 'Eksportuj zbiorczo'}
                        </button>
                    </div>
                </div>
            )}

            <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                    <thead>
                        <tr>
                            <th style={{ width: 40, textAlign: 'center' }}>
                                <input type="checkbox" checked={invoices.length > 0 && selectedIds.size === invoices.length} onChange={toggleSelectAll} />
                            </th>
                            <th>Data</th>
                            <th>Nr faktury</th>
                            <th>Klient</th>
                            <th>Kontrahent</th>
                            <th style={{ textAlign: 'right' }}>Kwota brutto</th>
                            <th>Typ</th>
                            <th>Płatność</th>
                            <th>Podgląd</th>
                            <th>Oryginał KSeF</th>
                        </tr>
                    </thead>
                    <tbody>
                        {invoices.map((invoice) => (
                            <tr key={invoice.id} style={{ background: selectedIds.has(invoice.id) ? 'var(--accent-dim)' : 'transparent' }}>
                                <td style={{ textAlign: 'center' }}>
                                    <input type="checkbox" checked={selectedIds.has(invoice.id)} onChange={() => toggleSelectOne(invoice.id)} />
                                </td>
                                <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                    {invoice.issue_date ? new Date(invoice.issue_date).toLocaleDateString('pl-PL') : '—'}
                                </td>
                                <td style={{ fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {invoice.invoice_number || invoice.ksef_number || '—'}
                                </td>
                                <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{invoice.client_name}</td>
                                <td style={{ color: 'var(--text-subtle)', whiteSpace: 'nowrap', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {invoice.direction === 'sales' ? invoice.buyer_name : invoice.seller_name}
                                </td>
                                <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                                    {invoice.gross_amount ? `${Number(invoice.gross_amount).toLocaleString('pl-PL', { minimumFractionDigits: 2 })} ${invoice.currency || 'PLN'}` : '—'}
                                </td>
                                <td>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                        {invoice.direction === 'sales' ? (
                                            <span style={{ fontSize: 11.5, fontWeight: 700, background: 'rgba(34,197,94,0.1)', color: 'var(--success)', border: '1px solid rgba(34,197,94,0.25)', padding: '3px 10px', borderRadius: 100 }}>Sprzedaż</span>
                                        ) : (
                                            <span style={{ fontSize: 11.5, fontWeight: 700, background: 'var(--accent-dim)', color: 'var(--accent-hover)', border: '1px solid rgba(99,102,241,0.25)', padding: '3px 10px', borderRadius: 100 }}>Zakup</span>
                                        )}
                                        {invoice.direction === 'purchase' && invoice.cost_category && (
                                            <span title={`Pewność: ${Math.round((invoice.classification_confidence || 0) * 100)}%`} style={{ fontSize: 10, fontWeight: 600, background: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.25)', padding: '2px 8px', borderRadius: 100, cursor: 'default', whiteSpace: 'nowrap' }}>
                                                {invoice.cost_category.replace(/_/g, ' ')}
                                            </span>
                                        )}
                                    </div>
                                </td>
                                <td>
                                    {invoice.direction === 'sales' ? (() => {
                                        const status = getPaymentStatus(invoice);
                                        const isOverdue = invoice.due_date && new Date(invoice.due_date) < new Date() && status !== 'paid';
                                        const isDueSoon = invoice.due_date && !isOverdue && Math.ceil((new Date(invoice.due_date).getTime() - Date.now()) / 86400000) <= 7 && status !== 'paid';
                                        return (
                                            <button
                                                onClick={() => togglePayment(invoice)}
                                                title={status === 'paid' ? 'Oznacz jako niezapłacona' : 'Oznacz jako zapłacona'}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, padding: 0, fontSize: 11.5, fontWeight: 600,
                                                    color: status === 'paid' ? '#22c55e' : isOverdue ? '#ef4444' : isDueSoon ? '#f59e0b' : 'var(--text-subtle)' }}>
                                                {status === 'paid' ? <CheckCircle size={14} /> : <Circle size={14} />}
                                                {status === 'paid' ? 'Zapłacona' : isOverdue ? 'Zaległa' : isDueSoon ? 'Wkrótce' : 'Nieopłacona'}
                                            </button>
                                        );
                                    })() : <span style={{ color: 'var(--text-subtle)', fontSize: 11.5 }}>—</span>}
                                </td>
                                <td>
                                    <Link href={`/dashboard/invoices/${invoice.id}/preview`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--accent-hover)', textDecoration: 'none', fontWeight: 600, padding: '4px 0' }}>
                                        <Eye size={12} /> Podgląd
                                    </Link>
                                </td>
                                <td>
                                    <DownloadButton invoiceId={invoice.id} invoiceNumber={invoice.invoice_number} ksefNumber={invoice.ksef_number} />
                                </td>
                            </tr>
                        ))}
                        {invoices.length === 0 && (
                            <tr>
                                <td colSpan={9} style={{ padding: '48px', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 14 }}>
                                    <div style={{ marginBottom: 10 }}><FileText size={32} color="var(--text-subtle)" style={{ margin: '0 auto' }} /></div>
                                    Nie znaleziono jeszcze żadnych faktur.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
