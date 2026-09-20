import { NextResponse } from 'next/server';
import { BooleanCapability, capabilities } from './deployment';

/**
 * null = proceed. Otherwise return this from the route. A disabled capability answers 404, NOT 403: a
 * customer's own box must not disclose that a vendor operator console (or a billing surface) exists.
 */
const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404 });

/** Billing surfaces (checkout, plan page, Stripe webhook) exist only where Stripe is the billing provider. */
export function requireBilling(): NextResponse | null {
    return capabilities().billingProvider === 'stripe' ? null : NOT_FOUND();
}

export function requireCapability(key: BooleanCapability): NextResponse | null {
    return capabilities()[key] ? null : NOT_FOUND();
}
