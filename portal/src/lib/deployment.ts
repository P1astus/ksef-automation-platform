// One codebase, two editions (hosted SaaS and a local install). Everything that differs between them is
// expressed as a CAPABILITY resolved here, never as `if (mode === 'local')` at a call site.
//
// Hard constraints: this file is env-only. No `pg`, no `next/server`: lib/auth.ts imports it and auth.ts is
// reachable from edge middleware. The request guard lives in capability-guard.ts for the same reason.
//
// Access policy and plan tier are DIFFERENT things (see entitlements.ts):
//   accessProvider decides whether the account is ACTIVE  ('stripe' | 'licence' | 'unmetered')
//   the firm's subscription_tier decides which FEATURES it has, in every mode
// A local firm is therefore created active + Pro; no tier check is bypassed anywhere.

export type DeploymentMode = 'saas' | 'local';
export type BillingProvider = 'stripe' | 'none';
export type AccessProvider = 'stripe' | 'licence' | 'unmetered';
export type EmailTransport = 'smtp' | 'resend' | 'none';

export interface Capabilities {
    mode: DeploymentMode;
    billingProvider: BillingProvider;
    accessProvider: AccessProvider;
    operatorConsole: boolean;
    /** false = the first firm must present the one-time setup token (see auth/register). */
    openRegistration: boolean;
    /** Client document upload needs inbound internet; off on a LAN-only install. */
    publicUpload: boolean;
    /** The embedded job scheduler (replaces n8n). Off until the worker exists. */
    scheduler: boolean;
    emailTransport: EmailTransport;
}

export type BooleanCapability = 'operatorConsole' | 'openRegistration' | 'publicUpload' | 'scheduler';

export class InvalidDeploymentError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InvalidDeploymentError';
    }
}

type Env = Record<string, string | undefined>;

const ACCESS: readonly AccessProvider[] = ['stripe', 'licence', 'unmetered'];
const TRANSPORTS: readonly EmailTransport[] = ['smtp', 'resend', 'none'];
const flag = (v: string | undefined) => v === 'true';

/**
 * Pure and table-testable: the whole policy, from an env object.
 * DEPLOYMENT_MODE unset resolves to 'saas' with Stripe access and is byte-identical to the behaviour
 * before this seam existed - including the existing tolerance of an empty STRIPE_SECRET_KEY (the app
 * starts; Stripe-dependent routes fail clearly when called). Requiring Stripe configuration is a hosted
 * production deployment check, not an application startup check.
 */
export function resolveDeployment(env: Env): Capabilities {
    const rawMode = (env.DEPLOYMENT_MODE ?? '').trim();
    if (rawMode !== '' && rawMode !== 'saas' && rawMode !== 'local') {
        throw new InvalidDeploymentError(`DEPLOYMENT_MODE must be 'saas' or 'local', got '${rawMode}'`);
    }
    const mode: DeploymentMode = rawMode === 'local' ? 'local' : 'saas';

    const rawAccess = (env.ACCESS_PROVIDER ?? '').trim();
    if (rawAccess !== '') {
        if (!ACCESS.includes(rawAccess as AccessProvider)) {
            throw new InvalidDeploymentError(`ACCESS_PROVIDER must be one of ${ACCESS.join(', ')}, got '${rawAccess}'`);
        }
        if (mode === 'saas' && rawAccess !== 'stripe') {
            throw new InvalidDeploymentError(`ACCESS_PROVIDER=${rawAccess} is only valid with DEPLOYMENT_MODE=local`);
        }
    }
    const accessProvider: AccessProvider = mode === 'saas' ? 'stripe' : ((rawAccess || 'unmetered') as AccessProvider);

    const rawTransport = (env.EMAIL_TRANSPORT ?? '').trim();
    if (rawTransport !== '' && !TRANSPORTS.includes(rawTransport as EmailTransport)) {
        throw new InvalidDeploymentError(`EMAIL_TRANSPORT must be one of ${TRANSPORTS.join(', ')}, got '${rawTransport}'`);
    }
    const emailTransport = (rawTransport || (mode === 'local' ? 'smtp' : 'resend')) as EmailTransport;

    // The one hard rejection: a Stripe key next to a non-Stripe access policy is a contradictory
    // configuration (two sources of truth for whether the account is active), i.e. a mistake.
    if (accessProvider !== 'stripe' && (env.STRIPE_SECRET_KEY ?? '').trim() !== '') {
        throw new InvalidDeploymentError(
            `STRIPE_SECRET_KEY is set but the access policy is '${accessProvider}': refusing to start with two sources of truth for account status`
        );
    }

    return {
        mode,
        billingProvider: accessProvider === 'stripe' ? 'stripe' : 'none',
        accessProvider,
        operatorConsole: mode === 'saas',
        openRegistration: mode === 'saas',
        publicUpload: mode === 'saas' || flag(env.PUBLIC_UPLOAD_ENABLED),
        scheduler: flag(env.SCHEDULER_ENABLED),
        emailTransport,
    };
}

let cached: Capabilities | undefined;

/**
 * Memoized process-wide view. Resolved lazily, never at import time, so `next build` (which statically
 * evaluates every route module with no env present) still works - the same reason MissingJwtSecretError
 * and MissingDatabaseUrlError are lazy.
 */
export function capabilities(): Capabilities {
    return (cached ??= resolveDeployment(process.env));
}

/** Test hook (precedent: invalidateFirmActiveCache). */
export function resetDeploymentCache(): void {
    cached = undefined;
}
