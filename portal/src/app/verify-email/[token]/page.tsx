'use client';

import { useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

// Opened from the e-mailed link: confirms a new account's address, or a login
// e-mail change. The token is sent once, by POST (never acted on by a GET that
// a mail scanner could prefetch).
export default function VerifyEmailPage() {
    const { token } = useParams<{ token: string }>();
    const [state, setState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
    const [message, setMessage] = useState('');
    const [changed, setChanged] = useState(false);
    const sent = useRef(false);

    const confirm = async () => {
        if (sent.current) return;
        sent.current = true;
        setState('working');
        try {
            const res = await fetch('/api/auth/verify-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'confirm', token }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Nie udało się potwierdzić adresu');
            setChanged(Boolean(data.emailChanged));
            setState('done');
        } catch (err: unknown) {
            setMessage(err instanceof Error ? err.message : 'Nie udało się potwierdzić adresu');
            setState('error');
        }
    };

    return (
        <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-bg)', padding: 24 }}>
            <div style={{ width: '100%', maxWidth: 420 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 40, justifyContent: 'center' }}>
                    <div style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg, #2563eb, #6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>⚡</div>
                    <span style={{ fontWeight: 800, fontSize: 18, color: 'var(--gray-900)' }}>KSeF Auto</span>
                </div>
                <div style={{ background: 'white', borderRadius: 16, padding: '36px', boxShadow: '0 4px 24px rgba(0,0,0,0.07)', border: '1px solid var(--gray-200)', textAlign: 'center' }}>
                    {state === 'done' ? (
                        <>
                            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
                            <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--gray-900)', margin: '0 0 12px' }}>
                                {changed ? 'Adres logowania został zmieniony' : 'Adres e-mail potwierdzony'}
                            </h1>
                            <p style={{ fontSize: 14, color: 'var(--gray-500)', margin: '0 0 24px' }}>
                                {changed ? 'Zaloguj się ponownie, używając nowego adresu.' : 'Możesz się teraz zalogować.'}
                            </p>
                            <Link href="/login" style={{ color: '#2563eb', fontWeight: 700, textDecoration: 'none' }}>Przejdź do logowania →</Link>
                        </>
                    ) : (
                        <>
                            <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--gray-900)', margin: '0 0 8px' }}>Potwierdź adres e-mail</h1>
                            <p style={{ fontSize: 14, color: 'var(--gray-400)', margin: '0 0 24px' }}>Kliknij, aby potwierdzić ten adres.</p>
                            {state === 'error' && (
                                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 9, padding: '11px 14px', fontSize: 13, color: '#dc2626', fontWeight: 500, marginBottom: 16 }}>
                                    ⚠ {message}
                                </div>
                            )}
                            <button
                                type="button"
                                onClick={confirm}
                                disabled={state === 'working' || state === 'error'}
                                style={{ width: '100%', padding: '12px', background: state === 'working' ? '#93c5fd' : '#2563eb', color: 'white', border: 'none', borderRadius: 9, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
                            >
                                {state === 'working' ? 'Potwierdzanie...' : 'Potwierdź adres →'}
                            </button>
                            {state === 'error' && (
                                <p style={{ marginTop: 16, fontSize: 13 }}><Link href="/login" style={{ color: 'var(--gray-500)' }}>Wróć do logowania</Link></p>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
