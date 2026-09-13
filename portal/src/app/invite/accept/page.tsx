'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Zap } from 'lucide-react';

function AcceptInviteForm() {
    const params = useSearchParams();
    const router = useRouter();
    const token = params.get('token') || '';

    const [info, setInfo] = useState<{ email: string; firmName: string; role: string } | null>(null);
    const [error, setError] = useState('');
    const [fullName, setFullName] = useState('');
    const [password, setPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [done, setDone] = useState(false);

    useEffect(() => {
        if (!token) { setError('Brak tokenu zaproszenia'); return; }
        fetch(`/api/team/accept?token=${token}`)
            .then(r => r.json())
            .then(d => {
                if (d.error) setError(d.error);
                else setInfo(d);
            })
            .catch(() => setError('Błąd połączenia'));
    }, [token]);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setSubmitting(true);
        try {
            const res = await fetch('/api/team/accept', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, fullName, password }),
            });
            const data = await res.json();
            if (res.ok) setDone(true);
            else setError(data.error || 'Błąd rejestracji');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)', padding: 20 }}>
            <div style={{ width: '100%', maxWidth: 400 }}>
                <div style={{ textAlign: 'center', marginBottom: 32 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                        <Zap size={22} color="#fff" strokeWidth={2.5} />
                    </div>
                    <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', margin: 0 }}>KSeF Auto</h1>
                </div>

                <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 28 }}>
                    {done ? (
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
                            <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Konto utworzone!</h2>
                            <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginBottom: 20 }}>Możesz teraz zalogować się do panelu.</p>
                            <Link href="/login" className="btn-primary" style={{ textDecoration: 'none', display: 'inline-block', padding: '10px 24px', borderRadius: 7 }}>
                                Zaloguj się →
                            </Link>
                        </div>
                    ) : error ? (
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 36, marginBottom: 12 }}>❌</div>
                            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Błąd</h2>
                            <p style={{ fontSize: 13.5, color: '#ef4444', marginBottom: 16 }}>{error}</p>
                            <Link href="/login" style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none' }}>Wróć do logowania →</Link>
                        </div>
                    ) : !info ? (
                        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Sprawdzam zaproszenie…</div>
                    ) : (
                        <>
                            <div style={{ marginBottom: 20, textAlign: 'center' }}>
                                <h2 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>Dołącz do zespołu</h2>
                                <p style={{ fontSize: 13.5, color: 'var(--text-muted)', margin: 0 }}>
                                    Zostałeś zaproszony do <strong>{info.firmName}</strong> jako {info.role}
                                </p>
                            </div>
                            <form onSubmit={handleSubmit}>
                                <div style={{ marginBottom: 14 }}>
                                    <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5 }}>Email</label>
                                    <input value={info.email} disabled style={{ width: '100%', opacity: 0.6 }} />
                                </div>
                                <div style={{ marginBottom: 14 }}>
                                    <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5 }}>Imię i nazwisko</label>
                                    <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Jan Kowalski" style={{ width: '100%' }} required />
                                </div>
                                <div style={{ marginBottom: 20 }}>
                                    <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5 }}>Hasło (min. 8 znaków)</label>
                                    <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" style={{ width: '100%' }} minLength={8} required />
                                </div>
                                <button type="submit" disabled={submitting} className="btn-primary" style={{ width: '100%' }}>
                                    {submitting ? 'Tworzenie konta…' : 'Utwórz konto'}
                                </button>
                            </form>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function AcceptInvitePage() {
    return (
        <Suspense fallback={<div />}>
            <AcceptInviteForm />
        </Suspense>
    );
}
