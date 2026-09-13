'use client';

import { useState } from 'react';
import Link from 'next/link';

const PLANS = [
    {
        id: 'start',
        name: 'Start',
        monthly: 149,
        annual: 119,
        desc: 'Idealne dla małych biur. Automatyzacja KSeF dla do 15 klientów.',
        highlight: false,
        features: [
            'Do 15 klientów (NIP)',
            'Pobieranie faktur z KSeF',
            'Generowanie JPK_V7M',
            'Alerty e-mail',
            'Wsparcie e-mail',
        ],
    },
    {
        id: 'biznes',
        name: 'Biznes',
        monthly: 399,
        annual: 319,
        desc: 'Dla rozwijających się biur. Pełna automatyzacja z wysyłką faktur i AI.',
        highlight: true,
        badge: 'Najpopularniejszy',
        features: [
            'Do 50 klientów (NIP)',
            'Pobieranie faktur w czasie rzeczywistym',
            'Wysyłka faktur do KSeF',
            'JPK_V7M + JPK_FA',
            'Klasyfikacja AI kosztów',
            'Zarządzanie zespołem',
            'Eksport CSV / Optima / Symfonia',
        ],
    },
    {
        id: 'pro',
        name: 'Pro',
        monthly: 799,
        annual: 639,
        desc: 'Nieograniczona skalowalność. Dedykowany opiekun i SLA dla dużych biur.',
        highlight: false,
        features: [
            'Nieograniczona liczba klientów',
            'Wszystkie funkcje Biznes',
            'API do integracji z systemami FK',
            'Dedykowany opiekun klienta',
            'SLA 99.9% z gwarancją',
            'White-label (własna domena)',
        ],
    },
];

export default function PricingSection() {
    const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly');

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 48 }}>
                <div style={{ color: '#3b7ff5', fontSize: 13, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>Cennik</div>
                <h2 style={{ fontSize: 40, fontWeight: 800, color: '#0f172a', letterSpacing: '-1.5px', margin: '0 0 16px' }}>Prosty, przejrzysty cennik</h2>
                <p style={{ color: '#64748b', fontSize: 17, maxWidth: 500, margin: '0 auto 28px' }}>Żadnych ukrytych opłat. 30 dni za darmo, bez karty kredytowej.</p>

                {/* Monthly / Annual toggle */}
                <div style={{ display: 'inline-flex', background: '#f1f5f9', borderRadius: 10, padding: 4, gap: 4 }}>
                    {(['monthly', 'annual'] as const).map((b) => (
                        <button
                            key={b}
                            onClick={() => setBilling(b)}
                            style={{
                                padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer',
                                fontSize: 14, fontWeight: 600,
                                background: billing === b ? 'white' : 'transparent',
                                color: billing === b ? '#0f172a' : '#64748b',
                                boxShadow: billing === b ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
                                transition: 'all 0.2s',
                            }}
                        >
                            {b === 'monthly' ? 'Miesięcznie' : 'Rocznie'}
                            {b === 'annual' && (
                                <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: '#059669', background: '#dcfce7', padding: '2px 6px', borderRadius: 4 }}>
                                    -20%
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24, alignItems: 'start' }}>
                {PLANS.map((plan) => {
                    const price = billing === 'monthly' ? plan.monthly : plan.annual;
                    const savings = plan.monthly - plan.annual;
                    return (
                        <div key={plan.name} style={{
                            background: plan.highlight ? 'linear-gradient(135deg, #1e3a6f, #1d4ed8)' : 'white',
                            borderRadius: 20, padding: '36px',
                            border: plan.highlight ? 'none' : '1px solid #e2e8f0',
                            boxShadow: plan.highlight ? '0 16px 48px rgba(30,58,111,0.35)' : '0 1px 4px rgba(0,0,0,0.04)',
                            transform: plan.highlight ? 'scale(1.04)' : 'none',
                            position: 'relative',
                        }}>
                            {plan.badge && (
                                <div style={{
                                    position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)',
                                    background: '#10b981', color: 'white', fontSize: 12, fontWeight: 700,
                                    padding: '4px 16px', borderRadius: 100, whiteSpace: 'nowrap',
                                }}>{plan.badge}</div>
                            )}
                            <div style={{ fontSize: 14, fontWeight: 600, color: plan.highlight ? 'rgba(255,255,255,0.7)' : '#64748b', marginBottom: 8 }}>{plan.name}</div>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 4 }}>
                                <span style={{ fontSize: 42, fontWeight: 900, color: plan.highlight ? 'white' : '#0f172a', letterSpacing: '-2px' }}>{price}</span>
                                <span style={{ fontSize: 16, color: plan.highlight ? 'rgba(255,255,255,0.6)' : '#94a3b8', fontWeight: 500 }}>zł/mies.</span>
                            </div>
                            {billing === 'annual' && (
                                <div style={{ fontSize: 12, fontWeight: 700, color: '#059669', background: plan.highlight ? 'rgba(16,185,129,0.15)' : '#dcfce7', padding: '3px 10px', borderRadius: 6, display: 'inline-block', marginBottom: 8 }}>
                                    Oszczędzasz {savings * 12} zł rocznie
                                </div>
                            )}
                            <p style={{ fontSize: 14, color: plan.highlight ? 'rgba(255,255,255,0.6)' : '#64748b', margin: '0 0 24px', lineHeight: 1.6 }}>{plan.desc}</p>

                            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 28px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                                {plan.features.map((f) => (
                                    <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                                        <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>✅</span>
                                        <span style={{ fontSize: 14, color: plan.highlight ? 'rgba(255,255,255,0.85)' : '#374151', lineHeight: 1.5 }}>{f}</span>
                                    </li>
                                ))}
                            </ul>

                            <Link href={`/register?plan=${plan.id}`} style={{
                                display: 'block', textAlign: 'center', textDecoration: 'none',
                                background: plan.highlight ? 'white' : '#3b7ff5',
                                color: plan.highlight ? '#1e3a6f' : 'white',
                                padding: '14px 24px', borderRadius: 10, fontWeight: 700, fontSize: 15,
                            }}>
                                Wypróbuj za darmo →
                            </Link>
                        </div>
                    );
                })}
            </div>

            <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, marginTop: 32 }}>
                Wszystkie plany zawierają 30-dniowy okres próbny. Brak karty kredytowej. Możliwość anulowania w dowolnym momencie.
            </p>
        </div>
    );
}
