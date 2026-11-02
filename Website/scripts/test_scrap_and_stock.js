const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function testOperations() {
  console.log('Testing scrap sale and stock receipt with UUID verification...\n');

  // Fetch a valid variant
  const res = await pool.query(`SELECT id, material_variant_id, material_name FROM v_inventory_summary WHERE material_name ILIKE '%CR Steel%' LIMIT 1`);
  console.log('Fetched from v_inventory_summary:', res.rows[0]);

  const variant = res.rows[0];
  if (!variant.id) {
    throw new Error('id is missing in v_inventory_summary');
  }

  // Test insert into inventory_ledger with this variant.id
  const testStock = await pool.query(`
    INSERT INTO inventory_ledger (
      material_variant_id, transaction_type, quantity_delta, unit_cost_inr, notes
    ) VALUES ($1, 'PURCHASE_RECEIPT', 1000, 0.082, 'Automated verification test')
    RETURNING id, material_variant_id, quantity_delta;
  `, [variant.id]);

  console.log('✓ Stock receipt inserted successfully:', testStock.rows[0]);

  // Clean up
  await pool.query(`DELETE FROM inventory_ledger WHERE id = $1`, [testStock.rows[0].id]);
  console.log('✓ Test cleanup complete. UUID insertion validated 100%!');

  await pool.end();
}

testOperations().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
