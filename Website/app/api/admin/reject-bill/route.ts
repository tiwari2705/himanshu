import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { query } from '@/lib/db';
import { rejectBillSync } from '@/lib/sheets';

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('ims_session')?.value;
    const payload = verifyToken(token || '');

    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { bill_id, rejection_reason } = body;

    if (!bill_id) {
      return NextResponse.json({ error: 'Bill ID is required' }, { status: 400 });
    }

    const reason = (rejection_reason || 'Rejected by Admin').trim();

    const billRes = await query(
      `SELECT 
        b.*,
        p.name AS product_name,
        u.username AS worker_username
       FROM bills b
       JOIN products p ON b.product_id = p.id
       JOIN users u ON b.worker_id = u.id
       WHERE b.id = $1 AND b.status = 'PENDING'`,
      [bill_id]
    );

    if (billRes.rows.length === 0) {
      return NextResponse.json(
        { error: 'Pending bill not found' },
        { status: 404 }
      );
    }

    const bill = billRes.rows[0];

    // Mark REJECTED in PostgreSQL
    await query(
      `UPDATE bills 
       SET status = 'REJECTED', rejection_reason = $1, decided_by = $2, decided_at = NOW() 
       WHERE id = $3`,
      [reason, payload.userId, bill_id]
    );

    // Sync to Google Sheets
    try {
      await rejectBillSync({
        billId: bill.id,
        bill_number: bill.bill_number,
        worker_username: bill.worker_username,
        customer_name: bill.customer_name,
        product_name: bill.product_name,
        materials_summary: '-',
        total_metal_weight_kg: 0,
        final_total_inr: parseFloat(bill.final_total_inr),
        rejection_reason: reason,
      });
    } catch (e) {
      console.warn('Rejection ledger sync notice:', e);
    }

    return NextResponse.json({
      success: true,
      message: 'Bill rejected successfully.',
    });
  } catch (error: any) {
    console.error('Reject bill error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to reject bill' },
      { status: 500 }
    );
  }
}
