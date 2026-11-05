/**
 * ============================================================================
 * Manufacturing ERP & Stealth Scrap-Ledger System (v2.0)
 * Google Apps Script Backend (Code.gs)
 *
 * Manages the stealth dual-ledger and serves the Master Command Dashboard.
 * Connected Spreadsheet ID: 1CeH8mN0rXxsufJLIYsnDEVbnDSq0aR4PTQB3qbtjO4U
 * ============================================================================
 */

const SPREADSHEET_ID = '1CeH8mN0rXxsufJLIYsnDEVbnDSq0aR4PTQB3qbtjO4U';
const WEBHOOK_SECRET = 'ims_webhook_secret_2024';

/**
 * Robust spreadsheet getter:
 * Safe fallback to openById if running standalone or in Web App context.
 */
function getSpreadsheet() {
  let ss = null;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {
    Logger.log('getActiveSpreadsheet notice: ' + e);
  }
  if (!ss && SPREADSHEET_ID) {
    try {
      ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    } catch (e) {
      Logger.log('openById error: ' + e);
    }
  }
  if (!ss) {
    throw new Error('Spreadsheet not found! Verify SPREADSHEET_ID: ' + SPREADSHEET_ID);
  }
  return ss;
}

/**
 * Numeric sanitizer to prevent NaN and handle currency strings / units
 */
function cleanNum(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const str = String(val).replace(/[^0-9.-]/g, '');
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

/**
 * Normalizes month/year strings (including "Bills_November_2026" or "November 2026") to "MMMM yyyy".
 */
function normalizeMonthYear(val, ss) {
  if (!val) return '';
  if (val instanceof Date) {
    const tz = (ss && ss.getSpreadsheetTimeZone()) || Session.getScriptTimeZone() || 'Asia/Kolkata';
    return Utilities.formatDate(val, tz, 'MMMM yyyy');
  }
  let str = String(val).trim();
  if (/^bills[\s\-_]+/i.test(str)) {
    str = str.replace(/^bills[\s\-_]+/i, '').trim();
  }
  const monthMatch = str.match(/^([A-Za-z]+)[\s\-_]+(\d{4})$/);
  if (monthMatch) {
    const m = monthMatch[1].toLowerCase();
    const y = monthMatch[2];
    const fullMonths = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const found = fullMonths.find(fm => fm.toLowerCase() === m || fm.toLowerCase().startsWith(m));
    if (found) {
      return found + ' ' + y;
    }
    return str.replace(/_/g, ' ');
  }
  try {
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime()) && str.length > 4) {
      const tz = (ss && ss.getSpreadsheetTimeZone()) || Session.getScriptTimeZone() || 'Asia/Kolkata';
      return Utilities.formatDate(parsed, tz, 'MMMM yyyy');
    }
  } catch (_) {}
  return str;
}

/**
 * Converts a month/year string (e.g. "November 2026") to canonical monthly sheet name ("Bills_November_2026")
 */
function toMonthlySheetName(val, ss) {
  const norm = normalizeMonthYear(val, ss);
  if (!norm) return 'Bills_Current_Month';
  return 'Bills_' + norm.replace(/\s+/g, '_');
}

/**
 * Canonical status normalizer for monthly bill sheets:
 * Maps legacy or raw status strings to:
 * 1. 'Pending'
 * 2. 'Approved – Normal'
 * 3. 'Approved – Secret'
 * 4. 'Rejected'
 */
function normalizeBillStatus(rawStatus) {
  const s = String(rawStatus || '').trim();
  const u = s.toUpperCase();
  if (u === 'PENDING') return 'Pending';
  if (u === 'REJECTED' || u.includes('REJECT')) return 'Rejected';
  if (u.includes('SECRET') || u.includes('RS45') || u.includes('SCRAP')) return 'Approved – Secret';
  if (u === 'NORMAL' || u === 'APPROVED' || u.includes('NORMAL')) return 'Approved – Normal';
  return s || 'Pending';
}

/**
 * Get or create Scrap_Inventory_Master tab with 11 dark-styled headers.
 */
function getOrCreateScrapMaster(ss) {
  ss = ss || getSpreadsheet();
  let scrapMaster = ss.getSheetByName('Scrap_Inventory_Master');
  if (!scrapMaster) {
    const allSheets = ss.getSheets();
    for (let s of allSheets) {
      const data = s.getDataRange().getValues();
      if (data.length > 0) {
        const h0 = String(data[0][0] || '').toLowerCase();
        const h1 = String(data[0][1] || '').toLowerCase();
        if (h0.includes('month') && (h1.includes('carryover') || h1.includes('scrap'))) {
          scrapMaster = s;
          try {
            scrapMaster.setName('Scrap_Inventory_Master');
          } catch (_) {}
          return scrapMaster;
        }
      }
    }
  }

  if (!scrapMaster) {
    scrapMaster = ss.insertSheet('Scrap_Inventory_Master');
    scrapMaster.getRange('A1:K1').setValues([[
      'Month_Year',
      'Carryover_Weight_KG',
      'New_Scrap_Added_KG',
      'Total_Weight_KG',
      'Used_Weight_KG',
      'Available_Weight_KG',
      'Scrap_Sale_Offset_INR',
      'Secret_Bills_Revenue_INR',
      'Net_Scrap_Revenue_INR',
      'Normal_Bills_Revenue_INR',
      'Updated_At'
    ]]);
    
    scrapMaster.getRange('A1:K1')
      .setBackground('#0f172a')
      .setFontColor('#f8fafc')
      .setFontWeight('bold');
  }
  return scrapMaster;
}

/**
 * Sheet 1: Permanent Inventory Management Sheet (`Inventory_Master`)
 * Maintains permanent stock records across all months with 13 columns:
 * Entry_ID, Product_Name, Category, Measurement_Unit, Total_Stock, Used_Stock, Remaining_Stock,
 * Normal_Used_Stock, Secret_Used_Stock, Total_Investment_INR, Entry_Date, Notes, Updated_At
 */
const INVENTORY_HEADERS = [
  'Entry_ID',
  'Product_Name',
  'Category',
  'Measurement_Unit',
  'Total_Stock',
  'Used_Stock',
  'Remaining_Stock',
  'Normal_Used_Stock',
  'Secret_Used_Stock',
  'Total_Investment_INR',
  'Entry_Date',
  'Notes',
  'Updated_At'
];

function getOrCreateInventoryMaster(ss) {
  ss = ss || getSpreadsheet();
  let invMaster = ss.getSheetByName('Inventory_Master');
  if (!invMaster) {
    invMaster = ss.insertSheet('Inventory_Master');
    invMaster.getRange(1, 1, 1, INVENTORY_HEADERS.length).setValues([INVENTORY_HEADERS]);
    invMaster.getRange(1, 1, 1, INVENTORY_HEADERS.length)
      .setBackground('#0f172a')
      .setFontColor('#f8fafc')
      .setFontWeight('bold');
    return invMaster;
  }

  // Upgrade legacy 8-column Inventory_Master if needed without losing existing records
  const raw = invMaster.getDataRange().getValues();
  if (raw.length > 0 && String(raw[0][0] || '').trim() !== 'Entry_ID') {
    const migratedRows = [];
    const nowIso = new Date().toISOString();
    for (let i = 1; i < raw.length; i++) {
      const r = raw[i];
      if (!r || r.every(c => c === '' || c === null || c === undefined)) continue;
      const pName = String(r[0] || 'Material');
      const cat = String(r[1] || 'OTHER');
      const unit = String(r[2] || 'KG');
      const lastAdded = cleanNum(r[3]);
      const currStock = cleanNum(r[4]);
      const totalStock = Math.max(lastAdded, currStock);
      const usedStock = Math.max(0, totalStock - currStock);
      const invInr = cleanNum(r[5]);
      const notes = String(r[6] || 'Migrated Stock Record');
      const updated = r[7] ? (r[7] instanceof Date ? r[7].toISOString() : String(r[7])) : nowIso;
      migratedRows.push([
        'INIT-' + i,
        pName,
        cat,
        unit,
        totalStock,
        usedStock,
        currStock,
        usedStock,
        0,
        invInr,
        updated,
        notes,
        nowIso
      ]);
    }
    invMaster.clearContents();
    invMaster.getRange(1, 1, 1, INVENTORY_HEADERS.length).setValues([INVENTORY_HEADERS]);
    invMaster.getRange(1, 1, 1, INVENTORY_HEADERS.length)
      .setBackground('#0f172a')
      .setFontColor('#f8fafc')
      .setFontWeight('bold');
    if (migratedRows.length > 0) {
      invMaster.getRange(2, 1, migratedRows.length, INVENTORY_HEADERS.length).setValues(migratedRows);
    }
  }
  return invMaster;
}

/**
 * Ensures any baseline items from DB snapshot exist in Inventory_Master without overwriting existing stock entry rows.
 */
function ensureSnapshotItemsInInventoryMaster(ss, snapshot) {
  if (!snapshot || !Array.isArray(snapshot) || snapshot.length === 0) return;
  const invMaster = getOrCreateInventoryMaster(ss);
  const raw = invMaster.getDataRange().getValues();
  const existingProducts = {};
  for (let i = 1; i < raw.length; i++) {
    const pName = String(raw[i][1] || '').trim().toLowerCase();
    if (pName) existingProducts[pName] = true;
  }

  const nowIso = new Date().toISOString();
  snapshot.forEach((item, idx) => {
    const pName = String(item.product_name || '').trim();
    const key = pName.toLowerCase();
    if (!pName || existingProducts[key]) return;

    const totalStock = cleanNum(item.total_stock !== undefined ? item.total_stock : item.current_stock);
    const usedStock = cleanNum(item.used_stock !== undefined ? item.used_stock : 0);
    const remStock = cleanNum(item.remaining_stock !== undefined ? item.remaining_stock : item.current_stock);
    const normUsed = cleanNum(item.normal_used_stock !== undefined ? item.normal_used_stock : usedStock);
    const secUsed = cleanNum(item.secret_used_stock !== undefined ? item.secret_used_stock : 0);

    invMaster.appendRow([
      'SEED-' + Date.now() + '-' + idx,
      pName,
      String(item.category || 'OTHER'),
      String(item.unit || 'KG').toUpperCase(),
      totalStock,
      usedStock,
      remStock,
      normUsed,
      secUsed,
      cleanNum(item.total_investment_inr || item.stock_valuation_inr || 0),
      nowIso,
      'Initial synced inventory record',
      nowIso
    ]);
    existingProducts[key] = true;
  });
}

/**
 * Deducts consumed bill quantities from Inventory_Master across matching item rows (FIFO order)
 * without overwriting or deleting historical stock entry rows.
 */
function deductInventoryFromMaster(ss, materialsSummary, isSecret, snapshot) {
  const invMaster = getOrCreateInventoryMaster(ss);
  if (snapshot && Array.isArray(snapshot)) {
    ensureSnapshotItemsInInventoryMaster(ss, snapshot);
  }
  if (!materialsSummary || !Array.isArray(materialsSummary) || materialsSummary.length === 0) return;

  const raw = invMaster.getDataRange().getValues();
  if (raw.length <= 1) return;

  const nowIso = new Date().toISOString();
  let modified = false;

  materialsSummary.forEach(mat => {
    const matName = String(mat.name || mat.material_name || '').trim().toLowerCase();
    if (!matName) return;

    let qtyToDeduct = 0;
    if (mat.display_quantity !== undefined) {
      qtyToDeduct = cleanNum(mat.display_quantity);
    } else {
      const rawQty = cleanNum(mat.actual_quantity_consumed || mat.quantity || 0);
      const rawUnit = String(mat.unit || '').toUpperCase();
      qtyToDeduct = (rawUnit === 'GRAM' || rawUnit === 'G') ? (rawQty / 1000.0) : rawQty;
    }
    if (qtyToDeduct <= 0) return;

    const matchingRowIndices = [];
    for (let i = 1; i < raw.length; i++) {
      const rowName = String(raw[i][1] || '').trim().toLowerCase();
      if (rowName === matName) {
        matchingRowIndices.push(i);
      }
    }

    if (matchingRowIndices.length === 0) {
      const dispUnit = String(mat.display_unit || (String(mat.unit || '').toUpperCase() === 'GRAM' ? 'KG' : mat.unit) || 'KG').toUpperCase();
      invMaster.appendRow([
        'AUTO-' + Date.now(),
        String(mat.name || mat.material_name || 'Material'),
        String(mat.category || 'OTHER'),
        dispUnit,
        0,
        qtyToDeduct,
        -qtyToDeduct,
        isSecret ? 0 : qtyToDeduct,
        isSecret ? qtyToDeduct : 0,
        0,
        nowIso,
        'Auto-created on bill consumption',
        nowIso
      ]);
      return;
    }

    let remainingToDeduct = qtyToDeduct;
    for (let idx = 0; idx < matchingRowIndices.length; idx++) {
      const rIdx = matchingRowIndices[idx];
      const row = raw[rIdx];
      const totalStock = cleanNum(row[4]);
      const usedStock = cleanNum(row[5]);
      const remStock = cleanNum(row[6]);
      const normUsed = cleanNum(row[7]);
      const secUsed = cleanNum(row[8]);

      const isLastRow = (idx === matchingRowIndices.length - 1);
      let deductHere = 0;

      if (remStock > 0) {
        deductHere = isLastRow ? remainingToDeduct : Math.min(remStock, remainingToDeduct);
      } else if (isLastRow && remainingToDeduct > 0) {
        deductHere = remainingToDeduct;
      }

      if (deductHere > 0) {
        const newUsed = Number((usedStock + deductHere).toFixed(4));
        const newRem = Number((totalStock - newUsed).toFixed(4));
        const newNorm = isSecret ? normUsed : Number((normUsed + deductHere).toFixed(4));
        const newSec = isSecret ? Number((secUsed + deductHere).toFixed(4)) : secUsed;

        raw[rIdx][5] = newUsed;
        raw[rIdx][6] = newRem;
        raw[rIdx][7] = newNorm;
        raw[rIdx][8] = newSec;
        raw[rIdx][12] = nowIso;

        remainingToDeduct = Number((remainingToDeduct - deductHere).toFixed(4));
        modified = true;
      }
      if (remainingToDeduct <= 0) break;
    }
  });

  if (modified) {
    const bodyRows = raw.slice(1).map(r => {
      while (r.length < INVENTORY_HEADERS.length) r.push('');
      return r.slice(0, INVENTORY_HEADERS.length);
    });
    invMaster.getRange(2, 1, bodyRows.length, INVENTORY_HEADERS.length).setValues(bodyRows);
  }
}

/**
 * Sheet 2: Monthly Bill Records (`Bills_<Month>_<Year>`, e.g., `Bills_November_2026`)
 */
const MONTHLY_BILL_HEADERS = [
  'Bill_Date',
  'Bill_Number',
  'Bill_ID',
  'Worker_Username',
  'Customer_Name',
  'Product_Name',
  'Materials_Summary',
  'Total_Weight_KG',
  'Bill_Amount_INR',
  'Status',
  'Remarks_Reason',
  'Materials_JSON',
  'Updated_At'
];

function ensureMonthlyBillTab(monthYear) {
  const ss = getSpreadsheet();
  const canonicalName = toMonthlySheetName(monthYear, ss);
  const legacyName = normalizeMonthYear(monthYear, ss);

  let billTab = ss.getSheetByName(canonicalName);
  if (!billTab && legacyName) {
    const legacyTab = ss.getSheetByName(legacyName);
    if (legacyTab) {
      billTab = legacyTab;
      try {
        billTab.setName(canonicalName);
      } catch (_) {}
    }
  }

  if (!billTab) {
    billTab = ss.insertSheet(canonicalName);
    billTab.getRange(1, 1, 1, MONTHLY_BILL_HEADERS.length).setValues([MONTHLY_BILL_HEADERS]);
    billTab.getRange(1, 1, 1, MONTHLY_BILL_HEADERS.length)
      .setBackground('#0f172a')
      .setFontColor('#f8fafc')
      .setFontWeight('bold');
  }

  return billTab;
}

/**
 * Idempotent upsert for a bill row in the monthly sheet.
 */
function upsertMonthlyBillRow(billTab, data, statusLabel) {
  const nowIso = new Date().toISOString();
  const billDate = String(data.bill_date || nowIso);
  const billId = String(data.bill_id || data.billId || data.bill_number || 'BILL-' + Date.now()).trim();
  const billNumber = String(data.bill_number || data.billId || billId).trim();
  const worker = String(data.worker_username || data.worker || 'worker').trim();
  const customer = String(data.customer_name || data.customer || 'Customer').trim();
  const product = String(data.product_name || data.product || 'Product Frame').trim();
  const materialsObj = data.materials_summary || data.materials || [];
  const materialsText = formatMaterialsSummary(materialsObj);
  const materialsJson = Array.isArray(materialsObj) ? JSON.stringify(materialsObj) : '';
  const weightKg = cleanNum(data.total_metal_weight_kg || data.metalWeightKg || 0);
  const amountInr = cleanNum(data.amount || data.final_total_inr || 0);
  const canonicalStatus = normalizeBillStatus(statusLabel);
  const remarks = String(data.rejection_reason || data.remarks || '');

  const raw = billTab.getDataRange().getValues();
  const is13Col = raw.length > 0 && String(raw[0][2] || '').trim() === 'Bill_ID';

  if (raw.length > 1) {
    for (let i = 1; i < raw.length; i++) {
      const r = raw[i];
      const existingBillNo = String(r[1] || '').trim();
      const existingBillId = is13Col ? String(r[2] || '').trim() : existingBillNo;
      const existingStatus = normalizeBillStatus(is13Col ? r[9] : r[8]);

      if ((billId && existingBillId === billId) || (billNumber && existingBillNo === billNumber)) {
        const alreadyApproved =
          (existingStatus === 'Approved – Normal' || existingStatus === 'Approved – Secret') &&
          (canonicalStatus === 'Approved – Normal' || canonicalStatus === 'Approved – Secret');

        if (is13Col) {
          billTab.getRange(i + 1, 1, 1, MONTHLY_BILL_HEADERS.length).setValues([[
            r[0] || billDate,
            billNumber,
            billId,
            worker,
            customer,
            product,
            materialsText,
            weightKg,
            amountInr,
            canonicalStatus,
            remarks,
            materialsJson || String(r[11] || ''),
            nowIso
          ]]);
        } else {
          billTab.getRange(i + 1, 1, 1, 9).setValues([[
            r[0] || billDate,
            billNumber,
            worker,
            customer,
            product,
            materialsText + (remarks ? ' [Reason: ' + remarks + ']' : ''),
            weightKg,
            amountInr,
            canonicalStatus
          ]]);
        }
        return { updated: true, alreadyProcessed: alreadyApproved };
      }
    }
  }

  if (is13Col || raw.length === 0) {
    billTab.appendRow([
      billDate,
      billNumber,
      billId,
      worker,
      customer,
      product,
      materialsText,
      weightKg,
      amountInr,
      canonicalStatus,
      remarks,
      materialsJson,
      nowIso
    ]);
  } else {
    billTab.appendRow([
      billDate,
      billNumber,
      worker,
      customer,
      product,
      materialsText + (remarks ? ' [Reason: ' + remarks + ']' : ''),
      weightKg,
      amountInr,
      canonicalStatus
    ]);
  }

  return { updated: false, alreadyProcessed: false };
}

/**
 * Reads the latest cumulative metrics from Scrap_Inventory_Master
 */
function getLastScrapMetrics(scrapMaster) {
  const rawData = scrapMaster.getDataRange().getValues();
  if (rawData.length <= 1) {
    return {
      carryover: 0,
      newScrap: 0,
      total: 0,
      used: 0,
      available: 0,
      scrapOffset: 0,
      secretRevenue: 0,
      netScrapRevenue: 0,
      normalRevenue: 0
    };
  }

  const lastRow = rawData[rawData.length - 1];
  return {
    carryover: cleanNum(lastRow[1]),
    newScrap: cleanNum(lastRow[2]),
    total: cleanNum(lastRow[3]),
    used: cleanNum(lastRow[4]),
    available: cleanNum(lastRow[5]),
    scrapOffset: cleanNum(lastRow[6]),
    secretRevenue: cleanNum(lastRow[7]),
    netScrapRevenue: cleanNum(lastRow[8]),
    normalRevenue: cleanNum(lastRow[9])
  };
}

/**
 * Webhook endpoint for Next.js ERP backend
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({
        error: 'No post data received'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    const payload = JSON.parse(e.postData.contents);
    
    if (WEBHOOK_SECRET && payload.secret !== WEBHOOK_SECRET) {
      return ContentService.createTextOutput(JSON.stringify({
        error: 'Unauthorized: Invalid secret'
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    const ss = getSpreadsheet();
    const currentMonth = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone() || 'Asia/Kolkata', 'MMMM yyyy');
    
    switch (payload.action) {
      case 'ADD_INVENTORY':
      case 'SYNC_INVENTORY':
        return handleAddInventory(payload.data, currentMonth);

      case 'CREATE_PENDING_BILL':
        return handlePendingBill(payload.data, currentMonth);

      case 'APPROVE_NORMAL_BILL':
        return handleNormalBillApproval(payload.data, currentMonth);
        
      case 'APPROVE_SECRET_BILL':
        return handleSecretBillApproval(payload.data, currentMonth);
        
      case 'REJECT_BILL':
        return handleRejectBill(payload.data, currentMonth);

      case 'RECORD_SCRAP_SALE':
        return handleScrapSale(payload.data, currentMonth);

      case 'RECORD_PURCHASE_SCRAP':
        return handlePurchaseScrap(payload.data, currentMonth);

      case 'GET_DASHBOARD_DATA':
        return ContentService.createTextOutput(JSON.stringify(
          getDashboardData(payload.data && payload.data.month)
        )).setMimeType(ContentService.MimeType.JSON);
        
      default:
        return ContentService.createTextOutput(JSON.stringify({
          error: 'Unknown action: ' + payload.action
        })).setMimeType(ContentService.MimeType.JSON);
    }
  } catch (error) {
    Logger.log('doPost error: ' + error.toString());
    return ContentService.createTextOutput(JSON.stringify({
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 0. ADD INVENTORY & TOTAL INVESTMENT:
 * - Creates a NEW stock entry row in permanent `Inventory_Master` without overwriting existing stock records
 */
function handleAddInventory(data, currentMonth) {
  const ss = getSpreadsheet();
  const invMaster = getOrCreateInventoryMaster(ss);

  const entryId = String(data.entry_id || ('INV-' + Date.now())).trim();
  const productName = String(data.product_name || data.productName || 'Inventory Item').trim();
  const category = String(data.category || 'OTHER').trim().toUpperCase();
  const unit = String(data.unit || data.measurement_unit || 'KG').toUpperCase();
  const qtyAdded = cleanNum(data.quantity_added || data.quantity || 0);
  const investmentAdded = cleanNum(data.total_investment_inr || data.totalInvestment || 0);
  const entryDate = String(data.entry_date || new Date().toISOString());
  const notes = String(data.notes || 'Added via Admin Portal');
  const nowIso = new Date().toISOString();

  const raw = invMaster.getDataRange().getValues();
  let existingRowIndex = -1;
  for (let i = 1; i < raw.length; i++) {
    if (String(raw[i][0] || '').trim() === entryId) {
      existingRowIndex = i + 1;
      break;
    }
  }

  if (existingRowIndex !== -1) {
    const prevRow = raw[existingRowIndex - 1];
    const used = cleanNum(prevRow[5]);
    invMaster.getRange(existingRowIndex, 1, 1, INVENTORY_HEADERS.length).setValues([[
      entryId,
      productName,
      category,
      unit,
      qtyAdded,
      used,
      qtyAdded - used,
      cleanNum(prevRow[7]),
      cleanNum(prevRow[8]),
      investmentAdded,
      entryDate,
      notes,
      nowIso
    ]]);
  } else if (qtyAdded > 0 || productName) {
    invMaster.appendRow([
      entryId,
      productName,
      category,
      unit,
      qtyAdded,
      0,
      qtyAdded,
      0,
      0,
      investmentAdded,
      entryDate,
      notes,
      nowIso
    ]);
  }

  if (data.inventory_snapshot && Array.isArray(data.inventory_snapshot)) {
    ensureSnapshotItemsInInventoryMaster(ss, data.inventory_snapshot);
  }

  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    action: 'ADD_INVENTORY',
    entry_id: entryId
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 0B. PENDING BILL CREATION:
 * - Records every newly created bill in `Bills_<Month>_<Year>` with Status = 'Pending'
 */
function handlePendingBill(data, currentMonth) {
  const billTab = ensureMonthlyBillTab(currentMonth);
  const res = upsertMonthlyBillRow(billTab, data, 'Pending');
  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    status: 'Pending',
    updated: res.updated
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 1. NORMAL BILL APPROVAL:
 * - Updates/inserts bill row in `Bills_<Month>_<Year>` with Status = 'Approved – Normal'
 * - Deducts consumed quantities in `Inventory_Master` (updating Used_Stock, Normal_Used_Stock, Remaining_Stock)
 */
function handleNormalBillApproval(data, currentMonth) {
  const ss = getSpreadsheet();
  const billTab = ensureMonthlyBillTab(currentMonth);
  const upsertRes = upsertMonthlyBillRow(billTab, data, 'Approved – Normal');

  if (!upsertRes.alreadyProcessed) {
    deductInventoryFromMaster(ss, data.materials_summary || data.materials, false, data.inventory_snapshot);
  }

  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    status: 'Approved – Normal',
    approvalType: 'NORMAL'
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 2. SECRET BILL APPROVAL:
 * - Updates/inserts bill row in `Bills_<Month>_<Year>` with Status = 'Approved – Secret'
 * - Deducts consumed quantities in `Inventory_Master` (updating Used_Stock, Secret_Used_Stock, Remaining_Stock)
 */
function handleSecretBillApproval(data, currentMonth) {
  const ss = getSpreadsheet();
  const billTab = ensureMonthlyBillTab(currentMonth);
  const upsertRes = upsertMonthlyBillRow(billTab, data, 'Approved – Secret');

  if (!upsertRes.alreadyProcessed) {
    deductInventoryFromMaster(ss, data.materials_summary || data.materials, true, data.inventory_snapshot);
  }

  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    status: 'Approved – Secret',
    approvalType: 'APPROVED_SECRET'
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 3. REJECTION PATH:
 * - Updates/inserts bill row in `Bills_<Month>_<Year>` with Status = 'Rejected'
 * - Does not deduct inventory or include in revenue calculations
 */
function handleRejectBill(data, currentMonth) {
  const billTab = ensureMonthlyBillTab(currentMonth);
  upsertMonthlyBillRow(billTab, data, 'Rejected');

  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    status: 'Rejected',
    approvalType: 'REJECTED'
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 4. RECORD SCRAP SALE:
 * Floor scrap material sold for cash (e.g., 40 kg for ₹10,000)
 * Appends new row in Scrap_Inventory_Master:
 * - New_Scrap_Added_KG += 40 kg
 * - Scrap_Sale_Offset_INR -= 10,000 (-10000)
 * - Normal_Bills_Revenue_INR += 10,000 (+10000 official cash)
 */
function handleScrapSale(data, currentMonth) {
  const ss = getSpreadsheet();
  const scrapMaster = getOrCreateScrapMaster(ss);
  
  const prev = getLastScrapMetrics(scrapMaster);
  
  const qty = cleanNum(data.quantity || 0);
  const amt = cleanNum(data.amount || 0);
  
  const newCarryover = prev.available;
  const newScrapAdded = qty;
  const newTotal = newCarryover + newScrapAdded;
  const newUsed = prev.used;
  const newAvailable = newTotal - newUsed;
  const newOffset = prev.scrapOffset - amt;
  const newSecret = prev.secretRevenue;
  const newNetScrap = newOffset + newSecret;
  const newNormal = prev.normalRevenue + amt;
  
  const newRow = [
    currentMonth,
    newCarryover,
    newScrapAdded,
    newTotal,
    newUsed,
    newAvailable,
    newOffset,
    newSecret,
    newNetScrap,
    newNormal,
    new Date().toISOString()
  ];
  scrapMaster.appendRow(newRow);
  
  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    available: newAvailable
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 5. RECORD PURCHASE SCRAP:
 * Raw material purchase containing defective scrap (e.g. 500g = 0.5kg defective from 20kg coil purchase)
 * Appends new row in Scrap_Inventory_Master adding to New_Scrap_Added_KG and Available_Weight_KG
 */
function handlePurchaseScrap(data, currentMonth) {
  const ss = getSpreadsheet();
  const scrapMaster = getOrCreateScrapMaster(ss);
  
  const prev = getLastScrapMetrics(scrapMaster);
  const scrapWeightKg = cleanNum(data.scrapWeightKg || (data.scrapWeightGrams ? data.scrapWeightGrams / 1000.0 : 0));
  
  const newCarryover = prev.available;
  const newScrapAdded = scrapWeightKg;
  const newTotal = newCarryover + newScrapAdded;
  const newUsed = prev.used;
  const newAvailable = newTotal - newUsed;
  
  const newRow = [
    currentMonth,
    newCarryover,
    newScrapAdded,
    newTotal,
    newUsed,
    newAvailable,
    prev.scrapOffset,
    prev.secretRevenue,
    prev.scrapOffset + prev.secretRevenue,
    prev.normalRevenue,
    new Date().toISOString()
  ];
  scrapMaster.appendRow(newRow);
  
  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    available: newAvailable
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Format material summary for spreadsheet cells
 */
function formatMaterialsSummary(summary) {
  if (!summary) return '-';
  if (typeof summary === 'string') return summary;
  if (Array.isArray(summary)) {
    return summary.map(m => {
      let part = m.name || m.material_name || m.category;
      if (m.input_length && m.input_breadth) {
        part += ' (' + m.input_length + 'x' + m.input_breadth + 'ft, ' + m.calculated_feet + 'ft)';
      }
      if (m.actual_quantity_consumed) {
        part += ' -> ' + m.actual_quantity_consumed + ' ' + (m.unit || '');
      }
      return part;
    }).join(' | ');
  }
  return JSON.stringify(summary);
}

/**
 * Serve dashboard HTML or raw JSON data
 */
function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'data') {
    return ContentService.createTextOutput(JSON.stringify(
      getDashboardData(e.parameter.month)
    )).setMimeType(ContentService.MimeType.JSON);
  }

  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Manufacturing ERP - Master Stealth Command Center')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Helper to parse a monthly bill sheet (supports both 13-col finalized format and 9-col legacy format)
 */
function parseBillSheetRows(sheet) {
  const result = {
    sheetName: sheet ? sheet.getName() : '',
    bills: [],
    normalBills: [],
    secretBills: [],
    pendingBills: [],
    rejectedBills: [],
    normalRevenue: 0,
    secretRevenue: 0,
    grossIncome: 0,
    normalWeightKg: 0,
    secretWeightKg: 0,
    itemUsageMap: {}
  };
  if (!sheet) return result;

  const billData = sheet.getDataRange().getValues();
  if (billData.length <= 1) return result;

  const bHeaders = billData[0].map(h => String(h || '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
  const is13Col = bHeaders.includes('billnumber') && bHeaders.includes('billid');

  const colDate = bHeaders.findIndex(h => h.includes('date') || h.includes('time'));
  const colBillNo = is13Col ? bHeaders.indexOf('billnumber') : bHeaders.findIndex(h => h.includes('billid') || h === 'id' || h.includes('bill'));
  const colBillId = is13Col ? bHeaders.indexOf('billid') : colBillNo;
  const colWorker = bHeaders.findIndex(h => h.includes('worker'));
  const colCustomer = bHeaders.findIndex(h => h.includes('customer'));
  const colProduct = bHeaders.findIndex(h => h.includes('product'));
  const colMaterials = bHeaders.findIndex(h => h.includes('materialssummary') || h.includes('material') || h.includes('summary'));
  const colMetalWeight = bHeaders.findIndex(h => h.includes('weight') || h.includes('metal') || h.includes('kg'));
  const colAmt = bHeaders.findIndex(h => h.includes('billamount') || h.includes('amount') || h.includes('totalamount') || h.includes('inr'));
  const colStatus = bHeaders.findIndex(h => h === 'status' || h.includes('approval') || h.includes('type'));
  const colRemarks = bHeaders.findIndex(h => h.includes('remark') || h.includes('reason'));
  const colMatJson = bHeaders.findIndex(h => h.includes('materialsjson') || h.includes('json'));
  const colUpdated = bHeaders.findIndex(h => h.includes('updated'));

  for (let i = 1; i < billData.length; i++) {
    const row = billData[i];
    if (!row || row.every(c => c === '' || c === null || c === undefined)) continue;

    const rawDate = colDate !== -1 ? row[colDate] : row[0];
    const dateStr = rawDate ? (rawDate instanceof Date ? rawDate.toISOString() : String(rawDate)) : '';
    const billNumber = colBillNo !== -1 ? String(row[colBillNo] || '') : String(row[1] || '');
    const billId = colBillId !== -1 ? String(row[colBillId] || billNumber) : billNumber;
    const worker = colWorker !== -1 ? String(row[colWorker] || 'worker') : String(row[is13Col ? 3 : 2] || 'worker');
    const customer = colCustomer !== -1 ? String(row[colCustomer] || 'Customer') : String(row[is13Col ? 4 : 3] || 'Customer');
    const product = colProduct !== -1 ? String(row[colProduct] || 'Frame') : String(row[is13Col ? 5 : 4] || 'Frame');
    const materials = colMaterials !== -1 ? String(row[colMaterials] || '-') : String(row[is13Col ? 6 : 5] || '-');
    const metalWeight = cleanNum(colMetalWeight !== -1 ? row[colMetalWeight] : row[is13Col ? 7 : 6]);
    const amount = cleanNum(colAmt !== -1 ? row[colAmt] : row[is13Col ? 8 : 7]);
    const rawStatus = colStatus !== -1 ? row[colStatus] : row[is13Col ? 9 : 8];
    const canonicalStatus = normalizeBillStatus(rawStatus);
    const remarks = colRemarks !== -1 ? String(row[colRemarks] || '') : '';
    const matJsonStr = colMatJson !== -1 ? String(row[colMatJson] || '') : '';
    const updatedStr = colUpdated !== -1 && row[colUpdated] ? (row[colUpdated] instanceof Date ? row[colUpdated].toISOString() : String(row[colUpdated])) : dateStr;

    const billRecord = {
      dateTime: dateStr,
      billNumber: billNumber || billId,
      billId: billNumber || billId,
      billUuid: billId,
      worker: worker,
      customer: customer,
      product: product,
      materials: materials,
      metalWeight: metalWeight,
      amount: amount,
      status: canonicalStatus,
      approvalType: canonicalStatus,
      remarks: remarks,
      updatedAt: updatedStr
    };

    recordMonthlyItemUsage(result.itemUsageMap, canonicalStatus, matJsonStr, materials, product);

    if (canonicalStatus === 'Approved – Normal') {
      result.normalRevenue += amount;
      result.normalWeightKg += metalWeight;
      result.normalBills.push(billRecord);
    } else if (canonicalStatus === 'Approved – Secret') {
      result.secretRevenue += amount;
      result.secretWeightKg += metalWeight;
      result.secretBills.push(billRecord);
    } else if (canonicalStatus === 'Pending') {
      result.pendingBills.push(billRecord);
    } else if (canonicalStatus === 'Rejected') {
      result.rejectedBills.push(billRecord);
    }

    result.bills.push(billRecord);
  }

  result.grossIncome = result.normalRevenue + result.secretRevenue;
  return result;
}

function recordMonthlyItemUsage(itemUsageMap, canonicalStatus, matJsonStr, materials, product) {
  if (canonicalStatus !== 'Approved – Normal' && canonicalStatus !== 'Approved – Secret') return;
  const isSec = canonicalStatus === 'Approved – Secret';
  let parsedItems = [];
  if (matJsonStr) {
    try {
      parsedItems = JSON.parse(matJsonStr);
    } catch (_) {}
  }
  if (!Array.isArray(parsedItems) || parsedItems.length === 0) {
    const parts = String(materials || '').split('|');
    parts.forEach(p => {
      const arrowSplit = p.split('->');
      if (arrowSplit.length === 2) {
        const leftName = arrowSplit[0].replace(/\([^)]*\)/g, '').trim();
        const rightTokens = arrowSplit[1].trim().split(/\s+/);
        const qVal = cleanNum(rightTokens[0]);
        const uVal = (rightTokens[1] || 'KG').toUpperCase();
        if (leftName && qVal > 0) {
          parsedItems.push({
            name: leftName,
            category: 'MATERIAL',
            actual_quantity_consumed: qVal,
            unit: uVal,
            display_quantity: uVal === 'GRAM' ? (qVal / 1000.0) : qVal,
            display_unit: uVal === 'GRAM' ? 'KG' : uVal
          });
        }
      }
    });
  }

  parsedItems.forEach(m => {
    const mName = String(m.name || m.material_name || product || 'Material').trim();
    const mKey = mName.toLowerCase();
    const rawU = String(m.display_unit || m.unit || 'KG').toUpperCase();
    const dispUnit = rawU === 'GRAM' ? 'KG' : rawU;
    const dispQty = m.display_quantity !== undefined
      ? cleanNum(m.display_quantity)
      : (String(m.unit || '').toUpperCase() === 'GRAM' ? cleanNum(m.actual_quantity_consumed) / 1000.0 : cleanNum(m.actual_quantity_consumed));

    if (!itemUsageMap[mKey]) {
      itemUsageMap[mKey] = {
        itemName: mName,
        category: String(m.category || 'OTHER'),
        unit: dispUnit,
        normalUsed: 0,
        secretUsed: 0,
        normalBillCount: 0,
        secretBillCount: 0
      };
    }
    if (isSec) {
      itemUsageMap[mKey].secretUsed = Number((itemUsageMap[mKey].secretUsed + dispQty).toFixed(4));
      itemUsageMap[mKey].secretBillCount += 1;
    } else {
      itemUsageMap[mKey].normalUsed = Number((itemUsageMap[mKey].normalUsed + dispQty).toFixed(4));
      itemUsageMap[mKey].normalBillCount += 1;
    }
  });
}
function getDashboardData(selectedMonth) {
  const ss = getSpreadsheet();
  const presentCalendarMonth = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone() || 'Asia/Kolkata', 'MMMM yyyy');

  ensureMonthlyBillTab(presentCalendarMonth);

  const sheets = ss.getSheets();
  const billSheets = sheets.filter(s => {
    const name = s.getName().trim();
    return name !== 'Scrap_Inventory_Master' && name !== 'Inventory_Master' && !/^Sheet\d+$/i.test(name);
  });

  // 1. Read Permanent Inventory_Master (13 columns)
  const invMaster = getOrCreateInventoryMaster(ss);
  const inventoryEntries = [];
  const itemSummaryMap = {};
  let totalInvestmentInr = 0;

  if (invMaster) {
    const invData = invMaster.getDataRange().getValues();
    for (let i = 1; i < invData.length; i++) {
      const r = invData[i];
      if (!r || r.every(c => c === '' || c === null || c === undefined)) continue;

      const entryId = String(r[0] || ('ROW-' + i));
      const pName = String(r[1] || 'Material').trim();
      const cat = String(r[2] || 'OTHER').trim();
      const unit = String(r[3] || 'KG').trim().toUpperCase();
      const totalStock = cleanNum(r[4]);
      const usedStock = cleanNum(r[5]);
      const remStock = r[6] !== '' && r[6] !== null && r[6] !== undefined ? cleanNum(r[6]) : (totalStock - usedStock);
      const normUsed = cleanNum(r[7]);
      const secUsed = cleanNum(r[8]);
      const invAmt = cleanNum(r[9]);
      const entryDate = r[10] ? (r[10] instanceof Date ? r[10].toISOString() : String(r[10])) : '';
      const notes = String(r[11] || '-');
      const updatedAt = r[12] ? (r[12] instanceof Date ? r[12].toISOString() : String(r[12])) : entryDate;

      totalInvestmentInr += invAmt;

      const entryObj = {
        entryId: entryId,
        productName: pName,
        category: cat,
        unit: unit,
        totalStock: totalStock,
        usedStock: usedStock,
        remainingStock: remStock,
        normalUsedStock: normUsed,
        secretUsedStock: secUsed,
        currentStock: remStock,
        lastQuantityAdded: totalStock,
        totalInvestmentInr: invAmt,
        entryDate: entryDate,
        notes: notes,
        updatedAt: updatedAt
      };
      inventoryEntries.push(entryObj);

      const key = pName.toLowerCase();
      if (!itemSummaryMap[key]) {
        itemSummaryMap[key] = {
          productName: pName,
          category: cat,
          unit: unit,
          totalStock: 0,
          usedStock: 0,
          remainingStock: 0,
          normalUsedStock: 0,
          secretUsedStock: 0,
          currentStock: 0,
          lastQuantityAdded: totalStock,
          totalInvestmentInr: 0,
          entryCount: 0,
          entryDate: entryDate,
          notes: notes,
          updatedAt: updatedAt
        };
      }
      itemSummaryMap[key].totalStock = Number((itemSummaryMap[key].totalStock + totalStock).toFixed(4));
      itemSummaryMap[key].usedStock = Number((itemSummaryMap[key].usedStock + usedStock).toFixed(4));
      itemSummaryMap[key].remainingStock = Number((itemSummaryMap[key].remainingStock + remStock).toFixed(4));
      itemSummaryMap[key].normalUsedStock = Number((itemSummaryMap[key].normalUsedStock + normUsed).toFixed(4));
      itemSummaryMap[key].secretUsedStock = Number((itemSummaryMap[key].secretUsedStock + secUsed).toFixed(4));
      itemSummaryMap[key].currentStock = itemSummaryMap[key].remainingStock;
      itemSummaryMap[key].lastQuantityAdded = totalStock;
      itemSummaryMap[key].totalInvestmentInr = Number((itemSummaryMap[key].totalInvestmentInr + invAmt).toFixed(2));
      itemSummaryMap[key].entryCount += 1;
      itemSummaryMap[key].notes = notes;
      itemSummaryMap[key].updatedAt = updatedAt;
    }
  }

  const inventoryItems = Object.keys(itemSummaryMap).map(k => itemSummaryMap[k]);

  // 2. Parse all monthly bill sheets (`Bills_<Month>_<Year>`) for Month-Wise Analytics & Selector
  const monthlyStatsByMonth = {};
  const monthlyAnalytics = [];
  const monthSet = {};

  billSheets.forEach(s => {
    const sName = s.getName().trim();
    const normM = normalizeMonthYear(sName, ss);
    if (normM) {
      monthSet[normM] = true;
      const parsed = parseBillSheetRows(s);
      monthlyStatsByMonth[normM.toLowerCase()] = {
        monthYear: normM,
        sheetName: sName,
        parsed: parsed
      };
      monthlyAnalytics.push({
        monthYear: normM,
        sheetName: sName,
        normalRevenue: parsed.normalRevenue,
        secretRevenue: parsed.secretRevenue,
        grossIncome: parsed.grossIncome,
        normalCount: parsed.normalBills.length,
        secretCount: parsed.secretBills.length,
        pendingCount: parsed.pendingBills.length,
        rejectedCount: parsed.rejectedBills.length,
        normalWeightKg: parsed.normalWeightKg,
        secretWeightKg: parsed.secretWeightKg
      });
    }
  });

  const combinedMonths = Object.keys(monthSet);
  combinedMonths.sort().reverse();

  let currentMonth = selectedMonth ? normalizeMonthYear(selectedMonth, ss) : '';
  if (!currentMonth) {
    if (combinedMonths.includes(presentCalendarMonth)) {
      currentMonth = presentCalendarMonth;
    } else if (combinedMonths.length > 0) {
      currentMonth = combinedMonths[0];
    } else {
      currentMonth = presentCalendarMonth;
    }
  }

  // 3. Selected month bill data
  const selectedEntry = monthlyStatsByMonth[currentMonth.toLowerCase()];
  const activeParsed = selectedEntry ? selectedEntry.parsed : parseBillSheetRows(null);
  const activeBillTabName = selectedEntry ? selectedEntry.sheetName : toMonthlySheetName(currentMonth, ss);

  // Calculate revenues strictly from Approved – Normal and Approved – Secret bills (Pending/Rejected excluded)
  const normalRev = activeParsed.normalRevenue;
  const secretRev = activeParsed.secretRevenue;
  const grossIncome = normalRev + secretRev;

  // Build Secret Inventory Usage Summary (combines selected month secret bill items + cumulative Inventory_Master secret usage)
  const secretUsageKeys = {};
  const secretInventoryUsage = [];

  Object.keys(activeParsed.itemUsageMap).forEach(k => {
    const u = activeParsed.itemUsageMap[k];
    if (u.secretUsed > 0) {
      const invItem = itemSummaryMap[k];
      secretUsageKeys[k] = true;
      secretInventoryUsage.push({
        itemName: u.itemName,
        category: invItem ? invItem.category : u.category,
        unit: invItem ? invItem.unit : u.unit,
        monthSecretUsed: u.secretUsed,
        totalSecretUsed: invItem && invItem.secretUsedStock > 0 ? invItem.secretUsedStock : u.secretUsed,
        secretBillsCount: u.secretBillCount,
        remainingStock: invItem ? invItem.remainingStock : 0
      });
    }
  });

  inventoryItems.forEach(item => {
    const k = item.productName.toLowerCase();
    if (!secretUsageKeys[k] && item.secretUsedStock > 0) {
      secretInventoryUsage.push({
        itemName: item.productName,
        category: item.category,
        unit: item.unit,
        monthSecretUsed: 0,
        totalSecretUsed: item.secretUsedStock,
        secretBillsCount: 0,
        remainingStock: item.remainingStock
      });
    }
  });

  // Build Inventory Usage Comparison dataset (Normal Used vs Secret Used vs Remaining Inventory)
  const inventoryUsageComparison = inventoryItems.map(item => {
    const k = item.productName.toLowerCase();
    const monthUsage = activeParsed.itemUsageMap[k];
    const normUsed = item.normalUsedStock > 0 ? item.normalUsedStock : (monthUsage ? monthUsage.normalUsed : item.usedStock);
    const secUsed = item.secretUsedStock > 0 ? item.secretUsedStock : (monthUsage ? monthUsage.secretUsed : 0);
    return {
      itemName: item.productName,
      category: item.category,
      unit: item.unit,
      totalStock: item.totalStock,
      normalUsed: normUsed,
      secretUsed: secUsed,
      remainingStock: item.remainingStock
    };
  });

  return {
    monthTabs: combinedMonths.length > 0 ? combinedMonths : [currentMonth || presentCalendarMonth],
    currentMonth: currentMonth || presentCalendarMonth,
    activeBillTab: activeBillTabName,
    inventoryItems: inventoryItems,
    inventoryEntries: inventoryEntries,
    secretInventoryUsage: secretInventoryUsage,
    inventoryUsageComparison: inventoryUsageComparison,
    monthlyAnalytics: monthlyAnalytics,
    totalInvestmentInr: totalInvestmentInr,
    bills: activeParsed.bills,
    normalBills: activeParsed.normalBills,
    secretBills: activeParsed.secretBills,
    pendingBills: activeParsed.pendingBills,
    rejectedBills: activeParsed.rejectedBills,
    normalSummary: {
      count: activeParsed.normalBills.length,
      totalAmount: normalRev,
      totalWeightKg: activeParsed.normalWeightKg
    },
    secretSummary: {
      count: activeParsed.secretBills.length,
      totalAmount: secretRev,
      totalWeightKg: activeParsed.secretWeightKg
    },
    billCounts: {
      total: activeParsed.bills.length,
      normal: activeParsed.normalBills.length,
      secret: activeParsed.secretBills.length,
      pending: activeParsed.pendingBills.length,
      rejected: activeParsed.rejectedBills.length
    },
    revenueSummary: {
      totalInvestment: totalInvestmentInr,
      grossIncome: grossIncome,
      normal: normalRev,
      secret: secretRev,
      combined: grossIncome
    }
  };
}

/**
 * Manual inventory addition from Google Sheets Dashboard
 */
function addManualInventoryEntry(productName, unit, quantity, totalInvestment) {
  const ss = getSpreadsheet();
  const currentMonth = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone() || 'Asia/Kolkata', 'MMMM yyyy');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    return handleAddInventory({
      product_name: productName,
      unit: unit,
      quantity_added: cleanNum(quantity),
      total_investment_inr: cleanNum(totalInvestment),
      notes: 'Manual Entry from Sheets Dashboard'
    }, currentMonth);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Manual scrap entry from dashboard:
 * Appends a new row to Scrap_Inventory_Master
 */
function addManualScrapEntry(itemName, quantity, amount) {
  const ss = getSpreadsheet();
  const currentMonth = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone() || 'Asia/Kolkata', 'MMMM yyyy');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  
  try {
    return handleScrapSale({
      itemName: itemName,
      quantity: cleanNum(quantity),
      amount: cleanNum(amount)
    }, currentMonth);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Diagnostic test runner - execute this directly in Apps Script Editor
 */
function testDashboard() {
  const ss = getSpreadsheet();
  Logger.log('Connected to Sheet: ' + ss.getName() + ' (ID: ' + ss.getId() + ')');
  const data = getDashboardData();
  Logger.log('Dashboard Data output:');
  Logger.log(JSON.stringify(data, null, 2));
  return data;
}
