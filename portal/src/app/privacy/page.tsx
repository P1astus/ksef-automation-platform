import Link from 'next/link';
import { Zap } from 'lucide-react';

export default function PrivacyPage() {
    const sections = [
        {
            title: '1. Administrator danych',
            content: `Administratorem danych osobowych jest KSeF Auto (dalej „Spółka"), świadcząca usługi automatyzacji KSeF dla biur rachunkowych. W sprawach związanych z ochroną danych osobowych można kontaktować się pod adresem: kontakt@ksef.auto.`,
        },
        {
            title: '2. Jakie dane zbieramy',
            content: `Zbieramy następujące kategorie danych:
• Dane rejestracyjne: nazwa firmy, NIP, adres e-mail, hasło (w postaci skrótu bcrypt)
• Dane rozliczeniowe: dane karty płatniczej przetwarzane przez Stripe (nie przechowujemy danych kart)
• Dane faktur: faktury pobrane z systemu KSeF w imieniu Twoich klientów (NIP, kwoty, daty, kontrahenci)
• Dane techniczne: logi dostępu, adresy IP, informacje o przeglądarce`,
        },
        {
            title: '3. Cel i podstawa prawna przetwarzania',
            content: `Przetwarzamy dane w następujących celach:
• Wykonanie umowy (art. 6 ust. 1 lit. b RODO) — świadczenie usług platformy KSeF Auto
• Obowiązek prawny (art. 6 ust. 1 lit. c RODO) — wystawianie faktur, rozliczenia podatkowe
• Prawnie uzasadniony interes (art. 6 ust. 1 lit. f RODO) — bezpieczeństwo systemu, wykrywanie nadużyć
• Zgoda (art. 6 ust. 1 lit. a RODO) — wysyłka newslettera i komunikatów marketingowych`,
        },
        {
            title: '4. Przekazywanie danych',
            content: `Dane mogą być przekazywane następującym podmiotom:
• Stripe Inc. — obsługa płatności (polityka prywatności: stripe.com/privacy)
• Amazon Web Services — infrastruktura serwerowa (serwery w UE)
• Ministerstwo Finansów / KSeF — w ramach autoryzowanych połączeń API
Nie sprzedajemy danych osobowych podmiotom trzecim.`,
        },
        {
            title: '5. Okres przechowywania danych',
            content: `• Dane konta: przez czas trwania umowy + 5 lat po jej zakończeniu (wymogi podatkowe)
• Faktury i dane KSeF: 5 lat od daty wystawienia faktury (zgodnie z ustawą o rachunkowości)
• Logi techniczne: 90 dni
• Dane marketingowe: do czasu cofnięcia zgody`,
        },
        {
            title: '6. Twoje prawa',
            content: `Przysługują Ci następujące prawa:
• Prawo dostępu do danych (art. 15 RODO)
• Prawo do sprostowania danych (art. 16 RODO)
• Prawo do usunięcia danych kontaktowych ("prawo do bycia zapomnianym", art. 17 RODO) — dotyczy danych osobowych (osoba kontaktowa, e-mail, telefon, notatki); faktury i dane rozliczeniowe podlegają obowiązkowi przechowywania wynikającemu z przepisów podatkowych (patrz pkt 5) i nie są usuwane na podstawie tego żądania
• Prawo do ograniczenia przetwarzania (art. 18 RODO)
• Prawo do przenoszenia danych (art. 20 RODO)
• Prawo do sprzeciwu (art. 21 RODO)
• Prawo wniesienia skargi do UODO (uodo.gov.pl)

Aby skorzystać z praw, skontaktuj się: kontakt@ksef.auto`,
        },
        {
            title: '7. Bezpieczeństwo',
            content: `Stosujemy następujące środki bezpieczeństwa:
• Szyfrowanie danych w transmisji (TLS 1.3)
• Szyfrowanie tokenów KSeF w bazie danych
• Hasła przechowywane jako skróty bcrypt (koszt 10)
• Izolacja danych między firmami (row-level security)
• Regularne kopie zapasowe bazy danych`,
        },
        {
            title: '8. Pliki cookie',
            content: `Używamy wyłącznie niezbędnych plików cookie:
• Cookie sesji (JWT w httpOnly cookie) — wymagane do logowania, wygasa po 7 dniach
• Nie używamy cookies analitycznych ani reklamowych bez Twojej zgody`,
        },
        {
            title: '9. Zmiany polityki',
            content: `O istotnych zmianach w polityce prywatności poinformujemy drogą e-mail z 30-dniowym wyprzedzeniem. Aktualna wersja jest zawsze dostępna pod adresem ksef.auto/privacy.`,
        },
    ];

    return (
        <div style={{ minHeight: '100vh', background: 'var(--bg-base)', color: 'var(--text)' }}>
            {/* Navbar */}
            <nav style={{ borderBottom: '1px solid var(--border)', padding: '0 40px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Zap size={16} color="#fff" strokeWidth={2.5} />
                    </div>
                    <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>KSeF Auto</span>
                </Link>
                <Link href="/" style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none' }}>← Powrót</Link>
            </nav>

            {/* Content */}
            <div style={{ maxWidth: 720, margin: '0 auto', padding: '56px 24px 80px' }}>
                <div style={{ marginBottom: 48 }}>
                    <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--accent-hover)', textTransform: 'uppercase', marginBottom: 12 }}>
                        Ostatnia aktualizacja: 17 marca 2026
                    </p>
                    <h1 style={{ fontSize: 36, fontWeight: 900, color: 'var(--text)', margin: '0 0 16px', letterSpacing: '-0.8px' }}>
                        Polityka Prywatności
                    </h1>
                    <p style={{ fontSize: 16, color: 'var(--text-muted)', lineHeight: 1.7, margin: 0 }}>
                        Szanujemy Twoją prywatność. Niniejsza polityka wyjaśnia, jakie dane zbieramy, w jakim celu i jak je chronimy, zgodnie z Rozporządzeniem (UE) 2016/679 (RODO).
                    </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {sections.map((section, i) => (
                        <div key={i} style={{ borderTop: '1px solid var(--border)', padding: '28px 0' }}>
                            <h2 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', margin: '0 0 14px', letterSpacing: '-0.3px' }}>
                                {section.title}
                            </h2>
                            <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.8, margin: 0, whiteSpace: 'pre-line' }}>
                                {section.content}
                            </p>
                        </div>
                    ))}
                </div>

                <div style={{ marginTop: 48, padding: '24px', background: 'var(--bg-surface)', borderRadius: 14, border: '1px solid var(--border)' }}>
                    <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0, lineHeight: 1.7 }}>
                        Pytania dotyczące prywatności? Napisz do nas:{' '}
                        <a href="mailto:kontakt@ksef.auto" style={{ color: 'var(--accent-hover)' }}>kontakt@ksef.auto</a>
                        {' '}lub skorzystaj z formularza kontaktowego na stronie głównej.
                    </p>
                </div>
            </div>

            {/* Footer */}
            <div style={{ borderTop: '1px solid var(--border)', padding: '20px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>KSeF Auto © 2026 · Automatyzacja KSeF dla biur rachunkowych</span>
                <div style={{ display: 'flex', gap: 20 }}>
                    <Link href="/privacy" style={{ fontSize: 12, color: 'var(--accent-hover)', textDecoration: 'none' }}>Polityka prywatności</Link>
                    <Link href="/terms" style={{ fontSize: 12, color: 'var(--text-subtle)', textDecoration: 'none' }}>Regulamin</Link>
                </div>
            </div>
        </div>
    );
}
