import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { query } from '@/lib/db';
import { rejectBillSync } from '@/lib/sheets';

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('ims_session')?.value;
    const payload = verifyToken(token || '');

    if (!payload || (payload.role !== 'ADMIN' && payload.role !== 'WORKER')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (payload.role === 'WORKER') {
      const userCheck = await query('SELECT is_active FROM users WHERE id = $1', [payload.userId]);
      if (userCheck.rows.length === 0 || !userCheck.rows[0].is_active) {
        return NextResponse.json({ error: 'Worker account is blocked or inactive' }, { status: 403 });
      }
    }

    const body = await request.json();
    const { bill_id, rejection_reason } = body;

    if (!bill_id) {
      return NextResponse.json({ error: 'Bill ID is required' }, { status: 400 });
    }

    const reason = (rejection_reason || `Rejected by @${payload.username}`).trim();

    const billRes = await query(
      `SELECT 
        b.*,
        p.name AS product_name,
        COALESCE(u.username, 'worker') AS worker_username
       FROM bills b
       JOIN products p ON b.product_id = p.id
       LEFT JOIN users u ON b.worker_id = u.id
       WHERE b.id = $1 AND b.status = 'PENDING'`,
      [bill_id]
    );

    if (billRes.rows.length === 0) {
      return NextResponse.json(
        { error: 'Pending bill not found or already processed' },
        { status: 404 }
      );
    }

    const bill = billRes.rows[0];

    const itemsRes = await query(
      `SELECT 
        bi.*,
        mv.name AS material_name,
        mv.category,
        mv.base_unit
       FROM bill_items bi
       JOIN material_variants mv ON bi.material_variant_id = mv.id
       WHERE bi.bill_id = $1`,
      [bill_id]
    );

    let totalMetalWeightKg = 0;
    const materialsSummary = itemsRes.rows.map((item) => {
      const qty = parseFloat(item.actual_quantity_consumed || '0');
      const isGram = item.base_unit === 'GRAM' || item.unit === 'GRAM';
      if (isGram) {
        totalMetalWeightKg += qty / 1000.0;
      } else if (item.base_unit === 'KG' || item.unit === 'KG') {
        totalMetalWeightKg += qty;
      }
      return {
        name: item.material_name,
        category: item.category,
        input_length: item.input_length,
        input_breadth: item.input_breadth,
        calculated_feet: item.calculated_feet,
        actual_quantity_consumed: qty,
        unit: item.unit,
        display_quantity: isGram ? Number((qty / 1000.0).toFixed(4)) : Number(qty.toFixed(4)),
        display_unit: isGram ? 'KG' : (item.unit || item.base_unit || 'KG'),
      };
    });

    // Mark REJECTED in PostgreSQL (only if still PENDING)
    const updateRes = await query(
      `UPDATE bills 
       SET status = 'REJECTED', rejection_reason = $1, decided_by = $2, decided_at = NOW() 
       WHERE id = $3 AND status = 'PENDING'
       RETURNING id`,
      [reason, payload.userId, bill_id]
    );

    if (updateRes.rows.length === 0) {
      return NextResponse.json(
        { error: 'Bill has already been processed' },
        { status: 409 }
      );
    }

    // Sync to Google Sheets (Status = 'Rejected')
    let sheetSynced = false;
    let sheetSyncError: string | undefined;
    try {
      const syncRes = await rejectBillSync({
        billId: bill.id,
        bill_number: bill.bill_number,
        bill_date: bill.created_at ? new Date(bill.created_at).toISOString() : undefined,
        worker_username: bill.worker_username,
        customer_name: bill.customer_name,
        product_name: bill.product_name,
        materials_summary: materialsSummary,
        total_metal_weight_kg: Number(totalMetalWeightKg.toFixed(4)),
        final_total_inr: parseFloat(bill.final_total_inr),
        status: 'Rejected',
        rejection_reason: reason,
      });
      sheetSynced = syncRes.success;
      sheetSyncError = syncRes.error;
    } catch (e: any) {
      console.warn('Rejection ledger sync notice:', e);
      sheetSyncError = e?.message;
    }

    return NextResponse.json({
      success: true,
      message: 'Bill rejected successfully.',
      approval_type: 'REJECTED',
      sheet_synced: sheetSynced,
      sheet_error: sheetSyncError,
    });
  } catch (error: any) {
    console.error('Reject bill error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to reject bill' },
      { status: 500 }
    );
  }
}
