'use client';

import { useEffect } from 'react';

// A link-friendly wrapper: POSTs the logout (state-changing, so never a GET
// route) and then returns to the login page.
export default function AdminLogoutPage() {
    useEffect(() => {
        fetch('/api/admin/logout', { method: 'POST' }).finally(() => { window.location.href = '/admin/login'; });
    }, []);
    return <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-subtle)' }}>Wylogowywanie...</div>;
}
