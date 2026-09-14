import { Pool } from 'pg';

// Checked lazily (on first actual query), not at module load - `next build`
// statically imports every route module with no DATABASE_URL available at
// build time, same reason auth.ts's JWT_SECRET check is lazy (see
// MissingJwtSecretError there). A missing DATABASE_URL used to silently fall
// back to 'postgresql://ksef_app:temp_pw@localhost:5433/ksef_platform' - not
// a real credential for anything (docker-compose's ksef_db is reachable as
// ksef_db:5432 from inside a container, not localhost:5433, and temp_pw was
// never the real password), so it couldn't actually forge a connection the
// way D9's JWT fallback could forge a session - but it still meant a missing
// env var failed with a confusing connection-refused error instead of
// saying plainly what was wrong.
export class MissingDatabaseUrlError extends Error {
  constructor() {
    super('DATABASE_URL is not set. Refusing to fall back to a placeholder connection string.');
    this.name = 'MissingDatabaseUrlError';
  }
}

let realPool: Pool | null = null;

function getPool(): Pool {
  if (realPool) return realPool;
  if (!process.env.DATABASE_URL) {
    throw new MissingDatabaseUrlError();
  }
  realPool = new Pool({ connectionString: process.env.DATABASE_URL });
  return realPool;
}

// Existing callers (ocr, export, export/optima, email/sync routes) import
// the default export directly and call pool.connect()/pool.query() etc. -
// this proxy preserves that exact interface while deferring construction
// (and the check above) to first real use.
const pool = new Proxy({} as Pool, {
  get(_target, prop, _receiver) {
    const real = getPool();
    const value = (real as unknown as Record<PropertyKey, unknown>)[prop];
    return typeof value === 'function' ? value.bind(real) : value;
  },
});

export default pool;

export async function query(text: string, params?: any[]) {
  const start = Date.now();
  const res = await getPool().query(text, params);
  const duration = Date.now() - start;
  console.log('executed query', { text, duration, rows: res.rowCount });
  return res;
}
