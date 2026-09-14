import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'fs';
import { join } from 'path';

// Before this fix, settings/route.ts's update_password action always wrote
// firms.admin_password_hash - the firm owner's credential - regardless of
// who called it. Once firm_users login started working (auth-firm-user-
// login.test.ts), that meant an invited team member had no way to ever
// change the password they were invited with: the only password-change
// action in the product would have silently overwritten the OWNER's
// password instead of their own (or, after gating it owner-only, simply
// 403'd them forever). Proves the real fix: the action now branches on
// session.userId (null for the owner, the firm_users.id for a member) and
// only ever touches that identity's own row.

const ROOT = join(__dirname, '..', '..', '..', '..');

async function changeOwnPassword(
    db: PGlite,
    session: { firmId: number; userId: number | null },
    currentPassword: string,
    newPassword: string
): Promise<{ ok: boolean; error?: string }> {
    if (session.userId) {
        const result = await db.query<{ password_hash: string }>(
            `SELECT password_hash FROM firm_users WHERE id = $1 AND firm_id = $2`, [session.userId, session.firmId]
        );
        const isValid = await bcrypt.compare(currentPassword, result.rows[0]?.password_hash || '');
        if (!isValid) return { ok: false, error: 'Nieprawidłowe obecne hasło' };
        const hash = await bcrypt.hash(newPassword, 10);
        await db.query(`UPDATE firm_users SET password_hash = $1 WHERE id = $2`, [hash, session.userId]);
        return { ok: true };
    }

    const result = await db.query<{ admin_password_hash: string }>(
        `SELECT admin_password_hash FROM firms WHERE id = $1`, [session.firmId]
    );
    const isValid = await bcrypt.compare(currentPassword, result.rows[0]?.admin_password_hash || '');
    if (!isValid) return { ok: false, error: 'Nieprawidłowe obecne hasło' };
    const hash = await bcrypt.hash(newPassword, 10);
    await db.query(`UPDATE firms SET admin_password_hash = $1 WHERE id = $2`, [hash, session.firmId]);
    return { ok: true };
}

describe('settings/route.ts update_password: branches by identity, not role', () => {
    let db: PGlite;
    let firmId: number;
    let memberId: number;

    beforeAll(async () => {
        db = new PGlite();
        for (const file of ['ksef-schema.sql', 'ksef-schema-migration.sql', 'ksef-schema-migration-v2.sql', join('migrations', 'sprint9-13.sql')]) {
            await db.exec(readFileSync(join(ROOT, file), 'utf8'));
        }

        const ownerHash = await bcrypt.hash('owner-original', 10);
        const firmRes = await db.query<{ id: number }>(
            `INSERT INTO firms (firm_name, slug, admin_email, admin_password_hash) VALUES ('Firm A', 'firm-a', 'owner@example.com', $1) RETURNING id`,
            [ownerHash]
        );
        firmId = firmRes.rows[0].id;

        const memberHash = await bcrypt.hash('member-original', 10);
        const memberRes = await db.query<{ id: number }>(
            `INSERT INTO firm_users (firm_id, email, password_hash, full_name, role, is_active) VALUES ($1, $2, $3, 'A Member', 'member', true) RETURNING id`,
            [firmId, 'member@example.com', memberHash]
        );
        memberId = memberRes.rows[0].id;
    });

    afterAll(async () => {
        await db.close();
    });

    it("a team member (userId set) changing their password touches firm_users, not firms — the fix", async () => {
        const res = await changeOwnPassword(db, { firmId, userId: memberId }, 'member-original', 'member-new-password');
        expect(res.ok).toBe(true);

        const memberRow = await db.query<{ password_hash: string }>(`SELECT password_hash FROM firm_users WHERE id = $1`, [memberId]);
        expect(await bcrypt.compare('member-new-password', memberRow.rows[0].password_hash)).toBe(true);

        // The owner's row is untouched by the member's password change.
        const firmRow = await db.query<{ admin_password_hash: string }>(`SELECT admin_password_hash FROM firms WHERE id = $1`, [firmId]);
        expect(await bcrypt.compare('owner-original', firmRow.rows[0].admin_password_hash)).toBe(true);
    });

    it('the owner (userId null) changing their password touches firms, not firm_users', async () => {
        const res = await changeOwnPassword(db, { firmId, userId: null }, 'owner-original', 'owner-new-password');
        expect(res.ok).toBe(true);

        const firmRow = await db.query<{ admin_password_hash: string }>(`SELECT admin_password_hash FROM firms WHERE id = $1`, [firmId]);
        expect(await bcrypt.compare('owner-new-password', firmRow.rows[0].admin_password_hash)).toBe(true);
    });

    it("a member can't change their password with the wrong current password", async () => {
        const res = await changeOwnPassword(db, { firmId, userId: memberId }, 'totally-wrong', 'irrelevant');
        expect(res.ok).toBe(false);
    });
});
