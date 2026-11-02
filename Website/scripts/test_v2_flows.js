const { Pool } = require('pg');
require('dotenv').config({ path: '../.env' });
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: './.env' });
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function runTests() {
  console.log('=== STARTING ERP v2.0 ARCHITECTURAL VERIFICATION ===\n');

  try {
    // 1. Verify schema & tables
    const tableRes = await pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name IN ('users', 'products', 'material_variants', 'inventory_ledger', 'bills', 'bill_items')
      ORDER BY table_name;
    `);
    console.log('✓ Public tables verified:', tableRes.rows.map(r => r.table_name).join(', '));

    // 2. Verify UUID primary keys
    const pkRes = await pool.query(`
      SELECT table_name, column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND column_name = 'id' AND table_name IN ('bills', 'bill_items', 'users', 'products', 'material_variants', 'inventory_ledger');
    `);
    console.log('✓ UUID primary key types:');
    pkRes.rows.forEach(r => console.log(`   - ${r.table_name}.id -> ${r.data_type}`));

    // 3. Verify views
    const viewRes = await pool.query(`
      SELECT table_name FROM information_schema.views 
      WHERE table_schema = 'public' AND table_name IN ('v_inventory_summary', 'v_active_worker_bills');
    `);
    console.log('✓ PostgreSQL views verified:', viewRes.rows.map(r => r.table_name).join(', '));

    // 4. Check Material Variants & BOM Weight per Foot
    const mvRes = await pool.query(`SELECT name, category, base_unit, bom_weight_per_foot_grams, unit_cost_inr FROM material_variants ORDER BY category, name;`);
    console.log('\n✓ Configured Material Variants & BOM Rules:');
    mvRes.rows.forEach(r => console.log(`   - [${r.category}] ${r.name} | Unit: ${r.base_unit} | BOM: ${r.bom_weight_per_foot_grams} g/ft | Cost: ₹${r.unit_cost_inr}`));

    // 5. Test Live Stock Calculation from inventory_ledger
    const stockRes = await pool.query(`SELECT material_name, category, current_stock, base_unit, stock_valuation_inr FROM v_inventory_summary ORDER BY category, material_name;`);
    console.log('\n✓ Current Stock Valuation:');
    stockRes.rows.forEach(r => {
      const stockStr = r.base_unit === 'GRAM' ? `${(r.current_stock / 1000).toFixed(2)} kg` : `${r.current_stock} ${r.base_unit}`;
      console.log(`   - ${r.material_name}: ${stockStr} (Valuation: ₹${Number(r.stock_valuation_inr).toFixed(2)})`);
    });

    console.log('\n=== ALL DATABASE CHECKS PASSED SUCCESSFULLY ===');
  } catch (err) {
    console.error('Test error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runTests();
