import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseEnvFile, decisions, backupDecision } from './preflight-cutover.mjs';

test('parses quoted and unquoted .env entries without exposing values', () => {
  assert.deepEqual(parseEnvFile('A=ignored\nJWT_SECRET="some secret"\nJOB_SECRET=abc # comment\nexport KSEF_ENVIRONMENT=test\n'), {
    A: 'ignored', JWT_SECRET: 'some secret', JOB_SECRET: 'abc', KSEF_ENVIRONMENT: 'test',
  });
});

test('gate rejects unknown jobs, overlap, production, and unset required variables', () => {
  const valid = { KSEF_CREDENTIALS_KEY: 'x', JOB_SECRET: 'x', SMTP_HOST: 'mail', SMTP_FROM_EMAIL: 'sender', NEXT_PUBLIC_APP_URL: 'https://example.invalid', ALERT_EMAIL: 'alert', SIDECAR_API_KEY: 'x', JWT_SECRET: 'x', KSEF_ENVIRONMENT: 'test', JOBS_ENABLED: 'jpk-preparation', JOBS_SHADOW: 'health-check' };
  assert.equal(decisions(valid).rows.filter(([level]) => level === 'FAIL').length, 0);
  const bad = decisions({ ...valid, JWT_SECRET: '', JOBS_ENABLED: 'jpk-preparation,unknown', JOBS_SHADOW: 'jpk-preparation', KSEF_ENVIRONMENT: 'prod' });
  assert.equal(bad.rows.filter(([level]) => level === 'FAIL').length, 4);
  assert.equal(decisions({ ...valid, JOB_SECRET: '' }).rows.some(([level, message]) => level === 'WARN' && message.includes('JOB_SECRET')), true);
});

test('recent backup checksum passes and tampering fails', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ksef-preflight-'));
  try {
    const run = path.join(root, '20260922-010000'); mkdirSync(run);
    const entries = ['ksef_platform.sql.gz', 'secrets.tgz'];
    for (const name of entries) writeFileSync(path.join(run, name), name);
    writeFileSync(path.join(run, 'SHA256SUMS'), entries.map(name => `${createHash('sha256').update(name).digest('hex')}  ${name}`).join('\n'));
    assert.equal(backupDecision(root)[0], 'PASS');
    writeFileSync(path.join(run, entries[0]), 'tampered');
    assert.equal(backupDecision(root)[0], 'FAIL');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
