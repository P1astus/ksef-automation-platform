#!/usr/bin/env node
import { readFileSync } from 'node:fs';

// Uses the same owner-only API as the settings page. Credentials never appear in arguments.
const [baseUrl, licencePath] = process.argv.slice(2);
const email = process.env.KSEF_OWNER_EMAIL;
const password = process.env.KSEF_OWNER_PASSWORD;
if (!baseUrl || !licencePath || !email || !password) {
    console.error('Usage: KSEF_OWNER_EMAIL=... KSEF_OWNER_PASSWORD=... node scripts/install-licence.mjs https://local.example licence.json');
    process.exit(2);
}
const root = new URL(baseUrl);
if (root.protocol !== 'https:' && root.hostname !== 'localhost' && root.hostname !== '127.0.0.1') throw new Error('HTTPS required');
const login = await fetch(new URL('/api/auth/login', root), { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: root.origin }, body: JSON.stringify({ email, password }), redirect: 'manual' });
if (!login.ok) throw new Error(`Owner login failed (${login.status})`);
const cookie = login.headers.get('set-cookie')?.split(';')[0];
if (!cookie) throw new Error('Owner login did not return a session');
const res = await fetch(new URL('/api/settings/licence', root), { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: root.origin, Cookie: cookie }, body: readFileSync(licencePath, 'utf8') });
const result = await res.json();
if (!res.ok) throw new Error(result.error || `Licence installation failed (${res.status})`);
console.log(JSON.stringify(result));
