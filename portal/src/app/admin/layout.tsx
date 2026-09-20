import { notFound } from 'next/navigation';
import { capabilities } from '@/lib/deployment';

// The vendor console (login, logout and console pages) exists only in the hosted edition. force-dynamic because this
// reads runtime env: without it Next prerenders the layout at build time and bakes the hosted value into the image.
// Each console page still calls requireOperator() itself (a layout-only guard is not a guard).
export const dynamic = 'force-dynamic';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    if (!capabilities().operatorConsole) notFound();
    return children;
}
