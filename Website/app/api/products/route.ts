import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('ims_session')?.value;
    if (!token || !verifyToken(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const productsRes = await query(
      'SELECT * FROM products WHERE is_active = TRUE ORDER BY name ASC'
    );

    const variantsRes = await query(
      `SELECT 
        mv.*,
        COALESCE(SUM(il.quantity_delta), 0) AS current_stock
       FROM material_variants mv
       LEFT JOIN inventory_ledger il ON mv.id = il.material_variant_id
       WHERE mv.is_active = TRUE
       GROUP BY mv.id
       ORDER BY mv.category ASC, mv.name ASC`
    );

    return NextResponse.json({
      products: productsRes.rows,
      variants: variantsRes.rows,
    });
  } catch (error: any) {
    console.error('Get products error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch products' },
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

    const body = await request.json();
    const rawName = (body.name || body.product_name || '').trim();
    const rawDesc = (body.description || '').trim();

    if (!rawName) {
      return NextResponse.json({ error: 'Product name is required' }, { status: 400 });
    }

    const lowerName = rawName.toLowerCase();
    const inferredFormula =
      lowerName.includes('door') && !lowerName.includes('sliding')
        ? 'DOOR_2L_PLUS_B'
        : lowerName.includes('window') || lowerName.includes('sliding')
        ? 'WINDOW_2_L_PLUS_B'
        : 'CUSTOM';

    const rawFormula = body.frame_formula_type ? String(body.frame_formula_type).trim().toUpperCase() : inferredFormula;
    const validFormula = ['DOOR_2L_PLUS_B', 'WINDOW_2_L_PLUS_B', 'CUSTOM'].includes(rawFormula)
      ? rawFormula
      : inferredFormula;

    // Check if product already exists (case-insensitive)
    const existingRes = await query(
      'SELECT * FROM products WHERE LOWER(name) = LOWER($1) LIMIT 1',
      [rawName]
    );

    if (existingRes.rows.length > 0) {
      const existing = existingRes.rows[0];
      if (!existing.is_active) {
        const reactivated = await query(
          'UPDATE products SET is_active = TRUE, frame_formula_type = $1 WHERE id = $2 RETURNING *',
          [validFormula, existing.id]
        );
        return NextResponse.json({
          success: true,
          product: reactivated.rows[0],
          message: `Product "${rawName}" reactivated`,
        });
      }
      return NextResponse.json({
        success: true,
        product: existing,
        message: `Product "${rawName}" already exists`,
      });
    }

    const defaultDesc =
      rawDesc ||
      (validFormula === 'DOOR_2L_PLUS_B'
        ? 'Door Frame perimeter formula: (2 * L) + B'
        : validFormula === 'WINDOW_2_L_PLUS_B'
        ? 'Window Frame perimeter formula: 2 * (L + B)'
        : 'Custom manufacturing product');

    const insertRes = await query(
      `INSERT INTO products (name, frame_formula_type, description, is_active)
       VALUES ($1, $2, $3, TRUE)
       RETURNING *`,
      [rawName, validFormula, defaultDesc]
    );

    return NextResponse.json({
      success: true,
      product: insertRes.rows[0],
      message: `Product "${rawName}" added successfully`,
    });
  } catch (error: any) {
    console.error('Create product error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to add product' },
      { status: 500 }
    );
  }
}
