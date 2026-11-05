-- ============================================================================
-- Manufacturing ERP & Stealth Scrap-Ledger System (v2.0)
-- PostgreSQL Database Schema (Supabase)
-- 
-- KEY DESIGN PRINCIPLE:
-- All primary keys use UUID (gen_random_uuid()) so that hard-deleting bills
-- during secret 'rs45' approvals never creates sequential ID gaps or leaves
-- any forensic trace in the ERP database.
-- ============================================================================

-- Enable pgcrypto for UUID generation if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Drop existing tables/views in reverse dependency order
DROP VIEW IF EXISTS v_inventory_summary CASCADE;
DROP VIEW IF EXISTS v_active_worker_bills CASCADE;
DROP TABLE IF EXISTS bill_items CASCADE;
DROP TABLE IF EXISTS bills CASCADE;
DROP TABLE IF EXISTS inventory_ledger CASCADE;
DROP TABLE IF EXISTS material_variants CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Also clean up legacy tables if present
DROP TABLE IF EXISTS billings CASCADE;
DROP TABLE IF EXISTS inventory CASCADE;

-- ============================================================================
-- 1. USERS TABLE
-- Roles: 'ADMIN' (management & approvals), 'WORKER' (production & billing)
-- ============================================================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) CHECK (role IN ('ADMIN', 'WORKER')) NOT NULL DEFAULT 'WORKER',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 2. PRODUCTS (Product Master)
-- Configures products and their perimeter calculation formula types
-- e.g. Door Frame (2L + B), Window Frame (2(L + B)), Custom
-- ============================================================================
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) UNIQUE NOT NULL,
    frame_formula_type VARCHAR(30) CHECK (frame_formula_type IN ('DOOR_2L_PLUS_B', 'WINDOW_2_L_PLUS_B', 'CUSTOM')) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 3. MATERIAL VARIANTS (Material Master & Configurable BOM Rules)
-- Stores items across categories: COIL, PIPE, HINGES, PAINT, OTHER
-- bom_weight_per_foot_grams: conversion factor from running feet to grams
-- ============================================================================
CREATE TABLE material_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category VARCHAR(20) CHECK (category IN ('COIL', 'PIPE', 'HINGES', 'PAINT', 'OTHER')) NOT NULL,
    name VARCHAR(200) NOT NULL,
    base_unit VARCHAR(20) CHECK (base_unit IN ('GRAM', 'KG', 'FEET', 'PIECE', 'LITRE')) NOT NULL,
    properties JSONB NOT NULL DEFAULT '{}'::jsonb,
    bom_weight_per_foot_grams NUMERIC(12,4) NOT NULL DEFAULT 0,
    unit_cost_inr NUMERIC(12,4) NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_material_variant_name_category UNIQUE (category, name)
);

-- ============================================================================
-- 4. INVENTORY LEDGER (Append-Only Normal Stock Ledger)
-- Present stock is dynamically calculated via SUM(quantity_delta)
-- ============================================================================
CREATE TABLE inventory_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_variant_id UUID NOT NULL REFERENCES material_variants(id) ON DELETE RESTRICT,
    transaction_type VARCHAR(30) CHECK (
        transaction_type IN (
            'PURCHASE_RECEIPT', 
            'PURCHASE_SCRAP', 
            'BILL_CONSUMPTION', 
            'SCRAP_SALE', 
            'ADJUSTMENT', 
            'RETURN'
        )
    ) NOT NULL,
    quantity_delta NUMERIC(14,4) NOT NULL, -- Quantity in variant's base_unit (+ for add, - for consume)
    unit_cost_inr NUMERIC(12,4) NOT NULL DEFAULT 0,
    supplier_name VARCHAR(255),
    invoice_no VARCHAR(100),
    reference_bill_id UUID,
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 5. BILLS & BILL ITEMS (Production Orders)
-- ON DELETE CASCADE on bill_items ensures that during 'rs45' bypass approvals,
-- the bill and all its items are permanently hard-deleted in one atomic step.
-- ============================================================================
CREATE TABLE bills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_number VARCHAR(50) UNIQUE NOT NULL,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    worker_id UUID REFERENCES users(id) ON DELETE SET NULL,
    customer_name VARCHAR(255) NOT NULL,
    production_cost_inr NUMERIC(12,2) NOT NULL DEFAULT 0,
    selling_price_inr NUMERIC(12,2) NOT NULL,
    gst_rate NUMERIC(5,2) NOT NULL DEFAULT 18.00,
    gst_amount_inr NUMERIC(12,2) NOT NULL DEFAULT 0,
    final_total_inr NUMERIC(12,2) NOT NULL DEFAULT 0,
    status VARCHAR(20) CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')) NOT NULL DEFAULT 'PENDING',
    rejection_reason TEXT,
    invoice_details JSONB NOT NULL DEFAULT '{}'::jsonb,
    decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE bill_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    material_variant_id UUID NOT NULL REFERENCES material_variants(id) ON DELETE RESTRICT,
    input_length NUMERIC(10,2),
    input_breadth NUMERIC(10,2),
    calculated_feet NUMERIC(10,2),
    actual_quantity_consumed NUMERIC(14,4) NOT NULL, -- in base_unit (e.g. grams, pieces, litres)
    unit VARCHAR(20) NOT NULL,
    line_cost_inr NUMERIC(12,2) NOT NULL DEFAULT 0,
    item_details JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- ============================================================================
-- 6. INDEXES FOR PERFORMANCE
-- ============================================================================
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_products_active ON products(is_active);
CREATE INDEX idx_material_variants_category ON material_variants(category);
CREATE INDEX idx_inventory_ledger_variant ON inventory_ledger(material_variant_id);
CREATE INDEX idx_inventory_ledger_type ON inventory_ledger(transaction_type);
CREATE INDEX idx_bills_status ON bills(status);
CREATE INDEX idx_bills_worker ON bills(worker_id);
CREATE INDEX idx_bills_created_at ON bills(created_at);
CREATE INDEX idx_bills_decided_at ON bills(decided_at);
CREATE INDEX idx_bill_items_bill_id ON bill_items(bill_id);

-- ============================================================================
-- 7. HELPER VIEWS
-- ============================================================================

-- Real-time stock summary per material variant (tracks Total Stock, Used Stock, Remaining Stock, Normal vs Secret Usage, and Total Investment)
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

-- Worker portal view: bills within strictly 48 hours
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

-- ============================================================================
-- 8. INITIAL SEED DATA
-- Default password for all users: 'password123'
-- Bcrypt hash for 'password123': $2a$10$exDJVSoSBTgp/mTJZzSowu/o4qgQLmMBLJjHMz5xil/Zmozt2Fpnm
-- ============================================================================

-- Admin & Workers
INSERT INTO users (username, password_hash, role) VALUES
('admin', '$2a$10$exDJVSoSBTgp/mTJZzSowu/o4qgQLmMBLJjHMz5xil/Zmozt2Fpnm', 'ADMIN'),
('worker1', '$2a$10$exDJVSoSBTgp/mTJZzSowu/o4qgQLmMBLJjHMz5xil/Zmozt2Fpnm', 'WORKER'),
('worker2', '$2a$10$exDJVSoSBTgp/mTJZzSowu/o4qgQLmMBLJjHMz5xil/Zmozt2Fpnm', 'WORKER');

-- Product Masters
INSERT INTO products (name, frame_formula_type, description) VALUES
('Door Frame', 'DOOR_2L_PLUS_B', 'Standard Door Frame perimeter formula: (2 * L) + B'),
('Window Frame', 'WINDOW_2_L_PLUS_B', 'Standard Window Frame perimeter formula: 2 * (L + B)'),
('Steel Gate', 'CUSTOM', 'Heavy duty sliding or swing gate frame'),
('Sliding Door', 'WINDOW_2_L_PLUS_B', 'Four-sided sliding door perimeter'),
('Window Grill', 'CUSTOM', 'Custom window grill with interior bracing');

-- Material Masters & Configured BOM Rules
INSERT INTO material_variants (category, name, base_unit, properties, bom_weight_per_foot_grams, unit_cost_inr) VALUES
('COIL', 'GI Steel Coil 18 Gauge', 'GRAM', '{"metal_type": "Steel/GI", "thickness": "18 gauge"}'::jsonb, 1000.0000, 0.0750),
('COIL', 'CR Steel Coil 16 Gauge', 'GRAM', '{"metal_type": "Cold Rolled Steel", "thickness": "16 gauge"}'::jsonb, 1250.0000, 0.0820),
('PIPE', 'Steel Square Pipe 1x1 inch', 'GRAM', '{"metal_type": "Mild Steel", "dimensions": "1x1 inch"}'::jsonb, 600.0000, 0.0800),
('PIPE', 'Steel Square Pipe 1.5x1.5 inch', 'GRAM', '{"metal_type": "Mild Steel", "dimensions": "1.5x1.5 inch"}'::jsonb, 900.0000, 0.0850),
('HINGES', 'Steel Butt Hinges 4 inch', 'PIECE', '{"size": "4 inch", "type": "Heavy Steel"}'::jsonb, 0.0000, 35.0000),
('HINGES', 'Stainless Steel Hinges 5 inch', 'PIECE', '{"size": "5 inch", "type": "SS-304"}'::jsonb, 0.0000, 65.0000),
('PAINT', 'Asian Paints Enamel Black', 'LITRE', '{"brand": "Asian Paints", "colour": "Gloss Black", "unit": "LITRE"}'::jsonb, 0.0000, 380.0000),
('PAINT', 'Red Oxide Anti-Rust Primer', 'LITRE', '{"brand": "Berger", "colour": "Red Oxide", "unit": "LITRE"}'::jsonb, 0.0000, 240.0000);

-- Initial Inventory Stock Receipts (using subqueries to resolve IDs)
INSERT INTO inventory_ledger (material_variant_id, transaction_type, quantity_delta, unit_cost_inr, supplier_name, invoice_no, notes)
SELECT id, 'PURCHASE_RECEIPT', 150000.0000, 0.0750, 'Tata Steel Ltd', 'INV-2026-001', 'Initial stock receipt: 150 kg GI Coil'
FROM material_variants WHERE name = 'GI Steel Coil 18 Gauge';

INSERT INTO inventory_ledger (material_variant_id, transaction_type, quantity_delta, unit_cost_inr, supplier_name, invoice_no, notes)
SELECT id, 'PURCHASE_RECEIPT', 80000.0000, 0.0800, 'Jindal Pipes', 'INV-2026-002', 'Initial stock receipt: 80 kg 1x1 Pipe'
FROM material_variants WHERE name = 'Steel Square Pipe 1x1 inch';

INSERT INTO inventory_ledger (material_variant_id, transaction_type, quantity_delta, unit_cost_inr, supplier_name, invoice_no, notes)
SELECT id, 'PURCHASE_RECEIPT', 100.0000, 35.0000, 'Hardware Junction', 'INV-2026-003', 'Initial stock: 100 Hinges'
FROM material_variants WHERE name = 'Steel Butt Hinges 4 inch';

INSERT INTO inventory_ledger (material_variant_id, transaction_type, quantity_delta, unit_cost_inr, supplier_name, invoice_no, notes)
SELECT id, 'PURCHASE_RECEIPT', 20.0000, 380.0000, 'Color World', 'INV-2026-004', 'Initial stock: 20 Litres Black Paint'
FROM material_variants WHERE name = 'Asian Paints Enamel Black';
