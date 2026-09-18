// Client-safe interpretation of the structured errors lib/entitlements.ts
// returns (402 SUBSCRIPTION_INACTIVE, 403 PLAN_UPGRADE_REQUIRED). Pure - no
// server imports - so any dashboard page can use it. The API stays the
// authority; this only decides how a rejected call is worded and whether the
// user should be pointed at the billing page.

export const BILLING_HREF = '/dashboard/billing';

export interface ApiFailure {
    message: string;
    /** True for 402/403 plan errors - the caller should offer a link to BILLING_HREF. */
    isPlanError: boolean;
    status: number;
}

interface ErrorBody {
    error?: unknown;
    code?: unknown;
}

export function interpretApiFailure(status: number, body: unknown, fallback: string): ApiFailure {
    const b: ErrorBody = body && typeof body === 'object' ? (body as ErrorBody) : {};
    const message = typeof b.error === 'string' && b.error ? b.error : fallback;
    const isPlanError =
        (status === 402 && b.code === 'SUBSCRIPTION_INACTIVE') ||
        (status === 403 && b.code === 'PLAN_UPGRADE_REQUIRED');
    return { message, isPlanError, status };
}

/** Reads a non-OK Response (tolerating a non-JSON body) and interprets it. */
export async function readApiFailure(res: Response, fallback: string): Promise<ApiFailure> {
    const body = await res.json().catch(() => ({}));
    return interpretApiFailure(res.status, body, fallback);
}
