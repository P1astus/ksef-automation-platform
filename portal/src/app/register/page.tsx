'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Zap, CheckCircle, AlertCircle } from 'lucide-react';

const PLAN_LABELS: Record<string, { name: string; price: string; clients: string }> = {
    start:  { name: 'Start',  price: '299 zł/mies.', clients: 'do 20 klientów' },
    biznes: { name: 'Biznes', price: '599 zł/mies.', clients: 'do 60 klientów' },
    pro:    { name: 'Pro',    price: '1 299 zł/mies.', clients: 'nieograniczeni klienci' },
};

const features = [
    'Automatyczne pobieranie faktur z KSeF',
    'Obsługa wielu klientów (NIP) jednocześnie',
    'Generowanie raportów JPK_VAT',
    'Alerty e-mail i monitoring 24/7',
];

function RegisterForm() {
    const searchParams = useSearchParams();
    const planParam = searchParams.get('plan') || 'start';
    const plan = PLAN_LABELS[planParam] ? planParam : 'start';
    const planInfo = PLAN_LABELS[plan];

    const [firmName, setFirmName] = useState('');
    const [firmNip, setFirmNip] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ firm_name: firmName, firm_nip: firmNip, admin_email: email, password, plan }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Błąd rejestracji');
            router.push(data.redirectUrl || '/dashboard/onboarding');
            router.refresh();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Błąd rejestracji');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-base)' }}>

            {/* ── Left panel ── */}
            <div style={{
                flex: '0 0 480px',
                background: 'var(--bg-sidebar)',
                borderRight: '1px solid var(--border)',
                display: 'flex', flexDirection: 'column',
                padding: '48px', position: 'relative', overflow: 'hidden',
            }}>
                {/* Indigo glow */}
                <div style={{
                    position: 'absolute', bottom: -120, left: -80,
                    width: 420, height: 420, borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(99,102,241,0.13) 0%, transparent 70%)',
                    pointerEvents: 'none',
                }} />
                <div style={{
                    position: 'absolute', top: -80, right: -60,
                    width: 280, height: 280, borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 70%)',
                    pointerEvents: 'none',
                }} />

                {/* Logo */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'auto' }}>
                    <div style={{
                        width: 36, height: 36, borderRadius: 8, background: 'var(--accent)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <Zap size={17} color="#fff" strokeWidth={2.5} />
                    </div>
                    <span style={{ color: 'var(--text)', fontWeight: 800, fontSize: 18, letterSpacing: '-0.4px' }}>
                        KSeF<span style={{ color: 'var(--accent-hover)' }}>Auto</span>
                    </span>
                </div>

                {/* Main copy */}
                <div style={{ marginBottom: 'auto' }}>
                    <h2 style={{
                        color: 'var(--text)', fontSize: 28, fontWeight: 900,
                        lineHeight: 1.2, margin: '0 0 14px', letterSpacing: '-0.03em',
                    }}>
                        Zacznij automatyzować<br />
                        <span style={{ color: 'var(--text-muted)' }}>obsługę KSeF dziś</span>
                    </h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.7, margin: 0 }}>
                        30 dni za darmo, bez karty kredytowej. Pełny dostęp do wszystkich funkcji wybranego planu.
                    </p>

                    {/* Selected plan badge */}
                    <div style={{
                        marginTop: 24,
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border)',
                        borderRadius: 10, padding: '16px 18px',
                    }}>
                        <div style={{
                            fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)',
                            letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8,
                        }}>
                            Wybrany plan
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                            <span style={{ color: 'var(--accent-hover)', fontWeight: 800, fontSize: 22 }}>{planInfo.name}</span>
                            <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>{planInfo.price}</span>
                        </div>
                        <div style={{ color: 'var(--text-subtle)', fontSize: 13, marginTop: 4 }}>{planInfo.clients}</div>
                    </div>

                    {/* Feature list */}
                    <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 11 }}>
                        {features.map((f) => (
                            <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <CheckCircle size={15} style={{ color: 'var(--success)', flexShrink: 0 }} />
                                <span style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>{f}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* ── Right panel (form) ── */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
                <div style={{ width: '100%', maxWidth: 440 }}>
                    <div style={{ marginBottom: 28 }}>
                        <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', margin: '0 0 7px', letterSpacing: '-0.03em' }}>
                            Utwórz konto
                        </h1>
                        <p style={{ fontSize: 13.5, color: 'var(--text-muted)', margin: 0 }}>
                            30 dni za darmo — bez karty kredytowej
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <div>
                            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                                Nazwa biura rachunkowego <span style={{ color: 'var(--error)' }}>*</span>
                            </label>
                            <input
                                type="text"
                                required
                                value={firmName}
                                onChange={(e) => setFirmName(e.target.value)}
                                placeholder="np. Biuro Rachunkowe Kowalski"
                                style={{ width: '100%', padding: '10px 13px', borderRadius: 7, fontSize: 14, boxSizing: 'border-box' }}
                            />
                        </div>

                        <div>
                            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                                NIP biura <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}>(opcjonalnie)</span>
                            </label>
                            <input
                                type="text"
                                value={firmNip}
                                onChange={(e) => setFirmNip(e.target.value)}
                                placeholder="1234567890"
                                maxLength={10}
                                style={{ width: '100%', padding: '10px 13px', borderRadius: 7, fontSize: 14, boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }}
                            />
                        </div>

                        <div>
                            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                                Adres e-mail <span style={{ color: 'var(--error)' }}>*</span>
                            </label>
                            <input
                                type="email"
                                autoComplete="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="twoj@biuro.pl"
                                style={{ width: '100%', padding: '10px 13px', borderRadius: 7, fontSize: 14, boxSizing: 'border-box' }}
                            />
                        </div>

                        <div>
                            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                                Hasło <span style={{ color: 'var(--error)' }}>*</span>
                            </label>
                            <input
                                type="password"
                                autoComplete="new-password"
                                required
                                minLength={8}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="min. 8 znaków"
                                style={{ width: '100%', padding: '10px 13px', borderRadius: 7, fontSize: 14, boxSizing: 'border-box' }}
                            />
                        </div>

                        {error && (
                            <div style={{
                                background: 'var(--error-dim)', border: '1px solid rgba(239,68,68,0.25)',
                                borderRadius: 7, padding: '10px 13px',
                                fontSize: 13, color: 'var(--error)', fontWeight: 500,
                                display: 'flex', alignItems: 'center', gap: 8,
                            }}>
                                <AlertCircle size={14} style={{ flexShrink: 0 }} />
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="btn-primary"
                            style={{
                                width: '100%', justifyContent: 'center', padding: '11px',
                                fontSize: 14.5, marginTop: 4,
                                opacity: loading ? 0.7 : 1, cursor: loading ? 'not-allowed' : 'pointer',
                            }}
                        >
                            {loading ? 'Tworzenie konta...' : 'Utwórz konto za darmo →'}
                        </button>

                        <p style={{ fontSize: 11.5, color: 'var(--text-subtle)', textAlign: 'center', margin: '2px 0 0' }}>
                            Rejestrując się akceptujesz{' '}
                            <Link href="/terms" style={{ color: 'var(--accent-hover)', textDecoration: 'none' }}>Regulamin</Link>
                            {' '}i{' '}
                            <Link href="/privacy" style={{ color: 'var(--accent-hover)', textDecoration: 'none' }}>Politykę prywatności</Link>
                        </p>
                    </form>

                    <p style={{ marginTop: 22, textAlign: 'center', fontSize: 13, color: 'var(--text-subtle)' }}>
                        Masz już konto?{' '}
                        <Link href="/login" style={{ color: 'var(--accent-hover)', fontWeight: 600, textDecoration: 'none' }}>
                            Zaloguj się
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    );
}

export default function RegisterPage() {
    return (
        <Suspense fallback={
            <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)', color: 'var(--text-muted)', fontSize: 14 }}>
                Ładowanie...
            </div>
        }>
            <RegisterForm />
        </Suspense>
    );
}
