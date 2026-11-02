import { Pool, QueryResult, QueryResultRow } from 'pg';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const databaseUrl = process.env.DATABASE_URL;

    if (databaseUrl) {
      pool = new Pool({
        connectionString: databaseUrl,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        ssl: {
          rejectUnauthorized: false,
        },
      });
    } else {
      throw new Error('DATABASE_URL not configured');
    }

    pool.on('error', (err) => {
      console.error('Unexpected database pool error:', err);
    });
  }
  return pool;
}

export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const client = await getPool().connect();
  try {
    return await client.query<T>(text, params);
  } finally {
    client.release();
  }
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
