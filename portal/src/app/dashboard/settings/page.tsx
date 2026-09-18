'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle, AlertCircle } from 'lucide-react';
import ImapSettings from './ImapSettings';

interface FirmData {
    firm_name: string;
    firm_nip: string;
    admin_email: string;
    subscription_tier: string;
    max_clients: number;
    role: 'owner' | 'admin' | 'member' | 'readonly';
    isOwner: boolean;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div style={{ background: 'var(--bg-surface)', borderRadius: 14, padding: '24px', border: '1px solid var(--border)', marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 20, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>{title}</div>
            {children}
        </div>
    );
}

function StatusMsg({ msg, ok }: { msg: string; ok: boolean }) {
    return (
        <div style={{
            marginTop: 12, padding: '10px 14px', borderRadius: 9, fontSize: 13, fontWeight: 500,
            background: ok ? 'rgba(34,197,94,0.1)' : 'var(--error-dim)',
            border: `1px solid ${ok ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
            color: ok ? 'var(--success)' : 'var(--error)',
            display: 'flex', gap: 8, alignItems: 'center',
        }}>
            {ok ? <CheckCircle size={15} /> : <AlertCircle size={15} />} {msg}
        </div>
    );
}

export default function SettingsPage() {
    const router = useRouter();
    const [data, setData] = useState<FirmData | null>(null);
    const [firmName, setFirmName] = useState('');
    const [firmNip, setFirmNip] = useState('');
    const [newEmail, setNewEmail] = useState('');
    const [currentPw, setCurrentPw] = useState('');
    const [newPw, setNewPw] = useState('');
    const [confirmPw, setConfirmPw] = useState('');
    const [deactivatePw, setDeactivatePw] = useState('');
    const [deactivating, setDeactivating] = useState(false);
    const [msgs, setMsgs] = useState<{ firm?: { text: string; ok: boolean }; email?: { text: string; ok: boolean }; pw?: { text: string; ok: boolean }; deactivate?: { text: string; ok: boolean } }>({});
    const [loading, setLoading] = useState<Record<string, boolean>>({});

    useEffect(() => {
        fetch('/api/settings').then(r => r.json()).then((d: FirmData) => {
            setData(d); setFirmName(d.firm_name || ''); setFirmNip(d.firm_nip || ''); setNewEmail(d.admin_email || '');
        });
    }, []);

    const patch = async (key: string, payload: object, msgKey: 'firm' | 'email' | 'pw') => {
        setLoading(l => ({ ...l, [key]: true }));
        setMsgs(m => ({ ...m, [msgKey]: undefined }));
        try {
            const res = await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const d = await res.json();
            setMsgs(m => ({ ...m, [msgKey]: { text: d.error || 'Zapisano zmiany', ok: res.ok } }));
        } catch {
            setMsgs(m => ({ ...m, [msgKey]: { text: 'Błąd serwera', ok: false } }));
        } finally {
            setLoading(l => ({ ...l, [key]: false }));
        }
    };

    const deactivateAccount = async () => {
        if (!deactivatePw) { setMsgs(m => ({ ...m, deactivate: { text: 'Podaj hasło, aby potwierdzić', ok: false } })); return; }
        const confirmed = window.confirm(
            'Dezaktywować konto biura?\n\n' +
            'Konto zostanie natychmiast zablokowane — nikt nie będzie mógł się zalogować. ' +
            'Dane faktur i rozliczeń NIE zostaną usunięte (przechowywane zgodnie z przepisami podatkowymi).\n\n' +
            'Aby faktycznie usunąć dane, skontaktuj się z obsługą.'
        );
        if (!confirmed) return;
        setDeactivating(true);
        setMsgs(m => ({ ...m, deactivate: undefined }));
        try {
            const res = await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deactivate_account', current_password: deactivatePw }) });
            const d = await res.json();
            if (res.ok) {
                await fetch('/api/auth/logout', { method: 'POST' });
                router.push('/login');
                router.refresh();
            } else {
                setMsgs(m => ({ ...m, deactivate: { text: d.error || 'Błąd', ok: false } }));
            }
        } finally {
            setDeactivating(false);
        }
    };

    if (!data) return <div style={{ padding: 40, color: 'var(--text-muted)' }}>Ładowanie...</div>;

    // update_firm/update_email are gated server-side to owner/admin (email
    // change is owner-only — it's the owner's own login identity). Hiding
    // the sections a member/readonly session can't use avoids showing a
    // form that will just 403 on submit.
    const canManageFirm = data.role === 'owner' || data.role === 'admin';

    return (
        <div style={{ maxWidth: 640, padding: '28px 0' }}>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', margin: '0 0 4px', letterSpacing: '-0.5px' }}>Ustawienia konta</h1>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 32px' }}>Zarządzaj danymi biura i bezpieczeństwem konta.</p>

            {canManageFirm && (
                <Section title="Dane biura">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <div>
                            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>Nazwa biura rachunkowego</label>
                            <input type="text" value={firmName} onChange={e => setFirmName(e.target.value)} />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>NIP biura</label>
                            <input type="text" value={firmNip} onChange={e => setFirmNip(e.target.value)} placeholder="10 cyfr" maxLength={10} className="mono" />
                        </div>
                    </div>
                    <button onClick={() => patch('firm', { action: 'update_firm', firm_name: firmName, firm_nip: firmNip }, 'firm')} className="btn-primary" style={{ marginTop: 16, opacity: loading['firm'] ? 0.7 : 1 }}>
                        {loading['firm'] ? 'Zapisywanie...' : 'Zapisz dane biura'}
                    </button>
                    {msgs.firm && <StatusMsg msg={msgs.firm.text} ok={msgs.firm.ok} />}
                </Section>
            )}

            {canManageFirm && (
                <Section title="Skrzynka faktur (IMAP)">
                    <ImapSettings />
                </Section>
            )}

            {data.isOwner && (
                <Section title="Adres e-mail">
                    <div>
                        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>Nowy adres e-mail</label>
                        <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
                    </div>
                    <button onClick={() => patch('email', { action: 'update_email', new_email: newEmail }, 'email')} className="btn-primary" style={{ marginTop: 16, opacity: loading['email'] ? 0.7 : 1 }}>
                        {loading['email'] ? 'Zapisywanie...' : 'Zmień e-mail'}
                    </button>
                    {msgs.email && <StatusMsg msg={msgs.email.text} ok={msgs.email.ok} />}
                </Section>
            )}

            <Section title="Zmiana hasła">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {[
                        { label: 'Obecne hasło', val: currentPw, set: setCurrentPw, placeholder: '••••••••' },
                        { label: 'Nowe hasło', val: newPw, set: setNewPw, placeholder: 'min. 8 znaków' },
                        { label: 'Powtórz nowe hasło', val: confirmPw, set: setConfirmPw, placeholder: '••••••••' },
                    ].map(({ label, val, set, placeholder }) => (
                        <div key={label}>
                            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>{label}</label>
                            <input type="password" value={val} onChange={e => set(e.target.value)} placeholder={placeholder} />
                        </div>
                    ))}
                </div>
                <button onClick={() => {
                    if (newPw !== confirmPw) { setMsgs(m => ({ ...m, pw: { text: 'Hasła nie są identyczne', ok: false } })); return; }
                    patch('pw', { action: 'update_password', current_password: currentPw, new_password: newPw }, 'pw');
                }} className="btn-primary" style={{ marginTop: 16, opacity: loading['pw'] ? 0.7 : 1 }}>
                    {loading['pw'] ? 'Zapisywanie...' : 'Zmień hasło'}
                </button>
                {msgs.pw && <StatusMsg msg={msgs.pw.text} ok={msgs.pw.ok} />}
            </Section>

            {data.isOwner && (
                <Section title="Dezaktywacja konta">
                    <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 14px' }}>
                        Zamyka dostęp do konta biura. Faktury i dane rozliczeniowe pozostają zachowane
                        zgodnie z obowiązkiem przechowywania dokumentacji podatkowej — to nie jest
                        trwałe usunięcie danych.
                    </p>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>Potwierdź hasłem</label>
                    <input type="password" value={deactivatePw} onChange={e => setDeactivatePw(e.target.value)} placeholder="••••••••" style={{ maxWidth: 280 }} />
                    <div>
                        <button
                            onClick={deactivateAccount}
                            disabled={deactivating}
                            style={{ marginTop: 16, background: 'var(--error-dim)', color: 'var(--error)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: deactivating ? 0.7 : 1 }}
                        >
                            {deactivating ? 'Dezaktywowanie...' : 'Dezaktywuj konto'}
                        </button>
                    </div>
                    {msgs.deactivate && <StatusMsg msg={msgs.deactivate.text} ok={msgs.deactivate.ok} />}
                </Section>
            )}
        </div>
    );
}
