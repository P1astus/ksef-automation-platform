'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Zap, CheckCircle, AlertCircle } from 'lucide-react';

const features = [
    'Automatyczne pobieranie faktur z KSeF',
    'Obsługa wielu klientów (NIP) jednocześnie',
    'Generowanie raportów JPK_VAT',
    'Alerty i monitoring 24/7',
];

export default function LoginPage() {
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
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Błąd logowania');
            router.push(data.redirectUrl || '/dashboard');
            router.refresh();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Błąd logowania');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-base)' }}>

            {/* ── Left panel ── */}
            <div style={{
                flex: '0 0 460px',
                background: 'var(--bg-sidebar)',
                borderRight: '1px solid var(--border)',
                display: 'flex', flexDirection: 'column',
                padding: '48px', position: 'relative', overflow: 'hidden',
            }}>
                {/* Indigo glow */}
                <div style={{
                    position: 'absolute', bottom: -100, left: -80,
                    width: 400, height: 400, borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)',
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
                        color: 'var(--text)', fontSize: 30, fontWeight: 900,
                        lineHeight: 1.2, margin: '0 0 14px', letterSpacing: '-0.03em',
                    }}>
                        Automatyzacja KSeF<br />
                        <span style={{ color: 'var(--text-muted)' }}>dla biur rachunkowych</span>
                    </h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.7, margin: 0 }}>
                        Pobieraj faktury, generuj JPK i monitoruj wszystkich klientów z jednego miejsca.
                    </p>

                    <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {features.map((f) => (
                            <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <CheckCircle size={15} style={{ color: 'var(--success)', flexShrink: 0 }} />
                                <span style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>{f}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Testimonial */}
                <div style={{
                    background: 'var(--bg-elevated)', borderRadius: 10,
                    padding: '16px 18px', border: '1px solid var(--border)',
                }}>
                    <p style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6, margin: '0 0 12px', fontStyle: 'italic' }}>
                        "KSeF Auto zaoszczędził nam 8 godzin tygodniowo na ręcznym pobieraniu faktur."
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <div style={{
                            width: 28, height: 28, borderRadius: '50%',
                            background: 'var(--accent-dim)', border: '1px solid rgba(99,102,241,0.3)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'var(--accent-hover)', fontSize: 11, fontWeight: 700,
                        }}>MK</div>
                        <div>
                            <div style={{ color: 'var(--text)', fontSize: 12, fontWeight: 600 }}>Marta Kowalczyk</div>
                            <div style={{ color: 'var(--text-subtle)', fontSize: 11 }}>Biuro Rachunkowe Kowalczyk</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Right panel (form) ── */}
            <div style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '40px',
            }}>
                <div style={{ width: '100%', maxWidth: 400 }}>
                    <div style={{ marginBottom: 32 }}>
                        <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', margin: '0 0 7px', letterSpacing: '-0.03em' }}>
                            Zaloguj się
                        </h1>
                        <p style={{ fontSize: 13.5, color: 'var(--text-muted)', margin: 0 }}>
                            Wprowadź swoje dane, aby kontynuować
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <div>
                            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                                Adres e-mail
                            </label>
                            <input
                                type="email"
                                autoComplete="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="twoj@email.pl"
                                style={{ width: '100%', padding: '10px 13px', borderRadius: 7, fontSize: 14, boxSizing: 'border-box' }}
                            />
                        </div>

                        <div>
                            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                                Hasło
                            </label>
                            <input
                                type="password"
                                autoComplete="current-password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
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
                            {loading ? 'Logowanie...' : 'Zaloguj się →'}
                        </button>
                    </form>

                    <p style={{ marginTop: 14, textAlign: 'center', fontSize: 13, color: 'var(--text-subtle)' }}>
                        <Link href="/reset-password" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
                            Zapomniałeś hasła?
                        </Link>
                    </p>
                    <p style={{ marginTop: 10, textAlign: 'center', fontSize: 13, color: 'var(--text-subtle)' }}>
                        Nie masz konta?{' '}
                        <Link href="/register" style={{ color: 'var(--accent-hover)', fontWeight: 600, textDecoration: 'none' }}>
                            Zarejestruj się za darmo
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
