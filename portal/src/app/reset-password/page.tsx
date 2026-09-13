'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function ResetPasswordPage() {
    const [email, setEmail] = useState('');
    const [submitted, setSubmitted] = useState(false);
    const [loading, setLoading] = useState(false);
    const [devUrl, setDevUrl] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const res = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'request', email }),
            });
            const data = await res.json();
            if (data.resetUrl) setDevUrl(data.resetUrl); // dev only
            setSubmitted(true);
        } finally {
            setLoading(false);
        }
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
                    {!submitted ? (
                        <>
                            <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--gray-900)', margin: '0 0 8px', letterSpacing: '-0.4px' }}>
                                Resetuj hasło
                            </h1>
                            <p style={{ fontSize: 14, color: 'var(--gray-400)', margin: '0 0 28px' }}>
                                Podaj adres e-mail, a wyślemy Ci link do ustawienia nowego hasła.
                            </p>

                            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--gray-700)', marginBottom: 6 }}>
                                        Adres e-mail
                                    </label>
                                    <input
                                        type="email"
                                        required
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="twoj@biuro.pl"
                                        style={{
                                            width: '100%', padding: '11px 14px',
                                            border: '1.5px solid var(--gray-200)', borderRadius: 9,
                                            fontSize: 14, color: 'var(--gray-800)', background: 'white',
                                            outline: 'none', boxSizing: 'border-box',
                                        }}
                                        onFocus={(e) => e.target.style.borderColor = '#2563eb'}
                                        onBlur={(e) => e.target.style.borderColor = 'var(--gray-200)'}
                                    />
                                </div>

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
                                    {loading ? 'Wysyłanie...' : 'Wyślij link resetujący →'}
                                </button>
                            </form>
                        </>
                    ) : (
                        <>
                            <div style={{ textAlign: 'center', marginBottom: 20 }}>
                                <div style={{ fontSize: 48, marginBottom: 16 }}>📧</div>
                                <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--gray-900)', margin: '0 0 12px' }}>
                                    Sprawdź skrzynkę
                                </h1>
                                <p style={{ fontSize: 14, color: 'var(--gray-500)', lineHeight: 1.6 }}>
                                    Jeśli konto z adresem <strong>{email}</strong> istnieje, wysłaliśmy link do resetowania hasła. Sprawdź folder spam, jeśli nie widzisz wiadomości.
                                </p>
                            </div>

                            {devUrl && (
                                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 9, padding: 14, marginBottom: 16 }}>
                                    <p style={{ fontSize: 12, color: '#166534', fontWeight: 600, margin: '0 0 6px' }}>
                                        DEV MODE — Link resetujący:
                                    </p>
                                    <a href={devUrl} style={{ fontSize: 12, color: '#2563eb', wordBreak: 'break-all' }}>{devUrl}</a>
                                </div>
                            )}
                        </>
                    )}

                    <p style={{ marginTop: 20, textAlign: 'center', fontSize: 13, color: 'var(--gray-400)' }}>
                        <Link href="/login" style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}>
                            ← Wróć do logowania
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
