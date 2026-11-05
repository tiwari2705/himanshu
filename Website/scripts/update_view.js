const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function updateView() {
  // 1. Ensure bills.worker_id allows ON DELETE SET NULL and add invoice_details / item_details JSONB columns
  await pool.query(`
    ALTER TABLE bills ALTER COLUMN worker_id DROP NOT NULL;
    ALTER TABLE bills DROP CONSTRAINT IF EXISTS bills_worker_id_fkey;
    ALTER TABLE bills ADD CONSTRAINT bills_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE bills ADD COLUMN IF NOT EXISTS invoice_details JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE bill_items ADD COLUMN IF NOT EXISTS item_details JSONB NOT NULL DEFAULT '{}'::jsonb;
  `);

  // 2. Recreate v_inventory_summary with total_stock, used_stock, remaining_stock, normal/secret usage, and total_investment_inr
  await pool.query(`DROP VIEW IF EXISTS v_inventory_summary CASCADE;`);
  await pool.query(`
    CREATE OR REPLACE VIEW v_inventory_summary AS
    SELECT 
        mv.id,
        mv.id AS material_variant_id,
        mv.name AS material_name,
        mv.category,
        mv.base_unit,
        mv.properties,
        mv.bom_weight_per_foot_grams,
        mv.unit_cost_inr,
        COALESCE(SUM(CASE WHEN il.quantity_delta > 0 THEN il.quantity_delta ELSE 0 END), 0) AS total_stock,
        CASE 
            WHEN mv.base_unit = 'GRAM' THEN ROUND(COALESCE(SUM(CASE WHEN il.quantity_delta > 0 THEN il.quantity_delta ELSE 0 END), 0) / 1000.0, 2)
            ELSE ROUND(COALESCE(SUM(CASE WHEN il.quantity_delta > 0 THEN il.quantity_delta ELSE 0 END), 0), 2)
        END AS total_stock_display,
        COALESCE(SUM(CASE WHEN il.quantity_delta < 0 THEN ABS(il.quantity_delta) ELSE 0 END), 0) AS used_stock,
        CASE 
            WHEN mv.base_unit = 'GRAM' THEN ROUND(COALESCE(SUM(CASE WHEN il.quantity_delta < 0 THEN ABS(il.quantity_delta) ELSE 0 END), 0) / 1000.0, 2)
            ELSE ROUND(COALESCE(SUM(CASE WHEN il.quantity_delta < 0 THEN ABS(il.quantity_delta) ELSE 0 END), 0), 2)
        END AS used_stock_display,
        CASE 
            WHEN mv.base_unit = 'GRAM' THEN ROUND(COALESCE(SUM(CASE WHEN il.quantity_delta < 0 AND il.reference_bill_id IS NOT NULL THEN ABS(il.quantity_delta) ELSE 0 END), 0) / 1000.0, 2)
            ELSE ROUND(COALESCE(SUM(CASE WHEN il.quantity_delta < 0 AND il.reference_bill_id IS NOT NULL THEN ABS(il.quantity_delta) ELSE 0 END), 0), 2)
        END AS normal_used_stock_display,
        CASE 
            WHEN mv.base_unit = 'GRAM' THEN ROUND(COALESCE(SUM(CASE WHEN il.quantity_delta < 0 AND (il.transaction_type IN ('PURCHASE_SCRAP', 'SCRAP_SALE') OR (il.transaction_type = 'BILL_CONSUMPTION' AND il.reference_bill_id IS NULL)) THEN ABS(il.quantity_delta) ELSE 0 END), 0) / 1000.0, 2)
            ELSE ROUND(COALESCE(SUM(CASE WHEN il.quantity_delta < 0 AND (il.transaction_type IN ('PURCHASE_SCRAP', 'SCRAP_SALE') OR (il.transaction_type = 'BILL_CONSUMPTION' AND il.reference_bill_id IS NULL)) THEN ABS(il.quantity_delta) ELSE 0 END), 0), 2)
        END AS secret_used_stock_display,
        COALESCE(SUM(il.quantity_delta), 0) AS current_stock,
        COALESCE(SUM(il.quantity_delta), 0) AS remaining_stock,
        CASE 
            WHEN mv.base_unit = 'GRAM' THEN ROUND(COALESCE(SUM(il.quantity_delta), 0) / 1000.0, 2)
            ELSE ROUND(COALESCE(SUM(il.quantity_delta), 0), 2)
        END AS current_stock_display,
        CASE 
            WHEN mv.base_unit = 'GRAM' THEN ROUND(COALESCE(SUM(il.quantity_delta), 0) / 1000.0, 2)
            ELSE ROUND(COALESCE(SUM(il.quantity_delta), 0), 2)
        END AS remaining_stock_display,
        CASE 
            WHEN mv.base_unit = 'GRAM' THEN 'KG'
            ELSE mv.base_unit
        END AS display_unit,
        ROUND(COALESCE(SUM(il.quantity_delta), 0) * mv.unit_cost_inr, 2) AS stock_valuation_inr,
        ROUND(COALESCE(SUM(CASE WHEN il.transaction_type = 'PURCHASE_RECEIPT' AND il.quantity_delta > 0 THEN il.quantity_delta * il.unit_cost_inr ELSE 0 END), 0), 2) AS total_investment_inr,
        mv.is_active
    FROM material_variants mv
    LEFT JOIN inventory_ledger il ON mv.id = il.material_variant_id
    GROUP BY mv.id;
  `);

  // 3. Recreate v_active_worker_bills with 48-hour window
  await pool.query(`DROP VIEW IF EXISTS v_active_worker_bills CASCADE;`);
  await pool.query(`
    CREATE OR REPLACE VIEW v_active_worker_bills AS
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
    WHERE b.created_at >= NOW() - INTERVAL '48 hours'
      AND (
        b.status = 'PENDING'
        OR (b.decided_at IS NOT NULL AND b.decided_at >= NOW() - INTERVAL '48 hours')
      );
  `);

  console.log('Successfully updated v_inventory_summary, v_active_worker_bills, and worker_id FK!');

  const check = await pool.query('SELECT id, material_variant_id, material_name, current_stock_display, display_unit, total_investment_inr FROM v_inventory_summary LIMIT 3');
  console.log('Sample rows from v_inventory_summary:');
  console.log(check.rows);

  await pool.end();
}

updateView().catch(e => {
  console.error(e);
  process.exit(1);
});
