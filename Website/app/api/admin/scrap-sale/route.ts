import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { query } from '@/lib/db';
import { recordScrapSale, recordPurchaseScrap } from '@/lib/sheets';

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('ims_session')?.value;
    const payload = verifyToken(token || '');

    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const salesRes = await query(
      `SELECT 
        il.id,
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
       WHERE il.transaction_type IN ('SCRAP_SALE', 'PURCHASE_SCRAP')
       ORDER BY il.created_at DESC`
    );

    const formattedSales = salesRes.rows.map((row) => {
      const absQty = Math.abs(parseFloat(row.quantity_delta));
      const qtyKg = row.base_unit === 'GRAM' ? absQty / 1000.0 : absQty;
      const totalAmt = absQty * parseFloat(row.unit_cost_inr || '0');
      return {
        id: row.id,
        transaction_type: row.transaction_type,
        item_name: row.material_name,
        quantity_kg: qtyKg,
        unit: row.base_unit === 'GRAM' ? 'KG' : row.base_unit,
        total_amount: totalAmt,
        notes: row.notes,
        created_at: row.created_at,
        created_by: row.created_by_username || 'admin',
      };
    });

    return NextResponse.json({ sales: formattedSales });
  } catch (error: any) {
    console.error('Fetch scrap sales error:', error);
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
    const { material_variant_id, item_name, quantity, total_amount, scrap_type, notes } = body;

    const numQtyKg = parseFloat(quantity);
    const numAmt = parseFloat(total_amount || '0') || 0;
    const isScrapLogOnly = scrap_type === 'PURCHASE_SCRAP' || scrap_type === 'SCRAP_LOG';

    if (isNaN(numQtyKg) || numQtyKg <= 0) {
      return NextResponse.json(
        { error: 'Valid scrap quantity (kg) is required' },
        { status: 400 }
      );
    }

    // Resolve material variant safely
    let variantId = material_variant_id;
    let variantName = item_name || 'Floor Metal Scrap';
    let baseUnit = 'GRAM';

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(variantId || '');

    if (variantId && isUuid) {
      const vRes = await query('SELECT id, name, base_unit FROM material_variants WHERE id = $1', [variantId]);
      if (vRes.rows.length > 0) {
        variantName = vRes.rows[0].name;
        baseUnit = vRes.rows[0].base_unit;
      }
    } else {
      const cleanSearch = (variantId || item_name || '').replace(/\s*\([A-Z]+\)$/, '').trim();
      const vRes = await query(
        `SELECT id, name, base_unit FROM material_variants 
         ORDER BY (name ILIKE $1 || '%') DESC, (category IN ('COIL', 'PIPE')) DESC, category ASC LIMIT 1`,
        [cleanSearch]
      );
      if (vRes.rows.length > 0) {
        variantId = vRes.rows[0].id;
        variantName = vRes.rows[0].name;
        baseUnit = vRes.rows[0].base_unit;
      }
    }

    if (!variantId) {
      return NextResponse.json({ error: 'No material variant found to assign scrap entry' }, { status: 400 });
    }

    const qtyInBaseUnit = baseUnit === 'GRAM' ? numQtyKg * 1000.0 : numQtyKg;
    const unitCost = qtyInBaseUnit > 0 ? (numAmt / qtyInBaseUnit) : 0;
    const txType = isScrapLogOnly ? 'PURCHASE_SCRAP' : 'SCRAP_SALE';

    // Insert scrap record into inventory_ledger (negative delta to reflect scrapped/sold material)
    const ledgerRes = await query(
      `INSERT INTO inventory_ledger (
        material_variant_id,
        transaction_type,
        quantity_delta,
        unit_cost_inr,
        notes,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        variantId,
        -qtyInBaseUnit,
        unitCost,
        notes ||
          (isScrapLogOnly
            ? `Scrap logged: ${numQtyKg.toFixed(2)} kg (${variantName})`
            : `Floor scrap sale: ${numQtyKg.toFixed(2)} kg sold for ₹${numAmt.toFixed(2)}`),
        payload.userId,
      ]
    );

    // Sync to stealth Google Sheets webhook
    try {
      if (isScrapLogOnly && numAmt === 0) {
        await recordPurchaseScrap({
          scrapWeightKg: numQtyKg,
          supplierName: variantName,
          invoiceNo: notes || 'SCRAP-LOG',
        });
      } else {
        await recordScrapSale({
          itemName: variantName,
          quantity: numQtyKg,
          amount: numAmt,
        });
      }
    } catch (sheetErr) {
      console.warn('Scrap sale stealth ledger sync notice:', sheetErr);
    }

    return NextResponse.json({
      success: true,
      entry: ledgerRes.rows[0],
      quantity_kg: numQtyKg,
      total_amount: numAmt,
    });
  } catch (error: any) {
    console.error('Record scrap sale error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to record scrap sale' },
      { status: 500 }
    );
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
      return NextResponse.json({ error: 'Scrap entry ID is required' }, { status: 400 });
    }

    await query(
      `DELETE FROM inventory_ledger WHERE id = $1 AND transaction_type IN ('SCRAP_SALE', 'PURCHASE_SCRAP')`,
      [entryId]
    );

    return NextResponse.json({
      success: true,
      message: 'Scrap entry removed from local database.',
    });
  } catch (error: any) {
    console.error('Delete scrap entry error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete scrap entry' },
      { status: 500 }
    );
  }
}
