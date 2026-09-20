import { NextResponse } from 'next/server';
import { BooleanCapability, capabilities } from './deployment';

/**
 * null = proceed. Otherwise return this from the route. A disabled capability answers 404, NOT 403: a
 * customer's own box must not disclose that a vendor operator console (or a billing surface) exists.
 */
export function requireCapability(key: BooleanCapability): NextResponse | null {
    return capabilities()[key] ? null : NextResponse.json({ error: 'Not found' }, { status: 404 });
}
