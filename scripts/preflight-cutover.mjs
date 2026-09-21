#!/usr/bin/env node
// Read-only cutover gate. PASS/FAIL/WARN; never prints secret values.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotSchema, diffSnapshots } from '../portal/scripts/lib/migrations.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requirePortal = createRequire(path.join(ROOT, 'portal/package.json'));
const { Client } = requirePortal('pg');

export const JOB_WORKFLOWS = {
  'health-check': ['Health Check'],
  'offline24-monitor': ['Offline24 Deadline Monitor'],
  'invoice-retrieval': ['Invoice Retrieval', 'Invoice Sync'],
  'jpk-preparation': ['JPK_VAT Preparation'],
  'client-notifications-offline24': ['Client Notifications'],
  'client-notifications-receivables': ['Client Notifications'],
};

export function parseEnvFile(text) {
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    result[match[1]] = value;
  }
  return result;
}

export function decisions(env) {
  const rows = [];
  const has = key => Boolean(env[key]?.trim());
  for (const key of ['KSEF_CREDENTIALS_KEY', 'NEXT_PUBLIC_APP_URL', 'ALERT_EMAIL', 'SIDECAR_API_KEY', 'JWT_SECRET'])
    rows.push([has(key) ? 'PASS' : 'FAIL', `env ${key}: ${has(key) ? 'set' : 'unset'}`]);
  rows.push([has('JOB_SECRET') ? 'PASS' : 'WARN', `env JOB_SECRET: ${has('JOB_SECRET') ? 'set' : 'unset (machine trigger opt-in)'}`]);
  const mail = has('RESEND_API_KEY') || (has('SMTP_HOST') && has('SMTP_FROM_EMAIL'));
  rows.push([mail ? 'PASS' : 'FAIL', `mail transport: ${mail ? 'set' : 'unset'}`]);
  const lists = {};
  for (const key of ['JOBS_ENABLED', 'JOBS_SHADOW']) {
    const names = (env[key] || '').split(',').map(s => s.trim()).filter(Boolean);
    const unknown = names.filter(name => !(name in JOB_WORKFLOWS));
    lists[key] = names;
    rows.push([unknown.length ? 'FAIL' : 'PASS', `${key}: ${unknown.length ? `unknown ${unknown.join(', ')}` : 'known jobs only'}`]);
  }
  const overlap = lists.JOBS_ENABLED.filter(name => lists.JOBS_SHADOW.includes(name));
  rows.push([overlap.length ? 'FAIL' : 'PASS', `job mode overlap: ${overlap.length ? overlap.join(', ') : 'none'}`]);
  rows.push([env.KSEF_ENVIRONMENT === 'prod' ? 'FAIL' : 'PASS', `KSEF_ENVIRONMENT: ${env.KSEF_ENVIRONMENT === 'prod' ? 'prod forbidden' : 'non-prod'}`]);
  return { rows, enabled: lists.JOBS_ENABLED };
}

export function backupDecision(dir, now = Date.now()) {
  if (!existsSync(dir)) return ['FAIL', 'backup: directory missing'];
  const runs = readdirSync(dir).filter(n => /^\d{8}-\d{6}$/.test(n)).sort().reverse();
  for (const run of runs) {
    const folder = path.join(dir, run);
    const sums = path.join(folder, 'SHA256SUMS');
    if (!existsSync(sums)) continue;
    if (now - statSync(sums).mtimeMs > 48 * 60 * 60 * 1000) continue;
    const lines = readFileSync(sums, 'utf8').trim().split(/\r?\n/);
    if (lines.length === 0) continue;
    let valid = true;
    for (const line of lines) {
      const match = line.match(/^([a-f0-9]{64})\s+\*?([^/\\]+)$/i);
      if (!match || !existsSync(path.join(folder, match[2]))) { valid = false; break; }
      const actual = createHash('sha256').update(readFileSync(path.join(folder, match[2]))).digest('hex');
      if (actual !== match[1].toLowerCase()) { valid = false; break; }
    }
    if (valid && lines.some(line => line.includes('ksef_platform.sql.gz')) && lines.some(line => /secrets\.tgz(?:\.enc)?$/.test(line)))
      return ['PASS', `backup: recent checksum verified (${run})`];
  }
  return ['FAIL', 'backup: no complete checksum-verified run in 48 hours'];
}

async function n8nDecision(env, enabled) {
  if (!enabled.length) return [['PASS', 'n8n: no enabled jobs to compare']];
  if (!env.N8N_OWNER_EMAIL || !env.N8N_OWNER_PASSWORD) return [['WARN', 'n8n: owner login unavailable']];
  try {
    const base = env.N8N_PREFLIGHT_URL || 'http://127.0.0.1:5678';
    const login = await fetch(`${base}/rest/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ emailOrLdapLoginId: env.N8N_OWNER_EMAIL, password: env.N8N_OWNER_PASSWORD }), signal: AbortSignal.timeout(5000) });
    if (!login.ok) return [['WARN', 'n8n: owner login failed']];
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    if (!cookie) return [['WARN', 'n8n: login cookie unavailable']];
    const response = await fetch(`${base}/rest/workflows`, { headers: { cookie }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) return [['WARN', 'n8n: workflow list unavailable']];
    const body = await response.json();
    const workflows = Array.isArray(body.data) ? body.data : [];
    return enabled.map(job => {
      const matches = workflows.filter(w => JOB_WORKFLOWS[job].some(prefix => w.name?.toLowerCase().includes(prefix.toLowerCase())));
      if (!matches.length) return ['WARN', `n8n ${job}: matching workflow not found`];
      return matches.some(w => w.active) ? ['FAIL', `n8n ${job}: matching workflow active`] : ['PASS', `n8n ${job}: matching workflow inactive`];
    });
  } catch { return [['WARN', 'n8n: unreachable']]; }
}

export async function run({ envFile = path.join(ROOT, '.env'), backupDir = path.join(ROOT, 'backups'), databaseUrl } = {}) {
  const env = { ...parseEnvFile(existsSync(envFile) ? readFileSync(envFile, 'utf8') : ''), ...process.env };
  const { rows, enabled } = decisions(env);
  rows.unshift(backupDecision(backupDir));
  const url = databaseUrl || env.PREFLIGHT_DATABASE_URL || `postgresql://ksef_app:${encodeURIComponent(env.KSEF_DB_PASSWORD || '')}@127.0.0.1:5433/ksef_platform`;
  const db = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  try {
    await db.connect();
    await db.query('BEGIN READ ONLY');
    const expected = JSON.parse(readFileSync(path.join(ROOT, 'db/baseline-2026-09-20.invariants.json'), 'utf8'));
    const diff = diffSnapshots(expected, await snapshotSchema({ query: (sql, args) => db.query(sql, args) }));
    rows.push([diff.ok ? 'PASS' : 'FAIL', `database baseline audit: ${diff.ok ? 'matched' : `${diff.missing.length} missing, ${diff.different.length} different`}`]);
    const calendar = await db.query("SELECT max(date) AS last_day FROM business_days WHERE is_business_day=true");
    const limit = new Date(); limit.setUTCMonth(limit.getUTCMonth() + 6);
    rows.push([calendar.rows[0]?.last_day && new Date(calendar.rows[0].last_day) > limit ? 'PASS' : 'FAIL', 'business_days: ' + (calendar.rows[0]?.last_day && new Date(calendar.rows[0].last_day) > limit ? 'extends beyond six months' : 'too short')]);
  } catch { rows.push(['FAIL', 'database: read-only audit unavailable']); }
  finally { await db.query('ROLLBACK').catch(() => {}); await db.end().catch(() => {}); }
  rows.push(...await n8nDecision(env, enabled));
  for (const [level, message] of rows) console.log(`${level} ${message}`);
  return rows.some(([level]) => level === 'FAIL') ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await run();
