interface InvoiceRow {
    id: number;
    seller_name?: string;
    buyer_name?: string;
    invoice_number?: string;
    net_amount?: number | string;
    direction?: string;
}

const CATEGORIES = [
    'transport', 'usługi_IT', 'materiały_biurowe', 'media',
    'wynajem', 'usługi_księgowe', 'paliwo', 'marketing',
    'usługi_budowlane', 'sprzęt_IT', 'inne',
] as const;

export type CostCategory = typeof CATEGORIES[number];

export async function classifyInvoice(invoice: InvoiceRow): Promise<{ category: CostCategory; confidence: number } | null> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;

    const prompt = `Sklasyfikuj polską fakturę kosztową do jednej z kategorii.

Dane faktury:
- Sprzedawca: ${invoice.seller_name || 'brak'}
- Nabywca: ${invoice.buyer_name || 'brak'}
- Nr faktury: ${invoice.invoice_number || 'brak'}
- Kwota netto: ${invoice.net_amount || 'brak'} PLN

Dostępne kategorie: ${CATEGORIES.join(', ')}

Odpowiedz TYLKO w formacie JSON: {"category": "nazwa_kategorii", "confidence": 0.95}
Confidence to liczba 0-1. Użyj "inne" gdy nie pasujesz do żadnej kategorii.`;

    try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 64,
                messages: [{ role: 'user', content: prompt }],
            }),
        });

        if (!res.ok) return null;
        const data = await res.json();
        const text = data.content?.[0]?.text || '';
        const match = text.match(/\{[^}]+\}/);
        if (!match) return null;
        const parsed = JSON.parse(match[0]);
        const category = CATEGORIES.includes(parsed.category) ? parsed.category : 'inne';
        const confidence = Math.min(1, Math.max(0, parseFloat(parsed.confidence) || 0.5));
        return { category, confidence };
    } catch {
        return null;
    }
}
