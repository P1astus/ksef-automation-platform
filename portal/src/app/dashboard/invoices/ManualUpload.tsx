'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Mail, FileUp, ListChecks } from 'lucide-react';

export default function ManualUpload() {
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [statusText, setStatusText] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const router = useRouter();

    const handleSyncEmail = async () => {
        setIsSyncing(true); setStatusText('Łączenie z serwerem poczty (IMAP)...');
        try {
            const res = await fetch('/api/email/sync', { method: 'POST' });
            if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Błąd synchronizacji poczty'); }
            const data = await res.json();
            alert(`Synchronizacja poczty: ${data.message || 'Zakończono!'}`);
            router.refresh();
        } catch (e: any) { alert(`❌ ${e.message}`); }
        finally { setIsSyncing(false); setStatusText(''); }
    };

    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault(); e.stopPropagation();
        setIsDragging(e.type === 'dragenter' || e.type === 'dragover');
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault(); e.stopPropagation(); setIsDragging(false);
        if (e.dataTransfer.files?.[0]) await processFile(e.dataTransfer.files[0]);
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) await processFile(e.target.files[0]);
    };

    const processFile = async (file: File) => {
        if (!(file.type === 'application/pdf' || file.type.startsWith('image/'))) {
            alert('Obsługiwane są tylko pliki PDF i obrazy.'); return;
        }
        setIsUploading(true); setStatusText('Wysyłanie pliku do serwera...');
        const formData = new FormData();
        formData.append('file', file);
        try {
            setStatusText('Przetwarzanie OCR (może potrwać kilka sekund)...');
            const res = await fetch('/api/ocr', { method: 'POST', body: formData });
            if (!res.ok) { const data = await res.json(); throw new Error(data.error || 'Wystąpił błąd podczas OCR.'); }
            const data = await res.json();
            setStatusText('Zakończono pomyślnie!');
            if (data.needsReview) {
                alert(`Odczytane dane wymagają weryfikacji przed zapisaniem:\n\nNumer: ${data.extracted.invoice_number}\nNIP: ${data.extracted.nip}\nBrutto: ${data.extracted.gross_amount}\n\nSprawdź i zatwierdź w kolejce weryfikacji OCR.`);
            } else {
                alert(`Udało się wyodrębnić informacje:\n\nNumer: ${data.extracted.invoice_number}\nNIP: ${data.extracted.nip}\nNetto: ${data.extracted.net_amount}\nBrutto: ${data.extracted.gross_amount}\n\nZapisano do bazy pomyślnie!`);
            }
            router.refresh();
        } catch (err: any) {
            console.error(err); alert(`Błąd: ${err.message}`);
        } finally { setIsUploading(false); setStatusText(''); }
    };

    return (
        <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginBottom: 12 }}>
                <Link href="/dashboard/invoices/review" className="btn-secondary" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ListChecks size={15} /> Kolejka weryfikacji OCR
                </Link>
                <button onClick={handleSyncEmail} disabled={isSyncing || isUploading} className="btn-secondary"
                    style={{ opacity: (isSyncing || isUploading) ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Mail size={15} /> {isSyncing ? 'Synchronizowanie skrzynki...' : 'Pobierz nowe faktury E-mail (IMAP)'}
                </button>
            </div>
            <div
                onDragEnter={handleDrag} onDragOver={handleDrag} onDragLeave={handleDrag} onDrop={handleDrop}
                onClick={() => !isUploading && fileInputRef.current?.click()}
                style={{
                    border: `2px dashed ${isDragging ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 14,
                    background: isDragging ? 'var(--accent-dim)' : 'var(--bg-surface)',
                    padding: '32px', textAlign: 'center',
                    cursor: isUploading ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s',
                }}
            >
                <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept="application/pdf,image/png,image/jpeg" style={{ display: 'none' }} />
                {isUploading ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 24, height: 24, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                        <div style={{ fontWeight: 600, color: 'var(--accent)', fontSize: 14 }}>{statusText}</div>
                    </div>
                ) : (
                    <div>
                        <div className="icon-box" style={{ width: 44, height: 44, borderRadius: 12, margin: '0 auto 12px' }}><FileUp size={20} /></div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Dodaj faktury spoza KSeF</div>
                        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                            Przeciągnij plik PDF / JPEG lub <b style={{ color: 'var(--accent-hover)' }}>kliknij aby wybrać z dysku</b>.<br />
                            System automatycznie odczyta dane (OCR).
                        </div>
                    </div>
                )}
                <style dangerouslySetInnerHTML={{ __html: `@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }` }} />
            </div>
        </div>
    );
}
