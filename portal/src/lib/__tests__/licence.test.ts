import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { licencePublicKey, verifyLicence, licenceWarningDays, licenceExpired, loadFirmLicence, assertLicenceStartup } from '../licence';

const db = vi.fn();
vi.mock('../db', () => ({ query: (...args: unknown[]) => db(...args) }));
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const other = generateKeyPairSync('ed25519');
const now = new Date('2026-09-22T12:00:00.000Z');
const payload = { version: 1, firm_name: 'Test Sp z oo', firm_nip: '1234567890', plan: 'biznes', max_clients: 30, issued_at: '2026-09-01T00:00:00.000Z', expires_on: '2026-10-31' };
function issue(value: object = payload, key = privateKey) {
    const bytes = Buffer.from(JSON.stringify(value));
    return JSON.stringify({ payload: bytes.toString('base64url'), signature: sign(null, bytes, key).toString('base64url') });
}
afterEach(() => { db.mockReset(); delete process.env.LICENCE_PUBLIC_KEY_BASE64; delete process.env.LICENCE_PUBLIC_KEY_PATH; });

describe('offline Ed25519 licence', () => {
    it('accepts a signed licence, enforces its tier/cap and warning threshold', () => {
        const p = verifyLicence(issue(), publicKey, now);
        expect(p.plan).toBe('biznes'); expect(p.max_clients).toBe(30);
        expect(licenceExpired(p, now)).toBe(false);
        expect(licenceWarningDays(p, new Date('2026-09-30T00:00:00Z'))).toBeNull();
        expect(licenceWarningDays(p, new Date('2026-10-02T00:00:00Z'))).toBe(30);
        expect(licenceWarningDays(p, new Date('2026-11-01T00:00:00Z'))).toBe(0);
        expect(licenceExpired(p, new Date('2026-11-01T00:00:00Z'))).toBe(true);
    });
    it('rejects tampering, wrong signatures, malformed files and bad schema', () => {
        const env = JSON.parse(issue()); env.payload = Buffer.from(JSON.stringify({ ...payload, max_clients: 999 })).toString('base64url');
        expect(() => verifyLicence(JSON.stringify(env), publicKey, now)).toThrow(/signature/);
        expect(() => verifyLicence(issue(payload, other.privateKey), publicKey, now)).toThrow(/signature/);
        expect(() => verifyLicence('{', publicKey, now)).toThrow(/Malformed/);
        for (const bad of [{ ...payload, plan: 'gold' }, { ...payload, max_clients: 0 }, { ...payload, max_clients: 51 }, { ...payload, firm_nip: undefined }]) expect(() => verifyLicence(issue(bad), publicKey, now)).toThrow(/payload/);
    });
    it('rejects a clock before issuance and an absent or invalid public key', () => {
        expect(() => verifyLicence(issue(), publicKey, new Date('2026-08-31T23:59:59Z'))).toThrow(/clock/);
        expect(() => licencePublicKey()).toThrow(/required/);
        process.env.LICENCE_PUBLIC_KEY_BASE64 = Buffer.from('wrong').toString('base64');
        expect(() => licencePublicKey()).toThrow(/valid/);
    });
    it('starts with a configured public key and no installed licence', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'ksef-licence-test-'));
        try {
            const path = join(dir, 'public.pem');
            writeFileSync(path, publicKey.export({ type: 'spki', format: 'pem' }));
            process.env.LICENCE_PUBLIC_KEY_PATH = path;
            db.mockResolvedValueOnce({ rows: [] });
            await expect(assertLicenceStartup()).resolves.toBeUndefined();
            db.mockResolvedValueOnce({ rows: [{ firm_nip: '1234567890', firm_name: payload.firm_name, signed_blob: null }] });
            expect(await loadFirmLicence(1, now)).toEqual({ payload: null, state: 'licence_missing' });
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });
    it('refuses wrong NIP and DB expiry tampering cannot extend the signed term', async () => {
        process.env.LICENCE_PUBLIC_KEY_BASE64 = Buffer.from(publicKey.export({ type: 'spki', format: 'pem' })).toString('base64');
        db.mockResolvedValueOnce({ rows: [{ firm_nip: '0000000000', firm_name: payload.firm_name, signed_blob: issue() }] });
        await expect(loadFirmLicence(1, now)).rejects.toThrow(/NIP/);
        db.mockResolvedValueOnce({ rows: [{ firm_nip: payload.firm_nip, firm_name: payload.firm_name, subscription_status: 'active', signed_blob: issue(), trial_expires_at: '2099-01-01' }] });
        db.mockResolvedValueOnce({ rows: [{ id: 1 }] });
        db.mockResolvedValueOnce({ rows: [] });
        expect((await loadFirmLicence(1, new Date('2026-11-01T00:00:00Z'))).state).toBe('licence_expired');
        expect(db.mock.calls.some(call => String(call[0]).includes('subscription_tier = $2') && call[1][1] === 'biznes' && call[1][2] === 30)).toBe(true);
    });
});
