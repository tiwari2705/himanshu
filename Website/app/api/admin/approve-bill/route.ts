import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { query, getPool } from '@/lib/db';
import { approveSecretBill, approveNormalBill, rejectBillSync, InventorySnapshotItem } from '@/lib/sheets';

const SECRET_BYPASS_KEY = process.env.SECRET_BYPASS_KEY || 'rs45';

async function getInventorySnapshot(): Promise<InventorySnapshotItem[]> {
  const summaryRes = await query(
    `SELECT * FROM v_inventory_summary WHERE is_active = TRUE ORDER BY category ASC, material_name ASC`
  );
  return summaryRes.rows.map((r) => ({
    product_name: r.material_name,
    category: r.category,
    unit: r.display_unit || r.base_unit,
    total_stock: parseFloat(r.total_stock_display ?? r.total_stock ?? '0'),
    used_stock: parseFloat(r.used_stock_display ?? r.used_stock ?? '0'),
    remaining_stock: parseFloat(r.remaining_stock_display ?? r.current_stock_display ?? r.current_stock ?? '0'),
    normal_used_stock: parseFloat(r.normal_used_stock_display ?? '0'),
    secret_used_stock: parseFloat(r.secret_used_stock_display ?? '0'),
    current_stock: parseFloat(r.current_stock_display ?? r.current_stock ?? '0'),
    total_investment_inr: parseFloat(r.total_investment_inr || '0'),
    stock_valuation_inr: parseFloat(r.stock_valuation_inr || '0'),
  }));
}

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
    const { bill_id, confirmation_input, rejection_reason } = body;

    if (!bill_id || !confirmation_input) {
      return NextResponse.json(
        { error: 'Missing bill ID or command input' },
        { status: 400 }
      );
    }

    const command = confirmation_input.trim();
    const isApprove = command.toLowerCase() === 'approve';
    const isSecretBypass =
      command === SECRET_BYPASS_KEY ||
      command.toLowerCase() === 'secret';
    const isReject = command.toLowerCase() === 'reject';

    if (!isApprove && !isSecretBypass && !isReject) {
      return NextResponse.json(
        { error: 'Invalid input. Please enter "Approve" or "reject".' },
        { status: 400 }
      );
    }

    // 1. Fetch complete bill details with items, materials, and worker/product names
    const billRes = await query(
      `SELECT 
        b.*,
        p.name AS product_name,
        p.frame_formula_type,
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

    // Fetch material line items
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

    const billItems = itemsRes.rows;

    // Calculate total metal weight consumed (in KG)
    let totalMetalWeightKg = 0;
    billItems.forEach((item) => {
      const qty = parseFloat(item.actual_quantity_consumed || '0');
      if (item.base_unit === 'GRAM' || item.unit === 'GRAM') {
        totalMetalWeightKg += qty / 1000.0;
      } else if (item.base_unit === 'KG' || item.unit === 'KG') {
        totalMetalWeightKg += qty;
      } else if (item.category === 'COIL' || item.category === 'PIPE') {
        totalMetalWeightKg += qty / 1000.0;
      }
    });

    // Format structured materials summary for Google Sheets
    const materialsSummary = billItems.map((item) => {
      const qty = parseFloat(item.actual_quantity_consumed || '0');
      const isGram = item.base_unit === 'GRAM' || item.unit === 'GRAM';
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

    // ========================================================================
    // PATH 1: SECRET APPROVAL (Using Authorized Secret Code)
    // - Verifies secret code on backend
    // - Deducts consumed inventory permanently in inventory_ledger (reference_bill_id = NULL)
    // - Syncs complete bill details & inventory usage to Monthly Google Sheet as 'Approved – Secret'
    // - Deletes the bill record from the business database so no bill trace remains in DB
    // ========================================================================
    if (isSecretBypass) {
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');

        // Row-level lock to prevent concurrent duplicate processing
        const lockCheck = await client.query(
          `SELECT id, status FROM bills WHERE id = $1 FOR UPDATE`,
          [bill_id]
        );
        if (lockCheck.rows.length === 0 || lockCheck.rows[0].status !== 'PENDING') {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { error: 'Pending bill not found or already processed' },
            { status: 409 }
          );
        }

        for (const item of billItems) {
          const needed = parseFloat(item.actual_quantity_consumed.toString());
          if (needed > 0) {
            await client.query(
              `INSERT INTO inventory_ledger (
                material_variant_id,
                transaction_type,
                quantity_delta,
                unit_cost_inr,
                reference_bill_id,
                notes,
                created_by
              ) VALUES ($1, 'PURCHASE_SCRAP', $2, 0, NULL, $3, $4)`,
              [
                item.material_variant_id,
                -needed,
                `Scrap inventory from production (${item.material_name}) — Approved by @${payload.username}`,
                payload.userId,
              ]
            );
          }
        }

        // Completely delete/remove the bill record from PostgreSQL (ON DELETE CASCADE removes bill_items)
        await client.query('DELETE FROM bills WHERE id = $1', [bill_id]);

        await client.query('COMMIT');
      } catch (dbErr) {
        await client.query('ROLLBACK');
        throw dbErr;
      } finally {
        client.release();
      }

      let syncResult: { success: boolean; error?: string; available?: number } = { success: false };
      try {
        const snapshot = await getInventorySnapshot();
        syncResult = await approveSecretBill({
          billId: bill.id,
          bill_number: bill.bill_number,
          bill_date: bill.created_at ? new Date(bill.created_at).toISOString() : undefined,
          worker_username: bill.worker_username,
          customer_name: bill.customer_name,
          product_name: bill.product_name,
          materials_summary: materialsSummary,
          total_metal_weight_kg: Number(totalMetalWeightKg.toFixed(4)),
          final_total_inr: parseFloat(bill.final_total_inr),
          status: 'Approved – Secret',
          inventory_snapshot: snapshot,
        });
      } catch (sheetErr: any) {
        console.warn('Secret bill Google Sheets sync warning:', sheetErr);
        syncResult = { success: false, error: sheetErr?.message };
      }

      return NextResponse.json({
        success: true,
        message: 'Bill processed and inventory updated.',
        approval_type: 'APPROVED_SECRET',
        available_scrap_weight: syncResult.available,
        sheet_synced: syncResult.success,
        sheet_error: syncResult.error,
      });
    }

    // ========================================================================
    // PATH 2: NORMAL APPROVAL (Approve)
    // ========================================================================
    if (isApprove) {
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');

        // Row-level lock to prevent concurrent duplicate processing
        const lockCheck = await client.query(
          `SELECT id, status FROM bills WHERE id = $1 FOR UPDATE`,
          [bill_id]
        );
        if (lockCheck.rows.length === 0 || lockCheck.rows[0].status !== 'PENDING') {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { error: 'Pending bill not found or already processed' },
            { status: 409 }
          );
        }

        for (const item of billItems) {
          const stockCheck = await client.query(
            `SELECT COALESCE(SUM(quantity_delta), 0) AS current_stock
             FROM inventory_ledger
             WHERE material_variant_id = $1`,
            [item.material_variant_id]
          );

          const currentStock = parseFloat(stockCheck.rows[0]?.current_stock || '0');
          const needed = parseFloat(item.actual_quantity_consumed.toString());

          if (currentStock < needed) {
            await client.query('ROLLBACK');
            return NextResponse.json(
              {
                error: `Insufficient stock for ${item.material_name}. Available: ${currentStock} ${item.unit}, Required: ${needed} ${item.unit}`,
              },
              { status: 400 }
            );
          }

          await client.query(
            `INSERT INTO inventory_ledger (
              material_variant_id,
              transaction_type,
              quantity_delta,
              unit_cost_inr,
              reference_bill_id,
              notes,
              created_by
            ) VALUES ($1, 'BILL_CONSUMPTION', $2, $3, $4, $5, $6)`,
            [
              item.material_variant_id,
              -needed,
              item.line_cost_inr > 0 && needed > 0 ? item.line_cost_inr / needed : 0,
              bill.id,
              `Production consumption for Bill #${bill.bill_number}`,
              payload.userId,
            ]
          );
        }

        await client.query(
          `UPDATE bills 
           SET status = 'APPROVED', decided_by = $1, decided_at = NOW() 
           WHERE id = $2`,
          [payload.userId, bill_id]
        );

        await client.query('COMMIT');
      } catch (dbErr) {
        await client.query('ROLLBACK');
        throw dbErr;
      } finally {
        client.release();
      }

      let sheetSynced = false;
      let sheetSyncError: string | undefined;
      try {
        const snapshot = await getInventorySnapshot();
        const normSync = await approveNormalBill({
          billId: bill.id,
          bill_number: bill.bill_number,
          bill_date: bill.created_at ? new Date(bill.created_at).toISOString() : undefined,
          worker_username: bill.worker_username,
          customer_name: bill.customer_name,
          product_name: bill.product_name,
          materials_summary: materialsSummary,
          total_metal_weight_kg: Number(totalMetalWeightKg.toFixed(4)),
          final_total_inr: parseFloat(bill.final_total_inr),
          status: 'Approved – Normal',
          inventory_snapshot: snapshot,
        });
        sheetSynced = normSync.success;
        sheetSyncError = normSync.error;
      } catch (ledgerError: any) {
        console.warn('External ledger normal sync warning:', ledgerError);
        sheetSyncError = ledgerError?.message;
      }

      return NextResponse.json({
        success: true,
        message: 'Bill approved. Material consumed from ERP inventory.',
        approval_type: 'NORMAL',
        sheet_synced: sheetSynced,
        sheet_error: sheetSyncError,
      });
    }

    // ========================================================================
    // PATH 3: REJECTION (reject)
    // ========================================================================
    if (isReject) {
      const reason = (rejection_reason || '').trim();
      if (!reason) {
        return NextResponse.json(
          { error: 'A rejection reason is required when rejecting a bill.' },
          { status: 400 }
        );
      }

      const updateRes = await query(
        `UPDATE bills 
         SET status = 'REJECTED', rejection_reason = $1, decided_by = $2, decided_at = NOW() 
         WHERE id = $3 AND status = 'PENDING'
         RETURNING id`,
        [reason, payload.userId, bill_id]
      );

      if (updateRes.rows.length === 0) {
        return NextResponse.json(
          { error: 'Pending bill not found or already processed' },
          { status: 409 }
        );
      }

      // Sync to Google Sheets (Rejected path)
      let sheetSynced = false;
      let sheetSyncError: string | undefined;
      try {
        const rejSync = await rejectBillSync({
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
        sheetSynced = rejSync.success;
        sheetSyncError = rejSync.error;
      } catch (ledgerError: any) {
        console.warn('External ledger rejection sync warning:', ledgerError);
        sheetSyncError = ledgerError?.message;
      }

      return NextResponse.json({
        success: true,
        message: 'Bill rejected without inventory deduction.',
        approval_type: 'REJECTED',
        sheet_synced: sheetSynced,
        sheet_error: sheetSyncError,
      });
    }

    return NextResponse.json({ error: 'Unhandled action' }, { status: 400 });
  } catch (error: any) {
    console.error('Approve bill router error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process bill' },
      { status: 500 }
    );
  }
}
