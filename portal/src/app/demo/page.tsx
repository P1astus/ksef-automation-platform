'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { DemoAreaChart, DemoBarChart } from './DemoCharts';
import {
    Zap, LayoutDashboard, Users, FileText, CreditCard, Settings,
    ArrowRight, CheckCircle, RefreshCw, Search,
} from 'lucide-react';

const BASE_CLIENTS = [
    { id: 1, nip: '5213456789', client_name: 'ABC Sp. z o.o.',         invoice_count: 142, last_sync: '17.03.2026 08:30' },
    { id: 2, nip: '7811234567', client_name: 'XYZ Handel Sp. k.',      invoice_count: 87,  last_sync: '17.03.2026 08:28' },
    { id: 3, nip: '9271234560', client_name: 'Firma Budowlana Nowak',  invoice_count: 203, last_sync: '17.03.2026 08:25' },
    { id: 4, nip: '6431234568', client_name: 'Transport Kowalski',     invoice_count: 56,  last_sync: '17.03.2026 08:20' },
    { id: 5, nip: '1231234567', client_name: 'Restauracja Smaczne',    invoice_count: 31,  last_sync: '17.03.2026 07:45' },
];

const BASE_INVOICES = [
    { id: 1, ksef_number: 'FA/2026/03/0412', seller_name: 'Dostawca Premium S.A.',           buyer_name: 'ABC Sp. z o.o.',        direction: 'purchase', gross_amount: '12 340.00', issue_date: '15.03.2026', status: 'exported_jpk', category: 'usługi IT' },
    { id: 2, ksef_number: 'FA/2026/03/0411', seller_name: 'ABC Sp. z o.o.',                  buyer_name: 'Klient Detaliczny',     direction: 'sales',    gross_amount: '45 690.00', issue_date: '15.03.2026', status: 'exported_jpk', category: null },
    { id: 3, ksef_number: 'FA/2026/03/0388', seller_name: 'Logistyka Polska Sp. z o.o.',     buyer_name: 'Transport Kowalski',    direction: 'purchase', gross_amount: '3 210.00',  issue_date: '14.03.2026', status: 'new',          category: 'transport' },
    { id: 4, ksef_number: 'FA/2026/03/0375', seller_name: 'Materiały Budowlane Sp. z o.o.', buyer_name: 'Firma Budowlana Nowak', direction: 'purchase', gross_amount: '78 920.00', issue_date: '14.03.2026', status: 'exported_jpk', category: 'materiały biurowe' },
    { id: 5, ksef_number: 'FA/2026/03/0350', seller_name: 'Firma Budowlana Nowak',           buyer_name: 'Deweloper Sp. z o.o.', direction: 'sales',    gross_amount: '156 000.00',issue_date: '13.03.2026', status: 'exported_jpk', category: null },
    { id: 6, ksef_number: 'FA/2026/03/0342', seller_name: 'Paliwo Trans Sp. k.',             buyer_name: 'Transport Kowalski',   direction: 'purchase', gross_amount: '8 745.00',  issue_date: '13.03.2026', status: 'new',          category: 'paliwo' },
];

const NEW_INVOICES = [
    { id: 7, ksef_number: 'FA/2026/03/0501', seller_name: 'Telecom Business S.A.',  buyer_name: 'ABC Sp. z o.o.',     direction: 'purchase', gross_amount: '2 460.00', issue_date: '17.03.2026', status: 'new', category: 'media' },
    { id: 8, ksef_number: 'FA/2026/03/0502', seller_name: 'XYZ Handel Sp. k.',      buyer_name: 'Sklep Online Sp. z o.o.', direction: 'sales', gross_amount: '9 830.00', issue_date: '17.03.2026', status: 'new', category: null },
];

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
    exported_jpk: { label: 'JPK gotowy', color: 'var(--success)',      bg: 'rgba(34,197,94,0.1)' },
    new:          { label: 'Nowa',       color: 'var(--accent-hover)', bg: 'var(--accent-dim)' },
    error:        { label: 'Błąd',       color: 'var(--error)',        bg: 'var(--error-dim)' },
};

const navItems = [
    { label: 'Dashboard',   Icon: LayoutDashboard, active: true },
    { label: 'Klienci',     Icon: Users,           active: false },
    { label: 'Faktury',     Icon: FileText,        active: false },
    { label: 'Rozliczenia', Icon: CreditCard,      active: false },
    { label: 'Ustawienia',  Icon: Settings,        active: false },
];

const services = [
    { name: 'Synchronizacja KSeF' },
    { name: 'Baza danych' },
    { name: 'Scheduler n8n' },
    { name: 'Serwis XAdES' },
];

export default function DemoPage() {
    const [searchQuery, setSearchQuery] = useState('');
    const [dirFilter, setDirFilter] = useState<'all' | 'sales' | 'purchase'>('all');
    const [invoices, setInvoices] = useState(BASE_INVOICES);
    const [syncing, setSyncing] = useState(false);
    const [showCta, setShowCta] = useState(false);

    useEffect(() => {
        const t = setTimeout(() => setShowCta(true), 4000);
        return () => clearTimeout(t);
    }, []);

    const filtered = invoices.filter((inv) => {
        const q = searchQuery.toLowerCase();
        const matchSearch = !q || inv.ksef_number.toLowerCase().includes(q) || inv.seller_name.toLowerCase().includes(q) || inv.buyer_name.toLowerCase().includes(q);
        const matchDir = dirFilter === 'all' || inv.direction === dirFilter;
        return matchSearch && matchDir;
    });

    const handleSync = () => {
        if (syncing) return;
        setSyncing(true);
        setTimeout(() => {
            setInvoices(prev => [...NEW_INVOICES, ...prev]);
            setSyncing(false);
        }, 2000);
    };

    return (
        <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-base)' }}>

            {/* ── Demo banner ── */}
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, background: 'var(--accent)', padding: '9px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: 600 }}>
                    Tryb demonstracyjny — dane są przykładowe. Zarejestruj się, aby korzystać z prawdziwych danych.
                </span>
                <div style={{ display: 'flex', gap: 12, flexShrink: 0, alignItems: 'center' }}>
                    <Link href="/login" style={{ color: 'rgba(255,255,255,0.75)', textDecoration: 'none', fontSize: 13, fontWeight: 500 }}>Mam konto</Link>
                    <Link href="/register" style={{ background: 'white', color: 'var(--accent)', textDecoration: 'none', padding: '5px 14px', borderRadius: 6, fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                        Zarejestruj się za darmo <ArrowRight size={12} strokeWidth={2.5} />
                    </Link>
                </div>
            </div>

            {/* ── Sidebar ── */}
            <aside style={{ width: 240, background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', position: 'fixed', top: 38, left: 0, bottom: 0, zIndex: 40 }}>
                <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 7, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Zap size={16} color="#fff" strokeWidth={2.5} />
                        </div>
                        <div>
                            <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)', letterSpacing: '-0.3px' }}>KSeF Auto</div>
                            <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Demo konta</div>
                        </div>
                    </div>
                </div>
                <nav style={{ flex: 1, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <div className="label-caps" style={{ padding: '4px 8px 8px' }}>Menu</div>
                    {navItems.map(({ label, Icon, active }) => (
                        <div key={label} className={`sidebar-link${active ? ' active' : ''}`} style={{ cursor: 'default' }}>
                            <Icon size={16} strokeWidth={2} style={{ flexShrink: 0 }} /> {label}
                        </div>
                    ))}
                </nav>
                <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent-dim)', border: '1px solid rgba(99,102,241,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-hover)', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>BR</div>
                        <div>
                            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>Biuro Demo</div>
                            <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>demo@ksef.auto</div>
                        </div>
                    </div>
                </div>
            </aside>

            {/* ── Main content ── */}
            <div style={{ marginLeft: 240, marginTop: 38, flex: 1, display: 'flex', flexDirection: 'column' }}>
                <header style={{ background: 'var(--bg-base)', borderBottom: '1px solid var(--border)', padding: '0 28px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 38, zIndex: 30 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Dashboard</div>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-hover)', fontSize: 11, fontWeight: 700 }}>BR</div>
                </header>

                <main style={{ flex: 1, padding: '24px 28px 100px' }}>
                    {/* KPI cards */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
                        {[
                            { label: 'Aktywni klienci',     value: '5',   sub: 'z 15 dostępnych' },
                            { label: 'Faktury łącznie',     value: String(invoices.length + 513), sub: 'w tym miesiącu' },
                            { label: 'Faktury sprzedaży',   value: '201', sub: '38.7% całości' },
                            { label: 'Faktury zakupu',      value: '318', sub: '61.3% całości' },
                            { label: 'Wykorzystanie planu', value: '33%', sub: '5 z 15 klientów' },
                        ].map((card) => (
                            <div key={card.label} className="card-stat">
                                <div style={{ fontSize: 10.5, color: 'var(--text-subtle)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>{card.label}</div>
                                <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.04em', lineHeight: 1, marginBottom: 5 }}>{card.value}</div>
                                <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{card.sub}</div>
                            </div>
                        ))}
                    </div>

                    {/* Charts row */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 14, marginBottom: 16 }}>
                        <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', padding: '20px 22px' }}>
                            <div style={{ marginBottom: 16 }}>
                                <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>Aktywność faktur</div>
                                <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 2 }}>Ostatnie 7 dni · Sprzedaż vs Zakup</div>
                            </div>
                            <DemoAreaChart />
                        </div>
                        <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', padding: '20px 22px' }}>
                            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>Status systemu</div>
                            {services.map((s) => (
                                <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
                                    <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{s.name}</span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                        <CheckCircle size={13} style={{ color: 'var(--success)' }} />
                                        <span style={{ fontSize: 11.5, color: 'var(--success)', fontWeight: 600 }}>Online</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Clients table with sync button */}
                    <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', padding: '20px 22px', marginBottom: 14 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>Klienci ({BASE_CLIENTS.length})</div>
                            <button onClick={handleSync} disabled={syncing} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 14px', borderRadius: 8, border: '1px solid var(--accent)', background: syncing ? 'var(--accent-dim)' : 'var(--accent)', color: 'white', fontSize: 12.5, fontWeight: 700, cursor: syncing ? 'wait' : 'pointer' }}>
                                <RefreshCw size={13} style={{ animation: syncing ? 'spin 0.8s linear infinite' : 'none' }} />
                                {syncing ? 'Synchronizuję...' : 'Synchronizuj teraz'}
                            </button>
                        </div>
                        <table className="data-table">
                            <thead><tr>{['NIP', 'Nazwa', 'Faktury', 'Ostatnia synchronizacja'].map(h => <th key={h}>{h}</th>)}</tr></thead>
                            <tbody>
                                {BASE_CLIENTS.map((c) => (
                                    <tr key={c.id}>
                                        <td className="mono" style={{ color: 'var(--text-subtle)' }}>{c.nip}</td>
                                        <td style={{ fontWeight: 600, color: 'var(--text)' }}>{c.client_name}</td>
                                        <td>{c.invoice_count}</td>
                                        <td style={{ color: 'var(--text-subtle)', fontSize: 12 }}>{c.last_sync}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Invoices with live search + filter */}
                    <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', padding: '20px 22px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>
                                Ostatnie faktury {invoices.length > BASE_INVOICES.length && <span style={{ fontSize: 11, background: 'var(--accent-dim)', color: 'var(--accent-hover)', padding: '2px 8px', borderRadius: 100, marginLeft: 8 }}>+{invoices.length - BASE_INVOICES.length} nowych</span>}
                            </div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <div style={{ position: 'relative' }}>
                                    <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)' }} />
                                    <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Szukaj faktury..." style={{ paddingLeft: 30, paddingRight: 12, height: 34, fontSize: 13, width: 200 }} />
                                </div>
                                {(['all', 'sales', 'purchase'] as const).map((f) => (
                                    <button key={f} onClick={() => setDirFilter(f)} style={{ padding: '5px 12px', borderRadius: 7, border: `1px solid ${dirFilter === f ? 'var(--accent)' : 'var(--border)'}`, background: dirFilter === f ? 'var(--accent)' : 'transparent', color: dirFilter === f ? 'white' : 'var(--text-muted)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                                        {f === 'all' ? 'Wszystkie' : f === 'sales' ? 'Sprzedaż' : 'Zakup'}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <table className="data-table">
                            <thead><tr>{['Nr KSeF', 'Kontrahent', 'Kierunek', 'Kwota brutto', 'Data', 'Status'].map(h => <th key={h}>{h}</th>)}</tr></thead>
                            <tbody>
                                {filtered.map((inv) => {
                                    const st = STATUS_LABELS[inv.status] || STATUS_LABELS['new'];
                                    return (
                                        <tr key={inv.id}>
                                            <td className="mono" style={{ color: 'var(--text-subtle)', fontSize: 12 }}>{inv.ksef_number}</td>
                                            <td>{inv.direction === 'purchase' ? inv.seller_name : inv.buyer_name}</td>
                                            <td>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                                    <span style={{ fontSize: 12, fontWeight: 600, color: inv.direction === 'sales' ? 'var(--success)' : 'var(--accent-hover)' }}>
                                                        {inv.direction === 'sales' ? '↑ Sprzedaż' : '↓ Zakup'}
                                                    </span>
                                                    {inv.direction === 'purchase' && inv.category && (
                                                        <span style={{ fontSize: 10, fontWeight: 600, background: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.25)', padding: '1px 7px', borderRadius: 100 }}>
                                                            {inv.category}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td style={{ fontWeight: 600, color: 'var(--text)' }}>{inv.gross_amount} PLN</td>
                                            <td style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{inv.issue_date}</td>
                                            <td><span style={{ background: st.bg, color: st.color, borderRadius: 5, padding: '3px 8px', fontSize: 11.5, fontWeight: 600 }}>{st.label}</span></td>
                                        </tr>
                                    );
                                })}
                                {filtered.length === 0 && (
                                    <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: 'var(--text-subtle)' }}>Brak faktur pasujących do filtrów</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </main>

                <footer style={{ padding: '14px 28px', borderTop: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>KSeF Auto © 2026 · Platforma automatyzacji KSeF dla biur rachunkowych</span>
                </footer>
            </div>

            {/* Sticky CTA — appears after 4s */}
            {showCta && (
                <Link href="/register" style={{ position: 'fixed', bottom: 22, right: 22, zIndex: 200, background: 'var(--accent)', color: 'white', textDecoration: 'none', padding: '13px 22px', borderRadius: 12, fontSize: 13.5, fontWeight: 700, boxShadow: '0 0 30px rgba(99,102,241,0.4)', display: 'flex', alignItems: 'center', gap: 8, animation: 'slideUp 0.4s ease' }}>
                    <Zap size={14} strokeWidth={2.5} />
                    Wypróbuj za darmo — 14 dni bez karty
                    <ArrowRight size={14} />
                </Link>
            )}

            <style>{`@keyframes slideUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } } @keyframes spin { to { transform:rotate(360deg); } }`}</style>
        </div>
    );
}
