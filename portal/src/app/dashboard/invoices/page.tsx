'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, ChevronLeft, ChevronRight, FilePlus, WifiOff, Upload } from 'lucide-react';
import Link from 'next/link';
import InvoiceTable from './InvoiceTable';
import ManualUpload from './ManualUpload';

interface InvoiceResponse {
    invoices: any[];
    total: number;
    page: number;
    totalPages: number;
}

export default function InvoicesPage() {
    const [data, setData] = useState<InvoiceResponse>({ invoices: [], total: 0, page: 1, totalPages: 1 });
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [direction, setDirection] = useState('');
    const [page, setPage] = useState(1);
    const [searchInput, setSearchInput] = useState('');
    const [showUpload, setShowUpload] = useState(false);

    const fetchInvoices = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (search) params.set('search', search);
            if (direction) params.set('direction', direction);
            params.set('page', String(page));
            const res = await fetch(`/api/invoices?${params}`);
            const json = await res.json();
            setData(json);
        } finally {
            setLoading(false);
        }
    }, [search, direction, page]);

    useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

    const applySearch = () => { setSearch(searchInput); setPage(1); };
    const handleDirectionChange = (val: string) => { setDirection(val); setPage(1); };

    const tabs = [
        { val: '',         label: 'Wszystkie', count: data.total },
        { val: 'sales',    label: 'Sprzedaż',  count: null },
        { val: 'purchase', label: 'Zakup',      count: null },
    ];

    return (
        <div>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, paddingTop: 28 }}>
                <div>
                    <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: 0, letterSpacing: '-0.4px' }}>Faktury</h1>
                    <p style={{ margin: '4px 0 0', fontSize: 13.5, color: 'var(--text-muted)' }}>
                        Faktury pobrane z KSeF lub dodane ręcznie
                    </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Link href="/dashboard/invoices/offline" className="btn-secondary" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '8px 14px', borderRadius: 7, color: 'var(--error)', borderColor: 'rgba(239,68,68,0.35)' }}>
                        <WifiOff size={14} /> Offline
                    </Link>
                    <Link href="/dashboard/invoices/new" className="btn-primary" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '8px 16px', borderRadius: 7 }}>
                        <FilePlus size={15} /> Wystaw fakturę
                    </Link>
                </div>
            </div>

            {/* Upload zone */}
            <div
                className="upload-zone"
                onClick={() => setShowUpload(v => !v)}
                role="button"
                tabIndex={0}
            >
                <Upload size={22} style={{ color: 'var(--accent)', marginBottom: 8 }} />
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 2 }}>
                    Dodaj faktury spoza KSeF
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                    Kliknij aby wgrać plik XML lub PDF
                </div>
            </div>
            {showUpload && <ManualUpload />}

            {/* Filter bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                {/* Tab filters */}
                <div className="tab-bar">
                    {tabs.map(({ val, label, count }) => (
                        <button
                            key={val}
                            className={`tab-item${direction === val ? ' active' : ''}`}
                            onClick={() => handleDirectionChange(val)}
                        >
                            {label}
                            {count !== null && (
                                <span style={{
                                    marginLeft: 6,
                                    fontSize: 10,
                                    fontWeight: 700,
                                    padding: '1px 6px',
                                    borderRadius: 100,
                                    background: direction === val ? 'rgba(255,255,255,0.2)' : 'var(--bg-elevated)',
                                    color: direction === val ? '#fff' : 'var(--text-subtle)',
                                }}>
                                    {count}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Search */}
                <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 360 }}>
                    <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)' }} />
                    <input
                        value={searchInput}
                        onChange={e => setSearchInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && applySearch()}
                        placeholder="Szukaj po nr faktury, NIP..."
                        style={{ paddingLeft: 32, width: '100%' }}
                    />
                </div>
                <button onClick={applySearch} className="btn-secondary" style={{ padding: '9px 16px', fontSize: 13 }}>
                    Szukaj
                </button>
                {(search || direction) && (
                    <button onClick={() => { setSearch(''); setSearchInput(''); setDirection(''); setPage(1); }} style={{ fontSize: 12, color: 'var(--text-subtle)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                        Wyczyść
                    </button>
                )}
            </div>

            {/* Table */}
            {loading ? (
                <div style={{ background: 'var(--bg-surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '48px', textAlign: 'center', color: 'var(--text-subtle)' }}>
                    Ładowanie...
                </div>
            ) : (
                <InvoiceTable invoices={data.invoices} onRefresh={fetchInvoices} />
            )}

            {/* Pagination */}
            {data.totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
                    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                        Strona {data.page} z {data.totalPages} · {data.total} wyników
                    </span>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="btn-secondary" style={{ padding: '7px 12px', opacity: page <= 1 ? 0.4 : 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <ChevronLeft size={15} /> Poprzednia
                        </button>
                        <button onClick={() => setPage(p => Math.min(data.totalPages, p + 1))} disabled={page >= data.totalPages} className="btn-secondary" style={{ padding: '7px 12px', opacity: page >= data.totalPages ? 0.4 : 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                            Następna <ChevronRight size={15} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
