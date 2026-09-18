'use client';

import { useState } from 'react';

export default function AdminLoginPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
            const res = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });
            if (res.ok) { window.location.href = '/admin'; return; }
            const d = await res.json().catch(() => ({}));
            setError(d.error || 'Błąd logowania');
        } catch {
            setError('Błąd połączenia z serwerem');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div style={{ maxWidth: 380, margin: '96px auto', padding: '0 16px' }}>
            <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>Konsola operatora</h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>Dostęp wyłącznie dla operatorów platformy. Każde wejście jest rejestrowane.</p>
            <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="E-mail" autoComplete="username" required />
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Hasło" autoComplete="current-password" required />
                {error && <div style={{ fontSize: 13, color: 'var(--error)' }}>{error}</div>}
                <button className="btn-primary" disabled={busy}>{busy ? 'Logowanie...' : 'Zaloguj'}</button>
            </form>
        </div>
    );
}
