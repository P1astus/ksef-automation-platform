import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { encrypt, decrypt, sessionRole, requireRole } from '../auth';
import { applyBaseline } from './helpers/baseline';

// Before this fix, an invited team member (firm_users) could complete the
// entire invite-accept flow and then never log in at all: auth/login/
// route.ts only ever queried firms.admin_email. This test replicates the
// route's actual two-stage lookup (firms first, then firm_users by email,
// bcrypt-checked one row at a time since firm_users.email is only unique
// per firm_id) against a real Postgres-compatible engine, the same
// convention settings/ksef/route.test.ts and tenancy.test.ts already use
// rather than invoking the Next.js handler directly (which needs next/
// headers' cookies() and this file's own pg pool, both awkward to mock).
//
// Round 11: the firm_users lookup never joined back to firms.is_active — a
// deactivated firm correctly locked out the owner login path, but an
// invited member's own is_active flag says nothing about the firm's, so
// they could keep logging in indefinitely after a billing lapse or ops
// deactivation. Fixed with a JOIN, replicated here the same way.

const ROOT = join(__dirname, '..', '..', '..', '..');

async function findFirmUserSession(db: PGlite, email: string, password: string) {
    const firmRes = await db.query<{ id: number; admin_password_hash: string; is_active: boolean }>(
        `SELECT id, admin_password_hash, is_active FROM firms WHERE admin_email = $1`, [email]
    );
    if (firmRes.rows.length > 0) {
        const firm = firmRes.rows[0];
        if (!firm.is_active) return null;
        if (!(await bcrypt.compare(password, firm.admin_password_hash))) return null;
        return { firmId: firm.id, role: 'owner' as const, userId: null };
    }

    const memberRes = await db.query<{ id: number; firm_id: number; password_hash: string; role: string; is_active: boolean }>(
        `SELECT fu.id, fu.firm_id, fu.password_hash, fu.role, fu.is_active
         FROM firm_users fu JOIN firms f ON f.id = fu.firm_id
         WHERE fu.email = $1 AND f.is_active = true`, [email]
    );
    for (const member of memberRes.rows) {
        if (!member.is_active) continue;
        if (await bcrypt.compare(password, member.password_hash)) {
            return { firmId: member.firm_id, role: member.role, userId: member.id };
        }
    }
    return null;
}

describe('firm_users login (the gap: invited members could never log in)', () => {
    let db: PGlite;
    let firmId: number;

    beforeAll(async () => {
        db = new PGlite();
        await applyBaseline(db);

        const ownerHash = await bcrypt.hash('owner-password', 10);
        const firmRes = await db.query<{ id: number }>(
            `INSERT INTO firms (firm_name, slug, admin_email, admin_password_hash) VALUES ('Firm A', 'firm-a', 'owner@example.com', $1) RETURNING id`,
            [ownerHash]
        );
        firmId = firmRes.rows[0].id;

        const memberHash = await bcrypt.hash('member-password', 10);
        await db.query(
            `INSERT INTO firm_users (firm_id, email, password_hash, full_name, role, is_active) VALUES ($1, $2, $3, 'A Member', 'member', true)`,
            [firmId, 'member@example.com', memberHash]
        );

        const inactiveHash = await bcrypt.hash('inactive-password', 10);
        await db.query(
            `INSERT INTO firm_users (firm_id, email, password_hash, full_name, role, is_active) VALUES ($1, $2, $3, 'Deactivated', 'admin', false)`,
            [firmId, 'inactive@example.com', inactiveHash]
        );

        const deactivatedFirmHash = await bcrypt.hash('owner-password-2', 10);
        const deactivatedFirmRes = await db.query<{ id: number }>(
            `INSERT INTO firms (firm_name, slug, admin_email, admin_password_hash, is_active) VALUES ('Firm B (deactivated)', 'firm-b', 'owner2@example.com', $1, false) RETURNING id`,
            [deactivatedFirmHash]
        );
        const deactivatedFirmMemberHash = await bcrypt.hash('member-password-2', 10);
        await db.query(
            `INSERT INTO firm_users (firm_id, email, password_hash, full_name, role, is_active) VALUES ($1, $2, $3, 'Member Of Deactivated Firm', 'member', true)`,
            [deactivatedFirmRes.rows[0].id, 'member-of-deactivated@example.com', deactivatedFirmMemberHash]
        );
    });

    afterAll(async () => {
        await db.close();
    });

    it('the firm owner logs in with role "owner" and no userId', async () => {
        const session = await findFirmUserSession(db, 'owner@example.com', 'owner-password');
        expect(session).toEqual({ firmId, role: 'owner', userId: null });
    });

    it('an invited, active team member logs in with their own role and userId — the fix', async () => {
        const session = await findFirmUserSession(db, 'member@example.com', 'member-password');
        expect(session?.firmId).toBe(firmId);
        expect(session?.role).toBe('member');
        expect(session?.userId).not.toBeNull();
    });

    it('a deactivated team member cannot log in even with the correct password', async () => {
        const session = await findFirmUserSession(db, 'inactive@example.com', 'inactive-password');
        expect(session).toBeNull();
    });

    it('an active team member of a deactivated firm cannot log in — the round 11 fix', async () => {
        const session = await findFirmUserSession(db, 'member-of-deactivated@example.com', 'member-password-2');
        expect(session).toBeNull();
    });

    it('rejects a wrong password for both the owner and a team member', async () => {
        expect(await findFirmUserSession(db, 'owner@example.com', 'wrong')).toBeNull();
        expect(await findFirmUserSession(db, 'member@example.com', 'wrong')).toBeNull();
    });

    it('rejects an email that matches neither firms nor firm_users', async () => {
        expect(await findFirmUserSession(db, 'nobody@example.com', 'whatever')).toBeNull();
    });
});

describe('session role encoding and requireRole gating', () => {
    it('round-trips role and userId through encrypt/decrypt', async () => {
        process.env.JWT_SECRET = 'test-only-secret-not-a-real-credential';
        const token = await encrypt({ firmId: 1, adminEmail: 'a@b.com', role: 'admin', userId: 7 });
        const payload = await decrypt(token);
        expect(payload.role).toBe('admin');
        expect(payload.userId).toBe(7);
    });

    it('sessionRole defaults to "owner" for a session with no role field (pre-existing sessions)', () => {
        expect(sessionRole({})).toBe('owner');
    });

    it('requireRole returns 401 for no session', async () => {
        const res = await requireRole(null, ['owner']);
        expect(res?.status).toBe(401);
    });

    it('requireRole returns null (allowed) when the session role is in the allowed list', async () => {
        const res = await requireRole({ role: 'admin' }, ['owner', 'admin']);
        expect(res).toBeNull();
    });

    it('requireRole returns 403 when the session role is not in the allowed list', async () => {
        const res = await requireRole({ role: 'member' }, ['owner', 'admin']);
        expect(res?.status).toBe(403);
    });

    it('requireRole treats a role-less session as owner (allowed)', async () => {
        const res = await requireRole({}, ['owner']);
        expect(res).toBeNull();
    });
});
