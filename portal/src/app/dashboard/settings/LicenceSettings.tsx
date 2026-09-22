'use client';
import { useEffect, useState } from 'react';

interface Status { state: string; plan: string | null; maxClients: number | null; expiresOn: string | null; warningDays: number | null }
export default function LicenceSettings() {
    const [status, setStatus] = useState<Status | null>(null);
    const [blob, setBlob] = useState('');
    const [message, setMessage] = useState('');
    const refresh = () => fetch('/api/settings/licence').then(r => r.json()).then(setStatus);
    useEffect(() => { refresh(); }, []);
    async function install() {
        const response = await fetch('/api/settings/licence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ licence: blob }) });
        const body = await response.json();
        setMessage(response.ok ? 'Licencja zainstalowana.' : body.error || 'Nie udało się zainstalować licencji.');
        if (response.ok) { setBlob(''); await refresh(); window.location.reload(); }
    }
    return <section style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 24, marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Licencja</h2>
        <p>{status?.state === 'licence_missing' ? 'Brak licencji — dostęp tylko do odczytu.' : status?.state === 'licence_expired' ? 'Licencja wygasła — dostęp tylko do odczytu.' : status?.expiresOn ? `${status.plan} · ${status.maxClients} klientów · ważna do ${status.expiresOn}` : 'Ładowanie…'}</p>
        <textarea aria-label="Plik licencji" value={blob} onChange={e => setBlob(e.target.value)} placeholder="Wklej zawartość pliku licencji JSON" rows={5} style={{ width: '100%', marginTop: 12 }} />
        <input type="file" accept=".json,.licence,text/plain,application/json" onChange={async e => { const file = e.target.files?.[0]; if (file) setBlob(await file.text()); }} />
        <button type="button" onClick={install} disabled={!blob.trim()} style={{ display: 'block', marginTop: 12 }}>Zainstaluj lub odnów licencję</button>
        {message && <p role="status">{message}</p>}
    </section>;
}
