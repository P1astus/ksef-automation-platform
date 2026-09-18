'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle, XCircle, FileWarning, ExternalLink } from 'lucide-react';

interface QueueItem {
    id: number;
    client_nip: string;
    source_type: string;
    file_type: string;
    ocr_status: string;
    confidence_score: string | null;
    extracted_data: { nip: string; invoiceNumber: string; netAmount: number; vatAmount: number; grossAmount: number } | null;
    created_at: string;
}

const SOURCE_LABEL: Record<string, string> = { upload: 'Wgrany plik', email: 'E-mail', webhook: 'Link od klienta' };

export default function OcrReviewQueuePage() {
    const [items, setItems] = useState<QueueItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [edits, setEdits] = useState<Record<number, { nip: string; invoiceNumber: string; netAmount: string; vatAmount: string; grossAmount: string; direction: string }>>({});
    const [busy, setBusy] = useState<Record<number, boolean>>({});

    const load = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/ocr-queue');
            const data = await res.json();
            const list: QueueItem[] = data.items || [];
            setItems(list);
            setEdits(prev => {
                const next = { ...prev };
                for (const item of list) {
                    if (!next[item.id]) {
                        next[item.id] = {
                            nip: item.extracted_data?.nip === 'NIEZNANY' ? '' : (item.extracted_data?.nip || ''),
                            invoiceNumber: item.extracted_data?.invoiceNumber || '',
                            netAmount: String(item.extracted_data?.netAmount ?? 0),
                            vatAmount: String(item.extracted_data?.vatAmount ?? 0),
                            grossAmount: String(item.extracted_data?.grossAmount ?? 0),
                            direction: 'purchase',
                        };
                    }
                }
                return next;
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const approve = async (id: number) => {
        const edit = edits[id];
        setBusy(b => ({ ...b, [id]: true }));
        try {
            const res = await fetch(`/api/ocr-queue/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'approve', ...edit }),
            });
            if (res.ok) setItems(prev => prev.filter(i => i.id !== id));
            else { const d = await res.json(); alert(d.error || 'Błąd zatwierdzania'); }
        } finally {
            setBusy(b => ({ ...b, [id]: false }));
        }
    };

    const reject = async (id: number) => {
        if (!confirm('Odrzucić ten dokument? Nie zostanie utworzona faktura.')) return;
        setBusy(b => ({ ...b, [id]: true }));
        try {
            const res = await fetch(`/api/ocr-queue/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'reject' }),
            });
            if (res.ok) setItems(prev => prev.filter(i => i.id !== id));
        } finally {
            setBusy(b => ({ ...b, [id]: false }));
        }
    };

    return (
        <div style={{ maxWidth: 900, padding: '28px 0' }}>
            <Link href="/dashboard/invoices" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none', marginBottom: 20 }}>
                <ArrowLeft size={14} /> Powrót do faktur
            </Link>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: '0 0 6px' }}>Kolejka weryfikacji OCR</h1>
            <p style={{ fontSize: 13.5, color: 'var(--text-muted)', margin: '0 0 24px' }}>
                Dokumenty z niepewnym odczytem (brak NIP, brak numeru faktury lub niespójne kwoty) czekają tu na sprawdzenie przed zapisaniem jako faktura.
            </p>

            {loading ? (
                <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 14 }}>Ładowanie...</div>
            ) : items.length === 0 ? (
                <div style={{ background: 'var(--bg-surface)', border: '1px dashed var(--border-hover)', borderRadius: 14, padding: '40px 32px', textAlign: 'center' }}>
                    <CheckCircle size={28} style={{ color: 'var(--success)', margin: '0 auto 10px', display: 'block' }} />
                    <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Brak dokumentów do weryfikacji.</div>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {items.map(item => {
                        const edit = edits[item.id] || { nip: '', invoiceNumber: '', netAmount: '0', vatAmount: '0', grossAmount: '0', direction: 'purchase' };
                        return (
                            <div key={item.id} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                                    <FileWarning size={16} style={{ color: '#f59e0b' }} />
                                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                                        {SOURCE_LABEL[item.source_type] || item.source_type} · {item.file_type?.toUpperCase()}
                                    </span>
                                    <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                                        {new Date(item.created_at).toLocaleString('pl-PL')}
                                    </span>
                                    <a
                                        href={`/api/ocr-queue/${item.id}/file`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--accent-hover)', textDecoration: 'none' }}
                                    >
                                        <ExternalLink size={13} /> Otwórz oryginał
                                    </a>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 14 }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: 11, color: 'var(--text-subtle)', marginBottom: 4 }}>NIP</label>
                                        <input value={edit.nip} onChange={e => setEdits(prev => ({ ...prev, [item.id]: { ...edit, nip: e.target.value.replace(/\D/g, '').slice(0, 10) } }))} placeholder="1234567890" style={{ width: '100%' }} />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: 11, color: 'var(--text-subtle)', marginBottom: 4 }}>Nr faktury</label>
                                        <input value={edit.invoiceNumber} onChange={e => setEdits(prev => ({ ...prev, [item.id]: { ...edit, invoiceNumber: e.target.value } }))} style={{ width: '100%' }} />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: 11, color: 'var(--text-subtle)', marginBottom: 4 }}>Netto</label>
                                        <input type="number" step="0.01" value={edit.netAmount} onChange={e => setEdits(prev => ({ ...prev, [item.id]: { ...edit, netAmount: e.target.value } }))} style={{ width: '100%' }} />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: 11, color: 'var(--text-subtle)', marginBottom: 4 }}>VAT</label>
                                        <input type="number" step="0.01" value={edit.vatAmount} onChange={e => setEdits(prev => ({ ...prev, [item.id]: { ...edit, vatAmount: e.target.value } }))} style={{ width: '100%' }} />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: 11, color: 'var(--text-subtle)', marginBottom: 4 }}>Brutto</label>
                                        <input type="number" step="0.01" value={edit.grossAmount} onChange={e => setEdits(prev => ({ ...prev, [item.id]: { ...edit, grossAmount: e.target.value } }))} style={{ width: '100%' }} />
                                    </div>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <select value={edit.direction} onChange={e => setEdits(prev => ({ ...prev, [item.id]: { ...edit, direction: e.target.value } }))} style={{ fontSize: 13 }}>
                                        <option value="purchase">Zakup</option>
                                        <option value="sales">Sprzedaż</option>
                                    </select>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <button onClick={() => reject(item.id)} disabled={busy[item.id]} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--error)', borderColor: 'rgba(239,68,68,0.4)' }}>
                                            <XCircle size={14} /> Odrzuć
                                        </button>
                                        <button onClick={() => approve(item.id)} disabled={busy[item.id]} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                                            <CheckCircle size={14} /> {busy[item.id] ? 'Zapisywanie...' : 'Zatwierdź jako fakturę'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
