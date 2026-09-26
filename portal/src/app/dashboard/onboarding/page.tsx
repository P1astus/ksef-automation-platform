import { capabilities } from '@/lib/deployment';
import OnboardingClient from './OnboardingClient';

// Reads the deployment edition at runtime (never baked into the build).
export const dynamic = 'force-dynamic';

export default function Page() {
    return <OnboardingClient showTrial={capabilities().billingProvider === 'stripe'} />;
}
