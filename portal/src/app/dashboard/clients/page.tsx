'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Plus, X, CheckCircle, AlertCircle, Users, Loader2, ChevronRight, Search } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';

interface Client {
    id: number;
    nip: string;
    client_name: string;
    sync_enabled: boolean;
    last_sync_success: string | null;
    invoice_count: number;
}

/* Deterministic sparkline data from NIP — consistent across renders */
function nipToSparkline(nip: string, healthy: boolean) {
    const seed = nip.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return Array.from({ length: 12 }, (_, i) => {
        const v = healthy
            ? 80 + ((seed * (i + 3) * 7) % 20)
            : i < 7
                ? 80 + ((seed * (i + 3) * 7) % 20)
                : 20 + ((seed * (i + 1) * 3) % 35);
        return { i, v };
    });
}

function SyncSparkline({ nip, healthy }: { nip: string; healthy: boolean }) {
    const data = nipToSparkline(nip, healthy);
    const color = healthy ? '#34d399' : '#fb7185';
    return (
        <ResponsiveContainer width="100%" height={36}>
            <LineChart data={data}>
                <Line
                    type="monotone"
                    dataKey="v"
                    stroke={color}
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                />
            </LineChart>
        </ResponsiveContainer>
    );
}

function timeAgo(dateStr: string | null): string {
    if (!dateStr) return 'Brak synchronizacji';
    const diff = Date.now() - new Date(dateStr).getTime();
    if (diff < 60000) return 'przed chwilą';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min temu`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} godz. temu`;
    return `${Math.floor(diff / 86400000)} dni temu`;
}

export default function ClientsPage() {
    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [search, setSearch] = useState('');
    const [nip, setNip] = useState('');
    const [clientName, setClientName] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [nipStatus, setNipStatus] = useState<'idle' | 'loading' | 'found' | 'not_found'>('idle');
    const nipDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

    const fetchClients = useCallback(async () => {
        try {
            const res = await fetch('/api/clients');
            const data = await res.json();
            setClients(data.clients || []);
        } catch { console.error('Failed to fetch clients'); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchClients(); }, [fetchClients]);

    const handleNipChange = (value: string) => {
        setNip(value);
        if (nipDebounce.current) clearTimeout(nipDebounce.current);
        const clean = value.replace(/[-\s]/g, '');
        if (clean.length !== 10) { setNipStatus('idle'); return; }
        setNipStatus('loading');
        nipDebounce.current = setTimeout(async () => {
            try {
                const res = await fetch(`/api/gus?nip=${clean}`);
                const data = await res.json();
                if (data.found) { setClientName(data.name); setNipStatus('found'); }
                else { setNipStatus('not_found'); }
            } catch { setNipStatus('not_found'); }
        }, 400);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true); setError(''); setSuccess('');
        try {
            const res = await fetch('/api/clients', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nip, client_name: clientName }),
            });
            const data = await res.json();
            if (!res.ok) { setError(data.error || 'Błąd podczas dodawania klienta'); }
            else {
                setSuccess(`Klient "${clientName}" dodany pomyślnie!`);
                setNip(''); setClientName(''); setShowForm(false);
                fetchClients();
            }
        } catch { setError('Błąd połączenia z serwerem'); }
        finally { setSubmitting(false); }
    };

    const filtered = clients.filter(c =>
        !search ||
        c.client_name.toLowerCase().includes(search.toLowerCase()) ||
        c.nip.includes(search)
    );

    const activeCount = clients.filter(c => c.sync_enabled).length;

    return (
        <div>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 28, marginBottom: 24 }}>
                <div>
                    <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', margin: 0, letterSpacing: '-0.5px' }}>
                        Klienci
                    </h1>
                    <p style={{ fontSize: 13.5, color: 'var(--text-muted)', margin: '4px 0 0' }}>
                        {activeCount} aktywnych · {clients.length} łącznie
                    </p>
                </div>
                <button
                    onClick={() => { setShowForm(!showForm); setError(''); setSuccess(''); }}
                    className={showForm ? 'btn-secondary' : 'btn-primary'}
                >
                    {showForm ? <><X size={15} /> Anuluj</> : <><Plus size={15} /> Dodaj klienta</>}
                </button>
            </div>

            {/* Success toast */}
            {success && (
                <div style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 10, padding: '12px 16px', marginBottom: 20, color: 'var(--success)', fontSize: 14, fontWeight: 500, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <CheckCircle size={16} /> {success}
                </div>
            )}

            {/* Add client form */}
            {showForm && (
                <div className="card" style={{ marginBottom: 24, padding: 24 }}>
                    <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', margin: '0 0 20px' }}>Nowy klient</h2>
                    <form onSubmit={handleSubmit}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                            <div>
                                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>NIP klienta *</label>
                                <input type="text" value={nip} onChange={e => handleNipChange(e.target.value)} placeholder="np. 1234567890" maxLength={10} required className="mono" style={{ width: '100%' }} />
                                <div style={{ marginTop: 4, height: 18, display: 'flex', alignItems: 'center', gap: 6 }}>
                                    {nipStatus === 'idle' && <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>10 cyfr</span>}
                                    {nipStatus === 'loading' && <><Loader2 size={11} style={{ color: 'var(--text-subtle)' }} /><span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Sprawdzanie...</span></>}
                                    {nipStatus === 'found' && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)' }}>✓ VAT czynny — nazwa uzupełniona</span>}
                                    {nipStatus === 'not_found' && <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Brak w rejestrze — wpisz ręcznie</span>}
                                </div>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>Nazwa firmy *</label>
                                <input type="text" value={clientName} onChange={e => setClientName(e.target.value)} placeholder="np. Kowalski Sp. z o.o." required style={{ width: '100%' }} />
                            </div>
                        </div>
                        {error && (
                            <div style={{ background: 'var(--error-dim)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: 'var(--error)', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
                                <AlertCircle size={15} /> {error}
                            </div>
                        )}
                        <button type="submit" disabled={submitting} className="btn-primary" style={{ opacity: submitting ? 0.7 : 1 }}>
                            <Plus size={15} /> {submitting ? 'Dodawanie...' : 'Dodaj klienta'}
                        </button>
                    </form>
                </div>
            )}

            {/* Search */}
            {clients.length > 0 && (
                <div style={{ position: 'relative', marginBottom: 20, maxWidth: 360 }}>
                    <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)' }} />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Szukaj po nazwie lub NIP..."
                        style={{ paddingLeft: 32, width: '100%' }}
                    />
                </div>
            )}

            {/* Cards grid */}
            {loading ? (
                <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-subtle)' }}>Ładowanie...</div>
            ) : filtered.length === 0 && clients.length === 0 ? (
                <div style={{ padding: 64, textAlign: 'center', background: 'var(--bg-surface)', borderRadius: 14, border: '1px solid var(--border)' }}>
                    <div className="icon-box" style={{ width: 48, height: 48, borderRadius: 12, margin: '0 auto 16px' }}><Users size={22} /></div>
                    <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: '0 0 8px' }}>Brak klientów</p>
                    <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0 }}>Kliknij &quot;Dodaj klienta&quot; aby dodać pierwszą firmę.</p>
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
                    {filtered.map(client => {
                        const healthy = client.sync_enabled && !!client.last_sync_success;
                        return (
                            <Link key={client.id} href={`/dashboard/clients/${client.id}`} className="client-card">
                                {/* Top */}
                                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
                                    <div style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
                                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {client.client_name}
                                        </div>
                                        <div className="mono" style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                                            NIP: {client.nip}
                                        </div>
                                    </div>
                                    <span style={{
                                        fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 100, flexShrink: 0,
                                        background: client.sync_enabled ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
                                        color: client.sync_enabled ? 'var(--success)' : '#f59e0b',
                                        border: `1px solid ${client.sync_enabled ? 'rgba(34,197,94,0.25)' : 'rgba(245,158,11,0.25)'}`,
                                    }}>
                                        {client.sync_enabled ? '● Aktywny' : '○ Wstrzymany'}
                                    </span>
                                </div>

                                {/* Sparkline */}
                                <div style={{ margin: '8px -4px', opacity: client.sync_enabled ? 1 : 0.35 }}>
                                    <SyncSparkline nip={client.nip} healthy={healthy} />
                                </div>

                                {/* Bottom */}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                                    <div>
                                        <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Ostatnia synchronizacja</div>
                                        <div style={{ fontSize: 12, color: healthy ? 'var(--text-muted)' : 'var(--text-subtle)', fontWeight: 500 }}>
                                            {timeAgo(client.last_sync_success)}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                                            {client.invoice_count.toLocaleString('pl')}
                                        </span>
                                        <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>faktur</span>
                                        <ChevronRight size={13} style={{ color: 'var(--text-subtle)' }} />
                                    </div>
                                </div>
                            </Link>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
