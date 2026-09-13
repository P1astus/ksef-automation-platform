'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
    ArrowLeft, RefreshCw, CheckCircle, AlertCircle, FileText,
    TrendingUp, TrendingDown, ToggleLeft, ToggleRight, Key, User, Save,
} from 'lucide-react';

interface Client {
    id: number;
    nip: string;
    client_name: string;
    sync_enabled: boolean;
    last_sync_at: string | null;
    last_sync_success: string | null;
    ksef_token_encrypted: string | null;
    invoice_count: number;
    sales_count: number;
    purchase_count: number;
    total_sales: string | null;
    total_purchases: string | null;
    created_at: string;
    contact_person: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    notes: string | null;
    tags: string | null;
}

interface Invoice {
    id: number;
    invoice_number: string;
    ksef_number: string;
    issue_date: string;
    direction: string;
    seller_name: string;
    buyer_name: string;
    gross_amount: string;
    currency: string;
    processing_status: string;
}

export default function ClientDetailPage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();

    const [client, setClient] = useState<Client | null>(null);
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState<{ ok: boolean; text: string } | null>(null);
    const [togglingSync, setTogglingSync] = useState(false);
    const [crm, setCrm] = useState({ contact_person: '', contact_email: '', contact_phone: '', notes: '', tags: '' });
    const [crmSaving, setCrmSaving] = useState(false);
    const [crmSaved, setCrmSaved] = useState(false);

    const load = async () => {
        try {
            const res = await fetch(`/api/clients/${id}`);
            if (!res.ok) { router.push('/dashboard/clients'); return; }
            const data = await res.json();
            setClient(data.client);
            setInvoices(data.recentInvoices);
            setCrm({
                contact_person: data.client.contact_person || '',
                contact_email: data.client.contact_email || '',
                contact_phone: data.client.contact_phone || '',
                notes: data.client.notes || '',
                tags: data.client.tags || '',
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, [id]);

    const handleSync = async () => {
        setSyncing(true);
        setSyncResult(null);
        try {
            const res = await fetch(`/api/clients/${id}/sync`, { method: 'POST' });
            const data = await res.json();
            setSyncResult({ ok: res.ok, text: res.ok ? data.message : data.error });
            if (res.ok) await load();
        } finally {
            setSyncing(false);
        }
    };

    const saveCrm = async () => {
        setCrmSaving(true);
        setCrmSaved(false);
        await fetch(`/api/clients/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(crm),
        });
        setCrmSaving(false);
        setCrmSaved(true);
        setTimeout(() => setCrmSaved(false), 2500);
    };

    const toggleSync = async () => {
        if (!client) return;
        setTogglingSync(true);
        try {
            await fetch(`/api/clients/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sync_enabled: !client.sync_enabled }),
            });
            await load();
        } finally {
            setTogglingSync(false);
        }
    };

    if (loading) {
        return (
            <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 14 }}>
                Ładowanie...
            </div>
        );
    }

    if (!client) return null;

    const fmt = (v: string | null) =>
        v ? Number(v).toLocaleString('pl-PL', { minimumFractionDigits: 2 }) + ' PLN' : '0,00 PLN';

    return (
        <div style={{ maxWidth: 900, padding: '28px 0' }}>
            {/* Back + header */}
            <div style={{ marginBottom: 24 }}>
                <Link href="/dashboard/clients" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none', marginBottom: 16 }}>
                    <ArrowLeft size={14} /> Powrót do listy klientów
                </Link>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                    <div>
                        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: '0 0 4px', letterSpacing: '-0.4px' }}>
                            {client.client_name}
                        </h1>
                        <span className="mono" style={{ fontSize: 13, color: 'var(--text-subtle)' }}>NIP: {client.nip}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                        <button
                            onClick={toggleSync}
                            disabled={togglingSync}
                            className="btn-secondary"
                            style={{ display: 'flex', alignItems: 'center', gap: 7, opacity: togglingSync ? 0.7 : 1 }}
                        >
                            {client.sync_enabled
                                ? <><ToggleRight size={15} color="var(--success)" /> Wstrzymaj sync</>
                                : <><ToggleLeft size={15} /> Włącz sync</>
                            }
                        </button>
                        <button
                            onClick={handleSync}
                            disabled={syncing}
                            className="btn-primary"
                            style={{ display: 'flex', alignItems: 'center', gap: 7, opacity: syncing ? 0.7 : 1 }}
                        >
                            <RefreshCw size={14} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} />
                            {syncing ? 'Synchronizowanie...' : 'Synchronizuj teraz'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Sync result */}
            {syncResult && (
                <div style={{
                    marginBottom: 20, padding: '12px 16px', borderRadius: 10,
                    background: syncResult.ok ? 'rgba(34,197,94,0.1)' : 'var(--error-dim)',
                    border: `1px solid ${syncResult.ok ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
                    display: 'flex', gap: 10, alignItems: 'center',
                }}>
                    {syncResult.ok
                        ? <CheckCircle size={15} color="var(--success)" />
                        : <AlertCircle size={15} color="var(--error)" />}
                    <span style={{ fontSize: 13, fontWeight: 500, color: syncResult.ok ? 'var(--success)' : 'var(--error)' }}>
                        {syncResult.text}
                    </span>
                </div>
            )}

            {/* Stat cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
                {[
                    { label: 'Wszystkie faktury', value: client.invoice_count, Icon: FileText },
                    { label: 'Faktury sprzedaży', value: client.sales_count, Icon: TrendingUp },
                    { label: 'Faktury zakupu', value: client.purchase_count, Icon: TrendingDown },
                    { label: 'Status sync', value: client.sync_enabled ? 'Aktywny' : 'Wstrzymany', Icon: RefreshCw },
                ].map(({ label, value, Icon }) => (
                    <div key={label} className="card-stat" style={{ padding: '16px 20px' }}>
                        <div className="icon-box" style={{ marginBottom: 12 }}><Icon size={16} strokeWidth={2} /></div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.5px' }}>{value}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 4 }}>{label}</div>
                    </div>
                ))}
            </div>

            {/* Info + token status */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
                <div style={{ background: 'var(--bg-surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '20px 24px' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>Informacje</div>
                    {[
                        { label: 'Obrót sprzedaży', value: fmt(client.total_sales) },
                        { label: 'Obrót zakupów', value: fmt(client.total_purchases) },
                        { label: 'Ostatnia synchronizacja', value: client.last_sync_at ? new Date(client.last_sync_at).toLocaleString('pl-PL') : 'Brak' },
                        { label: 'Dodano', value: new Date(client.created_at).toLocaleDateString('pl-PL') },
                    ].map(({ label, value }) => (
                        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{label}</span>
                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{value}</span>
                        </div>
                    ))}
                </div>

                <div style={{ background: 'var(--bg-surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '20px 24px' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>Token KSeF</div>
                    {client.ksef_token_encrypted ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'rgba(34,197,94,0.08)', borderRadius: 10, border: '1px solid rgba(34,197,94,0.2)' }}>
                            <CheckCircle size={16} color="var(--success)" />
                            <div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--success)' }}>Token skonfigurowany</div>
                                <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>Synchronizacja z KSeF jest możliwa</div>
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'var(--error-dim)', borderRadius: 10, border: '1px solid rgba(239,68,68,0.2)' }}>
                            <AlertCircle size={16} color="var(--error)" />
                            <div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--error)' }}>Brak tokenu KSeF</div>
                                <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>
                                    <Link href="/dashboard/settings/ksef" style={{ color: 'var(--accent-hover)' }}>Skonfiguruj token →</Link>
                                </div>
                            </div>
                        </div>
                    )}
                    <div style={{ marginTop: 16 }}>
                        <Link href="/dashboard/settings/ksef" className="btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13 }}>
                            <Key size={14} /> Zarządzaj tokenem
                        </Link>
                    </div>
                </div>
            </div>

            {/* CRM / contact fields */}
            <div style={{ background: 'var(--bg-surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '20px 24px', marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                        <User size={15} /> Dane kontaktowe
                    </div>
                    <button
                        onClick={saveCrm}
                        disabled={crmSaving}
                        className={crmSaved ? 'btn-secondary' : 'btn-primary'}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, padding: '7px 14px', opacity: crmSaving ? 0.7 : 1 }}
                    >
                        <Save size={13} />
                        {crmSaving ? 'Zapisywanie...' : crmSaved ? '✓ Zapisano' : 'Zapisz'}
                    </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                    {[
                        { field: 'contact_person', label: 'Osoba kontaktowa', placeholder: 'Jan Kowalski' },
                        { field: 'contact_email', label: 'E-mail', placeholder: 'kontakt@firma.pl' },
                        { field: 'contact_phone', label: 'Telefon', placeholder: '+48 600 000 000' },
                    ].map(({ field, label, placeholder }) => (
                        <div key={field}>
                            <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</label>
                            <input
                                value={crm[field as keyof typeof crm]}
                                onChange={e => setCrm(prev => ({ ...prev, [field]: e.target.value }))}
                                placeholder={placeholder}
                                style={{ width: '100%', boxSizing: 'border-box' }}
                            />
                        </div>
                    ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                        <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tagi (przecinek)</label>
                        <input
                            value={crm.tags}
                            onChange={e => setCrm(prev => ({ ...prev, tags: e.target.value }))}
                            placeholder="VIP, duży klient, handel"
                            style={{ width: '100%', boxSizing: 'border-box' }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Notatki</label>
                        <input
                            value={crm.notes}
                            onChange={e => setCrm(prev => ({ ...prev, notes: e.target.value }))}
                            placeholder="Dodatkowe informacje o kliencie..."
                            style={{ width: '100%', boxSizing: 'border-box' }}
                        />
                    </div>
                </div>
                {crm.tags && (
                    <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {crm.tags.split(',').map(t => t.trim()).filter(Boolean).map(tag => (
                            <span key={tag} style={{ fontSize: 11.5, fontWeight: 600, background: 'var(--accent-dim)', color: 'var(--accent-hover)', border: '1px solid rgba(99,102,241,0.25)', padding: '3px 10px', borderRadius: 100 }}>{tag}</span>
                        ))}
                    </div>
                )}
            </div>

            {/* Recent invoices */}
            <div style={{ background: 'var(--bg-surface)', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden' }}>
                <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Ostatnie faktury</div>
                    <Link href={`/dashboard/invoices`} style={{ fontSize: 12, color: 'var(--accent-hover)', textDecoration: 'none' }}>
                        Zobacz wszystkie →
                    </Link>
                </div>
                {invoices.length === 0 ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 14 }}>
                        <FileText size={28} style={{ margin: '0 auto 10px', display: 'block', color: 'var(--text-subtle)' }} />
                        Brak faktur dla tego klienta
                    </div>
                ) : (
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Data</th>
                                <th>Nr faktury</th>
                                <th>Kontrahent</th>
                                <th style={{ textAlign: 'right' }}>Kwota brutto</th>
                                <th>Typ</th>
                            </tr>
                        </thead>
                        <tbody>
                            {invoices.map(inv => (
                                <tr key={inv.id}>
                                    <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                        {inv.issue_date ? new Date(inv.issue_date).toLocaleDateString('pl-PL') : '—'}
                                    </td>
                                    <td style={{ fontWeight: 600, color: 'var(--text)' }}>
                                        {inv.invoice_number || inv.ksef_number || '—'}
                                    </td>
                                    <td style={{ color: 'var(--text-muted)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {inv.direction === 'sales' ? inv.buyer_name : inv.seller_name}
                                    </td>
                                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                                        {inv.gross_amount ? `${Number(inv.gross_amount).toLocaleString('pl-PL', { minimumFractionDigits: 2 })} ${inv.currency || 'PLN'}` : '—'}
                                    </td>
                                    <td>
                                        {inv.direction === 'sales'
                                            ? <span style={{ fontSize: 11, fontWeight: 700, background: 'rgba(34,197,94,0.1)', color: 'var(--success)', border: '1px solid rgba(34,197,94,0.25)', padding: '3px 10px', borderRadius: 100 }}>Sprzedaż</span>
                                            : <span style={{ fontSize: 11, fontWeight: 700, background: 'var(--accent-dim)', color: 'var(--accent-hover)', border: '1px solid rgba(99,102,241,0.25)', padding: '3px 10px', borderRadius: 100 }}>Zakup</span>
                                        }
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
    );
}
