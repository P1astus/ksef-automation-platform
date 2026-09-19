import Link from 'next/link';
import { Zap } from 'lucide-react';

export default function TermsPage() {
    const sections = [
        {
            title: '1. Definicje',
            content: `• „Platforma" — serwis KSeF Auto dostępny pod adresem ksef.auto oraz powiązane API
• „Usługodawca" — KSeF Auto, świadczący usługi automatyzacji KSeF
• „Użytkownik" — biuro rachunkowe lub przedsiębiorca, który zawarł umowę z Usługodawcą
• „Klient" — podmiot, którego dane fakturowe są przetwarzane przez Użytkownika za pośrednictwem Platformy
• „KSeF" — Krajowy System e-Faktur, prowadzony przez Ministerstwo Finansów RP
• „Plan" — wybrany przez Użytkownika pakiet usług (Start, Biznes lub Pro)`,
        },
        {
            title: '2. Zawarcie umowy',
            content: `Umowa między Użytkownikiem a Usługodawcą zostaje zawarta w chwili:
• Rejestracji konta i akceptacji niniejszego Regulaminu oraz Polityki Prywatności, lub
• Pierwszego logowania po aktywacji konta przez administratora

Użytkownik musi być osobą pełnoletnią, uprawnioną do reprezentowania firmy lub biura rachunkowego. Konto może być założone wyłącznie przez podmioty prowadzące działalność gospodarczą w Polsce i posiadające aktywny numer NIP.`,
        },
        {
            title: '3. Zakres usług',
            content: `Platforma KSeF Auto świadczy następujące usługi:
• Automatyczne pobieranie faktur z KSeF w imieniu Klientów Użytkownika (na podstawie przechowywanych tokenów autoryzacyjnych)
• Przechowywanie i kategoryzacja faktur (sprzedaż/zakup) w bezpiecznej bazie danych
• Eksport faktur do formatów obsługiwanych przez systemy FK (Comarch ERP Optima, Symfonia ERP, Insert)
• Zarządzanie konfiguracją tokenów KSeF dla poszczególnych klientów
• Dostęp do panelu analitycznego i raportów

Usługodawca nie świadczy usług doradztwa podatkowego ani prawnego. Odpowiedzialność za prawidłowość rozliczeń spoczywa na Użytkowniku.`,
        },
        {
            title: '4. Plany i płatności',
            content: `Dostępne plany subskrypcyjne:
• Start — 149 PLN/mies. — do 15 klientów KSeF (odczyt i raportowanie: synchronizacja faktur, JPK_V7M, alerty e-mail)
• Biznes — 399 PLN/mies. — do 50 klientów KSeF (dodatkowo: wystawianie i wysyłka faktur do KSeF, eksporty do systemów księgowych, klasyfikacja AI, zarządzanie zespołem)
• Pro — 799 PLN/mies. — do 999 klientów KSeF (funkcje planu Biznes)

Płatności są obsługiwane przez Stripe Inc. Opłaty są pobierane z góry za każdy okres rozliczeniowy (miesięcznie lub rocznie). Faktury VAT za subskrypcję są wysyłane automatycznie na adres e-mail konta.

Okres próbny: 14 dni od rejestracji (bez karty płatniczej). Po upływie okresu próbnego dostęp do Platformy wymaga aktywnego planu.`,
        },
        {
            title: '5. Rezygnacja i zwroty',
            content: `• Użytkownik może zrezygnować z subskrypcji w dowolnym momencie z poziomu panelu (Rozliczenia → Anuluj subskrypcję)
• Po rezygnacji dostęp pozostaje aktywny do końca opłaconego okresu rozliczeniowego
• Zwroty: w przypadku problemów technicznych po stronie Platformy trwających ponad 24h, Użytkownik może ubiegać się o proporcjonalny zwrot kosztów — wniosek należy złożyć na kontakt@ksef.auto w ciągu 14 dni
• Brak zwrotów za niewykorzystanie usługi w opłaconym okresie`,
        },
        {
            title: '6. Obowiązki Użytkownika',
            content: `Użytkownik zobowiązuje się do:
• Korzystania z Platformy wyłącznie w celach zgodnych z prawem polskim i unijnym
• Posiadania odpowiednich pełnomocnictw od swoich Klientów do pobierania faktur z KSeF w ich imieniu
• Nieudostępniania danych logowania osobom trzecim (każdy pracownik powinien mieć osobne konto)
• Niezwłocznego powiadamiania Usługodawcy o podejrzeniu naruszenia bezpieczeństwa konta
• Aktualizacji danych firmy w przypadku ich zmiany (NIP, adres, e-mail kontaktowy)
• Niepodejmowania prób obejścia mechanizmów zabezpieczeń, limitów API ani systemów rozliczeniowych`,
        },
        {
            title: '7. Odpowiedzialność i gwarancje',
            content: `Usługodawca:
• Nie ponosi odpowiedzialności za niedostępność API KSeF po stronie Ministerstwa Finansów
• Nie ponosi odpowiedzialności za straty wynikające z błędów w danych pobranych z KSeF
• Nie ponosi odpowiedzialności za szkody pośrednie, utracone korzyści ani szkody wynikające z przerwy w działalności

Maksymalna łączna odpowiedzialność Usługodawcy wobec Użytkownika nie może przekroczyć kwoty opłat uiszczonych przez Użytkownika w ciągu ostatnich 3 miesięcy.`,
        },
        {
            title: '8. Poufność i bezpieczeństwo',
            content: `Usługodawca zobowiązuje się do:
• Zachowania w tajemnicy wszystkich danych fakturowych przetwarzanych w imieniu Użytkownika
• Stosowania szyfrowania TLS 1.3 w transmisji danych
• Szyfrowania tokenów KSeF w bazie danych
• Nieudostępniania danych Użytkownika ani jego Klientów podmiotom trzecim, z wyjątkiem wskazanych w Polityce Prywatności
• Niezwłocznego powiadamiania Użytkownika (w ciągu 72h) o wykryciu naruszenia bezpieczeństwa danych

Dane fakturowe są izolowane między kontami (row-level security) — żaden Użytkownik nie ma dostępu do danych innego Użytkownika.`,
        },
        {
            title: '9. Własność intelektualna',
            content: `• Platforma, jej kod źródłowy, projekt graficzny, dokumentacja i API stanowią wyłączną własność Usługodawcy
• Użytkownik otrzymuje niewyłączną, niezbywalną licencję na korzystanie z Platformy wyłącznie na własne potrzeby operacyjne biura rachunkowego
• Zabrania się kopiowania, modyfikowania, dekompilowania, odtwarzania kodu źródłowego ani tworzenia produktów pochodnych na bazie Platformy
• Dane fakturowe wprowadzone przez Użytkownika pozostają własnością Użytkownika i jego Klientów`,
        },
        {
            title: '10. Zmiany Regulaminu',
            content: `Usługodawca zastrzega sobie prawo do zmiany Regulaminu z następującymi zasadami:
• Użytkownik zostanie poinformowany e-mailem o zmianach z co najmniej 30-dniowym wyprzedzeniem
• Zmiany wchodzą w życie z datą wskazaną w powiadomieniu
• Kontynuowanie korzystania z Platformy po dacie wejścia zmian oznacza akceptację nowego Regulaminu
• W przypadku braku akceptacji Użytkownik może zrezygnować z usługi bez dodatkowych opłat przed datą wejścia zmian w życie

Aktualny Regulamin jest zawsze dostępny pod adresem ksef.auto/terms.`,
        },
        {
            title: '11. Rozwiązanie umowy',
            content: `Usługodawca może rozwiązać umowę ze skutkiem natychmiastowym w przypadku:
• Naruszenia przez Użytkownika postanowień Regulaminu
• Podejrzenia wykorzystania Platformy do działań niezgodnych z prawem
• Zaległości w płatnościach przekraczającej 14 dni

Po rozwiązaniu umowy Użytkownik ma 30 dni na pobranie swoich danych (eksport). Po tym czasie dane zostaną trwale usunięte, z wyjątkiem danych wymaganych przepisami prawa (faktury — 5 lat).`,
        },
        {
            title: '12. Prawo właściwe i spory',
            content: `• Niniejszy Regulamin podlega prawu polskiemu
• Wszelkie spory będą rozstrzygane przez sąd właściwy dla siedziby Usługodawcy
• Przed skierowaniem sprawy do sądu strony zobowiązują się do podjęcia próby polubownego rozwiązania sporu w ciągu 30 dni od zgłoszenia reklamacji
• Reklamacje należy kierować na: kontakt@ksef.auto — odpowiedź w ciągu 14 dni roboczych`,
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
                        Regulamin Usługi
                    </h1>
                    <p style={{ fontSize: 16, color: 'var(--text-muted)', lineHeight: 1.7, margin: 0 }}>
                        Niniejszy Regulamin określa warunki korzystania z platformy KSeF Auto — usługi automatyzacji Krajowego Systemu e-Faktur dla biur rachunkowych i przedsiębiorców.
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
                        Pytania dotyczące Regulaminu? Skontaktuj się z nami:{' '}
                        <a href="mailto:kontakt@ksef.auto" style={{ color: 'var(--accent-hover)' }}>kontakt@ksef.auto</a>
                        {' '}lub skorzystaj z formularza kontaktowego na stronie głównej.
                    </p>
                </div>
            </div>

            {/* Footer */}
            <div style={{ borderTop: '1px solid var(--border)', padding: '20px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>KSeF Auto © 2026 · Automatyzacja KSeF dla biur rachunkowych</span>
                <div style={{ display: 'flex', gap: 20 }}>
                    <Link href="/privacy" style={{ fontSize: 12, color: 'var(--text-subtle)', textDecoration: 'none' }}>Polityka prywatności</Link>
                    <Link href="/terms" style={{ fontSize: 12, color: 'var(--accent-hover)', textDecoration: 'none' }}>Regulamin</Link>
                </div>
            </div>
        </div>
    );
}
