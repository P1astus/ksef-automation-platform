import Link from 'next/link';
import { BILLING_HREF } from '@/lib/plan-errors';

// Shown next to an error message when the API rejected the call for plan or
// subscription reasons (see lib/plan-errors.ts).
export default function PlanErrorLink({ show }: { show: boolean }) {
    if (!show) return null;
    return (
        <>
            {' '}
            <Link href={BILLING_HREF} style={{ color: 'inherit', fontWeight: 600, textDecoration: 'underline', whiteSpace: 'nowrap' }}>
                Zobacz plany i płatności →
            </Link>
        </>
    );
}
