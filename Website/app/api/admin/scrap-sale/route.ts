import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { query, getPool } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('ims_session')?.value;
    const payload = verifyToken(token || '');

    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const scrapRes = await query(
      `SELECT 
        il.id,
        il.material_variant_id,
        il.transaction_type,
        il.quantity_delta,
        il.unit_cost_inr,
        il.notes,
        il.created_at,
        mv.name AS material_name,
        mv.category,
        mv.base_unit,
        u.username AS created_by_username
       FROM inventory_ledger il
       JOIN material_variants mv ON il.material_variant_id = mv.id
       LEFT JOIN users u ON il.created_by = u.id
       WHERE il.quantity_delta < 0
         AND (
           il.transaction_type IN ('PURCHASE_SCRAP', 'SCRAP_SALE')
           OR (il.transaction_type = 'BILL_CONSUMPTION' AND il.reference_bill_id IS NULL)
         )
       ORDER BY il.created_at DESC`
    );

    const unsoldScrap: any[] = [];
    const soldScrap: any[] = [];
    const summaryMap: Record<string, {
      material_variant_id: string;
      material_name: string;
      category: string;
      unit: string;
      total_scrap_generated: number;
      unsold_scrap: number;
      sold_scrap: number;
      sold_revenue_inr: number;
    }> = {};

    let totalUnsoldQty = 0;
    let totalSoldQty = 0;
    let totalSoldRevenueInr = 0;

    for (const row of scrapRes.rows) {
      const absBaseQty = Math.abs(parseFloat(row.quantity_delta));
      const displayQty = row.base_unit === 'GRAM' ? absBaseQty / 1000.0 : absBaseQty;
      const displayUnit = row.base_unit === 'GRAM' ? 'KG' : row.base_unit;
      const isSold = row.transaction_type === 'SCRAP_SALE';
      const totalAmt = isSold ? Math.round(absBaseQty * parseFloat(row.unit_cost_inr || '0') * 100) / 100 : 0;

      const entryObj = {
        id: row.id,
        material_variant_id: row.material_variant_id,
        transaction_type: isSold ? 'SCRAP_SALE' : 'PURCHASE_SCRAP',
        item_name: row.material_name,
        category: row.category,
        quantity_kg: Number(displayQty.toFixed(2)),
        quantity_display: Number(displayQty.toFixed(2)),
        unit: displayUnit,
        total_amount: totalAmt,
        status: isSold ? 'SOLD' : 'UNSOLD',
        notes: row.notes,
        created_at: row.created_at,
        created_by: row.created_by_username || 'admin',
      };

      if (isSold) {
        soldScrap.push(entryObj);
        totalSoldQty += displayQty;
        totalSoldRevenueInr += totalAmt;
      } else {
        unsoldScrap.push(entryObj);
        totalUnsoldQty += displayQty;
      }

      const vid = row.material_variant_id;
      if (!summaryMap[vid]) {
        summaryMap[vid] = {
          material_variant_id: vid,
          material_name: row.material_name,
          category: row.category,
          unit: displayUnit,
          total_scrap_generated: 0,
          unsold_scrap: 0,
          sold_scrap: 0,
          sold_revenue_inr: 0,
        };
      }
      summaryMap[vid].total_scrap_generated = Number((summaryMap[vid].total_scrap_generated + displayQty).toFixed(2));
      if (isSold) {
        summaryMap[vid].sold_scrap = Number((summaryMap[vid].sold_scrap + displayQty).toFixed(2));
        summaryMap[vid].sold_revenue_inr = Number((summaryMap[vid].sold_revenue_inr + totalAmt).toFixed(2));
      } else {
        summaryMap[vid].unsold_scrap = Number((summaryMap[vid].unsold_scrap + displayQty).toFixed(2));
      }
    }

    return NextResponse.json({
      unsold_scrap: unsoldScrap,
      sales: soldScrap,
      summary: Object.values(summaryMap),
      totals: {
        total_unsold_qty: Number(totalUnsoldQty.toFixed(2)),
        total_sold_qty: Number(totalSoldQty.toFixed(2)),
        total_sold_revenue_inr: Number(totalSoldRevenueInr.toFixed(2)),
      },
    });
  } catch (error: any) {
    console.error('Fetch scrap inventory & sales error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('ims_session')?.value;
    const payload = verifyToken(token || '');
    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { scrap_entry_id, material_variant_id, quantity, total_amount, notes } = body;
    const numQtyDisplay = parseFloat(quantity);
    const numAmt = parseFloat(total_amount || '0');

    if (isNaN(numQtyDisplay) || numQtyDisplay <= 0) {
      return NextResponse.json({ error: 'Valid scrap quantity is required' }, { status: 400 });
    }
    if (isNaN(numAmt) || numAmt < 0) {
      return NextResponse.json({ error: 'Valid selling amount (₹) is required' }, { status: 400 });
    }

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');

      let unsoldQuery = `
        SELECT il.id, il.material_variant_id, il.quantity_delta, mv.name AS material_name, mv.base_unit
        FROM inventory_ledger il
        JOIN material_variants mv ON il.material_variant_id = mv.id
        WHERE il.quantity_delta < 0
          AND (
            il.transaction_type = 'PURCHASE_SCRAP'
            OR (il.transaction_type = 'BILL_CONSUMPTION' AND il.reference_bill_id IS NULL)
          )
      `;
      const queryParams: any[] = [];

      if (scrap_entry_id) {
        unsoldQuery += ` AND il.id = $1 FOR UPDATE`;
        queryParams.push(scrap_entry_id);
      } else if (material_variant_id) {
        unsoldQuery += ` AND il.material_variant_id = $1 ORDER BY il.created_at ASC FOR UPDATE`;
        queryParams.push(material_variant_id);
      } else {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Please select a scrap item to sell' }, { status: 400 });
      }

      const unsoldRes = await client.query(unsoldQuery, queryParams);
      if (unsoldRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'No unsold scrap available for the selected item' }, { status: 400 });
      }

      const baseUnit = unsoldRes.rows[0].base_unit;
      const variantName = unsoldRes.rows[0].material_name;
      const displayUnit = baseUnit === 'GRAM' ? 'KG' : baseUnit;
      const requestedBaseQty = baseUnit === 'GRAM' ? numQtyDisplay * 1000.0 : numQtyDisplay;

      const totalAvailableBaseQty = unsoldRes.rows.reduce(
        (acc: number, r: any) => acc + Math.abs(parseFloat(r.quantity_delta)),
        0
      );

      if (requestedBaseQty > totalAvailableBaseQty + 0.001) {
        await client.query('ROLLBACK');
        const availDisplay = baseUnit === 'GRAM' ? totalAvailableBaseQty / 1000.0 : totalAvailableBaseQty;
        return NextResponse.json(
          { error: `Cannot sell ${numQtyDisplay} ${displayUnit} — only ${availDisplay.toFixed(2)} ${displayUnit} of unsold scrap is available for ${variantName}.` },
          { status: 400 }
        );
      }

      const unitPriceInBase = requestedBaseQty > 0 ? numAmt / requestedBaseQty : 0;
      const saleNote = notes
        ? `Scrap Sold: ${numQtyDisplay.toFixed(2)} ${displayUnit} (${variantName}) for ₹${numAmt.toFixed(2)} — ${notes}`
        : `Scrap Sold: ${numQtyDisplay.toFixed(2)} ${displayUnit} (${variantName}) for ₹${numAmt.toFixed(2)}`;

      let remainingToSellBase = requestedBaseQty;

      for (const row of unsoldRes.rows) {
        if (remainingToSellBase <= 0.0001) break;
        const rowAbsBase = Math.abs(parseFloat(row.quantity_delta));

        if (remainingToSellBase >= rowAbsBase - 0.0001) {
          await client.query(
            `UPDATE inventory_ledger
             SET transaction_type = 'SCRAP_SALE', unit_cost_inr = $1, notes = $2, created_at = NOW()
             WHERE id = $3`,
            [unitPriceInBase, saleNote, row.id]
          );
          remainingToSellBase -= rowAbsBase;
        } else {
          const leftUnsoldBase = rowAbsBase - remainingToSellBase;
          await client.query(
            `UPDATE inventory_ledger SET quantity_delta = $1, transaction_type = 'PURCHASE_SCRAP' WHERE id = $2`,
            [-leftUnsoldBase, row.id]
          );

          await client.query(
            `INSERT INTO inventory_ledger (
              material_variant_id, transaction_type, quantity_delta, unit_cost_inr, reference_bill_id, notes, created_by
            ) VALUES ($1, 'SCRAP_SALE', $2, $3, NULL, $4, $5)`,
            [row.material_variant_id, -remainingToSellBase, unitPriceInBase, saleNote, payload.userId]
          );
          remainingToSellBase = 0;
        }
      }

      await client.query('COMMIT');

      return NextResponse.json({
        success: true,
        item_name: variantName,
        quantity_sold: numQtyDisplay,
        unit: displayUnit,
        total_amount: numAmt,
        sheet_synced: false,
      });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('Record scrap sale error:', error);
    return NextResponse.json({ error: error.message || 'Failed to record scrap sale' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const token = request.cookies.get('ims_session')?.value;
    const payload = verifyToken(token || '');
    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const entryId = searchParams.get('id');
    if (!entryId) {
      return NextResponse.json({ error: 'Scrap sale ID is required' }, { status: 400 });
    }

    await query(
      `UPDATE inventory_ledger
       SET transaction_type = 'PURCHASE_SCRAP',
           unit_cost_inr = 0,
           notes = 'Scrap inventory from production (Sale reverted)'
       WHERE id = $1 AND transaction_type = 'SCRAP_SALE'`,
      [entryId]
    );

    return NextResponse.json({
      success: true,
      message: 'Scrap sale reverted back to unsold scrap inventory in database.',
    });
  } catch (error: any) {
    console.error('Revert scrap sale error:', error);
    return NextResponse.json({ error: error.message || 'Failed to revert scrap sale' }, { status: 500 });
  }
}
