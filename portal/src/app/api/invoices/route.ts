import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: Request) {
    try {
        const session = await getSession();
        if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const search    = searchParams.get('search')    || '';
        const direction = searchParams.get('direction') || '';  // 'sales' | 'purchase' | ''
        const clientNip = searchParams.get('client_nip') || '';
        const page      = Math.max(1, parseInt(searchParams.get('page') || '1'));
        const limit     = 25;
        const offset    = (page - 1) * limit;

        const params: any[] = [session.firmId];
        const conditions: string[] = ['c.firm_id = $1'];

        if (direction === 'sales' || direction === 'purchase') {
            params.push(direction);
            conditions.push(`i.direction = $${params.length}`);
        }

        if (clientNip) {
            params.push(clientNip);
            conditions.push(`c.nip = $${params.length}`);
        }

        if (search) {
            params.push(`%${search}%`);
            const n = params.length;
            conditions.push(`(i.invoice_number ILIKE $${n} OR i.ksef_number ILIKE $${n} OR c.client_name ILIKE $${n} OR i.buyer_name ILIKE $${n} OR i.seller_name ILIKE $${n})`);
        }

        const where = conditions.join(' AND ');

        // Total count
        // Join is scoped by firm_id on both sides - a NIP can now belong to
        // more than one firm, so joining on client_nip alone could match an
        // invoice to a different firm's client row and leak it through the
        // WHERE c.firm_id = $1 filter below.
        const countRes = await query(
            `SELECT COUNT(*)::int AS total
             FROM invoices i
             JOIN clients c ON i.client_nip = c.nip AND i.firm_id = c.firm_id
             WHERE ${where}`,
            params
        );
        const total = countRes.rows[0].total;

        // Paginated rows
        params.push(limit, offset);
        const invoicesRes = await query(
            `SELECT i.*, c.client_name
             FROM invoices i
             JOIN clients c ON i.client_nip = c.nip AND i.firm_id = c.firm_id
             WHERE ${where}
             ORDER BY i.created_at DESC
             LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );

        return NextResponse.json({
            invoices: invoicesRes.rows,
            total,
            page,
            totalPages: Math.ceil(total / limit),
            limit,
        });
    } catch (err: any) {
        console.error('Invoices GET error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
