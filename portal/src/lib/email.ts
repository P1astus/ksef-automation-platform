const RESEND_API = 'https://api.resend.com/emails';
const FROM = process.env.RESEND_FROM_EMAIL || 'KSeF Auto <noreply@ksef.auto>';

async function send(to: string, subject: string, html: string) {
    const key = process.env.RESEND_API_KEY;
    if (!key) return; // silently skip if not configured
    await fetch(RESEND_API, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to, subject, html }),
    }).catch(() => { /* non-critical */ });
}

export async function sendWelcome(email: string, firmName: string) {
    await send(email, `Witamy w KSeF Auto, ${firmName}!`, `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px">
            <h1 style="color:#6366f1;font-size:24px;margin-bottom:8px">Witamy w KSeF Auto!</h1>
            <p style="color:#555;font-size:15px">Twoje konto dla biura <strong>${firmName}</strong> zostało utworzone.</p>
            <p style="color:#555;font-size:15px">Masz <strong>30 dni za darmo</strong> — zacznij od dodania pierwszego klienta.</p>
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard" style="display:inline-block;background:#6366f1;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:16px">Przejdź do panelu →</a>
            <p style="color:#999;font-size:12px;margin-top:32px">KSeF Auto · Automatyzacja KSeF dla biur rachunkowych</p>
        </div>
    `);
}

export async function sendTrialExpiry(email: string, firmName: string, daysLeft: number) {
    await send(email, `Twój okres próbny wygasa za ${daysLeft} ${daysLeft === 1 ? 'dzień' : 'dni'}`, `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px">
            <h1 style="color:#f59e0b;font-size:22px;margin-bottom:8px">Okres próbny kończy się wkrótce</h1>
            <p style="color:#555;font-size:15px">Hej ${firmName}, Twój bezpłatny okres próbny wygasa za <strong>${daysLeft} ${daysLeft === 1 ? 'dzień' : 'dni'}</strong>.</p>
            <p style="color:#555;font-size:15px">Wybierz plan, aby nie stracić dostępu do faktur i danych Twoich klientów.</p>
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing" style="display:inline-block;background:#6366f1;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:16px">Wybierz plan →</a>
            <p style="color:#999;font-size:12px;margin-top:32px">KSeF Auto · Automatyzacja KSeF dla biur rachunkowych</p>
        </div>
    `);
}

export async function sendSyncFailed(email: string, firmName: string, clientName: string, errorMsg: string) {
    await send(email, `Błąd synchronizacji KSeF — ${clientName}`, `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px">
            <h1 style="color:#ef4444;font-size:22px;margin-bottom:8px">Synchronizacja nie powiodła się</h1>
            <p style="color:#555;font-size:15px">Biuro: <strong>${firmName}</strong></p>
            <p style="color:#555;font-size:15px">Klient: <strong>${clientName}</strong></p>
            <p style="color:#555;font-size:15px">Błąd: <code style="background:#f5f5f5;padding:2px 6px;border-radius:4px">${errorMsg}</code></p>
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard/clients" style="display:inline-block;background:#6366f1;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:16px">Sprawdź klientów →</a>
            <p style="color:#999;font-size:12px;margin-top:32px">KSeF Auto · Automatyzacja KSeF dla biur rachunkowych</p>
        </div>
    `);
}

export async function sendDailyDigest(email: string, firmName: string, stats: {
    invoicesYesterday: number;
    clientsSynced: number;
    errors: number;
    totalInvoices: number;
}) {
    const statusColor = stats.errors > 0 ? '#ef4444' : '#22c55e';
    const statusText = stats.errors > 0 ? `${stats.errors} błędy synchronizacji` : 'Wszystkie synchronizacje OK';
    await send(email, `Raport dzienny KSeF Auto — ${new Date().toLocaleDateString('pl-PL')}`, `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px">
            <h1 style="color:#6366f1;font-size:22px;margin-bottom:4px">Raport dzienny</h1>
            <p style="color:#999;font-size:13px;margin-top:0">${firmName} · ${new Date().toLocaleDateString('pl-PL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:24px 0">
                <div style="background:#f9fafb;border-radius:10px;padding:16px;text-align:center">
                    <div style="font-size:28px;font-weight:800;color:#111">${stats.invoicesYesterday}</div>
                    <div style="font-size:12px;color:#666;margin-top:4px">Nowych faktur wczoraj</div>
                </div>
                <div style="background:#f9fafb;border-radius:10px;padding:16px;text-align:center">
                    <div style="font-size:28px;font-weight:800;color:#111">${stats.totalInvoices}</div>
                    <div style="font-size:12px;color:#666;margin-top:4px">Faktur łącznie</div>
                </div>
            </div>
            <p style="color:${statusColor};font-weight:600;font-size:14px">● ${statusText}</p>
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard" style="display:inline-block;background:#6366f1;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:8px">Otwórz panel →</a>
            <p style="color:#999;font-size:12px;margin-top:32px">KSeF Auto · <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings" style="color:#999">Wypisz się z raportów</a></p>
        </div>
    `);
}
