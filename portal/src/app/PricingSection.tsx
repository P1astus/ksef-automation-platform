'use client';

import Link from 'next/link';
import { PLANS as SHARED_PLANS } from '@/lib/plans';

// Price, client cap and feature bullets come from lib/plans.ts, the same
// source used by billing and the paywall.
const MARKETING: Record<string, { desc: string; badge?: string }> = {
    start: { desc: 'Plan tylko do odczytu i raportowania dla małych biur - do 15 klientów.' },
    biznes: { desc: 'Dla rozwijających się biur. Wystawianie i wysyłka faktur, eksporty i klasyfikacja AI.', badge: 'Najpopularniejszy' },
    pro: { desc: 'Wszystkie funkcje Biznes dla dużych biur - do 999 klientów.' },
};

const PLANS = SHARED_PLANS.map(p => ({ ...p, ...MARKETING[p.id] }));

export default function PricingSection() {
    return (
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 48 }}>
                <div style={{ color: '#3b7ff5', fontSize: 13, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>Cennik</div>
                <h2 style={{ fontSize: 40, fontWeight: 800, color: '#0f172a', letterSpacing: '-1.5px', margin: '0 0 16px' }}>Prosty, przejrzysty cennik</h2>
                <p style={{ color: '#64748b', fontSize: 17, maxWidth: 500, margin: '0 auto 28px' }}>Żadnych ukrytych opłat. 14 dni za darmo, bez karty kredytowej.</p>

            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24, alignItems: 'start' }}>
                {PLANS.map((plan) => {
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
                                <span style={{ fontSize: 42, fontWeight: 900, color: plan.highlight ? 'white' : '#0f172a', letterSpacing: '-2px' }}>{plan.price}</span>
                                <span style={{ fontSize: 16, color: plan.highlight ? 'rgba(255,255,255,0.6)' : '#94a3b8', fontWeight: 500 }}>zł/mies.</span>
                            </div>
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
                Wszystkie plany zawierają 14-dniowy okres próbny. Brak karty kredytowej. Możliwość anulowania w dowolnym momencie.
            </p>
        </div>
    );
}
