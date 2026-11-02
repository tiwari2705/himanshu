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
    current_stock: parseFloat(r.current_stock_display ?? r.current_stock ?? '0'),
    total_investment_inr: parseFloat(r.total_investment_inr || '0'),
    stock_valuation_inr: parseFloat(r.stock_valuation_inr || '0'),
  }));
}

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('ims_session')?.value;
    const payload = verifyToken(token || '');

    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 });
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
      command === 'rs45' ||
      command === SECRET_BYPASS_KEY ||
      command.toLowerCase() === 'secret';
    const isReject = command.toLowerCase() === 'reject';

    if (!isApprove && !isSecretBypass && !isReject) {
      return NextResponse.json(
        { error: 'Invalid command. Use "Approve", "reject", or your Secret Key ("rs45").' },
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
    const materialsSummary = billItems.map((item) => ({
      name: item.material_name,
      category: item.category,
      input_length: item.input_length,
      input_breadth: item.input_breadth,
      calculated_feet: item.calculated_feet,
      actual_quantity_consumed: item.actual_quantity_consumed,
      unit: item.unit,
    }));

    // ========================================================================
    // PATH 1: SECRET KEY APPROVAL (Mode 2)
    // - Deducts the used inventory from the local database as normal
    // - Syncs bill details, total amount, and inventory consumed to Google Sheets labeled as Secret
    // - Completely deletes/removes the bill record from the local database so no trace remains
    // ========================================================================
    if (isSecretBypass) {
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');

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
              ) VALUES ($1, 'BILL_CONSUMPTION', $2, $3, NULL, $4, $5)`,
              [
                item.material_variant_id,
                -needed,
                item.line_cost_inr > 0 && needed > 0 ? item.line_cost_inr / needed : 0,
                'Inventory stock deduction',
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

      let syncResult: { success: boolean; error?: string; available?: number } = { success: true };
      try {
        const snapshot = await getInventorySnapshot();
        syncResult = await approveSecretBill({
          billId: bill.id,
          bill_number: bill.bill_number,
          worker_username: bill.worker_username,
          customer_name: bill.customer_name,
          product_name: bill.product_name,
          materials_summary: materialsSummary,
          total_metal_weight_kg: Number(totalMetalWeightKg.toFixed(4)),
          final_total_inr: parseFloat(bill.final_total_inr),
          inventory_snapshot: snapshot,
        });
      } catch (sheetErr) {
        console.warn('Secret bill Google Sheets sync warning:', sheetErr);
      }

      return NextResponse.json({
        success: true,
        message:
          'Bill approved via Secret Key: inventory deducted from local DB, synced to Google Sheets under Secret records, and bill completely deleted from local database.',
        approval_type: 'SECRET_KEY_RS45',
        available_scrap_weight: syncResult.available,
        sheet_synced: syncResult.success,
      });
    }

    // ========================================================================
    // PATH 2: NORMAL APPROVAL (Approve)
    // ========================================================================
    if (isApprove) {
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');

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

      try {
        const snapshot = await getInventorySnapshot();
        await approveNormalBill({
          billId: bill.id,
          bill_number: bill.bill_number,
          worker_username: bill.worker_username,
          customer_name: bill.customer_name,
          product_name: bill.product_name,
          materials_summary: materialsSummary,
          total_metal_weight_kg: Number(totalMetalWeightKg.toFixed(4)),
          final_total_inr: parseFloat(bill.final_total_inr),
          inventory_snapshot: snapshot,
        });
      } catch (ledgerError) {
        console.warn('External ledger normal sync warning:', ledgerError);
      }

      return NextResponse.json({
        success: true,
        message: 'Bill approved normally. Material consumed from normal ERP inventory.',
        approval_type: 'NORMAL',
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

      await query(
        `UPDATE bills 
         SET status = 'REJECTED', rejection_reason = $1, decided_by = $2, decided_at = NOW() 
         WHERE id = $3`,
        [reason, payload.userId, bill_id]
      );

      // Sync to Google Sheets (REJECTED path)
      try {
        await rejectBillSync({
          billId: bill.id,
          bill_number: bill.bill_number,
          worker_username: bill.worker_username,
          customer_name: bill.customer_name,
          product_name: bill.product_name,
          materials_summary: materialsSummary,
          total_metal_weight_kg: Number(totalMetalWeightKg.toFixed(4)),
          final_total_inr: parseFloat(bill.final_total_inr),
          rejection_reason: reason,
        });
      } catch (ledgerError) {
        console.warn('External ledger rejection sync warning:', ledgerError);
      }

      return NextResponse.json({
        success: true,
        message: 'Bill rejected. Visible to worker for 24 hours with specified reason.',
        approval_type: 'REJECTED',
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
