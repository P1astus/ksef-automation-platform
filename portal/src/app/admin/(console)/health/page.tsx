import { auditOperator, requireOperator } from '@/lib/operator-auth';
import JobHealthDashboard from '@/components/JobHealthDashboard';

export const dynamic = 'force-dynamic';

export default async function OperatorHealthPage() {
    const session = await requireOperator();
    await auditOperator({ operatorId: session.operatorId, email: session.email, action: 'view_job_health' });
    return <JobHealthDashboard firmId={null} />;
}
