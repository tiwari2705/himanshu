import { Pool, QueryResult, QueryResultRow } from 'pg';

const globalForDb = globalThis as unknown as {
  pgPool: Pool | undefined;
};

function createPool(): Pool {
  const rawDatabaseUrl = process.env.DATABASE_URL;
  if (!rawDatabaseUrl) {
    throw new Error('DATABASE_URL not configured');
  }

  // Automatically upgrade Supabase Supavisor Session Mode (:5432, limited to 15 clients)
  // to Transaction Mode (:6543, supports 200+ concurrent serverless clients) unless overridden.
  const databaseUrl =
    rawDatabaseUrl.includes('pooler.supabase.com:5432/') &&
    process.env.DB_FORCE_SESSION_MODE !== 'true'
      ? rawDatabaseUrl.replace('pooler.supabase.com:5432/', 'pooler.supabase.com:6543/')
      : rawDatabaseUrl;

  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

  const newPool = new Pool({
    connectionString: databaseUrl,
    max: isServerless ? 2 : 5,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 30000,
    allowExitOnIdle: true,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  newPool.on('error', (err) => {
    console.warn('Database pool idle client notice:', err.message);
  });

  return newPool;
}

export function getPool(): Pool {
  if (!globalForDb.pgPool) {
    globalForDb.pgPool = createPool();
  }
  return globalForDb.pgPool;
}

export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  let lastError: any;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return await getPool().query<T>(text, params);
    } catch (err: any) {
      lastError = err;
      const msg = String(err?.message || '').toLowerCase();
      const isTransient =
        msg.includes('emaxconnsession') ||
        msg.includes('max clients reached') ||
        msg.includes('timeout') ||
        msg.includes('terminated') ||
        msg.includes('econnreset') ||
        msg.includes('connection') ||
        msg.includes('closed');

      if (isTransient && attempt < 4) {
        console.warn(`DB query transient notice (attempt ${attempt}/4), retrying...`);
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
        if (!msg.includes('emaxconnsession') && !msg.includes('max clients reached')) {
          try {
            await globalForDb.pgPool?.end();
          } catch (_) {}
          globalForDb.pgPool = createPool();
        }
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}


// ============================================================================
// TypeScript Models for Manufacturing ERP v2.0
// All primary keys use UUID strings (gen_random_uuid())
// ============================================================================

export type UserRole = 'ADMIN' | 'WORKER';

export interface User {
  id: string; // UUID
  username: string;
  password_hash: string;
  role: UserRole;
  is_active: boolean;
  created_at: Date;
}

export type FrameFormulaType = 'DOOR_2L_PLUS_B' | 'WINDOW_2_L_PLUS_B' | 'CUSTOM';

export interface Product {
  id: string; // UUID
  name: string;
  frame_formula_type: FrameFormulaType;
  description: string | null;
  is_active: boolean;
  created_at: Date;
}

export type MaterialCategory = 'COIL' | 'PIPE' | 'HINGES' | 'PAINT' | 'OTHER';
export type BaseUnit = 'GRAM' | 'KG' | 'FEET' | 'PIECE' | 'LITRE';

export interface MaterialVariant {
  id: string; // UUID
  category: MaterialCategory;
  name: string;
  base_unit: BaseUnit;
  properties: Record<string, any>;
  bom_weight_per_foot_grams: number;
  unit_cost_inr: number;
  is_active: boolean;
  created_at: Date;
}

export type InventoryTransactionType =
  | 'PURCHASE_RECEIPT'
  | 'PURCHASE_SCRAP'
  | 'BILL_CONSUMPTION'
  | 'SCRAP_SALE'
  | 'ADJUSTMENT'
  | 'RETURN';

export interface InventoryLedgerEntry {
  id: string; // UUID
  material_variant_id: string;
  transaction_type: InventoryTransactionType;
  quantity_delta: number;
  unit_cost_inr: number;
  supplier_name: string | null;
  invoice_no: string | null;
  reference_bill_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: Date;
}

export type BillStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Bill {
  id: string; // UUID
  bill_number: string;
  product_id: string;
  worker_id: string;
  customer_name: string;
  production_cost_inr: number;
  selling_price_inr: number;
  gst_rate: number;
  gst_amount_inr: number;
  final_total_inr: number;
  status: BillStatus;
  rejection_reason: string | null;
  decided_by: string | null;
  decided_at: Date | null;
  created_at: Date;
}

export interface BillItem {
  id: string; // UUID
  bill_id: string;
  material_variant_id: string;
  input_length: number | null;
  input_breadth: number | null;
  calculated_feet: number | null;
  actual_quantity_consumed: number;
  unit: string;
  line_cost_inr: number;
}

export interface InventorySummaryView {
  material_variant_id: string;
  material_name: string;
  category: MaterialCategory;
  base_unit: BaseUnit;
  properties: Record<string, any>;
  bom_weight_per_foot_grams: number;
  unit_cost_inr: number;
  current_stock: number;
  current_stock_display: number;
  display_unit: string;
  stock_valuation_inr: number;
  total_investment_inr: number;
  is_active: boolean;
}
