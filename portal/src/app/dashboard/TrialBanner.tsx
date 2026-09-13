import Link from 'next/link';

interface TrialBannerProps {
    daysLeft: number;
    tier: string;
}

export default function TrialBanner({ daysLeft, tier }: TrialBannerProps) {
    // Don't show banner for paid plans with no expiry concern
    if (tier !== 'start' && tier !== 'biznes' && tier !== 'pro') return null;

    if (daysLeft > 7) return null; // Only show when ≤7 days left or expired

    const expired = daysLeft <= 0;

    const bgColor = expired ? '#fef2f2' : '#fffbeb';
    const borderColor = expired ? '#fecaca' : '#fde68a';
    const textColor = expired ? '#dc2626' : '#92400e';
    const iconColor = expired ? '#ef4444' : '#f59e0b';

    return (
        <div style={{
            background: bgColor,
            border: `1px solid ${borderColor}`,
            borderRadius: 10,
            padding: '12px 20px',
            margin: '0 28px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 18 }}>{expired ? '🔴' : '⚠️'}</span>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: textColor }}>
                    {expired
                        ? 'Twój okres próbny wygasł — wybierz plan, aby kontynuować korzystanie z platformy.'
                        : `Twój okres próbny kończy się za ${daysLeft} ${daysLeft === 1 ? 'dzień' : 'dni'}.`}
                </span>
            </div>
            <Link
                href="/dashboard/billing"
                style={{
                    background: expired ? '#dc2626' : '#f59e0b',
                    color: 'white',
                    textDecoration: 'none',
                    padding: '7px 16px',
                    borderRadius: 7,
                    fontSize: 13,
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                }}
            >
                {expired ? 'Wybierz plan →' : 'Rozliczenia →'}
            </Link>
        </div>
    );
}
