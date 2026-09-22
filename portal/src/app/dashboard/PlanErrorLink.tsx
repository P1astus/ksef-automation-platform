'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BILLING_HREF, LICENCE_HREF } from '@/lib/plan-errors';

export default function PlanErrorLink({ show }: { show: boolean }) {
    const [licence, setLicence] = useState<boolean | null>(null);
    useEffect(() => {
        if (show) fetch('/api/settings').then(r => r.json()).then(d => setLicence(d.licenceMode === true)).catch(() => {});
    }, [show]);
    if (!show || licence === null) return null;
    return <> {' '}<Link href={licence ? LICENCE_HREF : BILLING_HREF} style={{ color: 'inherit', fontWeight: 600, textDecoration: 'underline', whiteSpace: 'nowrap' }}>
        {licence ? 'Zainstaluj licencję →' : 'Zobacz plany i płatności →'}
    </Link></>;
}
