'use client';

import { useState } from 'react';
import { Zap, CheckCircle, Lock } from 'lucide-react';

const PLANS = [
    {
        id: 'start',
        name: 'Start',
        price: 299,
        features: ['Do 20 klientów (NIP)', 'Pobieranie faktur co godzinę', 'Raporty JPK_V7', 'Alerty e-mail'],
    },
    {
        id: 'biznes',
        name: 'Biznes',
        price: 599,
        highlight: true,
        features: ['Do 60 klientów (NIP)', 'Faktury w czasie rzeczywistym', 'JPK_V7 i JPK_FA', 'Wsparcie telefoniczne', 'Eksport CSV / Excel'],
    },
    {
        id: 'pro',
        name: 'Pro',
        price: 1299,
        features: ['Nieograniczona liczba klientów', 'API integracji z FK', 'Wszystkie typy JPK', 'Dedykowany opiekun', 'SLA 99.9%'],
    },
];

export default function PaywallOverlay({ reason }: { reason: 'expired' | 'canceled' }) {
    const [upgrading, setUpgrading] = useState('');

    const handleUpgrade = async (planId: string) => {
        setUpgrading(planId);
        try {
            const res = await fetch('/api/billing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetPlan: planId }),
            });
            const d = await res.json();
            if (d.url) window.location.href = d.url;
        } finally {
            setUpgrading('');
        }
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(9,9,11,0.92)',
            backdropFilter: 'blur(12px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24,
            overflowY: 'auto',
        }}>
            <div style={{ maxWidth: 860, width: '100%', textAlign: 'center' }}>
                {/* Icon */}
                <div style={{
                    width: 60, height: 60, borderRadius: 16,
                    background: 'var(--error-dim)', border: '1px solid rgba(239,68,68,0.25)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto 24px',
                }}>
                    <Lock size={26} color="var(--error)" />
                </div>

                <h1 style={{ fontSize: 28, fontWeight: 900, color: 'var(--text)', margin: '0 0 12px', letterSpacing: '-0.6px' }}>
                    {reason === 'expired' ? 'Twój okres próbny wygasł' : 'Subskrypcja nieaktywna'}
                </h1>
                <p style={{ fontSize: 15, color: 'var(--text-muted)', margin: '0 0 36px', maxWidth: 480, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
                    {reason === 'expired'
                        ? 'Twój 30-dniowy okres próbny dobiegł końca. Wybierz plan, aby kontynuować korzystanie z platformy.'
                        : 'Twoja subskrypcja została anulowana. Wybierz plan, aby przywrócić dostęp do platformy.'}
                </p>

                {/* Plan cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 28 }}>
                    {PLANS.map((plan) => (
                        <div key={plan.id} style={{
                            background: plan.highlight ? 'var(--accent)' : 'var(--bg-surface)',
                            borderRadius: 16, padding: '28px 24px',
                            border: plan.highlight ? 'none' : '1px solid var(--border)',
                            position: 'relative', textAlign: 'left',
                        }}>
                            {plan.highlight && (
                                <div style={{ position: 'absolute', top: -12, left: 20, background: '#f59e0b', color: 'white', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 100 }}>
                                    Najpopularniejszy
                                </div>
                            )}
                            <div style={{ fontSize: 18, fontWeight: 800, color: plan.highlight ? 'white' : 'var(--text)', marginBottom: 4 }}>{plan.name}</div>
                            <div style={{ marginBottom: 20 }}>
                                <span style={{ fontSize: 26, fontWeight: 900, color: plan.highlight ? 'white' : 'var(--text)' }}>{plan.price}</span>
                                <span style={{ fontSize: 13, color: plan.highlight ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)' }}> zł/mies.</span>
                            </div>
                            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {plan.features.map((f) => (
                                    <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: plan.highlight ? 'rgba(255,255,255,0.85)' : 'var(--text-muted)' }}>
                                        <CheckCircle size={14} style={{ flexShrink: 0, marginTop: 2, color: plan.highlight ? 'white' : 'var(--accent)' }} />
                                        {f}
                                    </li>
                                ))}
                            </ul>
                            <button
                                onClick={() => handleUpgrade(plan.id)}
                                disabled={upgrading === plan.id}
                                style={{
                                    width: '100%', padding: '11px',
                                    background: plan.highlight ? 'white' : 'var(--accent)',
                                    color: plan.highlight ? 'var(--accent)' : 'white',
                                    border: 'none', borderRadius: 9,
                                    fontSize: 14, fontWeight: 700,
                                    cursor: upgrading === plan.id ? 'not-allowed' : 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                    opacity: upgrading === plan.id ? 0.7 : 1,
                                }}
                            >
                                <Zap size={14} />
                                {upgrading === plan.id ? 'Przekierowuję...' : `Wybierz ${plan.name}`}
                            </button>
                        </div>
                    ))}
                </div>

                <p style={{ fontSize: 13, color: 'var(--text-subtle)' }}>
                    Pytania? Napisz do nas: <a href="mailto:kontakt@ksef.auto" style={{ color: 'var(--accent-hover)' }}>kontakt@ksef.auto</a>
                </p>
            </div>
        </div>
    );
}
