'use client';

import { useEffect, useState } from 'react';
import { Banknote, TrendingDown } from 'lucide-react';

export function AnalyticsCards() {
    const [data, setData] = useState<{
        estimates: { vatLiability: number; incomeTax19: number };
        sales: { net: number; vat: number; gross: number };
        purchases: { net: number; vat: number; gross: number };
    } | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/analytics')
            .then(res => res.json())
            .then(d => {
                if (d.currentMonth) setData(d.currentMonth);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    if (loading || !data) {
        return (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                <div style={{ background: 'var(--bg-surface)', borderRadius: 14, border: '1px solid var(--border)', height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-subtle)', fontSize: 14 }}>Ładowanie...</div>
                <div style={{ background: 'var(--bg-surface)', borderRadius: 14, border: '1px solid var(--border)', height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-subtle)', fontSize: 14 }}>Ładowanie...</div>
            </div>
        );
    }

    return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            {/* VAT Estimate Card */}
            <div style={{ background: 'var(--bg-surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '20px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                    <div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Szacowany VAT</div>
                        <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>Do zapłaty (bieżący miesiąc)</div>
                    </div>
                    <div className="icon-box">
                        <Banknote size={17} strokeWidth={2} />
                    </div>
                </div>
                <div style={{ fontSize: 32, fontWeight: 900, color: 'var(--text)', letterSpacing: '-1px' }}>
                    {data.estimates.vatLiability.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' })}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.8 }}>
                    VAT należny: <strong style={{ color: 'var(--text)' }}>{data.sales.vat.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' })}</strong><br />
                    VAT naliczony: <strong style={{ color: 'var(--text)' }}>{data.purchases.vat.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' })}</strong>
                </div>
            </div>

            {/* Income Tax Estimate Card */}
            <div style={{ background: 'var(--bg-surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '20px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                    <div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Szacowany Podatek Dochodowy</div>
                        <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>Liniowy 19% (bieżący miesiąc)</div>
                    </div>
                    <div className="icon-box">
                        <TrendingDown size={17} strokeWidth={2} />
                    </div>
                </div>
                <div style={{ fontSize: 32, fontWeight: 900, color: 'var(--text)', letterSpacing: '-1px' }}>
                    {data.estimates.incomeTax19.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' })}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.8 }}>
                    Przychód (netto): <strong style={{ color: 'var(--text)' }}>{data.sales.net.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' })}</strong><br />
                    Koszty (netto): <strong style={{ color: 'var(--text)' }}>{data.purchases.net.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' })}</strong>
                </div>
            </div>
        </div>
    );
}
