'use client';

import { useEffect, useState } from 'react';
import { Download, FileUp, Landmark, RefreshCw } from 'lucide-react';

type Client = { id: number; nip: string; client_name: string };
type Declaration = { id: number; client_nip: string; client_name: string | null; period: string; document_types: string[]; source_filename: string; status: string; created_at: string };

export default function ZusDeclarationsPage() {
    const [clients, setClients] = useState<Client[]>([]);
    const [declarations, setDeclarations] = useState<Declaration[]>([]);
    const [clientNip, setClientNip] = useState('');
    const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
    const [file, setFile] = useState<File | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    async function refresh() {
        const response = await fetch('/api/zus/declarations');
        if (!response.ok) return;
        const data = await response.json();
        setDeclarations(Array.isArray(data.declarations) ? data.declarations : []);
    }

    useEffect(() => {
        fetch('/api/clients').then(r => r.json()).then(data => {
            const list = Array.isArray(data.clients) ? data.clients : [];
            setClients(list);
            if (list[0]) setClientNip(list[0].nip);
        }).catch(() => {});
        refresh().catch(() => {});
    }, []);

    async function upload() {
        if (!file || !clientNip || !period) return;
        setBusy(true); setError(''); setNotice('');
        try {
            const body = new FormData();
            body.set('file', file); body.set('clientNip', clientNip); body.set('period', period);
            const response = await fetch('/api/zus/declarations', { method: 'POST', body });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Import nie powiódł się.');
            setNotice(data.notice); setFile(null);
            const input = document.getElementById('zus-xml') as HTMLInputElement | null;
            if (input) input.value = '';
            await refresh();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Import nie powiódł się.');
        } finally { setBusy(false); }
    }

    return <div style={{ paddingTop: 28, maxWidth: 980 }}>
        <div style={{ marginBottom: 28 }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: 0 }}><Landmark size={21} style={{ verticalAlign: -4, marginRight: 8 }} />ZUS — deklaracje DRA/RCA</h1>
            <p style={{ margin: '5px 0 0', fontSize: 13.5, color: 'var(--text-muted)' }}>Rejestruj i eksportuj pakiety XML przygotowane w systemie kadrowo-płacowym.</p>
        </div>
        <div role="note" style={{ background: 'rgba(245,158,11,.12)', border: '1px solid #f59e0b', borderRadius: 10, padding: '13px 16px', marginBottom: 22, fontSize: 13, lineHeight: 1.5 }}>
            <strong>Wysyłka do ZUS nie jest jeszcze aktywna.</strong> Ten moduł bezpiecznie rejestruje plik i pozwala go pobrać do Płatnika/ePłatnika. Bezpośrednia wymiana EWD wymaga akceptacji ZUS oraz kwalifikowanego podpisu.
        </div>
        <section style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 22, marginBottom: 24 }}>
            <h2 style={{ fontSize: 15, margin: '0 0 16px' }}>Import XML DRA/RCA</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 170px 1.4fr auto', gap: 12, alignItems: 'end' }}>
                <label>Klient<select value={clientNip} onChange={e => setClientNip(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 5 }}><option value="">-- wybierz --</option>{clients.map(c => <option key={c.id} value={c.nip}>{c.client_name} ({c.nip})</option>)}</select></label>
                <label>Okres<input type="month" value={period} onChange={e => setPeriod(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 5 }} /></label>
                <label>Plik XML<input id="zus-xml" type="file" accept=".xml,application/xml,text/xml" onChange={e => setFile(e.target.files?.[0] || null)} style={{ display: 'block', width: '100%', marginTop: 5 }} /></label>
                <button className="btn-primary" disabled={busy || !file || !clientNip} onClick={upload} style={{ display: 'flex', gap: 7, alignItems: 'center' }}>{busy ? <RefreshCw size={15} /> : <FileUp size={15} />} Importuj</button>
            </div>
            {error && <p style={{ color: '#ef4444', margin: '14px 0 0', fontSize: 13 }}>{error}</p>}
            {notice && <p style={{ color: '#16a34a', margin: '14px 0 0', fontSize: 13 }}>{notice}</p>}
        </section>
        <section style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700 }}>Historia deklaracji</div>
            {declarations.length === 0 ? <p style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>Brak zaimportowanych deklaracji.</p> : <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}><thead><tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}><th style={{ padding: '10px 20px' }}>Klient / okres</th><th>Dokumenty</th><th>Plik</th><th>Utworzono</th><th></th></tr></thead><tbody>{declarations.map(d => <tr key={d.id} style={{ borderTop: '1px solid var(--border)' }}><td style={{ padding: '12px 20px' }}>{d.client_name || d.client_nip}<br /><small>{d.period}</small></td><td>{d.document_types.join(', ')}</td><td>{d.source_filename}</td><td>{new Date(d.created_at).toLocaleDateString('pl-PL')}</td><td><a className="btn-secondary" href={`/api/zus/declarations/${d.id}/download`} style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><Download size={14} /> XML</a></td></tr>)}</tbody></table>}
        </section>
    </div>;
}
