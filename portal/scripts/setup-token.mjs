// Print a one-time setup token for the local edition's first-run registration. Run again to rotate a lost,
// unconsumed token. Refuses once a firm exists.
//   DATABASE_URL=... node scripts/setup-token.mjs            prints the token once to stdout
//   SETUP_TOKEN_OUT=/path/token.txt ...                       also writes it to a file with mode 0600
// The raw token is never written anywhere else - not to a log, not to the database (only its SHA-256 is stored).
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { issueSetupToken, SetupTokenError } from './lib/setup-token.mjs';

if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
    await client.connect();
    const token = await issueSetupToken({ query: (t, p) => client.query(t, p) });
    if (process.env.SETUP_TOKEN_OUT) writeFileSync(process.env.SETUP_TOKEN_OUT, token + '\n', { mode: 0o600 });
    console.log(token);
    console.error('Setup token issued. It is shown once; it is required to create the first account.');
} catch (err) {
    console.error(err instanceof SetupTokenError ? `[setup-token] ${err.message}` : `[setup-token] unexpected failure: ${err.message}`);
    process.exitCode = err instanceof SetupTokenError ? 2 : 1;
} finally {
    await client.end().catch(() => {});
}
