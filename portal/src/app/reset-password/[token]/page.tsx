'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';

export default function ResetPasswordConfirmPage() {
    const { token } = useParams<{ token: string }>();
    const router = useRouter();
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [done, setDone] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (password !== confirm) {
            setError('Hasła nie są identyczne');
            return;
        }
        if (password.length < 8) {
            setError('Hasło musi mieć co najmniej 8 znaków');
            return;
        }

        setLoading(true);
        try {
            const res = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'confirm', token, newPassword: password }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Błąd serwera');
            setDone(true);
            setTimeout(() => router.push('/login?reset=success'), 2000);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Błąd serwera');
        } finally {
            setLoading(false);
        }
    };

    const inputStyle = {
        width: '100%', padding: '11px 14px',
        border: '1.5px solid var(--gray-200)', borderRadius: 9,
        fontSize: 14, color: 'var(--gray-800)', background: 'white',
        outline: 'none', boxSizing: 'border-box' as const,
    };

    return (
        <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-bg)', padding: 24 }}>
            <div style={{ width: '100%', maxWidth: 420 }}>
                {/* Logo */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 40, justifyContent: 'center' }}>
                    <div style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg, #2563eb, #6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>⚡</div>
                    <span style={{ fontWeight: 800, fontSize: 18, color: 'var(--gray-900)' }}>KSeF Auto</span>
                </div>

                <div style={{ background: 'white', borderRadius: 16, padding: '36px', boxShadow: '0 4px 24px rgba(0,0,0,0.07)', border: '1px solid var(--gray-200)' }}>
                    {!done ? (
                        <>
                            <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--gray-900)', margin: '0 0 8px', letterSpacing: '-0.4px' }}>
                                Ustaw nowe hasło
                            </h1>
                            <p style={{ fontSize: 14, color: 'var(--gray-400)', margin: '0 0 28px' }}>
                                Wprowadź nowe hasło dla swojego konta.
                            </p>

                            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--gray-700)', marginBottom: 6 }}>
                                        Nowe hasło
                                    </label>
                                    <input
                                        type="password"
                                        required
                                        minLength={8}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="min. 8 znaków"
                                        style={inputStyle}
                                        onFocus={(e) => e.target.style.borderColor = '#2563eb'}
                                        onBlur={(e) => e.target.style.borderColor = 'var(--gray-200)'}
                                    />
                                </div>

                                <div>
                                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--gray-700)', marginBottom: 6 }}>
                                        Powtórz hasło
                                    </label>
                                    <input
                                        type="password"
                                        required
                                        value={confirm}
                                        onChange={(e) => setConfirm(e.target.value)}
                                        placeholder="••••••••"
                                        style={inputStyle}
                                        onFocus={(e) => e.target.style.borderColor = '#2563eb'}
                                        onBlur={(e) => e.target.style.borderColor = 'var(--gray-200)'}
                                    />
                                </div>

                                {error && (
                                    <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 9, padding: '11px 14px', fontSize: 13, color: '#dc2626', fontWeight: 500 }}>
                                        ⚠ {error}
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={loading}
                                    style={{
                                        width: '100%', padding: '12px',
                                        background: loading ? '#93c5fd' : '#2563eb',
                                        color: 'white', border: 'none', borderRadius: 9,
                                        fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
                                        boxShadow: loading ? 'none' : '0 4px 12px rgba(37,99,235,0.35)',
                                    }}
                                >
                                    {loading ? 'Zapisywanie...' : 'Zapisz nowe hasło →'}
                                </button>
                            </form>
                        </>
                    ) : (
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
                            <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--gray-900)', margin: '0 0 12px' }}>
                                Hasło zostało zmienione
                            </h2>
                            <p style={{ fontSize: 14, color: 'var(--gray-500)' }}>
                                Za chwilę zostaniesz przekierowany do logowania...
                            </p>
                        </div>
                    )}

                    {!done && (
                        <p style={{ marginTop: 20, textAlign: 'center', fontSize: 13, color: 'var(--gray-400)' }}>
                            <Link href="/login" style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}>
                                ← Wróć do logowania
                            </Link>
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
