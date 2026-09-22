#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createPrivateKey, sign } from 'node:crypto';

// Usage: node scripts/issue-licence.mjs PRIVATE_KEY_PATH FIRM_NAME NIP PLAN MAX_CLIENTS EXPIRES_ON
const [path, firm_name, firm_nip, plan, cap, expires_on] = process.argv.slice(2);
const caps = { start: 15, biznes: 50, pro: 999 };
const max_clients = Number(cap);
if (!path || !firm_name?.trim() || !/^\d{10}$/.test(firm_nip ?? '') || !(plan in caps) || !Number.isSafeInteger(max_clients) || max_clients <= 0 || max_clients > caps[plan] || !/^\d{4}-\d{2}-\d{2}$/.test(expires_on ?? '') || new Date(`${expires_on}T00:00:00.000Z`).toISOString().slice(0,10) !== expires_on) {
    console.error('Usage: issue-licence.mjs PRIVATE_KEY_PATH FIRM_NAME NIP start|biznes|pro MAX_CLIENTS EXPIRES_ON(YYYY-MM-DD)');
    process.exit(2);
}
const key = createPrivateKey(readFileSync(path));
if (key.asymmetricKeyType !== 'ed25519') throw new Error('Expected Ed25519 private key');
const payload = Buffer.from(JSON.stringify({ version: 1, firm_name: firm_name.trim(), firm_nip, plan, max_clients, issued_at: new Date().toISOString(), expires_on }));
process.stdout.write(JSON.stringify({ payload: payload.toString('base64url'), signature: sign(null, payload, key).toString('base64url') }) + '\n');
