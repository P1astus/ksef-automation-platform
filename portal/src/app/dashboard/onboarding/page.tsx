'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Zap, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

export default function OnboardingPage() {
    const router = useRouter();
    const [step, setStep] = useState(1);
    const [nip, setNip] = useState('');
    const [clientName, setClientName] = useState('');
    const [clientError, setClientError] = useState('');
    const [clientAdded, setClientAdded] = useState(false);
    const [loading, setLoading] = useState(false);
    const [nipStatus, setNipStatus] = useState<'idle' | 'loading' | 'found' | 'not_found'>('idle');
    const nipDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

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
                else setNipStatus('not_found');
            } catch { setNipStatus('not_found'); }
        }, 400);
    };

    const addClient = async () => {
        if (!nip || !clientName) { setClientError('Podaj NIP i nazwę klienta'); return; }
        if (!/^\d{10}$/.test(nip.replace(/[-\s]/g, ''))) { setClientError('NIP musi mieć 10 cyfr'); return; }
        setClientError('');
        setLoading(true);
        try {
            const res = await fetch('/api/clients', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nip: nip.replace(/[-\s]/g, ''), client_name: clientName }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Błąd dodawania klienta');
            setClientAdded(true);
            setTimeout(() => setStep(3), 1000);
        } catch (err: unknown) {
            setClientError(err instanceof Error ? err.message : 'Błąd dodawania klienta');
        } finally {
            setLoading(false);
        }
    };

    const finish = async () => {
        setLoading(true);
        await fetch('/api/auth/complete-onboarding', { method: 'POST' });
        router.push('/dashboard');
        router.refresh();
    };

    return (
        <div style={{
            minHeight: '100vh',
            background: 'var(--bg-base)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
            <div style={{
                background: 'var(--bg-surface)',
                borderRadius: 20,
                padding: '48px',
                border: '1px solid var(--border)',
                width: '100%',
                maxWidth: 520,
            }}>
                {/* Progress indicator */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 36 }}>
                    {[1, 2, 3].map((s) => (
                        <div key={s} style={{
                            flex: 1, height: 4, borderRadius: 4,
                            background: s <= step ? 'var(--accent)' : 'var(--border)',
                            transition: 'background 0.3s',
                        }} />
                    ))}
                </div>

                {/* Step 1: Welcome */}
                {step === 1 && (
                    <div>
                        <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
                            <Zap size={26} color="var(--accent)" />
                        </div>
                        <h1 style={{ fontSize: 28, fontWeight: 900, color: 'var(--text)', margin: '0 0 12px', letterSpacing: '-0.7px' }}>
                            Witamy w KSeF Auto!
                        </h1>
                        <p style={{ fontSize: 15, color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 28px' }}>
                            Twoje konto jest gotowe. Masz <strong style={{ color: 'var(--accent-hover)' }}>14 dni za darmo</strong> — bez karty kredytowej.
                        </p>

                        <div style={{ background: 'var(--accent-dim)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 12, padding: '16px 20px', marginBottom: 28 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-hover)', marginBottom: 10 }}>Co zrobimy w następnych krokach:</div>
                            {['Dodasz pierwszego klienta (NIP)', 'System automatycznie zacznie pobierać faktury', 'Będziesz gotowy do pracy!'].map((item, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'white', fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
                                    <span style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>{item}</span>
                                </div>
                            ))}
                        </div>

                        <button onClick={() => setStep(2)} className="btn-primary" style={{ width: '100%', padding: '14px', fontSize: 16, justifyContent: 'center' }}>
                            Zaczynamy →
                        </button>
                    </div>
                )}

                {/* Step 2: Add first client */}
                {step === 2 && (
                    <div>
                        <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20, fontSize: 26 }}>
                            🏢
                        </div>
                        <h2 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', margin: '0 0 8px', letterSpacing: '-0.5px' }}>
                            Dodaj pierwszego klienta
                        </h2>
                        <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 28px', lineHeight: 1.6 }}>
                            Podaj NIP firmy, której faktury chcesz monitorować w KSeF.
                        </p>

                        {clientAdded ? (
                            <div style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 12, padding: '20px', textAlign: 'center' }}>
                                <CheckCircle size={32} color="var(--success)" style={{ marginBottom: 8 }} />
                                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--success)' }}>Klient dodany pomyślnie!</div>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>NIP klienta</label>
                                    <input type="text" value={nip} onChange={(e) => handleNipChange(e.target.value)} placeholder="1234567890" maxLength={10} className="mono" />
                                    <div style={{ marginTop: 4, height: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
                                        {nipStatus === 'loading' && <><Loader2 size={11} style={{ color: 'var(--text-subtle)', animation: 'spin 1s linear infinite' }} /><span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Sprawdzanie...</span></>}
                                        {nipStatus === 'found' && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)' }}>✓ Znaleziono w rejestrze VAT</span>}
                                        {nipStatus === 'not_found' && <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Brak w rejestrze — wpisz nazwę ręcznie</span>}
                                    </div>
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>Nazwa firmy klienta</label>
                                    <input type="text" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="np. ABC Sp. z o.o." />
                                </div>

                                {clientError && (
                                    <div style={{ background: 'var(--error-dim)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 9, padding: '10px 14px', fontSize: 13, color: 'var(--error)', display: 'flex', gap: 8, alignItems: 'center' }}>
                                        <AlertCircle size={15} /> {clientError}
                                    </div>
                                )}

                                <button onClick={addClient} disabled={loading} className="btn-primary" style={{ padding: '13px', fontSize: 15, justifyContent: 'center', opacity: loading ? 0.7 : 1 }}>
                                    {loading ? 'Dodawanie...' : 'Dodaj klienta →'}
                                </button>
                            </div>
                        )}

                        {!clientAdded && (
                            <button onClick={() => setStep(3)} className="btn-secondary" style={{ width: '100%', marginTop: 12, padding: '11px', fontSize: 14, justifyContent: 'center' }}>
                                Pomiń — dodam klientów później
                            </button>
                        )}
                    </div>
                )}

                {/* Step 3: Done */}
                {step === 3 && (
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ width: 64, height: 64, borderRadius: 18, background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 32 }}>
                            🎉
                        </div>
                        <h2 style={{ fontSize: 26, fontWeight: 900, color: 'var(--text)', margin: '0 0 12px', letterSpacing: '-0.6px' }}>
                            Wszystko gotowe!
                        </h2>
                        <p style={{ fontSize: 15, color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 28px' }}>
                            System automatycznie pobierze faktury z KSeF w ciągu najbliższej godziny.
                        </p>

                        <div style={{ background: 'var(--accent-dim)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 12, padding: '16px 20px', marginBottom: 28, textAlign: 'left' }}>
                            {[
                                { icon: '📥', text: 'Faktury pobierane automatycznie co 30 minut' },
                                { icon: '📊', text: 'Raporty JPK generowane jednym kliknięciem' },
                                { icon: '🔔', text: 'Alerty e-mail przy problemach z synchronizacją' },
                            ].map((item) => (
                                <div key={item.icon} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                                    <span style={{ fontSize: 20 }}>{item.icon}</span>
                                    <span style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>{item.text}</span>
                                </div>
                            ))}
                        </div>

                        <button onClick={finish} disabled={loading} className="btn-primary" style={{ width: '100%', padding: '14px', fontSize: 16, justifyContent: 'center', opacity: loading ? 0.7 : 1 }}>
                            {loading ? 'Ładowanie...' : 'Przejdź do panelu →'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
