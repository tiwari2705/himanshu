import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { query } from '@/lib/db';
import { recordPurchaseScrap, syncInventoryAddition, InventorySnapshotItem } from '@/lib/sheets';

function normalizeBaseUnit(rawUnit: string): 'GRAM' | 'KG' | 'FEET' | 'PIECE' | 'LITRE' {
  const u = (rawUnit || '').trim().toUpperCase();
  if (u === 'KG' || u === 'KGS' || u === 'KILOGRAM' || u === 'KILOGRAMS') return 'KG';
  if (u === 'FT' || u === 'FEET' || u === 'FOOT') return 'FEET';
  if (u === 'PCS' || u === 'PC' || u === 'PIECE' || u === 'PIECES' || u === 'NOS') return 'PIECE';
  if (u === 'L' || u === 'LTR' || u === 'LITRE' || u === 'LITRES' || u === 'LITER') return 'LITRE';
  if (u === 'G' || u === 'GM' || u === 'GRAM' || u === 'GRAMS') return 'GRAM';
  return 'KG';
}

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('ims_session')?.value;
    if (!token || !verifyToken(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const history = searchParams.get('history');

    if (history === 'true') {
      const ledgerRes = await query(
        `SELECT 
          il.*,
          ROUND(ABS(il.quantity_delta) * il.unit_cost_inr, 2) AS total_amount_inr,
          mv.name AS material_name,
          mv.category,
          mv.base_unit,
          u.username AS created_by_username
         FROM inventory_ledger il
         JOIN material_variants mv ON il.material_variant_id = mv.id
         LEFT JOIN users u ON il.created_by = u.id
         ORDER BY il.created_at DESC
         LIMIT 100`
      );
      return NextResponse.json({ ledger: ledgerRes.rows });
    }

    // Return live inventory summary view enriched with InvenTree allocation metrics
    // (in_stock, allocated_stock from PENDING bills, and available_stock = in_stock - allocated_stock)
    const result = await query(
      `SELECT 
        v.*,
        COALESCE(alloc.allocated_base_qty, 0) AS allocated_stock,
        CASE 
          WHEN v.base_unit = 'GRAM' THEN ROUND(COALESCE(alloc.allocated_base_qty, 0) / 1000.0, 2)
          ELSE ROUND(COALESCE(alloc.allocated_base_qty, 0), 2)
        END AS allocated_stock_display,
        CASE 
          WHEN v.base_unit = 'GRAM' THEN ROUND((v.current_stock - COALESCE(alloc.allocated_base_qty, 0)) / 1000.0, 2)
          ELSE ROUND(v.current_stock - COALESCE(alloc.allocated_base_qty, 0), 2)
        END AS available_stock_display
       FROM v_inventory_summary v
       LEFT JOIN (
         SELECT bi.material_variant_id, SUM(bi.actual_quantity_consumed) AS allocated_base_qty
         FROM bill_items bi
         JOIN bills b ON b.id = bi.bill_id
         WHERE b.status = 'PENDING'
         GROUP BY bi.material_variant_id
       ) alloc ON alloc.material_variant_id = v.material_variant_id
       WHERE v.is_active = TRUE
       ORDER BY v.category ASC, v.material_name ASC`
    );

    return NextResponse.json({ items: result.rows });
  } catch (error: any) {
    console.error('Get inventory error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch inventory' },
      { status: 500 }
    );
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
    const {
      stock_action, // InvenTree StockHistoryCode: 'STOCK_ADD' (default) | 'STOCK_REMOVE' | 'STOCK_COUNT' | 'RETURN'
      material_variant_id,
      product_name,
      category,
      measurement_unit,
      quantity,
      purchased_quantity,
      total_investment,
      total_investment_inr,
      defective_scrap_grams,
      bom_weight_per_foot_grams,
      unit_cost_inr,
      supplier_name,
      invoice_no,
      notes,
    } = body;

    const actionMode = String(stock_action || 'STOCK_ADD').toUpperCase();
    const rawQty = quantity !== undefined ? quantity : purchased_quantity;
    const inputQty = parseFloat(rawQty);

    if (isNaN(inputQty) || (actionMode === 'STOCK_COUNT' ? inputQty < 0 : inputQty <= 0)) {
      return NextResponse.json({ error: 'Quantity must be a valid positive number' }, { status: 400 });
    }

    const rawTotalInvestment =
      total_investment !== undefined
        ? parseFloat(total_investment)
        : total_investment_inr !== undefined
        ? parseFloat(total_investment_inr)
        : NaN;

    const scrapGrams = parseFloat(defective_scrap_grams || '0') || 0;
    const selectedUnitNormalized = measurement_unit ? normalizeBaseUnit(measurement_unit) : null;

    let targetVariant: any = null;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      material_variant_id || ''
    );

    if (material_variant_id && isUuid) {
      const vRes = await query('SELECT * FROM material_variants WHERE id = $1', [material_variant_id]);
      if (vRes.rows.length > 0) targetVariant = vRes.rows[0];
    }

    if (!targetVariant && (product_name || material_variant_id)) {
      const cleanName = String(product_name || material_variant_id || '')
        .replace(/\s*\([A-Z]+\)$/, '')
        .trim();

      if (cleanName) {
        const vMatch = await query(
          'SELECT * FROM material_variants WHERE LOWER(name) = LOWER($1) LIMIT 1',
          [cleanName]
        );
        if (vMatch.rows.length > 0) {
          targetVariant = vMatch.rows[0];
        } else {
          const newCategory = (category || 'OTHER').toUpperCase();
          const validCategory = ['COIL', 'PIPE', 'HINGES', 'PAINT', 'OTHER'].includes(newCategory)
            ? newCategory
            : 'OTHER';
          const newBaseUnit = selectedUnitNormalized || 'KG';
          const defaultBomWeight =
            bom_weight_per_foot_grams !== undefined
              ? parseFloat(bom_weight_per_foot_grams) || 0
              : validCategory === 'COIL'
              ? 1000
              : validCategory === 'PIPE'
              ? 600
              : 0;

          const createdRes = await query(
            `INSERT INTO material_variants (
              category, name, base_unit, properties, bom_weight_per_foot_grams, unit_cost_inr, is_active
            ) VALUES ($1, $2, $3, $4, $5, 0, TRUE) RETURNING *`,
            [
              validCategory,
              cleanName,
              newBaseUnit,
              JSON.stringify({ display_unit: (measurement_unit || newBaseUnit).toLowerCase() }),
              defaultBomWeight,
            ]
          );
          targetVariant = createdRes.rows[0];
        }
      }
    }

    if (!targetVariant) {
      return NextResponse.json({ error: 'Product Name or Material selection is required' }, { status: 400 });
    }

    let quantityInBaseUnit = inputQty;
    if (targetVariant.base_unit === 'GRAM' && selectedUnitNormalized === 'KG') {
      quantityInBaseUnit = inputQty * 1000.0;
    } else if (targetVariant.base_unit === 'KG' && selectedUnitNormalized === 'GRAM') {
      quantityInBaseUnit = inputQty / 1000.0;
    }

    const displayUnitLabel =
      measurement_unit ||
      (targetVariant.base_unit === 'GRAM' ? 'kg' : targetVariant.base_unit.toLowerCase());

    // Handle InvenTree Stock Operations: STOCK_ADD, STOCK_REMOVE, STOCK_COUNT (stocktake), RETURN
    let usableStockDelta = Math.max(0, quantityInBaseUnit - scrapGrams);
    let txType: 'PURCHASE_RECEIPT' | 'ADJUSTMENT' | 'RETURN' = 'PURCHASE_RECEIPT';
    let unitCostInBaseUnit = parseFloat(unit_cost_inr || '0') || 0;
    let finalTotalInvestment = 0;

    if (actionMode === 'STOCK_REMOVE') {
      txType = 'ADJUSTMENT';
      usableStockDelta = -Math.abs(quantityInBaseUnit);
      unitCostInBaseUnit = parseFloat(targetVariant.unit_cost_inr || '0') || 0;
    } else if (actionMode === 'STOCK_COUNT') {
      // InvenTree StockItem.stocktake(count): delta = count - current_stock
      txType = 'ADJUSTMENT';
      const currRes = await query(
        'SELECT COALESCE(SUM(quantity_delta), 0) AS curr FROM inventory_ledger WHERE material_variant_id = $1',
        [targetVariant.id]
      );
      const currStock = parseFloat(currRes.rows[0]?.curr || '0');
      usableStockDelta = quantityInBaseUnit - currStock;
      unitCostInBaseUnit = parseFloat(targetVariant.unit_cost_inr || '0') || 0;
    } else if (actionMode === 'RETURN') {
      txType = 'RETURN';
      usableStockDelta = Math.abs(quantityInBaseUnit);
      unitCostInBaseUnit = parseFloat(targetVariant.unit_cost_inr || '0') || 0;
    } else {
      // Default: STOCK_ADD / PURCHASE_RECEIPT
      txType = 'PURCHASE_RECEIPT';
      if (!isNaN(rawTotalInvestment) && rawTotalInvestment >= 0) {
        finalTotalInvestment = rawTotalInvestment;
        unitCostInBaseUnit = usableStockDelta > 0 ? finalTotalInvestment / usableStockDelta : 0;
      } else if (unitCostInBaseUnit > 0) {
        finalTotalInvestment = usableStockDelta * unitCostInBaseUnit;
      } else {
        unitCostInBaseUnit = parseFloat(targetVariant.unit_cost_inr || '0') || 0;
        finalTotalInvestment = usableStockDelta * unitCostInBaseUnit;
      }

      if (unitCostInBaseUnit > 0) {
        await query('UPDATE material_variants SET unit_cost_inr = $1 WHERE id = $2', [
          unitCostInBaseUnit,
          targetVariant.id,
        ]);
      }
    }

    const autoNotes =
      notes ||
      (actionMode === 'STOCK_COUNT'
        ? `[STOCK_COUNT] Stocktake counted at ${inputQty} ${displayUnitLabel}`
        : actionMode === 'STOCK_REMOVE'
        ? `[STOCK_REMOVE] Manually removed ${inputQty} ${displayUnitLabel}`
        : actionMode === 'RETURN'
        ? `[RETURNED_TO_STOCK] Returned +${inputQty} ${displayUnitLabel} to stock`
        : `[STOCK_ADD] Added ${inputQty} ${displayUnitLabel} | Total Investment: ₹${finalTotalInvestment.toFixed(2)}` +
          (scrapGrams > 0 ? ` (Defective scrap: ${scrapGrams}g)` : ''));

    const ledgerResult = await query(
      `INSERT INTO inventory_ledger (
        material_variant_id, transaction_type, quantity_delta, unit_cost_inr,
        supplier_name, invoice_no, notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        targetVariant.id,
        txType,
        usableStockDelta,
        unitCostInBaseUnit,
        supplier_name || null,
        invoice_no || null,
        autoNotes,
        payload.userId,
      ]
    );

    const summaryRes = await query(
      `SELECT * FROM v_inventory_summary WHERE is_active = TRUE ORDER BY category ASC, material_name ASC`
    );
    const updatedItem = summaryRes.rows.find((r) => r.id === targetVariant.id);
    const inventorySnapshot: InventorySnapshotItem[] = summaryRes.rows.map((r) => ({
      product_name: r.material_name,
      category: r.category,
      unit: r.display_unit || r.base_unit,
      current_stock: parseFloat(r.current_stock_display ?? r.current_stock ?? '0'),
      total_investment_inr: parseFloat(r.total_investment_inr || '0'),
      stock_valuation_inr: parseFloat(r.stock_valuation_inr || '0'),
    }));

    const scrapKg = scrapGrams > 0 ? Number((scrapGrams / 1000.0).toFixed(4)) : 0;

    try {
      await syncInventoryAddition({
        product_name: targetVariant.name,
        category: targetVariant.category,
        unit: displayUnitLabel.toUpperCase(),
        quantity_added: inputQty,
        total_investment_inr: Number(finalTotalInvestment.toFixed(2)),
        current_stock: updatedItem
          ? parseFloat(updatedItem.current_stock_display ?? updatedItem.current_stock ?? '0')
          : inputQty,
        notes: autoNotes,
        scrap_weight_kg: scrapKg,
        inventory_snapshot: inventorySnapshot,
      });
    } catch (sheetErr) {
      console.warn('Inventory addition Google Sheets sync notice:', sheetErr);
    }

    if (scrapKg > 0) {
      try {
        await recordPurchaseScrap({
          scrapWeightKg: scrapKg,
          supplierName: supplier_name,
          invoiceNo: invoice_no,
        });
      } catch (sheetErr) {
        console.warn('Purchase scrap ledger sync notice:', sheetErr);
      }
    }

    return NextResponse.json({
      success: true,
      entry: ledgerResult.rows[0],
      product_name: targetVariant.name,
      measurement_unit: displayUnitLabel,
      quantity_added: inputQty,
      usable_stock_added: usableStockDelta,
      usable_quantity_added: usableStockDelta,
      total_investment_inr: Number(finalTotalInvestment.toFixed(2)),
      scrap_grams: scrapGrams,
      scrap_weight_kg_logged: scrapKg,
    });
  } catch (error: any) {
    console.error('Inventory receipt error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to record stock purchase' },
      { status: 500 }
    );
  }
}
