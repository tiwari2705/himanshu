import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('ims_session')?.value;
    const payload = verifyToken(token || '');

    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 });
    }

    // 1. Total Inventory Valuation, Total Investment & Stock
    const invSummary = await query(
      `SELECT 
        COALESCE(SUM(stock_valuation_inr), 0) AS total_valuation,
        COALESCE(SUM(total_investment_inr), 0) AS total_investment,
        COALESCE(SUM(CASE WHEN base_unit = 'GRAM' THEN current_stock / 1000.0 WHEN base_unit = 'KG' THEN current_stock ELSE 0 END), 0) AS total_metal_kg,
        COUNT(CASE WHEN (base_unit = 'GRAM' AND current_stock <= 1000) OR (base_unit != 'GRAM' AND current_stock <= 5) THEN 1 END) AS low_stock_count
       FROM v_inventory_summary WHERE is_active = TRUE`
    );

    // 2. Official Revenue (Only from APPROVED bills in ERP DB)
    const revRes = await query(
      `SELECT 
        COALESCE(SUM(selling_price_inr), 0) AS official_sales_inr,
        COALESCE(SUM(gst_amount_inr), 0) AS official_gst_inr,
        COALESCE(SUM(final_total_inr), 0) AS official_total_revenue_inr,
        COALESCE(SUM(production_cost_inr), 0) AS official_production_cost_inr,
        COUNT(*) AS approved_bills_count
       FROM bills WHERE status = 'APPROVED'`
    );

    // 3. Floor Scrap Sale Cash Revenue
    const scrapSaleRes = await query(
      `SELECT 
        COALESCE(SUM(ABS(quantity_delta) * unit_cost_inr), 0) AS scrap_sale_revenue_inr
       FROM inventory_ledger WHERE transaction_type = 'SCRAP_SALE'`
    );

    // 4. Today's Purchases
    const purchaseRes = await query(
      `SELECT 
        COALESCE(SUM(quantity_delta * unit_cost_inr), 0) AS today_purchases_inr,
        COUNT(*) AS today_receipts_count
       FROM inventory_ledger 
       WHERE transaction_type = 'PURCHASE_RECEIPT' 
         AND created_at >= CURRENT_DATE`
    );

    // 5. Pending Bills Queue
    const pendingRes = await query(
      `SELECT COUNT(*) AS pending_count FROM bills WHERE status = 'PENDING'`
    );

    // 6. Rejected Bills Count (past 48h)
    const rejectedRes = await query(
      `SELECT COUNT(*) AS rejected_count FROM bills WHERE status = 'REJECTED' AND decided_at >= NOW() - INTERVAL '48 hours'`
    );

    const officialSales = parseFloat(revRes.rows[0]?.official_sales_inr || '0');
    const officialTotalRev = parseFloat(revRes.rows[0]?.official_total_revenue_inr || '0');
    const productionCost = parseFloat(revRes.rows[0]?.official_production_cost_inr || '0');
    const scrapSaleRev = parseFloat(scrapSaleRes.rows[0]?.scrap_sale_revenue_inr || '0');
    const totalOfficialCash = officialTotalRev + scrapSaleRev;
    const grossProfit = officialSales - productionCost;
    const totalValuation = parseFloat(invSummary.rows[0]?.total_valuation || '0');
    const totalInvestment = parseFloat(invSummary.rows[0]?.total_investment || '0');
    const totalMetalKg = parseFloat(invSummary.rows[0]?.total_metal_kg || '0');
    const lowStockCount = parseInt(invSummary.rows[0]?.low_stock_count || '0', 10);
    const todayPurchases = parseFloat(purchaseRes.rows[0]?.today_purchases_inr || '0');
    const todayReceiptsCount = parseInt(purchaseRes.rows[0]?.today_receipts_count || '0', 10);
    const approvedCount = parseInt(revRes.rows[0]?.approved_bills_count || '0', 10);
    const pendingCount = parseInt(pendingRes.rows[0]?.pending_count || '0', 10);
    const rejectedCount = parseInt(rejectedRes.rows[0]?.rejected_count || '0', 10);

    const statsPayload = {
      inventory_valuation_inr: totalValuation,
      total_inventory_valuation: totalValuation,
      total_investment_inr: totalInvestment,
      total_metal_stock_kg: totalMetalKg,
      total_metal_kg: totalMetalKg,
      low_stock_items: lowStockCount,
      low_stock_count: lowStockCount,
      official_revenue_inr: totalOfficialCash,
      official_total_revenue_inr: officialTotalRev,
      official_sales_inr: officialSales,
      official_gst_inr: parseFloat(revRes.rows[0]?.official_gst_inr || '0'),
      official_production_cost_inr: productionCost,
      official_gross_profit_inr: grossProfit,
      scrap_sale_revenue_inr: scrapSaleRev,
      today_purchases_inr: todayPurchases,
      today_receipts_count: todayReceiptsCount,
      approved_bills_count: approvedCount,
      pending_requests: pendingCount,
      pending_count: pendingCount,
      rejected_recent_count: rejectedCount,
      rejected_count: rejectedCount,
    };

    return NextResponse.json({
      ...statsPayload,
      stats: statsPayload,
    });
  } catch (error: any) {
    console.error('Get admin stats error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch ERP statistics' },
      { status: 500 }
    );
  }
}
