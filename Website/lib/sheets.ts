/**
 * Stealth Google Sheets Integration Client
 * Routes production and billing events to the standalone Google Sheets Dual-Ledger
 * via Google Apps Script Webhook (Method A)
 */

const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL || '';
const GAS_WEBHOOK_SECRET = process.env.GAS_WEBHOOK_SECRET || 'ims_webhook_secret_2024';

export interface WebhookBillPayload {
  billId: string;
  bill_number?: string;
  worker_username: string;
  customer_name: string;
  product_name: string;
  materials_summary: any;
  total_metal_weight_kg: number;
  final_total_inr: number;
  rejection_reason?: string;
  inventory_snapshot?: InventorySnapshotItem[];
}

export interface InventorySnapshotItem {
  product_name: string;
  category: string;
  unit: string;
  current_stock: number;
  total_investment_inr: number;
  stock_valuation_inr: number;
}

export interface WebhookInventoryPayload {
  product_name: string;
  category: string;
  unit: string;
  quantity_added: number;
  total_investment_inr: number;
  current_stock: number;
  notes?: string;
  scrap_weight_kg?: number;
  inventory_snapshot?: InventorySnapshotItem[];
}

/**
 * Call the Google Apps Script Webhook (Method A)
 */
export async function callWebhook(action: string, data: any): Promise<any> {
  if (!GAS_WEBHOOK_URL || GAS_WEBHOOK_URL === 'your-web-app-url-here') {
    throw new Error('GAS_WEBHOOK_URL is not configured in .env');
  }

  const response = await fetch(GAS_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      secret: GAS_WEBHOOK_SECRET,
      action,
      data,
    }),
    redirect: 'follow',
  });

  const text = await response.text();

  if (
    text.includes('accounts.google.com') ||
    text.includes('Sign in - Google Accounts') ||
    text.includes('ServiceLogin') ||
    text.includes('Page not found')
  ) {
    throw new Error(
      'Google Apps Script blocked the webhook request because "Who has access" is not set to "Anyone". Please open Apps Script -> Deploy -> Manage deployments -> Edit -> change "Who has access" to "Anyone" -> Deploy.'
    );
  }

  let result: any;
  try {
    result = JSON.parse(text);
  } catch (parseError) {
    throw new Error(
      `Google Apps Script did not return JSON. Response preview: ${text.slice(0, 150)}...`
    );
  }

  return result;
}

/**
 * Normal Bill Approval Sync
 */
export async function approveNormalBill(
  data: WebhookBillPayload
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await callWebhook('APPROVE_NORMAL_BILL', {
      bill_number: data.bill_number || data.billId,
      worker_username: data.worker_username,
      customer_name: data.customer_name,
      product_name: data.product_name,
      materials_summary: data.materials_summary,
      total_metal_weight_kg: data.total_metal_weight_kg,
      final_total_inr: data.final_total_inr,
      inventory_snapshot: data.inventory_snapshot,
    });

    if (result.error) {
      return { success: false, error: result.error };
    }
    return { success: true };
  } catch (err: any) {
    console.error('Webhook normal approval failed:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Secret Bypass Bill Approval Sync (rs45 / Secret Key)
 * Updates the stealth Google Sheet and signals whether it is safe to hard-delete from PostgreSQL
 */
export async function approveSecretBill(
  data: WebhookBillPayload
): Promise<{ success: boolean; error?: string; available?: number }> {
  try {
    const result = await callWebhook('APPROVE_SECRET_BILL', {
      bill_number: data.bill_number || data.billId,
      worker_username: data.worker_username,
      customer_name: data.customer_name,
      product_name: data.product_name,
      materials_summary: data.materials_summary,
      total_metal_weight_kg: data.total_metal_weight_kg,
      final_total_inr: data.final_total_inr,
      inventory_snapshot: data.inventory_snapshot,
    });

    if (result.error) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      available: result.available,
    };
  } catch (err: any) {
    console.error('Webhook rs45 secret approval failed:', err.message);
    return {
      success: false,
      error: err.message || 'Stealth ledger webhook connection failed',
    };
  }
}

/**
 * Inventory & Total Investment Addition Sync
 */
export async function syncInventoryAddition(
  data: WebhookInventoryPayload
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await callWebhook('ADD_INVENTORY', {
      product_name: data.product_name,
      category: data.category,
      unit: data.unit,
      quantity_added: data.quantity_added,
      total_investment_inr: data.total_investment_inr,
      current_stock: data.current_stock,
      notes: data.notes,
      scrap_weight_kg: data.scrap_weight_kg || 0,
      inventory_snapshot: data.inventory_snapshot,
    });

    if (result.error) {
      return { success: false, error: result.error };
    }
    return { success: true };
  } catch (err: any) {
    console.error('Webhook inventory addition sync failed:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Bill Rejection Sync
 */
export async function rejectBillSync(
  data: WebhookBillPayload
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await callWebhook('REJECT_BILL', {
      bill_number: data.bill_number || data.billId,
      worker_username: data.worker_username,
      customer_name: data.customer_name,
      product_name: data.product_name,
      materials_summary: data.materials_summary,
      total_metal_weight_kg: data.total_metal_weight_kg,
      final_total_inr: data.final_total_inr,
      rejection_reason: data.rejection_reason,
    });

    if (result.error) {
      return { success: false, error: result.error };
    }
    return { success: true };
  } catch (err: any) {
    console.error('Webhook bill rejection sync failed:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Scrap Sale Logging Sync
 */
export async function recordScrapSale(data: {
  itemName: string;
  quantity: number;
  amount: number;
}): Promise<{ success: boolean; error?: string; available?: number }> {
  try {
    const result = await callWebhook('RECORD_SCRAP_SALE', {
      itemName: data.itemName,
      quantity: data.quantity,
      amount: data.amount,
    });

    if (result.error) {
      return { success: false, error: result.error };
    }
    return { success: true, available: result.available };
  } catch (err: any) {
    console.error('Webhook scrap sale sync failed:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Defective Purchase Scrap Sync (e.g. 500g scrap from 20kg raw coil purchase)
 */
export async function recordPurchaseScrap(data: {
  scrapWeightKg: number;
  supplierName?: string;
  invoiceNo?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await callWebhook('RECORD_PURCHASE_SCRAP', {
      scrapWeightKg: data.scrapWeightKg,
      supplierName: data.supplierName,
      invoiceNo: data.invoiceNo,
    });

    if (result.error) {
      return { success: false, error: result.error };
    }
    return { success: true };
  } catch (err: any) {
    console.error('Webhook purchase scrap sync failed:', err.message);
    return { success: false, error: err.message };
  }
}
