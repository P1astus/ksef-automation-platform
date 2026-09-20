'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, KeyRound, ShieldCheck, Zap } from 'lucide-react';

export default function SetupForm() {
    const [setupToken, setSetupToken] = useState('');
    const [firmName, setFirmName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError('');
        setLoading(true);
        try {
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    setup_token: setupToken,
                    firm_name: firmName,
                    admin_email: email,
                    password,
                }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Nie udało się skonfigurować instalacji');
            router.replace(data.redirectUrl || '/dashboard/onboarding');
            router.refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Nie udało się skonfigurować instalacji');
        } finally {
            setLoading(false);
        }
    }

    return (
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--bg-base)' }}>
            <section style={{ width: '100%', maxWidth: 520, padding: 32, borderRadius: 14, border: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                    <div style={{ width: 42, height: 42, display: 'grid', placeItems: 'center', borderRadius: 10, background: 'var(--accent)' }}>
                        <Zap size={20} color="#fff" />
                    </div>
                    <div>
                        <h1 style={{ margin: 0, fontSize: 24, color: 'var(--text)' }}>Konfiguracja KSeF Auto</h1>
                        <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>Utwórz pierwsze konto administratora</p>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: 10, padding: 12, marginBottom: 22, borderRadius: 8, background: 'var(--accent-dim)', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 }}>
                    <ShieldCheck size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                    Token działa tylko raz. Po utworzeniu firmy ta strona przestanie być dostępna.
                </div>

                <form onSubmit={submit} style={{ display: 'grid', gap: 16 }}>
                    <label style={{ display: 'grid', gap: 6, color: 'var(--text-muted)', fontSize: 13 }}>
                        Token instalacyjny
                        <div style={{ position: 'relative' }}>
                            <KeyRound size={15} style={{ position: 'absolute', left: 12, top: 13, color: 'var(--text-subtle)' }} />
                            <input name="setup_token" value={setupToken} onChange={e => setSetupToken(e.target.value)} autoComplete="off" required autoFocus placeholder="Wklej token z setup-token.mjs" style={{ width: '100%', padding: '11px 12px 11px 36px', boxSizing: 'border-box', borderRadius: 7 }} />
                        </div>
                    </label>
                    <label style={{ display: 'grid', gap: 6, color: 'var(--text-muted)', fontSize: 13 }}>
                        Nazwa firmy
                        <input name="firm_name" value={firmName} onChange={e => setFirmName(e.target.value)} required style={{ padding: '11px 12px', borderRadius: 7 }} />
                    </label>
                    <label style={{ display: 'grid', gap: 6, color: 'var(--text-muted)', fontSize: 13 }}>
                        E-mail administratora
                        <input name="admin_email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required style={{ padding: '11px 12px', borderRadius: 7 }} />
                    </label>
                    <label style={{ display: 'grid', gap: 6, color: 'var(--text-muted)', fontSize: 13 }}>
                        Hasło
                        <input name="password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" required minLength={8} style={{ padding: '11px 12px', borderRadius: 7 }} />
                    </label>

                    {error && <div role="alert" style={{ display: 'flex', gap: 8, color: 'var(--error)', fontSize: 13 }}><AlertCircle size={16} />{error}</div>}

                    <button type="submit" className="btn-primary" disabled={loading} style={{ justifyContent: 'center', padding: 12, opacity: loading ? 0.7 : 1 }}>
                        {loading ? 'Tworzenie konta…' : 'Zakończ konfigurację'}
                    </button>
                </form>
            </section>
        </main>
    );
}
