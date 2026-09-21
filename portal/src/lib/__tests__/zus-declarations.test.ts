import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inspectZusDeclarationXml, safeZusFilename, ZusDeclarationValidationError } from '@/lib/zus-declarations';
import { PGlite } from '@electric-sql/pglite';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

describe('ZUS declaration import inspection', () => {
    it('recognizes a DRA/RCA package and produces a stable content hash', () => {
        const xml = '<?xml version="1.0" encoding="UTF-8"?><KEDU><ZUS_DRA/><ZUS_RCA/></KEDU>';
        const inspected = inspectZusDeclarationXml(xml);
        expect(inspected.documentTypes).toEqual(['DRA', 'RCA']);
        expect(inspected.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(inspectZusDeclarationXml(xml).sha256).toBe(inspected.sha256);
    });

    it('does not mistake arbitrary XML for a ZUS declaration', () => {
        expect(() => inspectZusDeclarationXml('<invoice/>')).toThrow(ZusDeclarationValidationError);
    });

    it('rejects DTD/entity-bearing XML before it can reach storage', () => {
        expect(() => inspectZusDeclarationXml('<!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><ZUS_DRA/>'))
            .toThrow('DTD');
    });

    it('keeps source filenames safe for a Content-Disposition header', () => {
        expect(safeZusFilename('../../DRA raport; 09.xml')).toBe('.._.._DRA_raport__09.xml');
    });
});

describe('ZUS declaration migration', () => {
    let db: PGlite;

    beforeAll(async () => {
        db = new PGlite();
        const root = join(__dirname, '..', '..', '..', '..');
        await db.exec('CREATE TABLE firms (id INTEGER PRIMARY KEY, firm_name TEXT NOT NULL, slug TEXT NOT NULL, admin_email TEXT NOT NULL, admin_password_hash TEXT NOT NULL)');
        await db.exec(readFileSync(join(root, 'migrations', '2026-09-19-zus-declarations.sql'), 'utf8'));
        const immutableMigration = join(root, 'db', 'migrations', '2026-09-22-zus-source-immutable.sql');
        if (existsSync(immutableMigration)) await db.exec(readFileSync(immutableMigration, 'utf8'));
        await db.exec("INSERT INTO firms (id, firm_name, slug, admin_email, admin_password_hash) VALUES (1, 'A', 'a', 'a@x.pl', 'x'), (2, 'B', 'b', 'b@x.pl', 'x')");
    });

    afterAll(async () => { await db.close(); });

    it('keeps same-NIP declaration records isolated by firm and audits them', async () => {
        const values = ['1234567890', '2026-09', ['DRA', 'RCA'], 'dra.xml', '<KEDU><ZUS_DRA/><ZUS_RCA/></KEDU>', 'a'.repeat(64)];
        const first = await db.query<{ id: number }>('INSERT INTO zus_declarations (firm_id, client_nip, period, document_types, source_filename, source_xml, sha256) VALUES (1, $1, $2, $3, $4, $5, $6) RETURNING id', values);
        await expect(db.query('INSERT INTO zus_declarations (firm_id, client_nip, period, document_types, source_filename, source_xml, sha256) VALUES (2, $1, $2, $3, $4, $5, $6)', values)).resolves.toBeDefined();
        await db.query('INSERT INTO zus_declaration_events (declaration_id, firm_id, event_type) VALUES ($1, 1, $2)', [first.rows[0].id, 'imported']);
        const events = await db.query('SELECT id FROM zus_declaration_events WHERE firm_id = 1');
        expect(events.rows).toHaveLength(1);
    });

    it('rejects direct source XML and hash updates while allowing application metadata writes', async () => {
        const values = ['1234567890', '2026-10', ['DRA'], 'dra.xml', '<KEDU><ZUS_DRA/></KEDU>', 'b'.repeat(64)];
        const inserted = await db.query<{ id: number }>('INSERT INTO zus_declarations (firm_id, client_nip, period, document_types, source_filename, source_xml, sha256) VALUES (1, $1, $2, $3, $4, $5, $6) RETURNING id', values);
        const id = inserted.rows[0].id;
        await expect(db.query('UPDATE zus_declarations SET source_xml = $1 WHERE id = $2', ['<KEDU/>', id])).rejects.toThrow('immutable');
        await expect(db.query('UPDATE zus_declarations SET sha256 = $1 WHERE id = $2', ['c'.repeat(64), id])).rejects.toThrow('immutable');
        await expect(db.query('UPDATE zus_declarations SET source_filename = $1 WHERE id = $2', ['renamed.xml', id])).resolves.toBeDefined();
    });
});
