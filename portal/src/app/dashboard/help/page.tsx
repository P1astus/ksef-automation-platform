import Link from 'next/link';
import { PLANS, PLAN_FEATURES } from '@/lib/plans';
import { capabilities } from '@/lib/deployment';

// Static help/FAQ. Every statement here describes behaviour that exists in the
// portal today - keep it that way (no "coming soon", no legal advice). Plan
// facts are derived from plans.ts so they cannot drift from what is enforced.

const paidPlans = PLANS.filter(p => PLAN_FEATURES[p.id].length > 0).map(p => p.name).join(' i ');
const startPlan = PLANS.find(p => p.id === 'start');

// Runtime configuration, not build-time: without this Next prerenders the page once at build and bakes the hosted
// edition's help (billing links, plans section) into every install.
export const dynamic = 'force-dynamic';

// Billing exists only where Stripe is the billing provider. A local install has no billing page, so a link to it
// would be a dead 404 - render the words without the link.
function BillingLink({ children }: { children: React.ReactNode }) {
    return capabilities().billingProvider === 'stripe' ? <Link href="/dashboard/billing">{children}</Link> : <>{children}</>;
}

interface Item { q: string; a: React.ReactNode }
interface Section { title: string; items: Item[] }

const SECTIONS: Section[] = [
    {
        title: 'Pierwsze kroki',
        items: [
            {
                q: 'Od czego zacząć?',
                a: <>Dodaj klienta w zakładce <Link href="/dashboard/clients">Klienci</Link> (wystarczy NIP i nazwa), następnie skonfiguruj jego dostęp do KSeF w zakładce <Link href="/dashboard/settings/ksef">Tokeny KSeF</Link>. Po zapisaniu danych dostępowych możesz uruchomić synchronizację faktur na stronie klienta.</>,
            },
            {
                q: 'Co oznacza „klient” w systemie?',
                a: <>Klient to firma, której faktury obsługuje Twoje biuro rachunkowe. Każdy klient jest identyfikowany numerem NIP, a wszystkie dane są widoczne wyłącznie dla Twojego biura.</>,
            },
            {
                q: 'Ile klientów mogę dodać?',
                a: <>Limit zależy od planu i jest egzekwowany na serwerze — dotyczy też klientów tworzonych automatycznie (np. z rozpoznawania dokumentów lub poczty). Szczegóły w zakładce <BillingLink>Rozliczenia</BillingLink>.</>,
            },
        ],
    },
    {
        title: 'Dostęp do KSeF (token i certyfikat)',
        items: [
            {
                q: 'Jak podłączyć klienta do KSeF?',
                a: <>W zakładce Tokeny KSeF wybierz klienta i metodę uwierzytelniania: <strong>Token API</strong> albo <strong>Certyfikat PKCS12 (.p12)</strong> wraz z hasłem. Token wygenerujesz w panelu KSeF: Zarządzanie tokenami → Wygeneruj token.</>,
            },
            {
                q: 'Jak sprawdzić, czy połączenie działa?',
                a: <>Po zapisaniu danych ekran pokazuje wynik sprawdzenia połączenia z KSeF. Jeśli zobaczysz błąd, sprawdź, czy token nie wygasł i czy został wygenerowany dla właściwego NIP.</>,
            },
            {
                q: 'Czy system pracuje na środowisku produkcyjnym KSeF?',
                a: <>Ta instalacja działa obecnie na środowisku testowym KSeF. Przejście na produkcję wymaga osobnej konfiguracji po stronie administratora.</>,
            },
        ],
    },
    {
        title: 'Faktury',
        items: [
            {
                q: 'Jak pobierać faktury z KSeF?',
                a: <>Wejdź na stronę klienta i uruchom synchronizację. System pobiera tylko nowe faktury od ostatniej udanej synchronizacji — nie pobiera wszystkiego od początku.</>,
            },
            {
                q: 'Jak wystawić fakturę?',
                a: <>W zakładce Faktury użyj przycisku „Wystaw fakturę”. Formularz wymaga adresu sprzedawcy (uzupełnisz go na stronie klienta) i adresu nabywcy, a numery NIP muszą mieć poprawny format — bez tego faktura zostanie odrzucona jeszcze przed zapisem, ponieważ nie przeszłaby walidacji schematu FA(3). Stawki zwolnione (zw) wymagają wskazania podstawy zwolnienia.</>,
            },
            {
                q: 'Jak wystawić fakturę korygującą?',
                a: <>Otwórz podgląd faktury i użyj przycisku „Wystaw korektę”. Formularz otworzy się z kopią pozycji oryginału — zmień je na stan po korekcie i podaj przyczynę korekty.</>,
            },
            {
                q: 'Co oznaczają statusy faktur?',
                a: <>„Wysłana do KSeF” — faktura przyjęta do przetwarzania. „Odrzucona przez KSeF” — na stronie podglądu zobaczysz powód podany przez KSeF. „Uwzględniona w JPK” — faktura weszła do wygenerowanego raportu JPK. Odrzucona faktura nie zmienia statusu przy generowaniu JPK.</>,
            },
            {
                q: 'Co dzieje się z dokumentami przesłanymi przez klienta lub pocztą?',
                a: <>Trafiają do „Kolejki weryfikacji OCR” (przycisk w zakładce Faktury). Nic nie jest księgowane automatycznie — każdy dokument zatwierdzasz lub odrzucasz ręcznie. Klientowi możesz wysłać e-mailem link do przesłania dokumentów ze strony klienta.</>,
            },
        ],
    },
    {
        title: 'Tryby offline i terminy',
        items: [
            {
                q: 'Jakie są tryby offline?',
                a: <>Przy wystawianiu faktury możesz wskazać: <strong>Offline-24</strong> (przerwa w działaniu KSeF), <strong>niedostępność KSeF (planowana)</strong>, <strong>awarię KSeF</strong> oraz <strong>całkowitą awarię</strong>.</>,
            },
            {
                q: 'Jak liczony jest termin przesłania faktury offline?',
                a: <>Termin to koniec najbliższego dnia roboczego po dacie wystawienia; system uwzględnia polskie dni wolne od pracy. Faktura offline trafia do kolejki faktur offline, skąd przesyłasz ją do KSeF, gdy tylko jest to możliwe.</>,
            },
            {
                q: 'Kto dostaje ostrzeżenia o zbliżającym się terminie?',
                a: <>System wysyła alerty wewnętrzne oraz — osobno — e-maile do klienta: na 4 godziny i 1 godzinę przed terminem oraz po jego przekroczeniu. Alerty e-mail są wysyłane tylko wtedy, gdy po stronie administratora skonfigurowano dostawcę poczty. Nie polegaj wyłącznie na alertach — termin przesłania faktury to obowiązek prawny.</>,
            },
            {
                q: 'Czy mogę wysłać fakturę offline po zmianie lub wygaśnięciu planu?',
                a: <>Tak — faktura z otwartym terminem offline może zostać wysłana nawet wtedy, gdy plan nie obejmuje już wystawiania faktur. Dotyczy to wyłącznie takich faktur.</>,
            },
        ],
    },
    {
        title: 'JPK_V7M',
        items: [
            {
                q: 'Jak wygenerować JPK_V7M?',
                a: <>W zakładce <Link href="/dashboard/jpk">JPK V7M</Link> wybierz klienta i okres, a następnie wygeneruj raport. Zakupy bez przypisanej kategorii trafiają do pól K_42/K_43 (pozostałe nabycia), a nie do środków trwałych.</>,
            },
            {
                q: 'Czy raport jest wysyłany do urzędu skarbowego?',
                a: <>Nie. System przygotowuje plik i podsumowanie; wysłanie deklaracji do urzędu pozostaje po Twojej stronie. Przed wysyłką sprawdź kwoty, zwłaszcza dla faktur bez szczegółowych pozycji (pobranych z KSeF).</>,
            },
        ],
    },
    {
        title: 'Eksport do programów księgowych',
        items: [
            {
                q: 'Do jakich programów mogę wyeksportować faktury?',
                a: <>Dostępne formaty: Optima (XML), Symfonia (TXT), INSERT (EPP) oraz CSV. Przed pierwszym użyciem w pracy produkcyjnej zaimportuj przykładowy plik do swojego programu — układ kolumn i kodowanie mają znaczenie.</>,
            },
            {
                q: 'Dlaczego eksport jest niedostępny?',
                a: <>Eksport wymaga planu {paidPlans}. W planie {startPlan?.name ?? 'Start'} dostępne są synchronizacja, JPK_V7M i alerty e-mail.</>,
            },
        ],
    },
    {
        title: 'Plany i płatności',
        items: [
            {
                q: 'Czym różnią się plany?',
                a: <>Plan {startPlan?.name ?? 'Start'} jest planem monitorowania i raportowania (tylko odczyt). Wystawianie faktur, tryby offline, wysyłka do KSeF, eksporty, klasyfikacja AI oraz zaproszenia zespołu wymagają planu {paidPlans}. Aktualne ceny i limity klientów znajdziesz w <BillingLink>Rozliczeniach</BillingLink>.</>,
            },
            {
                q: 'Jak długi jest okres próbny?',
                a: <>14 dni od rejestracji. W okresie próbnym obowiązują funkcje planu wybranego przy rejestracji.</>,
            },
            {
                q: 'Co się stanie, gdy subskrypcja wygaśnie?',
                a: <>Po anulowaniu, wstrzymaniu lub zakończeniu okresu próbnego dostęp jest blokowany do czasu wybrania planu. Przy zaległej płatności dostęp jest na razie zachowany. Komunikat „Subskrypcja jest nieaktywna” oznacza, że trzeba wybrać plan w zakładce Rozliczenia.</>,
            },
        ],
    },
    {
        title: 'Zespół i dane',
        items: [
            {
                q: 'Jak dodać współpracownika?',
                a: <>W zakładce <Link href="/dashboard/settings/team">Zespół</Link> wyślij zaproszenie e-mailem i wybierz rolę. Rola „tylko odczyt” nie pozwala na zmiany danych. Zaproszenia są dostępne w planie {paidPlans}.</>,
            },
            {
                q: 'Jak usunąć dane kontaktowe klienta (RODO)?',
                a: <>Na stronie klienta użyj opcji usunięcia danych kontaktowych. Usuwane są wyłącznie dane CRM klienta; treść faktur pozostaje, ponieważ wynika to z obowiązku ich przechowywania.</>,
            },
        ],
    },
];

export default function HelpPage() {
    // No plans, trial or payments in an install without billing: hide that whole section rather than describe a paywall.
    const billing = capabilities().billingProvider === 'stripe';
    const sections = SECTIONS.filter(section => billing || section.title !== 'Plany i płatności');
    return (
        <div style={{ maxWidth: 820, padding: '28px 0' }}>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', margin: '0 0 4px', letterSpacing: '-0.5px' }}>Pomoc</h1>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 28px' }}>
                Najczęstsze pytania o konfigurację, faktury, tryby offline, eksporty i plany. To opis działania systemu, nie porada prawna ani podatkowa.
            </p>

            {sections.map(section => (
                <section key={section.title} style={{ marginBottom: 28 }}>
                    <div className="label-caps" style={{ marginBottom: 10 }}>{section.title}</div>
                    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                        {section.items.map((item, i) => (
                            <details key={item.q} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)', padding: '14px 18px' }}>
                                <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{item.q}</summary>
                                <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.6, color: 'var(--text-muted)' }}>{item.a}</div>
                            </details>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}
