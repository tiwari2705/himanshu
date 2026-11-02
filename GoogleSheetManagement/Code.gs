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
 * Normalizes month/year strings without timezone rollbacks.
 */
function normalizeMonthYear(val, ss) {
  if (!val) return '';
  if (val instanceof Date) {
    const tz = (ss && ss.getSpreadsheetTimeZone()) || Session.getScriptTimeZone() || 'Asia/Kolkata';
    return Utilities.formatDate(val, tz, 'MMMM yyyy');
  }
  const str = String(val).trim();
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
    return str;
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
 * Get or create Inventory_Master tab to track Inventory Additions, Stock Levels (kg, ft, pcs, etc.), and Total Investment.
 */
function getOrCreateInventoryMaster(ss) {
  ss = ss || getSpreadsheet();
  let invMaster = ss.getSheetByName('Inventory_Master');
  if (!invMaster) {
    invMaster = ss.insertSheet('Inventory_Master');
    invMaster.getRange('A1:H1').setValues([[
      'Product_Name',
      'Category',
      'Measurement_Unit',
      'Last_Quantity_Added',
      'Current_Stock',
      'Total_Investment_INR',
      'Notes',
      'Updated_At'
    ]]);

    invMaster.getRange('A1:H1')
      .setBackground('#0f172a')
      .setFontColor('#f8fafc')
      .setFontWeight('bold');
  }
  return invMaster;
}

/**
 * Syncs full inventory snapshot from ERP DB into Inventory_Master
 */
function syncInventorySnapshotToSheet(ss, snapshot, latestAddition) {
  if (!snapshot || !Array.isArray(snapshot) || snapshot.length === 0) return;
  const invMaster = getOrCreateInventoryMaster(ss);
  const existingData = invMaster.getDataRange().getValues();
  const existingMap = {};

  for (let i = 1; i < existingData.length; i++) {
    const pName = String(existingData[i][0] || '').trim().toLowerCase();
    if (pName) {
      existingMap[pName] = {
        lastQtyAdded: cleanNum(existingData[i][3]),
        notes: String(existingData[i][6] || '')
      };
    }
  }

  const nowIso = new Date().toISOString();
  const rows = snapshot.map(item => {
    const key = String(item.product_name || '').trim().toLowerCase();
    const isAddedTarget = latestAddition && String(latestAddition.product_name || '').trim().toLowerCase() === key;
    const prevInfo = existingMap[key] || { lastQtyAdded: 0, notes: '' };

    return [
      String(item.product_name || 'Material'),
      String(item.category || 'OTHER'),
      String(item.unit || 'KG'),
      isAddedTarget ? cleanNum(latestAddition.quantity_added) : prevInfo.lastQtyAdded,
      cleanNum(item.current_stock),
      cleanNum(item.total_investment_inr || item.stock_valuation_inr),
      isAddedTarget && latestAddition.notes ? String(latestAddition.notes) : (prevInfo.notes || 'Synced with ERP DB'),
      nowIso
    ];
  });

  if (existingData.length > 1) {
    invMaster.getRange(2, 1, existingData.length - 1, 8).clearContent();
  }
  if (rows.length > 0) {
    invMaster.getRange(2, 1, rows.length, 8).setValues(rows);
  }
}

/**
 * Ensure monthly bills tab exists with 9 structured columns:
 * Date_Time, Bill_ID, Worker_Username, Customer_Name, Product_Name,
 * Materials_Used_Summary, Total_Metal_Weight_KG, Total_Amount_INR, Approval_Type
 */
function ensureMonthlyBillTab(monthYear) {
  const ss = getSpreadsheet();
  let billTab = ss.getSheetByName(monthYear);
  
  if (!billTab) {
    billTab = ss.insertSheet(monthYear);
    billTab.getRange('A1:I1').setValues([[
      'Date_Time',
      'Bill_ID',
      'Worker_Username',
      'Customer_Name',
      'Product_Name',
      'Materials_Used_Summary',
      'Total_Metal_Weight_KG',
      'Total_Amount_INR',
      'Approval_Type'
    ]]);
    
    billTab.getRange('A1:I1')
      .setBackground('#0f172a')
      .setFontColor('#f8fafc')
      .setFontWeight('bold');
  }
  
  return billTab;
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

      case 'APPROVE_NORMAL_BILL':
        return handleNormalBillApproval(payload.data, currentMonth);
        
      case 'APPROVE_SECRET_BILL': // rs45 bypass path
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
 * - Updates Inventory_Master with Product Name, Measurement Unit, Quantity, Current Stock, and Total Investment
 */
function handleAddInventory(data, currentMonth) {
  const ss = getSpreadsheet();
  const invMaster = getOrCreateInventoryMaster(ss);

  if (data.inventory_snapshot && Array.isArray(data.inventory_snapshot) && data.inventory_snapshot.length > 0) {
    syncInventorySnapshotToSheet(ss, data.inventory_snapshot, data);
  } else {
    const productName = String(data.product_name || data.productName || 'Inventory Item').trim();
    const category = String(data.category || 'OTHER').trim();
    const unit = String(data.unit || data.measurement_unit || 'KG').toUpperCase();
    const qtyAdded = cleanNum(data.quantity_added || data.quantity || 0);
    const investmentAdded = cleanNum(data.total_investment_inr || data.totalInvestment || 0);
    const notes = String(data.notes || 'Added via Admin Portal');
    const nowIso = new Date().toISOString();

    const raw = invMaster.getDataRange().getValues();
    let foundRowIndex = -1;
    for (let i = 1; i < raw.length; i++) {
      if (String(raw[i][0] || '').trim().toLowerCase() === productName.toLowerCase()) {
        foundRowIndex = i + 1;
        break;
      }
    }

    if (foundRowIndex !== -1) {
      const existingRow = raw[foundRowIndex - 1];
      const newStock = data.current_stock !== undefined ? cleanNum(data.current_stock) : (cleanNum(existingRow[4]) + qtyAdded);
      const newInv = cleanNum(existingRow[5]) + investmentAdded;
      invMaster.getRange(foundRowIndex, 1, 1, 8).setValues([[
        productName,
        category,
        unit,
        qtyAdded,
        newStock,
        newInv,
        notes,
        nowIso
      ]]);
    } else {
      invMaster.appendRow([
        productName,
        category,
        unit,
        qtyAdded,
        data.current_stock !== undefined ? cleanNum(data.current_stock) : qtyAdded,
        investmentAdded,
        notes,
        nowIso
      ]);
    }
  }

  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    action: 'ADD_INVENTORY'
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 1. NORMAL BILL APPROVAL:
 * - Appends bill row into monthly tab (e.g. "November 2026") as 'NORMAL'
 * - Appends new cumulative row into Scrap_Inventory_Master updating Normal_Bills_Revenue_INR
 */
function handleNormalBillApproval(data, currentMonth) {
  const ss = getSpreadsheet();
  const scrapMaster = getOrCreateScrapMaster(ss);
  
  const prev = getLastScrapMetrics(scrapMaster);
  const amt = cleanNum(data.amount || data.final_total_inr || 0);
  const metalWeightKg = cleanNum(data.total_metal_weight_kg || data.metalWeightKg || 0);
  
  const newNormal = prev.normalRevenue + amt;
  const newNetScrap = prev.scrapOffset + prev.secretRevenue;
  
  const newRow = [
    currentMonth,
    prev.available,
    0,
    prev.total,
    prev.used,
    prev.available,
    prev.scrapOffset,
    prev.secretRevenue,
    newNetScrap,
    newNormal,
    new Date().toISOString()
  ];
  scrapMaster.appendRow(newRow);
  
  const billTab = ensureMonthlyBillTab(currentMonth);
  billTab.appendRow([
    new Date().toISOString(),
    String(data.bill_number || data.billId || 'BILL-NORM'),
    String(data.worker_username || data.worker || 'worker'),
    String(data.customer_name || data.customer || 'Customer'),
    String(data.product_name || data.product || 'Product Frame'),
    formatMaterialsSummary(data.materials_summary || data.materials),
    metalWeightKg,
    amt,
    'NORMAL'
  ]);
  
  if (data.inventory_snapshot && Array.isArray(data.inventory_snapshot)) {
    syncInventorySnapshotToSheet(ss, data.inventory_snapshot, null);
  }

  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    approvalType: 'NORMAL'
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 2. SECRET SCRAP BYPASS (rs45):
 * - Deducts consumed metal weight from Available_Weight_KG (allows negative overdrafts!)
 * - Adds bill total to Secret_Bills_Revenue_INR & recalculates Net_Scrap_Revenue_INR
 * - Appends bill row into monthly tab as 'Made with Scrap (rs45)'
 * - Appends new cumulative row in Scrap_Inventory_Master
 */
function handleSecretBillApproval(data, currentMonth) {
  const ss = getSpreadsheet();
  const scrapMaster = getOrCreateScrapMaster(ss);
  
  const prev = getLastScrapMetrics(scrapMaster);
  
  const metalWeightKg = cleanNum(data.total_metal_weight_kg || data.metalWeightKg || 0);
  const amt = cleanNum(data.amount || data.final_total_inr || 0);
  
  const newCarryover = prev.available;
  const newScrapAdded = 0;
  const newTotal = prev.total;
  const newUsed = prev.used + metalWeightKg;
  const newAvailable = newTotal - newUsed; // Can go negative: e.g. -2.00 kg
  const newOffset = prev.scrapOffset;
  const newSecret = prev.secretRevenue + amt;
  const newNetScrap = newOffset + newSecret;
  const newNormal = prev.normalRevenue;
  
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
  
  const billTab = ensureMonthlyBillTab(currentMonth);
  billTab.appendRow([
    new Date().toISOString(),
    String(data.bill_number || data.billId || 'BILL-RS45'),
    String(data.worker_username || data.worker || 'worker'),
    String(data.customer_name || data.customer || 'Customer'),
    String(data.product_name || data.product || 'Product Frame'),
    formatMaterialsSummary(data.materials_summary || data.materials),
    metalWeightKg,
    amt,
    'SECRET (rs45)'
  ]);

  if (data.inventory_snapshot && Array.isArray(data.inventory_snapshot)) {
    syncInventorySnapshotToSheet(ss, data.inventory_snapshot, null);
  }
  
  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    available: newAvailable,
    approvalType: 'SECRET_KEY_RS45'
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 3. REJECTION PATH:
 * - Appends bill row into monthly tab as 'REJECTED' with ₹0 revenue impact
 */
function handleRejectBill(data, currentMonth) {
  const ss = getSpreadsheet();
  const billTab = ensureMonthlyBillTab(currentMonth);
  
  const metalWeightKg = cleanNum(data.total_metal_weight_kg || data.metalWeightKg || 0);
  const amt = cleanNum(data.amount || data.final_total_inr || 0);
  
  billTab.appendRow([
    new Date().toISOString(),
    String(data.bill_number || data.billId || 'BILL-REJ'),
    String(data.worker_username || data.worker || 'worker'),
    String(data.customer_name || data.customer || 'Customer'),
    String(data.product_name || data.product || 'Product Frame'),
    formatMaterialsSummary(data.materials_summary || data.materials) + 
      (data.rejection_reason ? ' [Reason: ' + data.rejection_reason + ']' : ''),
    metalWeightKg,
    amt,
    'REJECTED'
  ]);
  
  return ContentService.createTextOutput(JSON.stringify({
    success: true,
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
 * Get complete master dashboard data for selected month
 */
function getDashboardData(selectedMonth) {
  const ss = getSpreadsheet();
  
  // 1. Gather all month tabs, excluding Scrap_Inventory_Master, Inventory_Master, and default Sheet1/2/3
  const sheets = ss.getSheets();
  const sheetNames = sheets
    .map(s => s.getName().trim())
    .filter(name => name !== 'Scrap_Inventory_Master' && name !== 'Inventory_Master' && !/^Sheet\d+$/i.test(name));

  // 1b. Read Inventory_Master (Stock levels & Total Investment)
  const invMaster = getOrCreateInventoryMaster(ss);
  let inventoryItems = [];
  let totalInvestmentInr = 0;

  if (invMaster) {
    const invData = invMaster.getDataRange().getValues();
    for (let i = 1; i < invData.length; i++) {
      const r = invData[i];
      if (!r || r.every(c => c === '' || c === null || c === undefined)) continue;
      const invAmt = cleanNum(r[5]);
      totalInvestmentInr += invAmt;
      inventoryItems.push({
        productName: String(r[0] || 'Material'),
        category: String(r[1] || 'OTHER'),
        unit: String(r[2] || 'KG'),
        lastQuantityAdded: cleanNum(r[3]),
        currentStock: cleanNum(r[4]),
        totalInvestmentInr: invAmt,
        notes: String(r[6] || '-'),
        updatedAt: r[7] ? (r[7] instanceof Date ? r[7].toISOString() : String(r[7])) : ''
      });
    }
  }

  // 2. Read Scrap_Inventory_Master
  const scrapMaster = getOrCreateScrapMaster(ss);
  let allMasterRows = [];
  let masterMonthNames = [];

  if (scrapMaster) {
    const rawData = scrapMaster.getDataRange().getValues();
    if (rawData.length > 1) {
      const headers = rawData[0].map(h => String(h || '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
      
      const colMonth = headers.findIndex(h => h.includes('month'));
      const colCarryover = headers.findIndex(h => h.includes('carryover'));
      const colNewScrap = headers.findIndex(h => h.includes('newscrap'));
      const colTotal = headers.findIndex(h => h.includes('totalweight') || h === 'total');
      const colUsed = headers.findIndex(h => h.includes('usedweight') || h === 'used');
      const colAvailable = headers.findIndex(h => h.includes('availableweight') || h === 'available');
      const colOffset = headers.findIndex(h => h.includes('offset') || h.includes('scrapsale'));
      const colSecret = headers.findIndex(h => h.includes('secret'));
      const colNetScrap = headers.findIndex(h => h.includes('netscrap'));
      const colNormal = headers.findIndex(h => h.includes('normal'));
      const colUpdated = headers.findIndex(h => h.includes('updated'));

      for (let i = 1; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row || row.every(c => c === '' || c === null || c === undefined)) continue;

        const rawMonth = (colMonth !== -1 ? row[colMonth] : row[0]);
        const mStr = normalizeMonthYear(rawMonth, ss) || ('Row ' + (i + 1));
        
        masterMonthNames.push(mStr);
        allMasterRows.push({
          monthYear: mStr,
          carryover: cleanNum(colCarryover !== -1 ? row[colCarryover] : row[1]),
          newScrap: cleanNum(colNewScrap !== -1 ? row[colNewScrap] : row[2]),
          total: cleanNum(colTotal !== -1 ? row[colTotal] : row[3]),
          used: cleanNum(colUsed !== -1 ? row[colUsed] : row[4]),
          available: cleanNum(colAvailable !== -1 ? row[colAvailable] : row[5]),
          scrapOffset: cleanNum(colOffset !== -1 ? row[colOffset] : row[6]),
          secretRevenue: cleanNum(colSecret !== -1 ? row[colSecret] : row[7]),
          netScrapRevenue: cleanNum(colNetScrap !== -1 ? row[colNetScrap] : row[8]),
          normalRevenue: cleanNum(colNormal !== -1 ? row[colNormal] : row[9]),
          updatedAt: (colUpdated !== -1 ? row[colUpdated] : row[10]) ? 
            (row[colUpdated !== -1 ? colUpdated : 10] instanceof Date ? 
              row[colUpdated !== -1 ? colUpdated : 10].toISOString() : 
              String(row[colUpdated !== -1 ? colUpdated : 10])) : ''
        });
      }
    }
  }

  // Combine unique month names from both sheet tabs and Scrap_Inventory_Master
  const monthSet = {};
  sheetNames.forEach(m => { if (m) monthSet[m] = true; });
  masterMonthNames.forEach(m => { if (m) monthSet[m] = true; });
  const combinedMonths = Object.keys(monthSet);
  combinedMonths.sort().reverse();

  // Determine current/selected month
  let currentMonth = selectedMonth ? normalizeMonthYear(selectedMonth, ss) : '';
  const presentCalendarMonth = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone() || 'Asia/Kolkata', 'MMMM yyyy');

  if (!currentMonth) {
    if (combinedMonths.includes(presentCalendarMonth)) {
      currentMonth = presentCalendarMonth;
    } else if (combinedMonths.length > 0) {
      currentMonth = combinedMonths[0];
    } else {
      currentMonth = presentCalendarMonth;
    }
  }

  // Find latest scrapMetrics row for current month
  const matchingRows = allMasterRows.filter(
    r => r.monthYear.toLowerCase() === currentMonth.toLowerCase()
  );
  let scrapMetrics = matchingRows.length > 0 ? matchingRows[matchingRows.length - 1] : null;

  if (!scrapMetrics) {
    if (allMasterRows.length > 0) {
      scrapMetrics = allMasterRows[allMasterRows.length - 1];
    } else {
      scrapMetrics = {
        monthYear: currentMonth || presentCalendarMonth,
        carryover: 0,
        newScrap: 0,
        total: 0,
        used: 0,
        available: 0,
        scrapOffset: 0,
        secretRevenue: 0,
        netScrapRevenue: 0,
        normalRevenue: 0,
        updatedAt: ''
      };
    }
  }

  // 3. Find the sheet for bills
  let billTab = null;
  if (currentMonth) {
    billTab = ss.getSheetByName(currentMonth);
    if (!billTab) {
      billTab = sheets.find(s => {
        const sName = s.getName().trim();
        return sName.toLowerCase() === currentMonth.toLowerCase() ||
               normalizeMonthYear(sName, ss).toLowerCase() === currentMonth.toLowerCase();
      });
    }
  }

  if (!billTab) {
    const candidateSheets = sheets.filter(s => s.getName().trim() !== 'Scrap_Inventory_Master' && s.getName().trim() !== 'Inventory_Master');
    for (let s of candidateSheets) {
      const data = s.getDataRange().getValues();
      if (data.length > 0) {
        const topRow = data[0].map(c => String(c).toLowerCase());
        if (topRow.some(c => c.includes('bill') || c.includes('worker') || c.includes('customer') || c.includes('approval'))) {
          billTab = s;
          break;
        }
      }
    }
    if (!billTab && candidateSheets.length === 1) {
      billTab = candidateSheets[0];
    }
  }

  let bills = [];
  let normalBills = [];
  let secretBills = [];
  let normalCount = 0;
  let secretCount = 0;
  let rejectedCount = 0;
  let normalTotalWeightKg = 0;
  let secretTotalWeightKg = 0;
  let normalBillsAmount = 0;
  let secretBillsAmount = 0;

  if (billTab) {
    const billData = billTab.getDataRange().getValues();
    if (billData.length > 1) {
      const bHeaders = billData[0].map(h => String(h || '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
      
      const colDate = bHeaders.findIndex(h => h.includes('date') || h.includes('time'));
      const colId = bHeaders.findIndex(h => h.includes('billid') || h === 'id' || h.includes('bill'));
      const colWorker = bHeaders.findIndex(h => h.includes('worker'));
      const colCustomer = bHeaders.findIndex(h => h.includes('customer'));
      const colProduct = bHeaders.findIndex(h => h.includes('product'));
      const colMaterials = bHeaders.findIndex(h => h.includes('material') || h.includes('summary'));
      const colMetalWeight = bHeaders.findIndex(h => h.includes('metal') || h.includes('weight') || h.includes('kg'));
      const colAmt = bHeaders.findIndex(h => h.includes('amount') || h.includes('total') || h.includes('inr'));
      const colType = bHeaders.findIndex(h => h.includes('approval') || h.includes('type') || h.includes('status'));

      for (let i = 1; i < billData.length; i++) {
        const row = billData[i];
        if (!row || row.every(c => c === '' || c === null || c === undefined)) continue;

        const rawDate = colDate !== -1 ? row[colDate] : row[0];
        const dateStr = rawDate ? (rawDate instanceof Date ? rawDate.toISOString() : String(rawDate)) : '';
        const billId = colId !== -1 ? String(row[colId] || '') : String(row[1] || '');
        const worker = colWorker !== -1 ? String(row[colWorker] || '') : (row[2] ? String(row[2]) : 'worker');
        const customer = colCustomer !== -1 ? String(row[colCustomer] || '') : (row[3] ? String(row[3]) : 'Customer');
        const product = colProduct !== -1 ? String(row[colProduct] || '') : (row[4] ? String(row[4]) : 'Frame');
        const materials = colMaterials !== -1 ? String(row[colMaterials] || '') : (row[5] ? String(row[5]) : '-');
        const metalWeight = cleanNum(colMetalWeight !== -1 ? row[colMetalWeight] : row[6]);
        const amount = cleanNum(colAmt !== -1 ? row[colAmt] : row[7]);
        const approvalType = colType !== -1 ? String(row[colType] || 'NORMAL') : String(row[8] || 'NORMAL');

        const billRecord = {
          dateTime: dateStr,
          billId: billId,
          worker: worker,
          customer: customer,
          product: product,
          materials: materials,
          metalWeight: metalWeight,
          amount: amount,
          approvalType: approvalType
        };

        const upperType = approvalType.toUpperCase();
        if (upperType === 'NORMAL') {
          normalCount++;
          normalTotalWeightKg += metalWeight;
          normalBillsAmount += amount;
          normalBills.push(billRecord);
        } else if (upperType.includes('SECRET') || approvalType.includes('rs45') || approvalType.includes('Scrap')) {
          secretCount++;
          secretTotalWeightKg += metalWeight;
          secretBillsAmount += amount;
          secretBills.push(billRecord);
        } else if (upperType === 'REJECTED') {
          rejectedCount++;
        }

        bills.push(billRecord);
      }
    }
  }

  const normalRev = cleanNum(scrapMetrics.normalRevenue) || normalBillsAmount;
  const secretRev = cleanNum(scrapMetrics.secretRevenue) || secretBillsAmount;
  const netScrapRev = cleanNum(scrapMetrics.netScrapRevenue);
  const combinedRev = normalRev + secretRev;

  return {
    monthTabs: combinedMonths.length > 0 ? combinedMonths : [currentMonth || presentCalendarMonth],
    currentMonth: currentMonth || (scrapMetrics ? scrapMetrics.monthYear : presentCalendarMonth),
    scrapMetrics: scrapMetrics,
    inventoryItems: inventoryItems,
    totalInvestmentInr: totalInvestmentInr,
    bills: bills,
    normalBills: normalBills,
    secretBills: secretBills,
    normalSummary: {
      count: normalCount,
      totalAmount: normalBillsAmount || normalRev,
      totalWeightKg: normalTotalWeightKg
    },
    secretSummary: {
      count: secretCount,
      totalAmount: secretBillsAmount || secretRev,
      totalWeightKg: secretTotalWeightKg
    },
    allMasterRows: allMasterRows,
    activeBillTab: billTab ? billTab.getName() : '',
    billCounts: {
      total: bills.length,
      normal: normalCount,
      secret: secretCount,
      rejected: rejectedCount
    },
    revenueSummary: {
      normal: normalRev,
      secret: secretRev,
      netScrap: netScrapRev,
      combined: combinedRev,
      totalInvestment: totalInvestmentInr
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
