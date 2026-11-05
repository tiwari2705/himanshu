import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { query, getPool, Product, MaterialVariant } from '@/lib/db';
import { calculateBillSummary, MaterialLineItemInput } from '@/lib/calculations';
import { syncPendingBill } from '@/lib/sheets';

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('ims_session')?.value;
    const payload = verifyToken(token || '');

    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const filterType = searchParams.get('filter');

    let billsQuery = '';
    let params: any[] = [];

    if (payload.role === 'ADMIN') {
      if (filterType === 'pending') {
        billsQuery = `
          SELECT 
            b.*,
            p.name AS product_name,
            p.frame_formula_type,
            COALESCE(u.username, 'Deleted Worker') AS worker_username
          FROM bills b
          JOIN products p ON b.product_id = p.id
          LEFT JOIN users u ON b.worker_id = u.id
          WHERE b.status = 'PENDING'
          ORDER BY b.created_at DESC
        `;
      } else {
        billsQuery = `
          SELECT 
            b.*,
            p.name AS product_name,
            p.frame_formula_type,
            COALESCE(u.username, 'Deleted Worker') AS worker_username,
            admin_u.username AS decided_by_username,
            admin_u.role AS decided_by_role
          FROM bills b
          JOIN products p ON b.product_id = p.id
          LEFT JOIN users u ON b.worker_id = u.id
          LEFT JOIN users admin_u ON b.decided_by = admin_u.id
          ORDER BY b.created_at DESC
          LIMIT 200
        `;
      }
    } else {
      // Verify worker is still active
      const userCheck = await query('SELECT is_active FROM users WHERE id = $1', [payload.userId]);
      if (userCheck.rows.length === 0 || !userCheck.rows[0].is_active) {
        return NextResponse.json({ error: 'Worker account is blocked or inactive' }, { status: 403 });
      }

      // Worker view: 48-Hour Bill History Cleanup
      // Display submitted bill history strictly for the last 48 hours
      billsQuery = `
        SELECT 
          b.*,
          p.name AS product_name,
          p.frame_formula_type,
          COALESCE(u.username, 'Worker') AS worker_username,
          admin_u.username AS decided_by_username,
          admin_u.role AS decided_by_role
        FROM bills b
        JOIN products p ON b.product_id = p.id
        LEFT JOIN users u ON b.worker_id = u.id
        LEFT JOIN users admin_u ON b.decided_by = admin_u.id
        WHERE b.worker_id = $1
          AND b.created_at >= NOW() - INTERVAL '48 hours'
          AND (
            b.status = 'PENDING' 
            OR (b.decided_at IS NOT NULL AND b.decided_at >= NOW() - INTERVAL '48 hours')
          )
        ORDER BY b.created_at DESC
      `;
      params = [payload.userId];
    }

    const billsRes = await query(billsQuery, params);
    const bills = billsRes.rows;

    // Fetch items for these bills if any exist
    if (bills.length > 0) {
      const billIds = bills.map((b) => b.id);
      const itemsRes = await query(
        `SELECT 
          bi.*,
          mv.name AS material_name,
          mv.category,
          mv.base_unit
         FROM bill_items bi
         JOIN material_variants mv ON bi.material_variant_id = mv.id
         WHERE bi.bill_id = ANY($1::uuid[])`,
        [billIds]
      );

      const itemsByBill: Record<string, any[]> = {};
      itemsRes.rows.forEach((item) => {
        if (!itemsByBill[item.bill_id]) {
          itemsByBill[item.bill_id] = [];
        }
        itemsByBill[item.bill_id].push(item);
      });

      bills.forEach((b) => {
        b.items = itemsByBill[b.id] || [];
      });
    }

    return NextResponse.json({ bills });
  } catch (error: any) {
    console.error('Get bills error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch bills' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('ims_session')?.value;
    const payload = verifyToken(token || '');

    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify user is active in database
    const userCheck = await query('SELECT is_active FROM users WHERE id = $1', [payload.userId]);
    if (userCheck.rows.length === 0 || !userCheck.rows[0].is_active) {
      return NextResponse.json({ error: 'Your account is blocked or inactive' }, { status: 403 });
    }

    const body = await request.json();
    const {
      product_id,
      custom_product_name,
      custom_formula_type,
      customer_name,
      invoice_details,
      items,
      selling_price_inr,
      total_amount_inr,
      gst_rate,
    } = body;

    if (!customer_name || !String(customer_name).trim() || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'Customer name and at least one material item are required' },
        { status: 400 }
      );
    }

    const gstRateVal =
      gst_rate !== undefined && gst_rate !== null && gst_rate !== '' && !isNaN(parseFloat(gst_rate))
        ? parseFloat(gst_rate)
        : 0;

    // Sum individual item prices if provided on items
    const sumOfItemPrices = items.reduce((acc: number, it: any) => {
      const p = parseFloat(it.item_price_inr || it.price || '0');
      return acc + (!isNaN(p) && p > 0 ? p : 0);
    }, 0);

    let sellingPrice = parseFloat(selling_price_inr);
    const explicitTotal = parseFloat(total_amount_inr);
    if ((isNaN(sellingPrice) || sellingPrice <= 0) && sumOfItemPrices > 0) {
      sellingPrice = sumOfItemPrices;
    }
    if ((isNaN(sellingPrice) || sellingPrice <= 0) && !isNaN(explicitTotal) && explicitTotal > 0) {
      sellingPrice = gstRateVal > 0 ? explicitTotal / (1 + gstRateVal / 100.0) : explicitTotal;
    }

    if (isNaN(sellingPrice) || sellingPrice <= 0) {
      return NextResponse.json(
        { error: 'Valid item price or total selling price (₹) is required' },
        { status: 400 }
      );
    }

    // 1. Fetch or create Product master details (supports "OTHER" / custom product creation)
    let product: Product | null = null;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      product_id || ''
    );

    if (product_id && isUuid) {
      const prodRes = await query<Product>(
        'SELECT * FROM products WHERE id = $1 AND is_active = TRUE',
        [product_id]
      );
      if (prodRes.rows.length > 0) {
        product = prodRes.rows[0];
      }
    }

    if (!product && custom_product_name && String(custom_product_name).trim()) {
      const cleanProdName = String(custom_product_name).trim();
      const validFormula = ['DOOR_2L_PLUS_B', 'WINDOW_2_L_PLUS_B', 'CUSTOM'].includes(custom_formula_type)
        ? custom_formula_type
        : 'DOOR_2L_PLUS_B';
      const existingProd = await query<Product>(
        'SELECT * FROM products WHERE LOWER(name) = LOWER($1) LIMIT 1',
        [cleanProdName]
      );
      if (existingProd.rows.length > 0) {
        product = existingProd.rows[0];
      } else {
        const createdProd = await query<Product>(
          `INSERT INTO products (name, frame_formula_type, description, is_active)
           VALUES ($1, $2, $3, TRUE) RETURNING *`,
          [cleanProdName, validFormula, `Created via Bill Portal (${validFormula})`]
        );
        product = createdProd.rows[0];
      }
    }

    if (!product) {
      // Fallback to first item's product_id or first active product in catalog
      const itemWithProd = items.find((i: any) => i.product_id && /^[0-9a-f-]{36}$/i.test(i.product_id));
      const fallbackRes = itemWithProd
        ? await query<Product>('SELECT * FROM products WHERE id = $1 LIMIT 1', [itemWithProd.product_id])
        : await query<Product>('SELECT * FROM products WHERE is_active = TRUE ORDER BY created_at ASC LIMIT 1');
      if (fallbackRes.rows.length > 0) {
        product = fallbackRes.rows[0];
      }
    }

    if (!product) {
      return NextResponse.json({ error: 'Active product not found' }, { status: 404 });
    }

    // Fetch all products to resolve any per-line product overrides (e.g. Door on line 1, Window on line 2)
    const allProdsRes = await query<Product>('SELECT * FROM products WHERE is_active = TRUE');
    const prodMap = new Map<string, Product>();
    allProdsRes.rows.forEach((p) => prodMap.set(p.id, p));

    // 2. Fetch all requested material variants
    const variantIds = items.map((i: any) => i.material_variant_id);
    const variantsRes = await query<MaterialVariant>(
      'SELECT * FROM material_variants WHERE id = ANY($1::uuid[]) AND is_active = TRUE',
      [variantIds]
    );

    const variantMap = new Map<string, MaterialVariant>();
    variantsRes.rows.forEach((v) => variantMap.set(v.id, v));

    // 3. Prepare inputs for calculation engine
    const lineInputs: MaterialLineItemInput[] = items.map((item: any) => {
      const v = variantMap.get(item.material_variant_id);
      if (!v) {
        throw new Error(`Material variant ${item.material_variant_id} not found or inactive`);
      }

      const lineProd = item.product_id ? prodMap.get(item.product_id) : null;
      const lineFormula =
        item.formula_type || (lineProd ? lineProd.frame_formula_type : product!.frame_formula_type);

      return {
        materialVariantId: v.id,
        category: v.category,
        name: v.name,
        formulaType: lineFormula,
        pieceCount: item.piece_count !== undefined && item.piece_count !== '' ? parseInt(item.piece_count, 10) : 1,
        attritionPercent: item.attrition_percent !== undefined ? parseFloat(item.attrition_percent) : 0,
        itemPriceInr: item.item_price_inr !== undefined && item.item_price_inr !== '' ? parseFloat(item.item_price_inr) : undefined,
        inputLength: item.input_length !== undefined && item.input_length !== '' ? parseFloat(item.input_length) : undefined,
        inputBreadth: item.input_breadth !== undefined && item.input_breadth !== '' ? parseFloat(item.input_breadth) : undefined,
        bomWeightPerFootGrams: parseFloat(v.bom_weight_per_foot_grams.toString()),
        quantityConsumed: item.quantity_consumed !== undefined && item.quantity_consumed !== '' ? parseFloat(item.quantity_consumed) : undefined,
        inputWeightKg: item.input_weight_kg !== undefined && item.input_weight_kg !== '' ? parseFloat(item.input_weight_kg) : undefined,
        unit: v.base_unit,
        unitCostInr: parseFloat(v.unit_cost_inr.toString()),
      };
    });

    const summary = calculateBillSummary(
      product.frame_formula_type,
      lineInputs,
      sellingPrice,
      gstRateVal
    );

    // 5. Stock Pre-Check against normal ERP inventory
    for (const item of summary.calculatedItems) {
      const stockRes = await query(
        `SELECT current_stock, material_name, base_unit 
         FROM v_inventory_summary 
         WHERE material_variant_id = $1`,
        [item.materialVariantId]
      );

      const available = parseFloat(stockRes.rows[0]?.current_stock || '0');
      const materialName = stockRes.rows[0]?.material_name || 'Material';

      if (available < item.actualQuantityConsumed) {
        return NextResponse.json(
          {
            error: `Insufficient normal stock for ${materialName}. Available: ${available} ${item.unit}, Required: ${item.actualQuantityConsumed} ${item.unit}`,
          },
          { status: 400 }
        );
      }
    }

    // 6. Generate invoice number (e.g. 2026-2027/117 or custom invoice_no if supplied)
    const now = new Date();
    const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const fyStr = `${fyStart}-${fyStart + 1}`;
    const randomNum = Math.floor(100 + Math.random() * 900);
    const defaultBillNumber = `${fyStr}/${randomNum}`;
    const billNumber =
      invoice_details?.invoice_no && String(invoice_details.invoice_no).trim()
        ? String(invoice_details.invoice_no).trim()
        : defaultBillNumber;

    const cleanInvoiceDetails = {
      invoice_no: billNumber,
      invoice_date:
        invoice_details?.invoice_date ||
        `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`,
      invoice_type: invoice_details?.invoice_type || 'Credit',
      copy_type: invoice_details?.copy_type || 'Duplicate Copy',
      seller_state: invoice_details?.seller_state || '06-Haryana',
      transport_mode: invoice_details?.transport_mode || 'Intra',
      vehicle_number: invoice_details?.vehicle_number || '',
      date_time_of_supply:
        invoice_details?.date_time_of_supply ||
        `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()} & ${now.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })}`,
      place_of_supply: invoice_details?.place_of_supply || invoice_details?.party_address || invoice_details?.party_state || 'Haryana',
      party_name: customer_name.trim(),
      party_address: invoice_details?.party_address || '',
      party_gstin: invoice_details?.party_gstin || '',
      party_state: invoice_details?.party_state || 'Haryana',
      party_state_code: invoice_details?.party_state_code || '06',
      narration: invoice_details?.narration || '',
    };

    // 7. Atomic DB Transaction: Insert bill and bill_items
    const client = await getPool().connect();
    let createdBill: any = null;

    try {
      await client.query('BEGIN');

      const billInsert = await client.query(
        `INSERT INTO bills (
          bill_number,
          product_id,
          worker_id,
          customer_name,
          production_cost_inr,
          selling_price_inr,
          gst_rate,
          gst_amount_inr,
          final_total_inr,
          invoice_details,
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDING')
        RETURNING *`,
        [
          billNumber,
          product.id,
          payload.userId,
          customer_name.trim(),
          summary.productionCostInr,
          summary.sellingPriceInr,
          summary.gstRate,
          summary.gstAmountInr,
          summary.finalTotalInr,
          JSON.stringify(cleanInvoiceDetails),
        ]
      );

      createdBill = billInsert.rows[0];

      // Insert all calculated bill_items with their Tax Invoice item_details
      for (let idx = 0; idx < summary.calculatedItems.length; idx++) {
        const item = summary.calculatedItems[idx];
        const rawReqItem = items[idx] || {};
        const v = variantMap.get(item.materialVariantId);
        const lineProd = rawReqItem.product_id ? prodMap.get(rawReqItem.product_id) : null;

        const billingQty =
          rawReqItem.billing_qty !== undefined && rawReqItem.billing_qty !== ''
            ? parseFloat(rawReqItem.billing_qty)
            : item.calculatedFeet && item.calculatedFeet > 0
            ? item.calculatedFeet
            : item.unit === 'GRAM'
            ? item.actualQuantityConsumed / 1000.0
            : item.actualQuantityConsumed;

        const taxableAmt =
          item.itemPriceInr > 0
            ? item.itemPriceInr
            : rawReqItem.rate
            ? parseFloat(rawReqItem.rate) * billingQty
            : summary.sellingPriceInr / summary.calculatedItems.length;

        const rateVal =
          rawReqItem.rate !== undefined && rawReqItem.rate !== '' && parseFloat(rawReqItem.rate) > 0
            ? parseFloat(rawReqItem.rate)
            : billingQty > 0
            ? taxableAmt / billingQty
            : taxableAmt;

        const lineGstPct =
          rawReqItem.gst_percent !== undefined && rawReqItem.gst_percent !== ''
            ? parseFloat(rawReqItem.gst_percent)
            : summary.gstRate;

        const lineGstAmt = taxableAmt * (lineGstPct / 100.0);

        const itemDetailsJson = {
          item_detail:
            rawReqItem.item_detail ||
            (lineProd ? `${lineProd.name} (${v?.name || ''})` : v?.name || product.name),
          hsn_code: rawReqItem.hsn_code || (v?.category === 'PIPE' ? '7306' : v?.category === 'PAINT' ? '3208' : v?.category === 'HINGES' ? '8302' : '7308'),
          billing_qty: Number(billingQty.toFixed(2)),
          uom: rawReqItem.uom || (item.calculatedFeet ? 'RMT' : item.unit === 'GRAM' ? 'kg' : item.unit),
          rate: Number(rateVal.toFixed(2)),
          gst_percent: Number(lineGstPct.toFixed(2)),
          gst_amount: Number(lineGstAmt.toFixed(2)),
          taxable_amount: Number(taxableAmt.toFixed(2)),
        };

        await client.query(
          `INSERT INTO bill_items (
            bill_id,
            material_variant_id,
            input_length,
            input_breadth,
            calculated_feet,
            actual_quantity_consumed,
            unit,
            line_cost_inr,
            item_details
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            createdBill.id,
            item.materialVariantId,
            item.inputLength,
            item.inputBreadth,
            item.calculatedFeet,
            item.actualQuantityConsumed,
            item.unit,
            item.lineCostInr,
            JSON.stringify(itemDetailsJson),
          ]
        );
      }

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    // 8. Sync Pending Bill to Monthly Google Sheet (`Bills_<Month>_<Year>`) with Status = 'Pending'
    let sheetSynced = false;
    let sheetSyncError: string | undefined;
    try {
      let totalMetalWeightKg = 0;
      const materialsSummary = summary.calculatedItems.map((item) => {
        const v = variantMap.get(item.materialVariantId);
        const qty = Number(item.actualQuantityConsumed || 0);
        if (item.unit === 'GRAM' || v?.base_unit === 'GRAM') {
          totalMetalWeightKg += qty / 1000.0;
        } else if (item.unit === 'KG' || v?.base_unit === 'KG') {
          totalMetalWeightKg += qty;
        }
        const displayUnit = (item.unit === 'GRAM' || v?.base_unit === 'GRAM') ? 'KG' : (item.unit || v?.base_unit || 'KG');
        const displayQty = (item.unit === 'GRAM' || v?.base_unit === 'GRAM') ? Number((qty / 1000.0).toFixed(4)) : Number(qty.toFixed(4));
        return {
          name: v?.name || 'Material',
          category: v?.category || 'OTHER',
          input_length: item.inputLength,
          input_breadth: item.inputBreadth,
          calculated_feet: item.calculatedFeet,
          actual_quantity_consumed: qty,
          unit: item.unit,
          display_quantity: displayQty,
          display_unit: displayUnit,
        };
      });

      const pendingSync = await syncPendingBill({
        billId: createdBill.id,
        bill_number: createdBill.bill_number,
        bill_date: createdBill.created_at ? new Date(createdBill.created_at).toISOString() : new Date().toISOString(),
        worker_username: payload.username || 'worker',
        customer_name: createdBill.customer_name,
        product_name: product.name,
        materials_summary: materialsSummary,
        total_metal_weight_kg: Number(totalMetalWeightKg.toFixed(4)),
        final_total_inr: Number(summary.finalTotalInr),
        status: 'Pending',
      });
      sheetSynced = pendingSync.success;
      sheetSyncError = pendingSync.error;
    } catch (syncErr: any) {
      console.warn('Pending bill Google Sheets sync warning:', syncErr?.message || syncErr);
      sheetSyncError = syncErr?.message;
    }

    const enrichedCreatedBill = {
      ...createdBill,
      product_name: product.name,
      worker_username: payload.username || 'worker',
      items: summary.calculatedItems.map((item, idx) => {
        const v = variantMap.get(item.materialVariantId);
        return {
          id: `${createdBill.id}-item-${idx}`,
          material_name: v?.name || 'Material',
          category: v?.category || 'OTHER',
          base_unit: v?.base_unit || item.unit,
          input_length: item.inputLength,
          input_breadth: item.inputBreadth,
          calculated_feet: item.calculatedFeet,
          actual_quantity_consumed: item.actualQuantityConsumed,
          unit: item.unit,
          line_cost_inr: item.lineCostInr,
        };
      }),
    };

    return NextResponse.json({
      success: true,
      message: 'Bill generated successfully. Please review and approve or reject.',
      bill: enrichedCreatedBill,
      summary,
      sheet_synced: sheetSynced,
      sheet_error: sheetSyncError,
    });
  } catch (error: any) {
    console.error('Create bill error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create bill' },
      { status: 500 }
    );
  }
}
