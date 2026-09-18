'use client';

import { useEffect, useState } from 'react';
import { Key, CheckCircle, AlertCircle, Eye, EyeOff, Wifi, Upload, ShieldCheck } from 'lucide-react';
import PlanErrorLink from '@/app/dashboard/PlanErrorLink';
import { interpretApiFailure } from '@/lib/plan-errors';

interface ClientInfo {
    id: number;
    nip: string;
    client_name: string;
    auth_method: string;
    has_token: boolean;
}

interface ClientConfig {
    id: number;
    nip: string;
    client_name: string;
    auth_method: string;
    has_token: boolean;
    token_masked: string | null;
}

export default function KsefSettingsPage() {
    const [clients, setClients] = useState<ClientInfo[]>([]);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [config, setConfig] = useState<ClientConfig | null>(null);
    const [authMethod, setAuthMethod] = useState<'token' | 'cert'>('token');
    const [token, setToken] = useState('');
    const [showToken, setShowToken] = useState(false);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [result, setResult] = useState<{ ok: boolean; text: string; connectionOk?: boolean; connectionMsg?: string; planError?: boolean } | null>(null);
    const [certFile, setCertFile] = useState<File | null>(null);
    const [certPassword, setCertPassword] = useState('');
    const [showCertPass, setShowCertPass] = useState(false);

    useEffect(() => {
        fetch('/api/settings/ksef')
            .then(r => r.json())
            .then(d => setClients(d.clients || []));
    }, []);

    const selectClient = async (id: number) => {
        setSelectedId(id);
        setResult(null);
        setToken('');
        setLoading(true);
        try {
            const res = await fetch(`/api/settings/ksef?client_id=${id}`);
            const d = await res.json();
            setConfig(d);
            setAuthMethod(d.auth_method || 'token');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!selectedId) return;
        setSaving(true);
        setResult(null);
        try {
            let res: Response;
            if (authMethod === 'cert') {
                if (!certFile) { setResult({ ok: false, text: 'Wybierz plik certyfikatu .p12' }); setSaving(false); return; }
                if (!certPassword) { setResult({ ok: false, text: 'Wpisz hasło do certyfikatu' }); setSaving(false); return; }
                const form = new FormData();
                form.append('client_id', String(selectedId));
                form.append('auth_method', 'cert');
                form.append('cert', certFile);
                form.append('cert_password', certPassword);
                res = await fetch('/api/settings/ksef', { method: 'POST', body: form });
            } else {
                res = await fetch('/api/settings/ksef', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ client_id: selectedId, auth_method: authMethod, token }),
                });
            }
            const d = await res.json();
            if (!res.ok) {
                const failure = interpretApiFailure(res.status, d, 'Błąd zapisu');
                setResult({ ok: false, text: failure.message, planError: failure.isPlanError });
            } else {
                setResult({ ok: true, text: d.message, connectionOk: d.connectionOk, connectionMsg: d.connectionMsg });
                // Refresh client list
                const list = await fetch('/api/settings/ksef').then(r => r.json());
                setClients(list.clients || []);
                // Refresh config
                const cfg = await fetch(`/api/settings/ksef?client_id=${selectedId}`).then(r => r.json());
                setConfig(cfg);
                setToken('');
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <div style={{ maxWidth: 680, padding: '28px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                <div className="icon-box"><Key size={17} /></div>
                <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', margin: 0, letterSpacing: '-0.5px' }}>
                    Tokeny KSeF
                </h1>
            </div>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 32px 0' }}>
                Skonfiguruj metodę uwierzytelniania dla każdego klienta w systemie KSeF.
            </p>

            {/* Client selector */}
            <div style={{ background: 'var(--bg-surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '24px', marginBottom: 16 }}>
                <div className="label-caps" style={{ marginBottom: 12 }}>Wybierz klienta</div>

                {clients.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                        Brak klientów. <a href="/dashboard/clients" style={{ color: 'var(--accent-hover)' }}>Dodaj pierwszego klienta →</a>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {clients.map(c => (
                            <button
                                key={c.id}
                                onClick={() => selectClient(c.id)}
                                style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    padding: '12px 16px', borderRadius: 10,
                                    border: `1px solid ${selectedId === c.id ? 'var(--accent)' : 'var(--border)'}`,
                                    background: selectedId === c.id ? 'var(--accent-dim)' : 'var(--bg-base)',
                                    cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                                }}
                            >
                                <div>
                                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{c.client_name}</div>
                                    <div className="mono" style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>{c.nip}</div>
                                </div>
                                <span style={{
                                    fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 100,
                                    background: c.has_token ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                                    color: c.has_token ? 'var(--success)' : 'var(--error)',
                                    border: `1px solid ${c.has_token ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
                                }}>
                                    {c.has_token ? '● Skonfigurowany' : '○ Brak tokenu'}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Config panel */}
            {selectedId && (
                <div style={{ background: 'var(--bg-surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '24px' }}>
                    {loading ? (
                        <div style={{ color: 'var(--text-subtle)', fontSize: 14 }}>Ładowanie konfiguracji...</div>
                    ) : config ? (
                        <>
                            <div className="label-caps" style={{ marginBottom: 16 }}>Konfiguracja: {config.client_name}</div>

                            {/* Auth method toggle */}
                            <div style={{ marginBottom: 20 }}>
                                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10 }}>
                                    Metoda uwierzytelniania
                                </label>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    {[
                                        { val: 'token', label: 'Token API' },
                                        { val: 'cert',  label: 'Certyfikat PKCS12' },
                                    ].map(({ val, label }) => (
                                        <button
                                            key={val}
                                            onClick={() => setAuthMethod(val as 'token' | 'cert')}
                                            style={{
                                                padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                                                border: '1px solid var(--border)', cursor: 'pointer',
                                                background: authMethod === val ? 'var(--accent)' : 'var(--bg-base)',
                                                color: authMethod === val ? 'white' : 'var(--text-muted)',
                                                transition: 'all 0.15s',
                                            }}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {authMethod === 'token' ? (
                                <div style={{ marginBottom: 20 }}>
                                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                                        Token KSeF
                                    </label>
                                    {config.has_token && !token && (
                                        <div style={{ fontSize: 13, color: 'var(--text-subtle)', marginBottom: 8, fontFamily: 'monospace' }}>
                                            Obecny token: {config.token_masked}
                                        </div>
                                    )}
                                    <div style={{ position: 'relative' }}>
                                        <input
                                            type={showToken ? 'text' : 'password'}
                                            value={token}
                                            onChange={e => setToken(e.target.value)}
                                            placeholder={config.has_token ? 'Wpisz nowy token, aby zmienić...' : 'Wklej token z panelu KSeF...'}
                                            style={{ paddingRight: 44, width: '100%', fontFamily: 'monospace', fontSize: 13 }}
                                        />
                                        <button
                                            onClick={() => setShowToken(s => !s)}
                                            style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex' }}
                                        >
                                            {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 6 }}>
                                        Token znajdziesz w: Panel KSeF → Zarządzanie tokenami → Wygeneruj token
                                    </div>
                                </div>
                            ) : (
                                <div style={{ marginBottom: 20 }}>
                                    <div style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 10, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                                        <ShieldCheck size={15} color="var(--accent-hover)" style={{ marginTop: 1, flexShrink: 0 }} />
                                        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                                            Certyfikat PKCS12 (.p12) generowany przez Ministerstwo Finansów. Plik jest przetwarzany lokalnie — nie jest przesyłany na zewnętrzne serwery.
                                        </div>
                                    </div>
                                    <div style={{ marginBottom: 14 }}>
                                        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                                            Plik certyfikatu (.p12)
                                        </label>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 9, border: '1px dashed var(--border)', cursor: 'pointer', background: 'var(--bg-elevated)', fontSize: 13, color: certFile ? 'var(--text)' : 'var(--text-subtle)' }}>
                                            <Upload size={15} />
                                            {certFile ? certFile.name : 'Kliknij, aby wybrać plik .p12…'}
                                            <input
                                                type="file"
                                                accept=".p12,.pfx"
                                                style={{ display: 'none' }}
                                                onChange={e => setCertFile(e.target.files?.[0] || null)}
                                            />
                                        </label>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                                            Hasło do certyfikatu
                                        </label>
                                        <div style={{ position: 'relative' }}>
                                            <input
                                                type={showCertPass ? 'text' : 'password'}
                                                value={certPassword}
                                                onChange={e => setCertPassword(e.target.value)}
                                                placeholder="Hasło ustawione przy generowaniu certyfikatu"
                                                style={{ paddingRight: 44, width: '100%' }}
                                            />
                                            <button
                                                onClick={() => setShowCertPass(s => !s)}
                                                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex' }}
                                            >
                                                {showCertPass ? <EyeOff size={16} /> : <Eye size={16} />}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Result message */}
                            {result && (
                                <div style={{
                                    marginBottom: 16, padding: '12px 16px', borderRadius: 10,
                                    background: result.ok ? 'rgba(34,197,94,0.1)' : 'var(--error-dim)',
                                    border: `1px solid ${result.ok ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
                                    display: 'flex', flexDirection: 'column', gap: 6,
                                }}>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                        {result.ok ? <CheckCircle size={15} color="var(--success)" /> : <AlertCircle size={15} color="var(--error)" />}
                                        <span style={{ fontSize: 13, fontWeight: 600, color: result.ok ? 'var(--success)' : 'var(--error)' }}>
                                            {result.text}<PlanErrorLink show={!!result.planError} />
                                        </span>
                                    </div>
                                    {result.connectionMsg && (
                                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingLeft: 23 }}>
                                            <Wifi size={13} color={result.connectionOk ? 'var(--success)' : 'var(--text-subtle)'} />
                                            <span style={{ fontSize: 12, color: result.connectionOk ? 'var(--success)' : 'var(--text-subtle)' }}>
                                                {result.connectionMsg}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}

                            <button
                                onClick={handleSave}
                                disabled={saving || (authMethod === 'token' && !token && !config.has_token) || (authMethod === 'cert' && !certFile && !config.has_token)}
                                className="btn-primary"
                                style={{ opacity: saving ? 0.7 : 1 }}
                            >
                                <Key size={15} />
                                {saving ? 'Zapisywanie i testowanie...' : 'Zapisz i przetestuj połączenie'}
                            </button>
                        </>
                    ) : null}
                </div>
            )}
        </div>
    );
}
