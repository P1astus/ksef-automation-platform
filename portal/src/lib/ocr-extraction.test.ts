import { describe, it, expect } from 'vitest';
import { extractInvoiceFields, needsManualReview } from './ocr-extraction';

describe('extractInvoiceFields / needsManualReview', () => {
    it('extracts NIP, invoice number and amounts from clean invoice text', () => {
        const fields = extractInvoiceFields('Sprzedawca: Acme Sp. z o.o. NIP: 123-456-32-18 Faktura VAT nr FV/1/2026 Do zapłaty: 123,00 PLN');
        expect(fields.nip).toBe('1234563218');
        expect(fields.nipMatched).toBe(true);
        expect(fields.invoiceNumber).toBe('FV/1/2026');
        expect(fields.grossAmount).toBe(123);
        expect(needsManualReview(fields)).toBe(false);
    });

    it('flags for review when no NIP is found', () => {
        const fields = extractInvoiceFields('Faktura VAT nr FV/1/2026 Do zapłaty: 123,00 PLN');
        expect(fields.nipMatched).toBe(false);
        expect(fields.nip).toBe('NIEZNANY');
        expect(needsManualReview(fields)).toBe(true);
    });

    it('flags for review when no invoice number is found', () => {
        const fields = extractInvoiceFields('NIP: 123-456-32-18 Do zapłaty: 123,00 PLN');
        expect(fields.invoiceNumber).toBeNull();
        expect(needsManualReview(fields)).toBe(true);
    });

    it('flags for review when no amount at all is found', () => {
        const fields = extractInvoiceFields('NIP: 123-456-32-18 Faktura VAT nr FV/1/2026');
        expect(fields.grossAmount).toBe(0);
        expect(needsManualReview(fields)).toBe(true);
    });

    it('flags for review when net+VAT does not reconcile to gross', () => {
        const fields = extractInvoiceFields('x');
        const tampered = { ...fields, nipMatched: true, invoiceNumber: 'FV/1', grossAmount: 100, netAmount: 50, vatAmount: 10 };
        expect(needsManualReview(tampered)).toBe(true);
    });
});
