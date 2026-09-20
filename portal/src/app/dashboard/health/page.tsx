import { notFound, redirect } from 'next/navigation';
import { getSession, sessionRole } from '@/lib/auth';
import JobHealthDashboard from '@/components/JobHealthDashboard';

export const dynamic = 'force-dynamic';

export default async function HealthPage() {
    const session = await getSession();
    if (!session) redirect('/login?session=ended');
    if (sessionRole(session) !== 'owner') notFound();
    return <JobHealthDashboard firmId={session.firmId} />;
}
