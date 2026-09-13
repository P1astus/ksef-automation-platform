import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import pool from '@/lib/db';
import { generateOptimaXml } from '@/lib/optima-mapper';

export async function POST(request: Request) {
    try {
        const session = await getSession();
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const invoiceIds = body.invoiceIds;

        if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
            return NextResponse.json({ error: 'No invoice IDs provided' }, { status: 400 });
        }

        // Connect to DB and fetch the selected invoices
        const client = await pool.connect();
        try {
            // Ensure the firm only exports their own invoices - filtered directly
            // on invoices.firm_id, not via a clients join on client_nip (a NIP can
            // now belong to more than one firm, so that join alone isn't safe)
            const query = `
        SELECT i.*
        FROM invoices i
        WHERE i.id = ANY($1::int[]) AND i.firm_id = $2
      `;
            const result = await client.query(query, [invoiceIds, session.firmId]);

            const invoices = result.rows;
            if (invoices.length === 0) {
                return NextResponse.json({ error: 'No matching invoices found or access denied' }, { status: 403 });
            }

            // Generate the Optima XML file
            const optimaXml = generateOptimaXml(invoices);

            // Return the XML payload as a downloadable file
            return new NextResponse(optimaXml, {
                status: 200,
                headers: {
                    'Content-Type': 'application/xml',
                    'Content-Disposition': 'attachment; filename="optima-export.xml"'
                }
            });

        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error exporting to Optima:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
