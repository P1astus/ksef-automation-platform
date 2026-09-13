import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const nip = searchParams.get('nip')?.replace(/[-\s]/g, '');

    if (!nip || !/^\d{10}$/.test(nip)) {
        return NextResponse.json({ error: 'Nieprawidłowy NIP' }, { status: 400 });
    }

    const date = new Date().toISOString().split('T')[0];

    try {
        const res = await fetch(
            `https://wl-api.mf.gov.pl/api/search/nip/${nip}?date=${date}`,
            { headers: { 'Accept': 'application/json' }, next: { revalidate: 3600 } }
        );

        if (!res.ok) {
            return NextResponse.json({ found: false }, { status: 200 });
        }

        const data = await res.json();
        const subject = data?.result?.subject;

        if (!subject) {
            return NextResponse.json({ found: false }, { status: 200 });
        }

        const statusCode = subject.statusVat;
        const vatStatus = statusCode === 'Czynny' ? 'active'
            : statusCode === 'Zwolniony' ? 'exempt'
            : 'not_registered';

        return NextResponse.json({
            found: true,
            name: subject.name,
            nip: subject.nip,
            vatStatus,
            vatStatusLabel: statusCode || 'Brak danych',
        });
    } catch {
        return NextResponse.json({ found: false }, { status: 200 });
    }
}
