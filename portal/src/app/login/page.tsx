import { capabilities } from '@/lib/deployment';
import LoginClient from './LoginClient';

// Reads the deployment edition at runtime (never baked into the build).
export const dynamic = 'force-dynamic';

export default function Page() {
    return <LoginClient showRegister={capabilities().openRegistration} />;
}
