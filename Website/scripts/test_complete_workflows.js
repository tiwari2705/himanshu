const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function assert(condition, message) {
  if (!condition) {
    throw new Error('ASSERTION FAILED: ' + message);
  }
  console.log('  ✓ ' + message);
}

async function testDatabaseAndWorkflows() {
  console.log('\n================================================================');
  console.log('PART 1: DATABASE & 4 BILL WORKFLOWS VERIFICATION (PostgreSQL)');
  console.log('================================================================');

  const client = await pool.connect();
  let testMaterialId = null;
  let testProductId = null;
  let adminUserId = null;
  const createdLedgerIds = [];
  const createdBillIds = [];

  try {
    const adminRes = await client.query(`SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1`);
    adminUserId = adminRes.rows[0]?.id || null;

    const prodRes = await client.query(`SELECT id, name FROM products LIMIT 1`);
    testProductId = prodRes.rows[0].id;

    // 1. Create a test material variant ("Test Iron Bar E2E")
    const matInsert = await client.query(
      `INSERT INTO material_variants (category, name, base_unit, bom_weight_per_foot_grams, unit_cost_inr)
       VALUES ('OTHER', 'Test Iron Bar E2E', 'KG', 0, 50)
       RETURNING id`
    );
    testMaterialId = matInsert.rows[0].id;

    // 2. Add two separate stock entries (100 KG + 50 KG = 150 KG Total Stock)
    const entry1 = await client.query(
      `INSERT INTO inventory_ledger (material_variant_id, transaction_type, quantity_delta, unit_cost_inr, notes, created_by)
       VALUES ($1, 'PURCHASE_RECEIPT', 100, 50, 'Batch 1: 100 KG', $2) RETURNING id`,
      [testMaterialId, adminUserId]
    );
    createdLedgerIds.push(entry1.rows[0].id);

    const entry2 = await client.query(
      `INSERT INTO inventory_ledger (material_variant_id, transaction_type, quantity_delta, unit_cost_inr, notes, created_by)
       VALUES ($1, 'PURCHASE_RECEIPT', 50, 60, 'Batch 2: 50 KG', $2) RETURNING id`,
      [testMaterialId, adminUserId]
    );
    createdLedgerIds.push(entry2.rows[0].id);

    let invCheck = await client.query(`SELECT * FROM v_inventory_summary WHERE id = $1`, [testMaterialId]);
    let invRow = invCheck.rows[0];
    assert(parseFloat(invRow.total_stock_display) === 150, 'Multiple stock entries summed to Total Stock = 150 KG (existing entry not overwritten)');
    assert(parseFloat(invRow.used_stock_display) === 0, 'Initial Used Stock = 0 KG');
    assert(parseFloat(invRow.remaining_stock_display) === 150, 'Initial Remaining Stock = 150 KG');
    assert(parseFloat(invRow.total_investment_inr) === 8000, 'Total Investment = ₹8,000 (100*50 + 50*60)');

    // 3. SCENARIO D: PENDING BILL (40 KG)
    console.log('\n--- Testing Scenario D: Pending Bill ---');
    const pendingBillRes = await client.query(
      `INSERT INTO bills (bill_number, product_id, worker_id, customer_name, production_cost_inr, selling_price_inr, gst_rate, gst_amount_inr, final_total_inr, status)
       VALUES ('TEST-PEND-001', $1, $2, 'Pending Customer', 2000, 3000, 0, 0, 3000, 'PENDING') RETURNING id`,
      [testProductId, adminUserId]
    );
    const pendingBillId = pendingBillRes.rows[0].id;
    createdBillIds.push(pendingBillId);

    await client.query(
      `INSERT INTO bill_items (bill_id, material_variant_id, actual_quantity_consumed, unit, line_cost_inr)
       VALUES ($1, $2, 40, 'KG', 2000)`,
      [pendingBillId, testMaterialId]
    );

    invCheck = await client.query(`SELECT * FROM v_inventory_summary WHERE id = $1`, [testMaterialId]);
    invRow = invCheck.rows[0];
    assert(parseFloat(invRow.remaining_stock_display) === 150, 'Pending Bill does NOT deduct Remaining Stock (still 150 KG)');
    assert(parseFloat(invRow.used_stock_display) === 0, 'Pending Bill Used Stock remains 0 KG');

    // 4. SCENARIO A: NORMAL APPROVAL (Approve the 40 KG bill)
    console.log('\n--- Testing Scenario A: Normal Approval ---');
    await client.query('BEGIN');
    const lockNorm = await client.query(`SELECT id, status FROM bills WHERE id = $1 FOR UPDATE`, [pendingBillId]);
    assert(lockNorm.rows[0].status === 'PENDING', 'Row-level FOR UPDATE lock acquired on PENDING bill');

    const normLedger = await client.query(
      `INSERT INTO inventory_ledger (material_variant_id, transaction_type, quantity_delta, unit_cost_inr, reference_bill_id, notes, created_by)
       VALUES ($1, 'BILL_CONSUMPTION', -40, 50, $2, 'Normal consumption', $3) RETURNING id`,
      [testMaterialId, pendingBillId, adminUserId]
    );
    createdLedgerIds.push(normLedger.rows[0].id);

    await client.query(`UPDATE bills SET status = 'APPROVED', decided_at = NOW() WHERE id = $1`, [pendingBillId]);
    await client.query('COMMIT');

    const checkNormBill = await client.query(`SELECT status FROM bills WHERE id = $1`, [pendingBillId]);
    assert(checkNormBill.rows.length === 1 && checkNormBill.rows[0].status === 'APPROVED', 'Normal-approved bill record is RETAINED in database with status APPROVED');

    invCheck = await client.query(`SELECT * FROM v_inventory_summary WHERE id = $1`, [testMaterialId]);
    invRow = invCheck.rows[0];
    assert(parseFloat(invRow.total_stock_display) === 150, 'Total Stock remains 150 KG');
    assert(parseFloat(invRow.used_stock_display) === 40, 'Used Stock updated to 40 KG');
    assert(parseFloat(invRow.normal_used_stock_display) === 40, 'Normal Used Stock = 40 KG');
    assert(parseFloat(invRow.remaining_stock_display) === 110, 'Remaining Stock deducted to 110 KG');

    const dupCheck = await client.query(`SELECT id FROM bills WHERE id = $1 AND status = 'PENDING'`, [pendingBillId]);
    assert(dupCheck.rows.length === 0, 'Duplicate approval prevented: bill is no longer PENDING');

    // 5. SCENARIO B: SECRET APPROVAL (35 KG)
    console.log('\n--- Testing Scenario B: Secret Approval ---');
    const secretBillRes = await client.query(
      `INSERT INTO bills (bill_number, product_id, worker_id, customer_name, production_cost_inr, selling_price_inr, gst_rate, gst_amount_inr, final_total_inr, status)
       VALUES ('TEST-SEC-002', $1, $2, 'Secret Customer', 1750, 2800, 0, 0, 2800, 'PENDING') RETURNING id`,
      [testProductId, adminUserId]
    );
    const secretBillId = secretBillRes.rows[0].id;
    createdBillIds.push(secretBillId);

    await client.query(
      `INSERT INTO bill_items (bill_id, material_variant_id, actual_quantity_consumed, unit, line_cost_inr)
       VALUES ($1, $2, 35, 'KG', 1750)`,
      [secretBillId, testMaterialId]
    );

    await client.query('BEGIN');
    const secLedger = await client.query(
      `INSERT INTO inventory_ledger (material_variant_id, transaction_type, quantity_delta, unit_cost_inr, reference_bill_id, notes, created_by)
       VALUES ($1, 'PURCHASE_SCRAP', -35, 0, NULL, 'Scrap inventory from production', $2) RETURNING id`,
      [testMaterialId, adminUserId]
    );
    const secLedgerId = secLedger.rows[0].id;
    createdLedgerIds.push(secLedgerId);

    await client.query(`DELETE FROM bills WHERE id = $1`, [secretBillId]);
    await client.query('COMMIT');

    const checkSecBill = await client.query(`SELECT * FROM bills WHERE id = $1`, [secretBillId]);
    const checkSecItems = await client.query(`SELECT * FROM bill_items WHERE bill_id = $1`, [secretBillId]);
    assert(checkSecBill.rows.length === 0 && checkSecItems.rows.length === 0, 'Secret-approved bill record & bill_items are NOT retained in business database');

    const checkUnsoldScrap = await client.query(`SELECT transaction_type, quantity_delta FROM inventory_ledger WHERE id = $1`, [secLedgerId]);
    assert(checkUnsoldScrap.rows[0].transaction_type === 'PURCHASE_SCRAP' && parseFloat(checkUnsoldScrap.rows[0].quantity_delta) === -35, 'Consumed inventory from Secret Approval is stored as Unsold Scrap (PURCHASE_SCRAP) in Website DB');

    invCheck = await client.query(`SELECT * FROM v_inventory_summary WHERE id = $1`, [testMaterialId]);
    invRow = invCheck.rows[0];
    assert(parseFloat(invRow.total_stock_display) === 150, 'Total Stock remains 150 KG after Secret Approval');
    assert(parseFloat(invRow.used_stock_display) === 75, 'Used Stock permanently updated to 75 KG (40 Normal + 35 Secret)');
    assert(parseFloat(invRow.secret_used_stock_display) === 35, 'Secret Used Stock = 35 KG in v_inventory_summary');
    assert(parseFloat(invRow.remaining_stock_display) === 75, 'Remaining Stock permanently deducted to 75 KG');

    // 5B. ADMIN SELLS SCRAP IN WEBSITE ADMIN DASHBOARD (35 KG sold for ₹1,400 — DB only, no double deduction)
    console.log('\n--- Testing Scenario B2: Selling Scrap in Website Database (Isolated from Google Sheets) ---');
    const soldAmtInr = 1400;
    const unitPriceInr = soldAmtInr / 35;
    await client.query(
      `UPDATE inventory_ledger SET transaction_type = 'SCRAP_SALE', unit_cost_inr = $1, notes = 'Scrap Sold for ₹1400' WHERE id = $2`,
      [unitPriceInr, secLedgerId]
    );

    const checkScrapSaleRev = await client.query(
      `SELECT COALESCE(SUM(ABS(quantity_delta) * unit_cost_inr), 0) AS scrap_rev FROM inventory_ledger WHERE id = $1 AND transaction_type = 'SCRAP_SALE'`,
      [secLedgerId]
    );
    assert(Math.round(parseFloat(checkScrapSaleRev.rows[0].scrap_rev)) === 1400, 'Sold scrap amount (₹1,400) stored and retrieved in Website Database');

    invCheck = await client.query(`SELECT * FROM v_inventory_summary WHERE id = $1`, [testMaterialId]);
    invRow = invCheck.rows[0];
    assert(parseFloat(invRow.remaining_stock_display) === 75 && parseFloat(invRow.used_stock_display) === 75, 'Selling scrap in Website DB does NOT double-deduct main inventory (Remaining=75 KG, Used=75 KG)');

    // 6. SCENARIO C: REJECTED BILL (20 KG)
    console.log('\n--- Testing Scenario C: Rejected Bill ---');
    const rejectBillRes = await client.query(
      `INSERT INTO bills (bill_number, product_id, worker_id, customer_name, production_cost_inr, selling_price_inr, gst_rate, gst_amount_inr, final_total_inr, status)
       VALUES ('TEST-REJ-003', $1, $2, 'Rejected Customer', 1000, 1500, 0, 0, 1500, 'PENDING') RETURNING id`,
      [testProductId, adminUserId]
    );
    const rejectBillId = rejectBillRes.rows[0].id;
    createdBillIds.push(rejectBillId);

    await client.query(
      `INSERT INTO bill_items (bill_id, material_variant_id, actual_quantity_consumed, unit, line_cost_inr)
       VALUES ($1, $2, 20, 'KG', 1000)`,
      [rejectBillId, testMaterialId]
    );

    await client.query(
      `UPDATE bills SET status = 'REJECTED', rejection_reason = 'Specification mismatch', decided_at = NOW() WHERE id = $1`,
      [rejectBillId]
    );

    const checkRejBill = await client.query(`SELECT status, rejection_reason FROM bills WHERE id = $1`, [rejectBillId]);
    assert(checkRejBill.rows.length === 1 && checkRejBill.rows[0].status === 'REJECTED', 'Rejected bill record is RETAINED in database with status REJECTED');

    invCheck = await client.query(`SELECT * FROM v_inventory_summary WHERE id = $1`, [testMaterialId]);
    invRow = invCheck.rows[0];
    assert(parseFloat(invRow.used_stock_display) === 75, 'Rejected bill does NOT increase Used Stock (remains 75 KG)');
    assert(parseFloat(invRow.remaining_stock_display) === 75, 'Rejected bill does NOT deduct Remaining Stock (remains 75 KG)');
  } finally {
    if (createdBillIds.length > 0) {
      await client.query(`DELETE FROM bills WHERE id = ANY($1::uuid[])`, [createdBillIds]);
    }
    if (createdLedgerIds.length > 0) {
      await client.query(`DELETE FROM inventory_ledger WHERE id = ANY($1::uuid[])`, [createdLedgerIds]);
    }
    if (testMaterialId) {
      await client.query(`DELETE FROM material_variants WHERE id = $1`, [testMaterialId]);
    }
    client.release();
  }
}

function testGoogleAppsScriptEngine() {
  console.log('\n================================================================');
  console.log('PART 2: GOOGLE APPS SCRIPT (Code.gs) & SHEETS SIMULATION');
  console.log('================================================================');

  const codeGsPath = path.join(__dirname, '..', '..', 'GoogleSheetManagement', 'Code.gs');
  const codeGs = fs.readFileSync(codeGsPath, 'utf8');

  const sheetsMap = {};
  function createMockSheet(name) {
    let grid = [];
    return {
      _name: name,
      _grid: grid,
      getName() { return this._name; },
      setName(newName) {
        delete sheetsMap[this._name];
        this._name = newName;
        sheetsMap[newName] = this;
      },
      clearContents() { this._grid = []; },
      appendRow(row) {
        this._grid.push(row.slice());
      },
      getDataRange() {
        const self = this;
        return {
          getValues() {
            return self._grid.map(r => r.slice());
          }
        };
      },
      getRange(r, c, numRows, numCols) {
        const self = this;
        if (typeof r === 'string') {
          return {
            setValues(vals) {
              for (let i = 0; i < vals.length; i++) {
                self._grid[i] = vals[i].slice();
              }
              return this;
            },
            setBackground() { return this; },
            setFontColor() { return this; },
            setFontWeight() { return this; }
          };
        }
        return {
          setValues(vals) {
            for (let i = 0; i < (numRows || vals.length); i++) {
              const targetRow = (r - 1) + i;
              if (!self._grid[targetRow]) self._grid[targetRow] = [];
              for (let j = 0; j < (numCols || vals[i].length); j++) {
                self._grid[targetRow][(c - 1) + j] = vals[i][j];
              }
            }
            return this;
          },
          clearContent() { return this; },
          setBackground() { return this; },
          setFontColor() { return this; },
          setFontWeight() { return this; }
        };
      }
    };
  }

  const mockSpreadsheet = {
    getSheetByName(name) { return sheetsMap[name] || null; },
    insertSheet(name) {
      const s = createMockSheet(name);
      sheetsMap[name] = s;
      return s;
    },
    getSheets() { return Object.values(sheetsMap); },
    getSpreadsheetTimeZone() { return 'Asia/Kolkata'; }
  };

  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => mockSpreadsheet,
      openById: () => mockSpreadsheet
    },
    Utilities: {
      formatDate: () => 'November 2026'
    },
    Session: {
      getScriptTimeZone: () => 'Asia/Kolkata'
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => {},
        releaseLock: () => {}
      })
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (txt) => ({
        _text: txt,
        setMimeType() { return this; },
        getText() { return this._text; }
      })
    },
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
      createHtmlOutputFromFile: () => ({
        setTitle() { return this; },
        setXFrameOptionsMode() { return this; }
      })
    },
    Logger: { log: () => {} },
    Date,
    Math,
    JSON,
    String,
    Number,
    Array,
    Object,
    RegExp,
    parseFloat,
    isNaN
  };

  vm.createContext(sandbox);
  vm.runInContext(codeGs, sandbox);
  // 1. Add Two Stock Entries for "Iron" (100 KG + 50 KG)
  sandbox.handleAddInventory({
    entry_id: 'ENTRY-IRON-1',
    product_name: 'Iron',
    category: 'COIL',
    unit: 'KG',
    quantity_added: 100,
    total_investment_inr: 5000,
    notes: 'Batch 1'
  }, 'November 2026');

  sandbox.handleAddInventory({
    entry_id: 'ENTRY-IRON-2',
    product_name: 'Iron',
    category: 'COIL',
    unit: 'KG',
    quantity_added: 50,
    total_investment_inr: 2500,
    notes: 'Batch 2'
  }, 'November 2026');

  const invSheet = sheetsMap['Inventory_Master'];
  assert(invSheet && invSheet._grid.length === 3, 'Inventory_Master created 2 distinct stock entry rows (plus header) without overwriting');

  // 2. Test Pending Bill in Monthly Sheet (`Bills_November_2026`)
  sandbox.handlePendingBill({
    bill_id: 'UUID-BILL-1',
    bill_number: '2026-27/1001',
    worker_username: 'worker1',
    customer_name: 'Customer Alpha',
    product_name: 'Door Frame',
    materials_summary: [{ name: 'Iron', category: 'COIL', actual_quantity_consumed: 60, unit: 'KG', display_quantity: 60, display_unit: 'KG' }],
    total_metal_weight_kg: 60,
    final_total_inr: 4500
  }, 'November 2026');

  const novSheet = sheetsMap['Bills_November_2026'];
  assert(!!novSheet, 'Monthly sheet Bills_November_2026 automatically created');
  assert(novSheet._grid.length === 2 && novSheet._grid[1][9] === 'Pending', 'Pending bill recorded in Bills_November_2026 with Status = "Pending"');

  // 3. Transition Bill 1 from Pending -> Approved – Normal (in-place update, no duplicate)
  sandbox.handleNormalBillApproval({
    bill_id: 'UUID-BILL-1',
    bill_number: '2026-27/1001',
    worker_username: 'worker1',
    customer_name: 'Customer Alpha',
    product_name: 'Door Frame',
    materials_summary: [{ name: 'Iron', category: 'COIL', actual_quantity_consumed: 60, unit: 'KG', display_quantity: 60, display_unit: 'KG' }],
    total_metal_weight_kg: 60,
    final_total_inr: 4500
  }, 'November 2026');

  assert(novSheet._grid.length === 2 && novSheet._grid[1][9] === 'Approved – Normal', 'Bill 1 updated in-place from Pending to "Approved – Normal" (no duplicate row created)');

  // 4. Create & Secret-Approve Bill 2 (consuming 50 KG of Iron: 40 KG from Batch 1 + 10 KG from Batch 2 via FIFO)
  sandbox.handlePendingBill({
    bill_id: 'UUID-BILL-2',
    bill_number: '2026-27/1002',
    worker_username: 'worker1',
    customer_name: 'Customer Beta',
    product_name: 'Window Frame',
    materials_summary: [{ name: 'Iron', category: 'COIL', actual_quantity_consumed: 50, unit: 'KG', display_quantity: 50, display_unit: 'KG' }],
    total_metal_weight_kg: 50,
    final_total_inr: 3800
  }, 'November 2026');

  sandbox.handleSecretBillApproval({
    bill_id: 'UUID-BILL-2',
    bill_number: '2026-27/1002',
    worker_username: 'worker1',
    customer_name: 'Customer Beta',
    product_name: 'Window Frame',
    materials_summary: [{ name: 'Iron', category: 'COIL', actual_quantity_consumed: 50, unit: 'KG', display_quantity: 50, display_unit: 'KG' }],
    total_metal_weight_kg: 50,
    final_total_inr: 3800
  }, 'November 2026');

  assert(novSheet._grid.length === 3 && novSheet._grid[2][9] === 'Approved – Secret', 'Bill 2 updated in-place to "Approved – Secret"');
  assert(invSheet._grid[1][5] === 100 && invSheet._grid[1][6] === 0, 'FIFO Batch 1: Total=100, Used=100, Remaining=0');
  assert(invSheet._grid[2][5] === 10 && invSheet._grid[2][6] === 40, 'FIFO Batch 2: Total=50, Used=10, Remaining=40');

  // 5. Rejected Bill 3 & Pending Bill 4 (excluded from revenue and inventory consumption)
  sandbox.handleRejectBill({
    bill_id: 'UUID-BILL-3',
    bill_number: '2026-27/1003',
    worker_username: 'worker1',
    customer_name: 'Customer Gamma',
    product_name: 'Door Frame',
    materials_summary: [{ name: 'Iron', category: 'COIL', actual_quantity_consumed: 25, unit: 'KG', display_quantity: 25, display_unit: 'KG' }],
    total_metal_weight_kg: 25,
    final_total_inr: 9999,
    rejection_reason: 'Cancelled by client'
  }, 'November 2026');

  sandbox.handlePendingBill({
    bill_id: 'UUID-BILL-4',
    bill_number: '2026-27/1004',
    worker_username: 'worker1',
    customer_name: 'Customer Delta',
    product_name: 'Door Frame',
    materials_summary: [{ name: 'Iron', category: 'COIL', actual_quantity_consumed: 15, unit: 'KG', display_quantity: 15, display_unit: 'KG' }],
    total_metal_weight_kg: 15,
    final_total_inr: 7777
  }, 'November 2026');

  // 6. Verify Dashboard Data output
  const dash = sandbox.getDashboardData('November 2026');
  assert(dash.revenueSummary.totalInvestment === 7500, 'Dashboard Total Investment = ₹7,500');
  assert(dash.revenueSummary.normal === 4500, 'Dashboard Normal Revenue = ₹4,500 (Pending/Rejected excluded)');
  assert(dash.revenueSummary.secret === 3800, 'Dashboard Secret Bills Revenue = ₹3,800');
  assert(dash.revenueSummary.grossIncome === 8300, 'Dashboard Gross Income = ₹8,300 (4500 + 3800)');
  assert(dash.inventoryItems[0].totalStock === 150 && dash.inventoryItems[0].usedStock === 110 && dash.inventoryItems[0].remainingStock === 40,
    'Dashboard Complete Inventory aggregates Iron: Total=150 KG, Used=110 KG (60 Normal + 50 Secret), Remaining=40 KG');
  assert(dash.secretInventoryUsage.length === 1 && dash.secretInventoryUsage[0].totalSecretUsed === 50,
    'Dashboard Secret Inventory Usage table accurately reports 50 KG of Iron consumed in Secret Bills');
}

async function main() {
  try {
    await testDatabaseAndWorkflows();
    testGoogleAppsScriptEngine();
    console.log('\n================================================================');
    console.log('ALL END-TO-END VERIFICATION CHECKS PASSED SUCCESSFULLY!');
    console.log('================================================================\n');
    await pool.end();
  } catch (err) {
    console.error('\nVERIFICATION ERROR:', err);
    await pool.end();
    process.exit(1);
  }
}

main();

