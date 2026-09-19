import { createHash } from 'crypto';

export const MAX_ZUS_XML_BYTES = 5 * 1024 * 1024;

export type ZusDocumentType = 'DRA' | 'RCA';

export class ZusDeclarationValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ZusDeclarationValidationError';
    }
}

// This is intentionally structural validation only. ZUS publishes the EWD
// schemas/rules to certified interface providers; accepting a document here
// must never be represented as ZUS acceptance or a ready-to-send filing.
export function inspectZusDeclarationXml(xml: string): { documentTypes: ZusDocumentType[]; sha256: string } {
    if (!xml.trim().startsWith('<?xml') && !xml.trim().startsWith('<')) {
        throw new ZusDeclarationValidationError('Plik nie wygląda na dokument XML.');
    }
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
        throw new ZusDeclarationValidationError('Dokument XML nie może zawierać deklaracji DTD ani encji zewnętrznych.');
    }
    if (!/<(?:[\w-]+:)?(?:KEDU|ZUS_DRA|DRA|ZUS_RCA|RCA)(?:\s|\/?>)/i.test(xml)) {
        throw new ZusDeclarationValidationError('Nie rozpoznano dokumentu ZUS DRA ani RCA.');
    }

    const documentTypes: ZusDocumentType[] = [];
    if (/<(?:[\w-]+:)?(?:ZUS_)?DRA(?:\s|\/?>)/i.test(xml)) documentTypes.push('DRA');
    if (/<(?:[\w-]+:)?(?:ZUS_)?RCA(?:\s|\/?>)/i.test(xml)) documentTypes.push('RCA');
    if (documentTypes.length === 0) {
        throw new ZusDeclarationValidationError('Pakiet musi zawierać co najmniej dokument DRA lub RCA.');
    }

    return { documentTypes, sha256: createHash('sha256').update(xml, 'utf8').digest('hex') };
}

export function safeZusFilename(name: string): string {
    const cleaned = name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 255);
    return cleaned || 'zus-deklaracja.xml';
}
