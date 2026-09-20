import { notFound } from 'next/navigation';
import { capabilities } from '@/lib/deployment';
import { query } from '@/lib/db';
import SetupForm from './SetupForm';

// Both the deployment edition and "has a firm been created?" are runtime
// facts. Never prerender the hosted answer into the shared image.
export const dynamic = 'force-dynamic';

export default async function SetupPage() {
    if (capabilities().mode !== 'local') notFound();

    const result = await query('SELECT COUNT(*)::int AS count FROM firms');
    if (Number(result.rows[0]?.count ?? 0) > 0) notFound();

    return <SetupForm />;
}
