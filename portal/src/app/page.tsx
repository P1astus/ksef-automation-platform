import Link from 'next/link';
import PricingSection from './PricingSection';
import {
    Zap, Lock, Server, Shield, Building2,
    RefreshCw, FileBarChart2, Users, Bell, Database, Link2,
    CheckCircle, ArrowRight,
} from 'lucide-react';

const trustBadges = [
    { Icon: Lock,      text: 'Certyfikat SSL' },
    { Icon: Server,    text: 'Serwery w Polsce' },
    { Icon: Shield,    text: 'Zgodny z RODO' },
    { Icon: Building2, text: 'Integracja z KSeF MF' },
];

const features = [
    {
        Icon: RefreshCw,   color: 'var(--accent)',   dim: 'var(--accent-dim)',
        title: 'Automatyczne pobieranie faktur',
        desc: 'Faktury wszystkich Twoich klientów są pobierane z KSeF co godzinę — bez żadnej ingerencji. Działamy 24/7.',
    },
    {
        Icon: FileBarChart2, color: 'var(--success)', dim: 'var(--success-dim)',
        title: 'Raporty JPK jednym kliknięciem',
        desc: 'Generuj miesięczne pliki JPK_V7 dla dowolnego klienta. Pobierz XML gotowy do wysłania do urzędu.',
    },
    {
        Icon: Users,  color: 'var(--accent)',   dim: 'var(--accent-dim)',
        title: 'Multi-klient w jednym panelu',
        desc: 'Obsługuj dziesiątki klientów (NIP) z jednego miejsca. Filtruj, wyszukuj, zarządzaj dostępem.',
    },
    {
        Icon: Bell,     color: 'var(--warning)',   dim: 'var(--warning-dim)',
        title: 'Alerty i powiadomienia',
        desc: 'Natychmiastowe powiadomienia o błędach synchronizacji, nowych fakturach i problemach z KSeF.',
    },
    {
        Icon: Database, color: 'var(--error)',     dim: 'var(--error-dim)',
        title: 'Izolacja danych klientów',
        desc: 'Każde biuro widzi tylko swoje dane. Architektura multi-tenant z izolacją na poziomie bazy danych.',
    },
    {
        Icon: Link2,    color: '#06B6D4',            dim: 'rgba(6,182,212,0.1)',
        title: 'Bezpośrednia integracja z API KSeF',
        desc: 'Podpisywanie XML z XAdES, obsługa certyfikatów kwalifikowanych, pełna zgodność z API Ministerstwa Finansów.',
    },
];

const steps = [
    { n: '01', title: 'Zarejestruj biuro',       desc: 'Podaj nazwę firmy, adres e-mail i utwórz konto w 60 sekund.' },
    { n: '02', title: 'Dodaj klientów (NIP)',     desc: 'Wpisz numery NIP firm, które obsługujesz. Możesz wgrać listę CSV.' },
    { n: '03', title: 'System pracuje za Ciebie', desc: 'Automatyczne pobieranie faktur, generowanie JPK i alerty startują natychmiast.' },
];

const testimonials = [
    {
        quote: 'KSeF Auto zaoszczędził nam ponad 8 godzin tygodniowo. Wcześniej pobieranie faktur zajmowało cały poniedziałkowy poranek — teraz system robi to automatycznie.',
        name: 'Marta Kowalczyk', role: 'Właścicielka, Biuro Rachunkowe Kowalczyk', initials: 'MK',
    },
    {
        quote: 'Obsługa klientów KSeF była dla nas ogromnym wyzwaniem. Teraz zarządzamy 45 firmami z jednego miejsca i nigdy nie przegapiamy terminów JPK.',
        name: 'Tomasz Wiśniewski', role: 'Główny Księgowy, Kancelaria Finansowa APEX', initials: 'TW',
    },
    {
        quote: 'Alerty o zbliżających się terminach dla faktur offline uratowały nas przed karą niejednokrotnie. Polecam każdemu biuru rachunkowemu.',
        name: 'Anna Zielińska', role: 'Dyrektor, BookPro Sp. z o.o.', initials: 'AZ',
    },
];

const faqs = [
    { q: 'Czy muszę podawać kartę kredytową przy rejestracji?', a: 'Nie. Okres próbny przez 30 dni jest całkowicie bezpłatny i nie wymaga karty kredytowej. Płatność jest wymagana dopiero po zakończeniu okresu próbnego.' },
    { q: 'Jak bezpieczne są dane moich klientów?', a: 'Dane przechowywane są na serwerach w Polsce (zgodnie z RODO). Tokeny KSeF są szyfrowane w bazie danych. Komunikacja z KSeF odbywa się przez szyfrowane połączenie HTTPS z podpisem kryptograficznym XAdES-BES.' },
    { q: 'Co to jest KSeF i czy muszę go używać?', a: 'KSeF (Krajowy System e-Faktur) to obowiązkowy od 2026 roku system e-fakturowania MF. Każda firma w Polsce będzie zobligowana do wystawiania i odbierania faktur przez KSeF. Nasze biuro rachunkowe powinno być gotowe już teraz.' },
    { q: 'Jak długo trwa konfiguracja nowego klienta?', a: 'Dodanie klienta zajmuje mniej niż 5 minut. Wystarczy podać NIP firmy i token autoryzacyjny (lub certyfikat PKCS12). System automatycznie zacznie pobierać faktury w ciągu godziny.' },
    { q: 'Czy mogę eksportować dane do Optimy lub Symfonii?', a: 'Tak. Platforma obsługuje eksport do formatów Optima FK, Symfonia FK oraz Insert FK. Eksport CSV/Excel dostępny jest od planu Biznes.' },
    { q: 'Co się dzieje po zakończeniu okresu próbnego?', a: 'Po wygaśnięciu próby dostęp do panelu zostaje ograniczony. Twoje dane są bezpieczne i możesz je odzyskać w każdej chwili po wybraniu planu. Nie usuwamy danych bez Twojej zgody.' },
    { q: 'Czy system obsługuje tryb offline KSeF?', a: 'Tak. Platforma monitoruje terminy przesłania faktur wystawionych podczas awarii KSeF i wysyła alerty z wyprzedzeniem 4 godzin i 1 godziny przed upływem terminu.' },
    { q: 'Ile firm mogę obsługiwać na planie Start?', a: 'Plan Start umożliwia obsługę do 15 klientów (NIP). Jeśli potrzebujesz więcej, plan Biznes obsługuje do 50, a plan Pro — nieograniczoną liczbę klientów.' },
];

export default function LandingPage() {
    return (
        <div style={{ background: 'var(--bg-base)', minHeight: '100vh' }}>

            {/* ── NAVBAR ── */}
            <nav style={{
                position: 'sticky', top: 0, zIndex: 50,
                background: 'rgba(9,9,11,0.85)',
                backdropFilter: 'blur(14px)',
                borderBottom: '1px solid var(--border)',
            }}>
                <div style={{ maxWidth: 1160, margin: '0 auto', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 62 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                            width: 32, height: 32, borderRadius: 7,
                            background: 'var(--accent)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            <Zap size={16} color="#fff" strokeWidth={2.5} />
                        </div>
                        <span style={{ color: 'var(--text)', fontWeight: 800, fontSize: 18, letterSpacing: '-0.5px' }}>
                            KSeF<span style={{ color: 'var(--accent-hover)' }}>Auto</span>
                        </span>
                    </div>
                    <div style={{ display: 'flex', gap: 28, alignItems: 'center' }}>
                        <a href="#features" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: 14, fontWeight: 500 }}>Funkcje</a>
                        <a href="#pricing" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: 14, fontWeight: 500 }}>Cennik</a>
                        <Link href="/demo" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: 14, fontWeight: 500 }}>Demo</Link>
                        <Link href="/login" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: 14, fontWeight: 500 }}>Zaloguj się</Link>
                        <Link href="/register" className="btn-primary" style={{ padding: '7px 18px', fontSize: 13 }}>
                            Wypróbuj za darmo
                        </Link>
                    </div>
                </div>
            </nav>

            {/* ── HERO ── */}
            <section style={{
                padding: '110px 24px 90px',
                textAlign: 'center',
                position: 'relative',
                overflow: 'hidden',
            }}>
                {/* Single indigo beam */}
                <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'radial-gradient(ellipse 80% 55% at 50% -5%, rgba(99,102,241,0.22) 0%, transparent 68%)',
                    pointerEvents: 'none',
                }} />

                <div style={{ position: 'relative', maxWidth: 780, margin: '0 auto' }}>
                    {/* Badge */}
                    <div style={{
                        display: 'inline-flex', alignItems: 'center', gap: 7,
                        background: 'var(--accent-dim)', border: '1px solid rgba(99,102,241,0.3)',
                        borderRadius: 100, padding: '5px 14px', marginBottom: 28,
                    }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)', flexShrink: 0 }} />
                        <span style={{ color: 'var(--accent-hover)', fontSize: 12.5, fontWeight: 500 }}>
                            Zgodny z KSeF 2.0 · Gotowy na obowiązkowy e-fakturing
                        </span>
                    </div>

                    <h1 style={{
                        color: 'var(--text)',
                        fontSize: 'clamp(36px, 5vw, 58px)',
                        fontWeight: 900, lineHeight: 1.08, letterSpacing: '-0.03em',
                        margin: '0 0 22px',
                    }}>
                        Automatyzacja KSeF<br />
                        <span style={{
                            background: 'linear-gradient(135deg, #818CF8 0%, #C4B5FD 100%)',
                            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
                        }}>dla biur rachunkowych</span>
                    </h1>

                    <p style={{
                        color: 'var(--text-muted)', fontSize: 17.5, lineHeight: 1.75,
                        margin: '0 auto 40px', maxWidth: 580,
                    }}>
                        Pobierz faktury wszystkich klientów z KSeF automatycznie. Generuj raporty JPK jednym kliknięciem.
                        Skalujesz biuro — my skalujemy system.
                    </p>

                    <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
                        <Link href="/register" style={{
                            display: 'inline-flex', alignItems: 'center', gap: 8,
                            background: 'var(--accent)', color: 'white', textDecoration: 'none',
                            padding: '15px 30px', borderRadius: 9, fontSize: 15.5, fontWeight: 700,
                            boxShadow: '0 0 28px var(--accent-glow)',
                            transition: 'all 0.15s ease',
                        }}>
                            Rozpocznij za darmo
                            <ArrowRight size={16} strokeWidth={2.5} />
                        </Link>
                        <Link href="/demo" style={{
                            display: 'inline-flex', alignItems: 'center', gap: 8,
                            background: 'transparent', color: 'var(--text-muted)', textDecoration: 'none',
                            padding: '15px 30px', borderRadius: 9, fontSize: 15.5, fontWeight: 600,
                            border: '1px solid var(--border)',
                            transition: 'all 0.15s ease',
                        }}>
                            Zobaczyć demo
                        </Link>
                    </div>

                    {/* Trust badges */}
                    <div style={{ marginTop: 52, display: 'flex', gap: 28, justifyContent: 'center', flexWrap: 'wrap' }}>
                        {trustBadges.map(({ Icon, text }) => (
                            <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                                <Icon size={14} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
                                <span style={{ color: 'var(--text-subtle)', fontSize: 13, fontWeight: 500 }}>{text}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── STATS BAND ── */}
            <section style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
                <div style={{ maxWidth: 1000, margin: '0 auto', padding: '36px 24px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0 }}>
                    {[
                        { value: '10 000+', label: 'Faktur pobranych miesięcznie' },
                        { value: '< 5 min', label: 'Czas konfiguracji klienta' },
                        { value: '99.9%',   label: 'Dostępność systemu (SLA)' },
                        { value: '0 zł',    label: 'Opłata za wdrożenie' },
                    ].map((s, i) => (
                        <div key={i} style={{
                            textAlign: 'center', padding: '16px 24px',
                            borderRight: i < 3 ? '1px solid var(--border)' : 'none',
                        }}>
                            <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.04em' }}>{s.value}</div>
                            <div style={{ fontSize: 12.5, color: 'var(--text-subtle)', marginTop: 4, fontWeight: 500 }}>{s.label}</div>
                        </div>
                    ))}
                </div>
            </section>

            {/* ── FEATURES ── */}
            <section id="features" style={{ padding: '96px 24px' }}>
                <div style={{ maxWidth: 1100, margin: '0 auto' }}>
                    <div style={{ textAlign: 'center', marginBottom: 60 }}>
                        <div className="label-caps" style={{ marginBottom: 12, color: 'var(--accent-hover)' }}>Funkcje platformy</div>
                        <h2 style={{ fontSize: 38, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.03em', margin: '0 0 14px' }}>
                            Wszystko czego potrzebuje biuro rachunkowe
                        </h2>
                        <p style={{ color: 'var(--text-muted)', fontSize: 16, maxWidth: 520, margin: '0 auto', lineHeight: 1.75 }}>
                            Od pobrania faktur, przez JPK, po alerty — zarządzasz wszystkim z jednego panelu.
                        </p>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: 16 }}>
                        {features.map((f) => (
                            <div key={f.title} style={{
                                background: 'var(--bg-surface)', borderRadius: 12, padding: '24px',
                                border: '1px solid var(--border)',
                                transition: 'border-color 0.15s ease, background 0.15s ease',
                            }}>
                                <div style={{
                                    width: 42, height: 42, borderRadius: 9, background: f.dim,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    marginBottom: 16, color: f.color, flexShrink: 0,
                                }}>
                                    <f.Icon size={19} strokeWidth={2} />
                                </div>
                                <h3 style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--text)', margin: '0 0 9px' }}>{f.title}</h3>
                                <p style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.7, margin: 0 }}>{f.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── HOW IT WORKS ── */}
            <section style={{ padding: '96px 24px', borderTop: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
                <div style={{ maxWidth: 860, margin: '0 auto', textAlign: 'center' }}>
                    <div className="label-caps" style={{ marginBottom: 12, color: 'var(--accent-hover)' }}>Jak to działa</div>
                    <h2 style={{ fontSize: 36, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.03em', margin: '0 0 60px' }}>
                        Wdrożenie w 3 krokach
                    </h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 40 }}>
                        {steps.map((s) => (
                            <div key={s.n}>
                                <div style={{
                                    width: 52, height: 52, borderRadius: 12,
                                    background: 'var(--accent-dim)',
                                    border: '1px solid rgba(99,102,241,0.25)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    margin: '0 auto 16px',
                                }}>
                                    <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--accent-hover)' }}>{s.n}</span>
                                </div>
                                <div className="label-caps" style={{ marginBottom: 8, color: 'var(--accent-hover)' }}>Krok {s.n}</div>
                                <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', margin: '0 0 10px' }}>{s.title}</h3>
                                <p style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.7, margin: 0 }}>{s.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── TESTIMONIALS ── */}
            <section style={{ padding: '96px 24px', borderTop: '1px solid var(--border)' }}>
                <div style={{ maxWidth: 1100, margin: '0 auto' }}>
                    <div style={{ textAlign: 'center', marginBottom: 52 }}>
                        <div className="label-caps" style={{ marginBottom: 12, color: 'var(--accent-hover)' }}>Opinie klientów</div>
                        <h2 style={{ fontSize: 36, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.03em', margin: 0 }}>Zaufali nam</h2>
                    </div>

                    {/* Logo band */}
                    <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 52 }}>
                        {['Biuro Rachunkowe Kowalski', 'Kancelaria Finansowa APEX', 'BookPro Sp. z o.o.', 'Rachunki24.pl', 'Tax Partners Sp. k.'].map((name) => (
                            <div key={name} style={{
                                padding: '6px 16px', background: 'var(--bg-surface)',
                                border: '1px solid var(--border)', borderRadius: 7,
                                fontSize: 12.5, fontWeight: 600, color: 'var(--text-subtle)',
                            }}>
                                {name}
                            </div>
                        ))}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                        {testimonials.map((t) => (
                            <div key={t.name} style={{
                                background: 'var(--bg-surface)', borderRadius: 12, padding: '26px',
                                border: '1px solid var(--border)',
                            }}>
                                <div style={{ color: 'var(--accent)', fontSize: 32, marginBottom: 12, lineHeight: 1, fontFamily: 'Georgia, serif' }}>"</div>
                                <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.75, margin: '0 0 22px', fontStyle: 'italic' }}>
                                    {t.quote}
                                </p>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                                    <div style={{
                                        width: 36, height: 36, borderRadius: '50%',
                                        background: 'var(--accent-dim)', border: '1px solid rgba(99,102,241,0.3)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        color: 'var(--accent-hover)', fontSize: 12, fontWeight: 700, flexShrink: 0,
                                    }}>{t.initials}</div>
                                    <div>
                                        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{t.name}</div>
                                        <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>{t.role}</div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── FAQ ── */}
            <section style={{ padding: '80px 24px', borderTop: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
                <div style={{ maxWidth: 700, margin: '0 auto' }}>
                    <div style={{ textAlign: 'center', marginBottom: 48 }}>
                        <div className="label-caps" style={{ marginBottom: 12, color: 'var(--accent-hover)' }}>FAQ</div>
                        <h2 style={{ fontSize: 36, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.03em', margin: 0 }}>Najczęstsze pytania</h2>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {faqs.map((faq, i) => (
                            <details key={i} style={{
                                background: 'var(--bg-base)', borderRadius: 9,
                                border: '1px solid var(--border)', overflow: 'hidden',
                            }}>
                                <summary style={{
                                    padding: '16px 18px', fontSize: 14.5, fontWeight: 600,
                                    color: 'var(--text)', cursor: 'pointer', listStyle: 'none',
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                }}>
                                    {faq.q}
                                    <span style={{ color: 'var(--accent)', flexShrink: 0, marginLeft: 12, fontSize: 18, lineHeight: 1 }}>+</span>
                                </summary>
                                <div style={{ padding: '0 18px 16px', fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.75 }}>
                                    {faq.a}
                                </div>
                            </details>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── PRICING ── */}
            <section id="pricing" style={{ padding: '96px 24px', borderTop: '1px solid var(--border)' }}>
                <PricingSection />
            </section>

            {/* ── CTA BANNER ── */}
            <section style={{
                padding: '80px 24px', textAlign: 'center',
                borderTop: '1px solid var(--border)', background: 'var(--bg-surface)',
                position: 'relative', overflow: 'hidden',
            }}>
                <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'radial-gradient(ellipse 60% 80% at 50% 50%, rgba(99,102,241,0.1) 0%, transparent 70%)',
                    pointerEvents: 'none',
                }} />
                <div style={{ position: 'relative', maxWidth: 660, margin: '0 auto' }}>
                    <h2 style={{ color: 'var(--text)', fontSize: 38, fontWeight: 800, letterSpacing: '-0.03em', margin: '0 0 14px' }}>
                        Gotowy, żeby zautomatyzować KSeF?
                    </h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: 17, lineHeight: 1.75, margin: '0 0 34px' }}>
                        Dołącz do biur rachunkowych, które już zaoszczędziły dziesiątki godzin miesięcznie.
                        Pierwsze 30 dni całkowicie za darmo.
                    </p>
                    <Link href="/register" style={{
                        display: 'inline-flex', alignItems: 'center', gap: 8,
                        background: 'var(--accent)', color: 'white', textDecoration: 'none',
                        padding: '15px 36px', borderRadius: 9, fontSize: 16, fontWeight: 700,
                        boxShadow: '0 0 32px var(--accent-glow)',
                    }}>
                        <Zap size={16} strokeWidth={2.5} />
                        Zacznij już teraz — 60 sekund
                    </Link>
                </div>
            </section>

            {/* ── FOOTER ── */}
            <footer style={{ borderTop: '1px solid var(--border)', padding: '32px 24px' }}>
                <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                            width: 26, height: 26, borderRadius: 6,
                            background: 'var(--accent)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            <Zap size={13} color="#fff" strokeWidth={2.5} />
                        </div>
                        <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: 15, letterSpacing: '-0.2px' }}>
                            KSeF<span style={{ color: 'var(--accent-hover)' }}>Auto</span>
                        </span>
                    </div>
                    <div style={{ display: 'flex', gap: 24 }}>
                        <a href="#features" style={{ color: 'var(--text-subtle)', textDecoration: 'none', fontSize: 13 }}>Funkcje</a>
                        <a href="#pricing"  style={{ color: 'var(--text-subtle)', textDecoration: 'none', fontSize: 13 }}>Cennik</a>
                        <Link href="/login" style={{ color: 'var(--text-subtle)', textDecoration: 'none', fontSize: 13 }}>Zaloguj się</Link>
                        <Link href="/demo"  style={{ color: 'var(--text-subtle)', textDecoration: 'none', fontSize: 13 }}>Demo</Link>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                        © 2025 KSeF Auto · Polityka prywatności · Regulamin
                    </div>
                </div>
            </footer>

        </div>
    );
}
