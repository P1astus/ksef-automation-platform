'use client';

import { useEffect, useState } from 'react';
import PlanErrorLink from '@/app/dashboard/PlanErrorLink';
import { interpretApiFailure } from '@/lib/plan-errors';

export default function ImapSettings() {
    const [host, setHost] = useState('');
    const [port, setPort] = useState('993');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [mailbox, setMailbox] = useState('INBOX');
    const [useTls, setUseTls] = useState(true);
    const [hasPassword, setHasPassword] = useState(false);
    const [saving, setSaving] = useState(false);
    const [result, setResult] = useState<{ text: string; ok: boolean; plan: boolean } | null>(null);

    useEffect(() => {
        fetch('/api/settings/email').then(async response => {
            if (!response.ok) return;
            const data = await response.json();
            if (data.configured) {
                setHost(data.host || '');
                setPort(String(data.port || 993));
                setUsername(data.username || '');
                setMailbox(data.mailbox || 'INBOX');
                setUseTls(data.use_tls !== false);
                setHasPassword(!!data.has_password);
            }
        }).catch(() => {});
    }, []);

    const save = async () => {
        setSaving(true);
        setResult(null);
        try {
            const response = await fetch('/api/settings/email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ host, port: Number(port), username, password, mailbox, use_tls: useTls }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                const failure = interpretApiFailure(response.status, data, 'Nie udało się zapisać ustawień IMAP');
                setResult({ text: failure.message, ok: false, plan: failure.isPlanError });
                return;
            }
            setHasPassword(true);
            setPassword('');
            setResult({ text: 'Ustawienia skrzynki zostały zapisane.', ok: true, plan: false });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
                Ustawienia dotyczą wyłącznie tego biura. Wiadomości są oznaczane jako przeczytane dopiero po poprawnym przetworzeniu.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 12 }}>
                <div><label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>Serwer IMAP</label><input value={host} onChange={e => setHost(e.target.value)} placeholder="imap.example.pl" style={{ width: '100%' }} /></div>
                <div><label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>Port</label><input type="number" value={port} onChange={e => setPort(e.target.value)} style={{ width: '100%' }} /></div>
            </div>
            <div><label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>Użytkownik</label><input value={username} onChange={e => setUsername(e.target.value)} style={{ width: '100%' }} /></div>
            <div><label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>Hasło aplikacji</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={hasPassword ? 'Pozostaw puste, aby zachować obecne' : 'Wymagane'} style={{ width: '100%' }} /></div>
            <div><label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>Folder</label><input value={mailbox} onChange={e => setMailbox(e.target.value)} style={{ width: '100%' }} /></div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={useTls} onChange={e => setUseTls(e.target.checked)} /> Używaj TLS</label>
            <div><button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Zapisywanie...' : 'Zapisz skrzynkę'}</button></div>
            {result && <div style={{ fontSize: 13, color: result.ok ? 'var(--success)' : 'var(--error)' }}>{result.text}<PlanErrorLink show={result.plan} /></div>}
        </div>
    );
}
