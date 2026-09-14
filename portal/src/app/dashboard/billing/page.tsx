'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle, Zap, AlertCircle } from 'lucide-react';
import { PLANS } from '@/lib/plans';

interface BillingData {
    tier: string;
    maxClients: number;
    clientCount: number;
    status: string;
    trialDaysLeft: number | null;
    trialExpiresAt: string | null;
    hasActiveSubscription: boolean;
}

export default function BillingPage() {
    const [data, setData] = useState<BillingData | null>(null);
    const [loading, setLoading] = useState(true);
    const [upgrading, setUpgrading] = useState('');
    const [upgradeError, setUpgradeError] = useState('');
    const searchParams = useSearchParams();
    const success = searchParams.get('success');
    const cancelled = searchParams.get('cancelled');

    useEffect(() => {
        fetch('/api/billing')
            .then(r => r.json())
            .then(setData)
            .finally(() => setLoading(false));
    }, []);

    const handleUpgrade = async (planId: string) => {
        setUpgrading(planId);
        setUpgradeError('');
        try {
            const res = await fetch('/api/billing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetPlan: planId }),
            });
            const d = await res.json();
            if (d.url) {
                window.location.href = d.url;
            } else {
                setUpgradeError(d.error || 'Nie udało się uruchomić płatności');
            }
        } catch {
            setUpgradeError('Błąd połączenia z serwerem');
        } finally {
            setUpgrading('');
        }
    };

    if (loading) {
        return <div style={{ padding: 40, color: 'var(--text-muted)' }}>Ładowanie...</div>;
    }

    const usagePct = data ? Math.round((data.clientCount / data.maxClients) * 100) : 0;
    const currentPlan = PLANS.find(p => p.id === data?.tier) || PLANS[0];

    return (
        <div style={{ maxWidth: 960, padding: '28px 0' }}>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', margin: '0 0 4px', letterSpacing: '-0.5px' }}>Rozliczenia i plan</h1>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 32px' }}>Zarządzaj subskrypcją i śledź zużycie.</p>

            {/* Success banner */}
            {success && (
                <div style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 12, padding: '16px 20px', marginBottom: 24, display: 'flex', gap: 12, alignItems: 'center' }}>
                    <CheckCircle size={20} color="#22c55e" />
                    <div>
                        <div style={{ fontWeight: 700, color: '#22c55e', marginBottom: 2 }}>Płatność zakończona sukcesem!</div>
                        <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Twój plan został aktywowany. Może minąć chwila, zanim zmiany będą widoczne.</div>
                    </div>
                </div>
            )}

            {/* Cancelled banner */}
            {cancelled && (
                <div style={{ background: 'var(--error-dim)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 12, padding: '16px 20px', marginBottom: 24, display: 'flex', gap: 12, alignItems: 'center' }}>
                    <AlertCircle size={20} color="var(--error)" />
                    <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Płatność anulowana. Twój plan nie został zmieniony.</div>
                </div>
            )}

            {/* Upgrade error */}
            {upgradeError && (
                <div style={{ background: 'var(--error-dim)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 12, padding: '16px 20px', marginBottom: 24, display: 'flex', gap: 12, alignItems: 'center' }}>
                    <AlertCircle size={20} color="var(--error)" />
                    <div style={{ fontSize: 14, color: 'var(--error)' }}>{upgradeError}</div>
                </div>
            )}

            {/* Current plan card */}
            <div className="card" style={{ marginBottom: 24 }}>
                <div className="label-caps" style={{ marginBottom: 16 }}>Twój obecny plan</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 24, alignItems: 'center' }}>
                    <div>
                        <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--text)', letterSpacing: '-0.8px' }}>{currentPlan.name}</div>
                        <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 2 }}>
                            {data?.status === 'trial'
                                ? `Okres próbny — ${data.trialDaysLeft ?? 0} dni pozostało`
                                : data?.status === 'active'
                                ? 'Aktywna subskrypcja'
                                : data?.status === 'past_due'
                                ? 'Płatność przeterminowana'
                                : 'Subskrypcja nieaktywna'}
                        </div>
                    </div>
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Klienci</span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{data?.clientCount} / {data?.maxClients}</span>
                        </div>
                        <div style={{ background: 'var(--border)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                            <div style={{ height: '100%', background: usagePct > 80 ? 'var(--error)' : 'var(--accent)', width: `${usagePct}%`, borderRadius: 4, transition: 'width 0.5s' }} />
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 4 }}>{usagePct}% wykorzystania planu</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)' }}>{currentPlan.price} zł</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>/ miesiąc</div>
                    </div>
                </div>
            </div>

            {/* Plan cards */}
            <div className="label-caps" style={{ marginBottom: 16 }}>Dostępne plany</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
                {PLANS.map((plan) => {
                    const isCurrent = plan.id === data?.tier;
                    return (
                        <div key={plan.id} style={{
                            background: plan.highlight ? 'var(--accent)' : 'var(--bg-surface)',
                            borderRadius: 16, padding: '28px',
                            border: isCurrent ? `2px solid var(--accent)` : plan.highlight ? 'none' : '1px solid var(--border)',
                            position: 'relative',
                        }}>
                            {isCurrent && (
                                <div style={{ position: 'absolute', top: -12, left: 20, background: 'var(--accent)', color: 'white', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 100 }}>
                                    Twój plan
                                </div>
                            )}
                            {plan.highlight && !isCurrent && (
                                <div style={{ position: 'absolute', top: -12, left: 20, background: '#f59e0b', color: 'white', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 100 }}>
                                    Najpopularniejszy
                                </div>
                            )}
                            <div style={{ fontSize: 20, fontWeight: 800, color: plan.highlight ? 'white' : 'var(--text)', marginBottom: 4 }}>{plan.name}</div>
                            <div style={{ marginBottom: 20 }}>
                                <span style={{ fontSize: 28, fontWeight: 900, color: plan.highlight ? 'white' : 'var(--text)' }}>{plan.price}</span>
                                <span style={{ fontSize: 14, color: plan.highlight ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)' }}> zł/mies.</span>
                            </div>
                            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', display: 'flex', flexDirection: 'column', gap: 9 }}>
                                {plan.features.map((f) => (
                                    <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: plan.highlight ? 'rgba(255,255,255,0.85)' : 'var(--text-muted)' }}>
                                        <CheckCircle size={14} style={{ flexShrink: 0, marginTop: 2, color: plan.highlight ? 'white' : 'var(--accent)' }} />
                                        {f}
                                    </li>
                                ))}
                            </ul>
                            {isCurrent ? (
                                <div style={{ padding: '11px', textAlign: 'center', background: plan.highlight ? 'rgba(255,255,255,0.15)' : 'var(--accent-dim)', borderRadius: 9, fontSize: 13, fontWeight: 600, color: plan.highlight ? 'white' : 'var(--accent)' }}>
                                    Aktualny plan
                                </div>
                            ) : (
                                <button
                                    onClick={() => handleUpgrade(plan.id)}
                                    disabled={upgrading === plan.id}
                                    style={{
                                        width: '100%', padding: '11px',
                                        background: plan.highlight ? 'white' : 'var(--accent)',
                                        color: plan.highlight ? 'var(--accent)' : 'white',
                                        border: 'none', borderRadius: 9,
                                        fontSize: 14, fontWeight: 700, cursor: upgrading === plan.id ? 'not-allowed' : 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                        opacity: upgrading === plan.id ? 0.7 : 1,
                                    }}
                                >
                                    {upgrading === plan.id ? 'Przekierowuję...' : <><Zap size={14} /> Przejdź na {plan.name}</>}
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>

            <p style={{ marginTop: 20, fontSize: 13, color: 'var(--text-subtle)', textAlign: 'center' }}>
                Pytania o billing? Napisz do nas: <a href="mailto:kontakt@ksef.auto" style={{ color: 'var(--accent-hover)' }}>kontakt@ksef.auto</a>
            </p>
        </div>
    );
}
