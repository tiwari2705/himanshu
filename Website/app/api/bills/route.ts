import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { query, getPool, Product, MaterialVariant } from '@/lib/db';
import { calculateBillSummary, MaterialLineItemInput } from '@/lib/calculations';

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
            admin_u.username AS decided_by_username
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
          admin_u.username AS decided_by_username
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

    // 6. Generate sequential-proof unique bill number (e.g. BILL-20261101-ABCD)
    const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const billNumber = `BILL-${datePrefix}-${randomSuffix}`;

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
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING')
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
        ]
      );

      createdBill = billInsert.rows[0];

      // Insert all calculated bill_items
      for (const item of summary.calculatedItems) {
        await client.query(
          `INSERT INTO bill_items (
            bill_id,
            material_variant_id,
            input_length,
            input_breadth,
            calculated_feet,
            actual_quantity_consumed,
            unit,
            line_cost_inr
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            createdBill.id,
            item.materialVariantId,
            item.inputLength,
            item.inputBreadth,
            item.calculatedFeet,
            item.actualQuantityConsumed,
            item.unit,
            item.lineCostInr,
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

    return NextResponse.json({
      success: true,
      message: 'Bill created successfully and submitted to Admin pending queue.',
      bill: createdBill,
      summary,
    });
  } catch (error: any) {
    console.error('Create bill error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create bill' },
      { status: 500 }
    );
  }
}
