// A database id in a route path: a positive integer that fits Postgres
// `integer`. Anything else is a client error, not a query to attempt.
export function isRouteId(id: unknown): id is string {
    return typeof id === 'string' && /^[1-9]\d{0,9}$/.test(id) && Number(id) <= 2147483647;
}
