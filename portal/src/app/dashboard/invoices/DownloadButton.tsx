'use client';

interface DownloadButtonProps {
    invoiceId: number;
    invoiceNumber: string | null;
    ksefNumber: string;
}

export default function DownloadButton({ invoiceId, invoiceNumber, ksefNumber }: DownloadButtonProps) {
    const filename = `${invoiceNumber || ksefNumber}.xml`.replace(/[/\\:*?"<>|]/g, '_');

    async function handleDownload() {
        const apiUrl = `/api/invoices/${invoiceId}/download`;

        // Modern Chrome (86+): show native Windows "Save As" dialog
        if ('showSaveFilePicker' in window) {
            try {
                const fileHandle = await (window as unknown as {
                    showSaveFilePicker: (opts: object) => Promise<FileSystemFileHandle>
                }).showSaveFilePicker({
                    suggestedName: filename,
                    types: [{ description: 'Plik XML Faktury KSeF', accept: { 'application/xml': ['.xml'], 'text/xml': ['.xml'] } }]
                });

                const resp = await fetch(apiUrl);
                if (!resp.ok) {
                    let errMsg = 'Błąd pobierania pliku z serwera';
                    try { const j = await resp.json(); errMsg = j.error || errMsg; } catch { /* ignore */ }
                    alert(`❌ ${errMsg}`);
                    return;
                }
                const text = await resp.text();
                if (!text || text.trim().length === 0) {
                    alert('❌ Plik XML jest pusty. Faktura mogła nie zostać jeszcze pobrana z KSeF.');
                    return;
                }

                const writable = await fileHandle.createWritable();
                await writable.write(text);
                await writable.close();
                return;
            } catch (e: unknown) {
                if ((e as { name?: string }).name === 'AbortError') return;
            }
        }

        // Fallback for Firefox/Safari/older Chrome
        const resp = await fetch(apiUrl);
        if (!resp.ok) {
            let errMsg = 'Błąd pobierania';
            try { const j = await resp.json(); errMsg = j.error || errMsg; } catch { /* ignore */ }
            alert(`❌ ${errMsg}`);
            return;
        }
        const blob = await resp.blob();
        if (blob.size === 0) {
            alert('❌ Plik XML jest pusty. Faktura mogła nie zostać jeszcze pobrana z KSeF.');
            return;
        }
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(blobUrl); }, 200);
    }

    return (
        <button
            onClick={handleDownload}
            style={{
                color: '#2563eb',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 600,
                textDecoration: 'underline',
                padding: 0,
                fontSize: 'inherit',
            }}
        >
            Pobierz XML
        </button>
    );
}
