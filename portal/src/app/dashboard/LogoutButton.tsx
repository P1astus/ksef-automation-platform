'use client';

import { useRouter } from 'next/navigation';

export default function LogoutButton() {
    const router = useRouter();

    const handleLogout = async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        router.push('/login');
        router.refresh();
    };

    return (
        <button
            onClick={handleLogout}
            style={{
                width: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text-muted)', padding: '8px 14px', borderRadius: 8,
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--error-dim)'; e.currentTarget.style.color = 'var(--error)'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.3)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
        >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Wyloguj się
        </button>
    );
}
