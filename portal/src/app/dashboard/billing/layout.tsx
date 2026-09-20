import { notFound } from 'next/navigation';
import { capabilities } from '@/lib/deployment';

// Billing exists only where Stripe is the billing provider. force-dynamic: runtime env, not build-time (see admin/layout).
export const dynamic = 'force-dynamic';

export default function BillingLayout({ children }: { children: React.ReactNode }) {
    if (capabilities().billingProvider !== 'stripe') notFound();
    return children;
}
