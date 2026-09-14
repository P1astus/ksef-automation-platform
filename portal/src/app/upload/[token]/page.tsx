'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Zap, Upload, CheckCircle } from 'lucide-react';

export default function UploadPage() {
    const { token } = useParams<{ token: string }>();
    const [clientName, setClientName] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [uploaded, setUploaded] = useState<string[]>([]);

    useEffect(() => {
        fetch(`/api/upload/${token}`).then(r => r.json()).then(d => {
            if (d.error) setError(d.error);
            else setClientName(d.clientName);
        }).catch(() => setError('Błąd połączenia'));
    }, [token]);

    async function handleUpload(e: React.FormEvent) {
        e.preventDefault();
        if (!file) return;
        setUploading(true);
        setError('');
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch(`/api/upload/${token}`, { method: 'POST', body: formData });
            const data = await res.json();
            if (res.ok) {
                setUploaded(prev => [...prev, file.name]);
                setFile(null);
            } else {
                setError(data.error || 'Błąd wysyłki pliku');
            }
        } catch {
            setError('Błąd połączenia');
        } finally {
            setUploading(false);
        }
    }

    return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)', padding: 20 }}>
            <div style={{ width: '100%', maxWidth: 420 }}>
                <div style={{ textAlign: 'center', marginBottom: 32 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                        <Zap size={22} color="#fff" strokeWidth={2.5} />
                    </div>
                    <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', margin: 0 }}>KSeF Auto</h1>
                </div>

                <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 28 }}>
                    {error ? (
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 36, marginBottom: 12 }}>❌</div>
                            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Błąd</h2>
                            <p style={{ fontSize: 13.5, color: '#ef4444' }}>{error}</p>
                        </div>
                    ) : !clientName ? (
                        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Sprawdzam link…</div>
                    ) : (
                        <>
                            <div style={{ marginBottom: 20, textAlign: 'center' }}>
                                <h2 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>Prześlij dokumenty</h2>
                                <p style={{ fontSize: 13.5, color: 'var(--text-muted)', margin: 0 }}>
                                    Dla: <strong>{clientName}</strong>
                                </p>
                            </div>

                            {uploaded.length > 0 && (
                                <div style={{ marginBottom: 16 }}>
                                    {uploaded.map((name, i) => (
                                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--success)', marginBottom: 6 }}>
                                            <CheckCircle size={14} /> {name}
                                        </div>
                                    ))}
                                </div>
                            )}

                            <form onSubmit={handleUpload}>
                                <label style={{
                                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                                    border: '2px dashed var(--border)', borderRadius: 10, padding: '28px 16px',
                                    cursor: 'pointer', marginBottom: 16, textAlign: 'center',
                                }}>
                                    <Upload size={22} style={{ color: 'var(--text-subtle)' }} />
                                    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                                        {file ? file.name : 'Kliknij aby wybrać plik (PDF, JPEG, PNG)'}
                                    </span>
                                    <input
                                        type="file"
                                        accept="application/pdf,image/jpeg,image/png"
                                        onChange={e => setFile(e.target.files?.[0] || null)}
                                        style={{ display: 'none' }}
                                    />
                                </label>
                                <button type="submit" disabled={!file || uploading} className="btn-primary" style={{ width: '100%' }}>
                                    {uploading ? 'Wysyłanie…' : 'Prześlij plik'}
                                </button>
                            </form>
                            <p style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 16, textAlign: 'center' }}>
                                Możesz przesłać więcej niż jeden plik — wróć na tę stronę i powtórz.
                            </p>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
