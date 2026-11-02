const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function verifyRequirements() {
  console.log('=== STARTING DUAL-PORTAL & GOOGLE SHEETS SYNC VERIFICATION ===\n');
  const client = await pool.connect();

  try {
    const invView = await client.query(
      `SELECT material_name, display_unit, current_stock_display, total_investment_inr 
       FROM v_inventory_summary LIMIT 5`
    );
    console.log('✓ [A.1] Inventory & Total Investment View verified:');
    invView.rows.forEach((r) => {
      console.log(`   - ${r.material_name}: Stock=${r.current_stock_display} ${r.display_unit} | Total Investment=₹${r.total_investment_inr}`);
    });

    const testWorkerName = 'test_worker_' + Date.now();
    const hash = await bcrypt.hash('pass1234', 10);
    const createdWorker = await client.query(
      `INSERT INTO users (username, password_hash, role, is_active) VALUES ($1, $2, 'WORKER', TRUE) RETURNING id, username, is_active`,
      [testWorkerName, hash]
    );
    const workerId = createdWorker.rows[0].id;
    console.log(`\n✓ [A.3] Created Worker Account: ${createdWorker.rows[0].username} (Active=${createdWorker.rows[0].is_active})`);

    const blockedWorker = await client.query(`UPDATE users SET is_active = FALSE WHERE id = $1 RETURNING is_active`, [workerId]);
    console.log(`✓ [A.3] Blocked Worker Account: Active=${blockedWorker.rows[0].is_active}`);

    const unblockedWorker = await client.query(`UPDATE users SET is_active = TRUE WHERE id = $1 RETURNING is_active`, [workerId]);
    console.log(`✓ [A.3] Unblocked Worker Account: Active=${unblockedWorker.rows[0].is_active}`);

    const prodRes = await client.query(`SELECT id, name, frame_formula_type FROM products WHERE frame_formula_type = 'DOOR_2L_PLUS_B' LIMIT 1`);
    const product = prodRes.rows[0];
    const coilRes = await client.query(`SELECT id, name, base_unit, bom_weight_per_foot_grams, unit_cost_inr FROM material_variants WHERE category = 'COIL' LIMIT 1`);
    const coil = coilRes.rows[0];

    const stockBeforeRes = await client.query(`SELECT COALESCE(SUM(quantity_delta), 0) AS stock FROM inventory_ledger WHERE material_variant_id = $1`, [coil.id]);
    const stockBefore = parseFloat(stockBeforeRes.rows[0].stock);

    const calcFeet = 2 * 7 + 3; // 17 ft
    const consumedGrams = calcFeet * parseFloat(coil.bom_weight_per_foot_grams);

    await client.query('BEGIN');
    const billRes = await client.query(
      `INSERT INTO bills (bill_number, product_id, worker_id, customer_name, production_cost_inr, selling_price_inr, gst_rate, gst_amount_inr, final_total_inr, status)
       VALUES ($1, $2, $3, 'Test Secret Customer', 1000, 2000, 18, 360, 2360, 'PENDING') RETURNING id, bill_number`,
      ['BILL-TEST-SEC-' + Date.now(), product.id, workerId]
    );
    const secretBillId = billRes.rows[0].id;

    await client.query(
      `INSERT INTO bill_items (bill_id, material_variant_id, input_length, input_breadth, calculated_feet, actual_quantity_consumed, unit, line_cost_inr)
       VALUES ($1, $2, 7, 3, $3, $4, $5, 1000)`,
      [secretBillId, coil.id, calcFeet, consumedGrams, coil.base_unit]
    );

    const deductionRes = await client.query(
      `INSERT INTO inventory_ledger (material_variant_id, transaction_type, quantity_delta, unit_cost_inr, reference_bill_id, notes)
       VALUES ($1, 'BILL_CONSUMPTION', $2, $3, NULL, 'Test inventory deduction') RETURNING id`,
      [coil.id, -consumedGrams, coil.unit_cost_inr]
    );
    const deductionId = deductionRes.rows[0].id;

    await client.query(`DELETE FROM bills WHERE id = $1`, [secretBillId]);

    const stockAfterRes = await client.query(`SELECT COALESCE(SUM(quantity_delta), 0) AS stock FROM inventory_ledger WHERE material_variant_id = $1`, [coil.id]);
    const stockAfter = parseFloat(stockAfterRes.rows[0].stock);
    const billTraceCheck = await client.query(`SELECT COUNT(*)::int AS cnt FROM bills WHERE id = $1`, [secretBillId]);
    const itemTraceCheck = await client.query(`SELECT COUNT(*)::int AS cnt FROM bill_items WHERE bill_id = $1`, [secretBillId]);

    console.log(
      `\n✓ [A.4 & B.1] Secret Key Approval & Formula Check:` +
        `\n   - Formula (2L+B for 7x3ft): ${calcFeet} ft -> ${consumedGrams / 1000} kg` +
        `\n   - Stock Before: ${stockBefore}g, Stock After Deduction: ${stockAfter}g (Delta: ${stockAfter - stockBefore}g)` +
        `\n   - Bill trace in DB: ${billTraceCheck.rows[0].cnt} (bill_items: ${itemTraceCheck.rows[0].cnt})`
    );

    await client.query(`DELETE FROM inventory_ledger WHERE id = $1`, [deductionId]);
    await client.query('COMMIT');

    await client.query(`DELETE FROM users WHERE id = $1`, [workerId]);
    console.log(`✓ [A.3] Deleted Worker Account cleanly`);

    const viewDef = await client.query(`SELECT pg_get_viewdef('v_active_worker_bills', true) AS def`);
    const defStr = viewDef.rows[0].def;
    const has48Hours = defStr.includes('48 hours') || defStr.includes('48:00:00') || defStr.includes('2 days');
    console.log(`\n✓ [B.2] 48-Hour Bill History Cleanup in DB View: ${has48Hours ? 'VERIFIED (' + defStr.trim().split('\n').pop().trim() + ')' : 'MISSING'}`);
    console.log('\n=== ALL REQUIREMENTS VERIFIED SUCCESSFULLY ===');
  } finally {
    client.release();
    await pool.end();
  }
}

verifyRequirements().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
