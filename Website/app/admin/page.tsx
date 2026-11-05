'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Package,
  LogOut,
  Plus,
  CheckCircle,
  XCircle,
  Clock,
  TrendingUp,
  Box,
  AlertTriangle,
  FileText,
  DollarSign,
  Search,
  Filter,
  Layers,
  ShieldCheck,
  RefreshCw,
  Eye,
  Info,
  Calendar,
  UserCheck,
  ArrowUpRight,
  ArrowDownRight,
  AlertOctagon,
  Percent,
  Printer,
} from 'lucide-react';
import { openAndPrintTaxInvoice } from '@/lib/invoice-template';

interface User {
  id: string;
  username: string;
  role: 'ADMIN' | 'WORKER';
}

interface AdminStats {
  total_inventory_valuation: number;
  total_investment_inr?: number;
  total_metal_kg: number;
  low_stock_count: number;
  official_sales_inr: number;
  official_gst_inr: number;
  official_total_revenue_inr: number;
  official_production_cost_inr: number;
  approved_bills_count: number;
  scrap_sale_revenue_inr: number;
  today_purchases_inr: number;
  today_receipts_count: number;
  pending_count: number;
  rejected_count: number;
}

interface InventoryItem {
  id: string;
  material_variant_id?: string;
  material_name: string;
  category: 'COIL' | 'PIPE' | 'HINGES' | 'PAINT' | 'OTHER';
  base_unit: string;
  display_unit?: string;
  total_stock_display?: number;
  used_stock_display?: number;
  normal_used_stock_display?: number;
  secret_used_stock_display?: number;
  remaining_stock_display?: number;
  current_stock_display?: number;
  allocated_stock_display?: number;
  available_stock_display?: number;
  properties: any;
  bom_weight_per_foot_grams: number;
  unit_cost_inr: number;
  current_stock: number;
  stock_valuation_inr: number;
  total_investment_inr?: number;
  is_active: boolean;
}

interface WorkerAccount {
  id: string;
  username: string;
  role: 'WORKER';
  is_active: boolean;
  created_at: string;
  bills_count: number;
}

interface LedgerEntry {
  id: string;
  material_name: string;
  category: string;
  base_unit: string;
  transaction_type: string;
  quantity_delta: number;
  unit_cost_inr: number;
  supplier_name: string | null;
  invoice_no: string | null;
  notes: string | null;
  created_by_username: string | null;
  created_at: string;
}

interface BillItem {
  id: string;
  material_name: string;
  category: string;
  base_unit: string;
  input_length: number | null;
  input_breadth: number | null;
  calculated_feet: number | null;
  actual_quantity_consumed: number;
  unit: string;
  line_cost_inr: number;
}

interface Bill {
  id: string;
  bill_number: string;
  product_name: string;
  frame_formula_type: string;
  worker_username: string;
  customer_name: string;
  production_cost_inr: number;
  selling_price_inr: number;
  gst_rate: number;
  gst_amount_inr: number;
  final_total_inr: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejection_reason: string | null;
  decided_by_username: string | null;
  decided_at: string | null;
  created_at: string;
  items?: BillItem[];
}

interface ScrapSaleRecord {
  id: string;
  material_variant_id?: string;
  item_name: string;
  category?: string;
  quantity_kg: number;
  quantity_display?: number;
  unit?: string;
  total_amount: number;
  status?: 'UNSOLD' | 'SOLD';
  notes: string | null;
  created_at: string;
  created_by: string;
}

interface ScrapMaterialSummary {
  material_variant_id: string;
  material_name: string;
  category: string;
  unit: string;
  total_scrap_generated: number;
  unsold_scrap: number;
  sold_scrap: number;
  sold_revenue_inr: number;
}

interface ProductMaster {
  id: string;
  name: string;
  frame_formula_type: string;
  description: string | null;
  is_active: boolean;
}

export default function AdminPortalPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<'queue' | 'inventory' | 'history' | 'scrap' | 'workers' | 'masters'>('queue');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Stats & Data states
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [ledgerHistory, setLedgerHistory] = useState<LedgerEntry[]>([]);
  const [pendingBills, setPendingBills] = useState<Bill[]>([]);
  const [allBills, setAllBills] = useState<Bill[]>([]);
  const [unsoldScrap, setUnsoldScrap] = useState<ScrapSaleRecord[]>([]);
  const [scrapSales, setScrapSales] = useState<ScrapSaleRecord[]>([]);
  const [scrapSummary, setScrapSummary] = useState<ScrapMaterialSummary[]>([]);
  const [scrapTotals, setScrapTotals] = useState<{ total_unsold_qty: number; total_sold_qty: number; total_sold_revenue_inr: number }>({
    total_unsold_qty: 0,
    total_sold_qty: 0,
    total_sold_revenue_inr: 0,
  });
  const [products, setProducts] = useState<ProductMaster[]>([]);
  const [workers, setWorkers] = useState<WorkerAccount[]>([]);

  // Worker Management states
  const [newWorkerName, setNewWorkerName] = useState('');
  const [newWorkerPassword, setNewWorkerPassword] = useState('');
  const [creatingWorker, setCreatingWorker] = useState(false);
  const [workerActionLoading, setWorkerActionLoading] = useState<string | null>(null);

  // Product Master states
  const [newMasterProductName, setNewMasterProductName] = useState('');
  const [newMasterFormula, setNewMasterFormula] = useState('DOOR_2L_PLUS_B');
  const [creatingMasterProduct, setCreatingMasterProduct] = useState(false);
  const [bomEdits, setBomEdits] = useState<Record<string, string>>({});
  const [savingBomId, setSavingBomId] = useState<string | null>(null);

  // Search & Filter
  const [billSearch, setBillSearch] = useState('');
  const [billStatusFilter, setBillStatusFilter] = useState<'ALL' | 'APPROVED' | 'REJECTED'>('ALL');
  const [inventorySearch, setInventorySearch] = useState('');

  // Modals
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const [commandInput, setCommandInput] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [processingDecision, setProcessingDecision] = useState(false);

  const [showInspectModal, setShowInspectModal] = useState(false);
  const [inspectBill, setInspectBill] = useState<Bill | null>(null);

  const [showAddStockModal, setShowAddStockModal] = useState(false);
  const [stockUseNewProduct, setStockUseNewProduct] = useState(false);
  const [stockProductName, setStockProductName] = useState('');
  const [stockCategory, setStockCategory] = useState('COIL');
  const [stockMeasurementUnit, setStockMeasurementUnit] = useState('kg');
  const [stockVariantId, setStockVariantId] = useState('');
  const [stockPurchasedQty, setStockPurchasedQty] = useState('');
  const [stockTotalInvestment, setStockTotalInvestment] = useState('');
  const [stockScrapSplitGrams, setStockScrapSplitGrams] = useState('');
  const [stockUnitCost, setStockUnitCost] = useState('');
  const [stockSupplier, setStockSupplier] = useState('');
  const [stockInvoice, setStockInvoice] = useState('');
  const [stockNotes, setStockNotes] = useState('');
  const [savingStock, setSavingStock] = useState(false);

  const [showScrapSaleModal, setShowScrapSaleModal] = useState(false);
  const [scrapSaleEntryId, setScrapSaleEntryId] = useState<string>('');
  const [scrapSaleVariantId, setScrapSaleVariantId] = useState('');
  const [scrapSaleItemLabel, setScrapSaleItemLabel] = useState('');
  const [scrapSaleUnit, setScrapSaleUnit] = useState('KG');
  const [scrapSaleMaxQty, setScrapSaleMaxQty] = useState<number>(0);
  const [scrapSaleQtyKg, setScrapSaleQtyKg] = useState('');
  const [scrapSaleAmountInr, setScrapSaleAmountInr] = useState('');
  const [scrapSaleNotes, setScrapSaleNotes] = useState('');
  const [savingScrapSale, setSavingScrapSale] = useState(false);

  useEffect(() => {
    checkAuth();
    loadAllData();
  }, []);

  const checkAuth = async () => {
    try {
      const response = await fetch('/api/auth/me');
      if (!response.ok) {
        router.push('/login');
        return;
      }
      const data = await response.json();
      if (!data.user || data.user.role?.toUpperCase() !== 'ADMIN') {
        router.push('/portal');
        return;
      }
      setCurrentUser(data.user);
    } catch {
      router.push('/login');
    }
  };

  const loadAllData = async () => {
    setRefreshing(true);
    try {
      const [statsRes, invRes, ledgerRes, pendingRes, allRes, scrapRes, prodRes, workersRes] = await Promise.all([
        fetch('/api/admin/stats'),
        fetch('/api/inventory'),
        fetch('/api/inventory?history=true'),
        fetch('/api/bills?filter=pending'),
        fetch('/api/bills'),
        fetch('/api/admin/scrap-sale'),
        fetch('/api/products'),
        fetch('/api/admin/workers'),
      ]);

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData.stats || statsData);
      }

      if (invRes.ok) {
        const invData = await invRes.json();
        setInventory(invData.items || []);
        if (invData.items?.length > 0 && !stockVariantId) {
          const initialId = invData.items[0].id || invData.items[0].material_variant_id;
          setStockVariantId(initialId);
          setScrapSaleVariantId(initialId);
        }
      }

      if (ledgerRes.ok) {
        const ledgerData = await ledgerRes.json();
        setLedgerHistory(ledgerData.ledger || []);
      }

      if (pendingRes.ok) {
        const pendingData = await pendingRes.json();
        setPendingBills(pendingData.bills || []);
      }

      if (allRes.ok) {
        const allData = await allRes.json();
        setAllBills(allData.bills || []);
      }

      if (scrapRes.ok) {
        const scrapData = await scrapRes.json();
        setUnsoldScrap(scrapData.unsold_scrap || []);
        setScrapSales(scrapData.sales || []);
        setScrapSummary(scrapData.summary || []);
        if (scrapData.totals) {
          setScrapTotals(scrapData.totals);
        }
      }

      if (prodRes.ok) {
        const prodData = await prodRes.json();
        setProducts(prodData.products || []);
      }

      if (workersRes.ok) {
        const workersData = await workersRes.json();
        setWorkers(workersData.workers || []);
      }
    } catch (err) {
      console.error('Failed to load admin data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
    }
  };

  // ==========================================================================
  // BILL REVIEW ROUTER
  // ==========================================================================
  const openDecisionModal = (bill: Bill) => {
    setSelectedBill(bill);
    setCommandInput('');
    setRejectionReason('');
    setShowApprovalModal(true);
  };

  const normalizedCommand = commandInput.trim().toLowerCase();
  const isApprove = normalizedCommand === 'approve';
  const isReject = normalizedCommand === 'reject';
  const isCustomAction = normalizedCommand.length > 0 && !isApprove && !isReject;
  const isValidCommand = isApprove || isCustomAction || isReject;

  const handleExecuteDecision = async () => {
    if (!selectedBill || !isValidCommand) return;
    if (isReject && !rejectionReason.trim()) {
      alert('A rejection reason is required to reject this bill.');
      return;
    }

    setProcessingDecision(true);
    try {
      const response = await fetch('/api/admin/approve-bill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bill_id: selectedBill.id,
          confirmation_input: commandInput.trim(),
          rejection_reason: rejectionReason.trim() || undefined,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        if (data.approval_type === 'REJECTED') {
          alert('Bill marked as REJECTED.');
        } else {
          alert('✓ Bill processed. Production stock updated in ERP inventory.');
        }
        setShowApprovalModal(false);
        setSelectedBill(null);
        setCommandInput('');
        setRejectionReason('');
        loadAllData();
      } else {
        alert(data.error || 'Decision processing failed');
      }
    } catch (err: any) {
      alert('Network error while processing decision');
    } finally {
      setProcessingDecision(false);
    }
  };

  // ==========================================================================
  // INVENTORY & TOTAL INVESTMENT SINGLE-ENTRY ADDITION
  // ==========================================================================
  const handleAddStock = async (e: React.FormEvent) => {
    e.preventDefault();
    const chosenName = stockUseNewProduct ? stockProductName.trim() : '';
    if ((!stockUseNewProduct && !stockVariantId) || (stockUseNewProduct && !chosenName) || !stockPurchasedQty) {
      alert('Please provide Product Name, Measurement Unit, Quantity, and Total Investment.');
      return;
    }

    setSavingStock(true);
    try {
      const response = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          material_variant_id: stockUseNewProduct ? undefined : stockVariantId,
          product_name: stockUseNewProduct ? chosenName : undefined,
          category: stockCategory,
          measurement_unit: stockMeasurementUnit,
          quantity: parseFloat(stockPurchasedQty),
          purchased_quantity: parseFloat(stockPurchasedQty),
          total_investment: stockTotalInvestment !== '' ? parseFloat(stockTotalInvestment) : undefined,
          defective_scrap_grams: parseFloat(stockScrapSplitGrams || '0'),
          unit_cost_inr: parseFloat(stockUnitCost || '0'),
          supplier_name: stockSupplier.trim() || null,
          invoice_no: stockInvoice.trim() || null,
          notes: stockNotes.trim() || null,
        }),
      });

      const data = await response.json();
      if (response.ok) {
        alert(
          `✓ Inventory & Investment Added!\n• Product: ${data.product_name || 'Material'}\n• Added: +${data.quantity_added} ${data.measurement_unit || stockMeasurementUnit}\n• Total Investment: ₹${(data.total_investment_inr || 0).toFixed(2)}`
        );
        setShowAddStockModal(false);
        setStockProductName('');
        setStockPurchasedQty('');
        setStockTotalInvestment('');
        setStockScrapSplitGrams('');
        setStockUnitCost('');
        setStockSupplier('');
        setStockInvoice('');
        setStockNotes('');
        loadAllData();
      } else {
        alert(data.error || 'Failed to add inventory');
      }
    } catch {
      alert('Network error while saving inventory');
    } finally {
      setSavingStock(false);
    }
  };

  // ==========================================================================
  // SCRAP INVENTORY SALE
  // ==========================================================================
  const openSellScrapModal = (entry?: ScrapSaleRecord) => {
    if (entry) {
      setScrapSaleEntryId(entry.id);
      setScrapSaleVariantId(entry.material_variant_id || '');
      setScrapSaleItemLabel(`${entry.item_name} (${entry.category || 'MATERIAL'})`);
      setScrapSaleUnit(entry.unit || 'KG');
      setScrapSaleMaxQty(entry.quantity_display || entry.quantity_kg || 0);
      setScrapSaleQtyKg(String(entry.quantity_display || entry.quantity_kg || ''));
    } else {
      const availMat = scrapSummary.find((m) => m.unsold_scrap > 0);
      setScrapSaleEntryId('');
      setScrapSaleVariantId(availMat?.material_variant_id || '');
      setScrapSaleItemLabel(availMat ? `${availMat.material_name} (${availMat.category})` : '');
      setScrapSaleUnit(availMat?.unit || 'KG');
      setScrapSaleMaxQty(availMat?.unsold_scrap || 0);
      setScrapSaleQtyKg(availMat ? String(availMat.unsold_scrap) : '');
    }
    setScrapSaleAmountInr('');
    setScrapSaleNotes('');
    setShowScrapSaleModal(true);
  };

  const handleRecordScrapSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scrapSaleQtyKg || !scrapSaleAmountInr) {
      alert('Please enter scrap quantity and selling amount (₹).');
      return;
    }

    setSavingScrapSale(true);
    try {
      const response = await fetch('/api/admin/scrap-sale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scrap_entry_id: scrapSaleEntryId || undefined,
          material_variant_id: scrapSaleVariantId || undefined,
          quantity: parseFloat(scrapSaleQtyKg),
          total_amount: parseFloat(scrapSaleAmountInr),
          notes: scrapSaleNotes.trim() || undefined,
        }),
      });

      const data = await response.json();
      if (response.ok) {
        alert(`✓ Scrap sold for ₹${scrapSaleAmountInr} and recorded in inventory ledger.`);
        setShowScrapSaleModal(false);
        setScrapSaleEntryId('');
        setScrapSaleQtyKg('');
        setScrapSaleAmountInr('');
        setScrapSaleNotes('');
        loadAllData();
      } else {
        alert(data.error || 'Failed to record scrap sale');
      }
    } catch {
      alert('Network error while recording scrap sale');
    } finally {
      setSavingScrapSale(false);
    }
  };

  // ==========================================================================
  // WORKER MANAGEMENT HANDLERS (Create, Block/Unblock, Delete)
  // ==========================================================================
  const handleCreateWorker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkerName.trim() || !newWorkerPassword.trim()) {
      alert('Please enter both Worker Name and Password.');
      return;
    }
    setCreatingWorker(true);
    try {
      const res = await fetch('/api/admin/workers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newWorkerName.trim(),
          password: newWorkerPassword.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(`✓ Worker account "${newWorkerName.trim()}" created successfully!`);
        setNewWorkerName('');
        setNewWorkerPassword('');
        loadAllData();
      } else {
        alert(data.error || 'Failed to create worker');
      }
    } catch {
      alert('Network error creating worker');
    } finally {
      setCreatingWorker(false);
    }
  };

  const handleToggleBlockWorker = async (worker: WorkerAccount) => {
    setWorkerActionLoading(worker.id);
    try {
      const res = await fetch('/api/admin/workers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: worker.id,
          is_active: !worker.is_active,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        loadAllData();
      } else {
        alert(data.error || 'Failed to update worker status');
      }
    } catch {
      alert('Network error updating worker');
    } finally {
      setWorkerActionLoading(null);
    }
  };

  const handleDeleteWorker = async (worker: WorkerAccount) => {
    setWorkerActionLoading(worker.id);
    try {
      const res = await fetch(`/api/admin/workers?id=${encodeURIComponent(worker.id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok) {
        loadAllData();
      } else {
        alert(data.error || 'Failed to delete worker');
      }
    } catch {
      alert('Network error deleting worker');
    } finally {
      setWorkerActionLoading(null);
    }
  };

  const handleDeleteScrapEntry = async (entryId: string) => {
    try {
      const res = await fetch(`/api/admin/scrap-sale?id=${encodeURIComponent(entryId)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        loadAllData();
      }
    } catch {
      alert('Failed to delete scrap entry');
    }
  };

  const handleCreateMasterProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMasterProductName.trim()) return;
    setCreatingMasterProduct(true);
    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newMasterProductName.trim(),
          frame_formula_type: newMasterFormula,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(`✓ Product "${newMasterProductName.trim()}" added to catalog!`);
        setNewMasterProductName('');
        loadAllData();
      } else {
        alert(data.error || 'Failed to add product');
      }
    } catch {
      alert('Network error adding product');
    } finally {
      setCreatingMasterProduct(false);
    }
  };

  const handleSaveBomWeight = async (variantId: string, fallbackWeight: number) => {
    const rawVal = bomEdits[variantId] !== undefined ? bomEdits[variantId] : String(fallbackWeight ?? 0);
    const numBom = parseFloat(rawVal);
    if (isNaN(numBom) || numBom < 0) {
      alert('Please enter a valid non-negative BOM Weight / Foot (g/ft).');
      return;
    }
    setSavingBomId(variantId);
    try {
      const res = await fetch('/api/inventory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: variantId,
          bom_weight_per_foot_grams: numBom,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        loadAllData();
      } else {
        alert(data.error || 'Failed to update BOM Weight / Foot');
      }
    } catch {
      alert('Network error updating BOM Weight / Foot');
    } finally {
      setSavingBomId(null);
    }
  };

  // Filtered bills
  const filteredAllBills = allBills.filter((bill) => {
    const matchesStatus = billStatusFilter === 'ALL' || bill.status === billStatusFilter;
    const matchesSearch =
      !billSearch.trim() ||
      bill.bill_number.toLowerCase().includes(billSearch.toLowerCase()) ||
      bill.customer_name.toLowerCase().includes(billSearch.toLowerCase()) ||
      bill.product_name.toLowerCase().includes(billSearch.toLowerCase()) ||
      bill.worker_username.toLowerCase().includes(billSearch.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  // Filtered inventory
  const filteredInventory = inventory.filter((item) =>
    !inventorySearch.trim() ||
    item.material_name.toLowerCase().includes(inventorySearch.toLowerCase()) ||
    item.category.toLowerCase().includes(inventorySearch.toLowerCase())
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-300">
        <RefreshCw className="w-10 h-10 text-emerald-500 animate-spin mb-4" />
        <p className="text-sm font-medium tracking-wide">Loading Enterprise ERP Master Engine...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Navigation Bar */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <ShieldCheck className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg tracking-tight text-white">STEELCRAFT</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-semibold border border-emerald-500/30">
                  ERP v2.0
                </span>
              </div>
              <p className="text-xs text-slate-400">Executive Production & Inventory Gateway</p>
            </div>
          </div>

          {/* Right Action Bar */}
          <div className="flex items-center gap-4">
            <button
              onClick={loadAllData}
              disabled={refreshing}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition border border-slate-700 flex items-center gap-1.5 text-xs font-medium"
              title="Refresh all metrics"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-emerald-400' : ''}`} />
              <span className="hidden sm:inline">Sync</span>
            </button>

            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/60 text-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-slate-300 font-medium">{currentUser?.username || 'Admin'}</span>
              <span className="text-slate-500">|</span>
              <span className="text-emerald-400 font-mono">OFFICIAL DB</span>
            </div>

            <button
              onClick={handleLogout}
              className="p-2 rounded-lg bg-red-950/40 hover:bg-red-900/50 text-red-400 border border-red-800/40 transition flex items-center gap-1.5 text-xs font-medium"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Exit</span>
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex gap-1 overflow-x-auto pb-px scrollbar-none">
          <button
            onClick={() => setActiveTab('queue')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition whitespace-nowrap ${
              activeTab === 'queue'
                ? 'border-emerald-500 text-emerald-400 bg-emerald-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <Clock className="w-4 h-4" />
            Approval Queue
            {pendingBills.length > 0 && (
              <span className="ml-1.5 px-2 py-0.5 text-xs font-bold rounded-full bg-amber-500 text-slate-950 animate-pulse">
                {pendingBills.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('inventory')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition whitespace-nowrap ${
              activeTab === 'inventory'
                ? 'border-emerald-500 text-emerald-400 bg-emerald-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <Box className="w-4 h-4" />
            ERP Inventory & Ledger
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition whitespace-nowrap ${
              activeTab === 'history'
                ? 'border-emerald-500 text-emerald-400 bg-emerald-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <FileText className="w-4 h-4" />
            Production Bills History
          </button>

          <button
            onClick={() => setActiveTab('workers')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition whitespace-nowrap ${
              activeTab === 'workers'
                ? 'border-emerald-500 text-emerald-400 bg-emerald-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <UserCheck className="w-4 h-4" />
            Worker Management
            <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-slate-800 text-slate-300">
              {workers.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('masters')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition whitespace-nowrap ${
              activeTab === 'masters'
                ? 'border-emerald-500 text-emerald-400 bg-emerald-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <Layers className="w-4 h-4" />
            BOM & Product Masters
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3.5 sm:px-6 lg:px-8 py-4 sm:py-6 pb-24 sm:pb-8 space-y-5 sm:space-y-6">
        {/* Executive KPI Overview Cards - Mobile-first 2-col grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Investment & Stock</span>
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                <Box className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-bold tracking-tight text-white">
              ₹{(stats?.total_investment_inr || stats?.total_inventory_valuation || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </div>
            <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
              <span>{(stats?.total_metal_kg || 0).toFixed(1)} kg Metal Stock</span>
              {stats && stats.low_stock_count > 0 && (
                <span className="text-amber-400 font-medium flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {stats.low_stock_count} Low
                </span>
              )}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Official DB Revenue</span>
              <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400">
                <DollarSign className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-bold tracking-tight text-white">
              ₹{((stats?.official_total_revenue_inr || 0) + (stats?.scrap_sale_revenue_inr || 0)).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </div>
            <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
              <span>Bills: ₹{(stats?.official_total_revenue_inr || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
              <span className="text-amber-400 font-mono">Scrap Sold: ₹{(stats?.scrap_sale_revenue_inr || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Today&apos;s Purchases</span>
              <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
                <ArrowDownRight className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-bold tracking-tight text-white">
              ₹{(stats?.today_purchases_inr || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </div>
            <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
              <span>{stats?.today_receipts_count || 0} Stock Receipts Today</span>
              <span className="text-emerald-400">Verified</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Pending Review</span>
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
                <Clock className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-bold tracking-tight text-amber-400">
              {pendingBills.length}
            </div>
            <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
              <span>Awaiting Admin Review</span>
              <span className="text-slate-500">Approval Queue</span>
            </div>
          </div>
        </div>

        {/* TAB 1: APPROVAL QUEUE */}
        {activeTab === 'queue' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-slate-900/60 border border-slate-800">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Clock className="w-5 h-5 text-amber-400" />
                  Pending Bills Queue
                </h2>
                <p className="text-xs text-slate-400">
                  Review production bills submitted by workers and approve or reject them.
                </p>
              </div>
              <div className="text-xs text-slate-400 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700/60 flex items-center gap-2">
                <span className="font-semibold text-slate-200">{pendingBills.length}</span> pending verification
              </div>
            </div>

            {pendingBills.length === 0 ? (
              <div className="p-12 text-center rounded-2xl bg-slate-900/40 border border-slate-800/80">
                <CheckCircle className="w-12 h-12 text-emerald-500/60 mx-auto mb-3" />
                <h3 className="text-base font-semibold text-white">Queue is clear</h3>
                <p className="text-xs text-slate-400 mt-1">All worker submitted bills have been routed and processed.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {pendingBills.map((bill, bIdx) => {
                  let metalWeightKg = 0;
                  bill.items?.forEach((item) => {
                    if (item.category === 'COIL' || item.category === 'PIPE') {
                      metalWeightKg += parseFloat(item.actual_quantity_consumed?.toString() || '0') / 1000.0;
                    }
                  });

                  return (
                    <div
                      key={bill.id ? `${bill.id}-${bIdx}` : `pending-bill-${bIdx}`}
                      className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition space-y-4 shadow-sm"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            <FileText className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white text-base">#{bill.bill_number}</span>
                              <span className="text-xs px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 font-medium">
                                {bill.product_name}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
                              <span>Customer: <strong className="text-slate-200">{bill.customer_name}</strong></span>
                              <span>•</span>
                              <span>Worker: <strong className="text-slate-200">@{bill.worker_username}</strong></span>
                              <span>•</span>
                              <span>{new Date(bill.created_at).toLocaleString()}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
                          <div className="text-right">
                            <div className="text-xs text-slate-400">Total (GST Inc.)</div>
                            <div className="text-lg font-bold text-emerald-400">
                              ₹{parseFloat(bill.final_total_inr?.toString() || '0').toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => openAndPrintTaxInvoice(bill, 'Duplicate Copy')}
                            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs flex items-center gap-1.5 transition"
                            title="Preview / Print Tax Invoice"
                          >
                            <Printer className="w-3.5 h-3.5 text-cyan-400" />
                            <span>View Invoice</span>
                          </button>
                          <button
                            onClick={() => openDecisionModal(bill)}
                            className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-xs tracking-wide shadow-md transition"
                          >
                            Review &amp; Decide
                          </button>
                        </div>
                      </div>

                      {/* Line items preview */}
                      <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800/60">
                        <div className="text-xs font-semibold text-slate-400 mb-2 flex items-center justify-between">
                          <span>CONSUMED MATERIALS BREAKDOWN</span>
                          <span className="font-mono text-emerald-400">
                            Total Metal: {metalWeightKg.toFixed(3)} kg
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                          {bill.items?.map((item, iIdx) => (
                            <div
                              key={item.id ? `${item.id}-${iIdx}` : `preview-item-${bIdx}-${iIdx}`}
                              className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs flex flex-col justify-between"
                            >
                              <div className="flex items-center justify-between font-medium text-slate-200">
                                <span>{item.material_name}</span>
                                <span className="text-slate-400 font-mono text-[11px]">{item.category}</span>
                              </div>
                              <div className="mt-1 text-[11px] text-slate-400 flex items-center justify-between">
                                <span>
                                  {item.input_length && item.input_breadth
                                    ? `${item.input_length}' × ${item.input_breadth}' (${item.calculated_feet} ft)`
                                    : 'Direct'}
                                </span>
                                <span className="text-emerald-400 font-semibold">
                                  {item.unit === 'GRAM'
                                    ? `${(item.actual_quantity_consumed / 1000).toFixed(2)} kg`
                                    : `${item.actual_quantity_consumed} ${item.unit}`}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: INVENTORY & AUDIT LEDGER */}
        {activeTab === 'inventory' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-slate-900/60 border border-slate-800">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Box className="w-5 h-5 text-emerald-400" />
                  ERP Official Stock & Append-Only Ledger
                </h2>
                <p className="text-xs text-slate-400">
                  Real-time stock valuation and verifiable transaction audit trails. All stock movements derive from <span className="font-mono text-slate-300">inventory_ledger</span>.
                </p>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={() => setShowAddStockModal(true)}
                  className="flex-1 sm:flex-initial justify-center px-3 py-2.5 sm:py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Stock Receipt
                </button>
                <button
                  onClick={() => openSellScrapModal()}
                  className="flex-1 sm:flex-initial justify-center px-3 py-2.5 sm:py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs flex items-center gap-1.5 border border-slate-700 transition"
                >
                  <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
                  Sell Scrap
                </button>
              </div>
            </div>

            {/* Live Stock Variant Cards */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Live Material Stock Levels</h3>
                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={inventorySearch}
                    onChange={(e) => setInventorySearch(e.target.value)}
                    placeholder="Search materials..."
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredInventory.map((item, itemIdx) => {
                  const stockDisplay =
                    item.base_unit === 'GRAM'
                      ? `${(item.current_stock / 1000).toFixed(2)} kg`
                      : `${item.current_stock} ${item.base_unit}`;

                  const isLow = item.base_unit === 'GRAM' ? item.current_stock <= 2000 : item.current_stock <= 5;

                  return (
                    <div
                      key={item.id ? `${item.id}-${itemIdx}` : `inv-item-${itemIdx}`}
                      className="p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition flex flex-col justify-between"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300 uppercase tracking-wider">
                            {item.category}
                          </span>
                          <h4 className="font-semibold text-sm text-white mt-1.5">{item.material_name}</h4>
                        </div>
                        {isLow ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            Low Stock
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            In Stock
                          </span>
                        )}
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-800/80 grid grid-cols-4 gap-2 text-xs">
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase">Total Stock</div>
                          <div className="font-semibold text-slate-200 font-mono">
                            {parseFloat((item.total_stock_display ?? item.current_stock_display ?? 0).toString()).toFixed(2)} {item.display_unit || item.base_unit}
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-[10px] text-slate-500 uppercase">Used Stock</div>
                          <div className="font-semibold text-cyan-400 font-mono">
                            {parseFloat((item.normal_used_stock_display ?? item.used_stock_display ?? 0).toString()).toFixed(2)} {item.display_unit || item.base_unit}
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-[10px] text-slate-500 uppercase">Scrap</div>
                          <div className="font-semibold text-amber-400 font-mono">
                            {parseFloat((item.secret_used_stock_display ?? 0).toString()).toFixed(2)} {item.display_unit || item.base_unit}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] text-slate-500 uppercase">Remaining</div>
                          <div className="font-bold text-white text-sm font-mono">{stockDisplay}</div>
                        </div>
                      </div>
                      <div className="mt-2 pt-2 border-t border-slate-800/40 flex items-center justify-between text-[11px]">
                        <span className="text-slate-400 font-mono">
                          Pending Alloc: <b className="text-amber-300">{parseFloat(item.allocated_stock_display?.toString() || '0').toFixed(2)} {item.display_unit || item.base_unit}</b>
                        </span>
                        <span className="text-emerald-400 font-semibold font-mono">
                          Inv: ₹{parseFloat((item.total_investment_inr ?? item.stock_valuation_inr)?.toString() || '0').toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* WORKSHOP SCRAP INVENTORY & SCRAP SALES (INSIDE INVENTORY TAB) */}
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-amber-400" />
                    Workshop Scrap Inventory &amp; Scrap Sales
                  </h3>
                  <p className="text-xs text-slate-400">
                    Scrap stock recorded in the database. Click &ldquo;Sell Scrap&rdquo; to enter the sold amount (₹) and store it in the database.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="px-3 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono text-xs font-bold">
                    Scrap Sold Revenue: ₹{scrapTotals.total_sold_revenue_inr.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                  {unsoldScrap.length > 0 && (
                    <button
                      onClick={() => openSellScrapModal()}
                      className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow transition"
                    >
                      <DollarSign className="w-3.5 h-3.5" />
                      Sell Scrap
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-lg border border-slate-800 bg-slate-950/50 overflow-hidden">
                  <div className="px-3 py-2 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400">Available Scrap Stock</span>
                    <span className="text-[11px] font-mono text-slate-400">{unsoldScrap.length} entries</span>
                  </div>
                  <div className="overflow-x-auto max-h-64 overflow-y-auto">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-900 text-slate-400 uppercase text-[10px] border-b border-slate-800">
                        <tr>
                          <th className="px-3 py-2">Date</th>
                          <th className="px-3 py-2">Material</th>
                          <th className="px-3 py-2">Approved By</th>
                          <th className="px-3 py-2 text-right">Scrap Qty</th>
                          <th className="px-3 py-2 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono">
                        {unsoldScrap.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-3 py-6 text-center text-slate-500 font-sans">No unsold scrap in stock.</td>
                          </tr>
                        ) : (
                          unsoldScrap.map((entry, uIdx) => (
                            <tr key={entry.id ? `${entry.id}-${uIdx}` : `unsold-${uIdx}`} className="hover:bg-slate-800/30">
                              <td className="px-3 py-2 text-slate-400 font-sans whitespace-nowrap">{new Date(entry.created_at).toLocaleDateString()}</td>
                              <td className="px-3 py-2 font-sans font-medium text-white">{entry.item_name}</td>
                              <td className="px-3 py-2 font-sans text-indigo-300">
                                @{entry.created_by || 'admin'}
                              </td>
                              <td className="px-3 py-2 text-right font-bold text-amber-400">
                                {(entry.quantity_display ?? entry.quantity_kg).toFixed(2)} {entry.unit || 'KG'}
                              </td>
                              <td className="px-3 py-2 text-right font-sans">
                                <button onClick={() => openSellScrapModal(entry)} className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold transition">
                                  Sell Scrap
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/50 overflow-hidden">
                  <div className="px-3 py-2 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">Sold Scrap History</span>
                    <span className="text-[11px] font-mono text-emerald-400">{scrapSales.length} sold</span>
                  </div>
                  <div className="overflow-x-auto max-h-64 overflow-y-auto">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-900 text-slate-400 uppercase text-[10px] border-b border-slate-800">
                        <tr>
                          <th className="px-3 py-2">Date</th>
                          <th className="px-3 py-2">Material</th>
                          <th className="px-3 py-2 text-right">Qty Sold</th>
                          <th className="px-3 py-2 text-right">Amount (₹)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono">
                        {scrapSales.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-3 py-6 text-center text-slate-500 font-sans">No scrap sold yet.</td>
                          </tr>
                        ) : (
                          scrapSales.map((sale, sIdx) => (
                            <tr key={sale.id ? `${sale.id}-${sIdx}` : `sale-${sIdx}`} className="hover:bg-slate-800/30">
                              <td className="px-3 py-2 text-slate-400 font-sans whitespace-nowrap">{new Date(sale.created_at).toLocaleDateString()}</td>
                              <td className="px-3 py-2 font-sans font-medium text-slate-200">{sale.item_name}</td>
                              <td className="px-3 py-2 text-right text-amber-400">
                                {(sale.quantity_display ?? sale.quantity_kg).toFixed(2)} {sale.unit || 'KG'}
                              </td>
                              <td className="px-3 py-2 text-right font-bold text-emerald-400">
                                ₹{sale.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            {/* Audit Ledger History Table */}
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white">Append-Only Inventory Ledger (Recent 100 Transactions)</h3>
                  <p className="text-xs text-slate-400">Verifiable transactional record of purchases, consumptions, and scrap sales.</p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-800/80">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-950/80 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
                    <tr>
                      <th className="px-3 py-2.5">Date & Time</th>
                      <th className="px-3 py-2.5">Material</th>
                      <th className="px-3 py-2.5">Type</th>
                      <th className="px-3 py-2.5 text-right">Delta</th>
                      <th className="px-3 py-2.5 text-right">Unit Rate</th>
                      <th className="px-3 py-2.5">Supplier / Invoice</th>
                      <th className="px-3 py-2.5">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {ledgerHistory.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                          No ledger transactions recorded yet.
                        </td>
                      </tr>
                    ) : (
                      ledgerHistory.map((entry, eIdx) => {
                        const delta = parseFloat(entry.quantity_delta?.toString() || '0');
                        const isPositive = delta > 0;
                        const deltaFormatted =
                          entry.base_unit === 'GRAM'
                            ? `${(delta / 1000).toFixed(2)} kg`
                            : `${delta} ${entry.base_unit}`;

                        return (
                          <tr key={entry.id ? `${entry.id}-${eIdx}` : `ledger-${eIdx}`} className="hover:bg-slate-800/30 transition">
                            <td className="px-3 py-2 text-slate-400 font-sans whitespace-nowrap">
                              {new Date(entry.created_at).toLocaleString()}
                            </td>
                            <td className="px-3 py-2 font-sans font-medium text-slate-200">
                              {entry.material_name}
                            </td>
                            <td className="px-3 py-2 font-sans">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  entry.transaction_type === 'PURCHASE_RECEIPT'
                                    ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                    : entry.transaction_type === 'BILL_CONSUMPTION'
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                }`}
                              >
                                {entry.transaction_type}
                              </span>
                            </td>
                            <td className={`px-3 py-2 text-right font-bold ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {isPositive ? `+${deltaFormatted}` : deltaFormatted}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-300">
                              ₹{parseFloat(entry.unit_cost_inr?.toString() || '0').toFixed(2)}
                            </td>
                            <td className="px-3 py-2 font-sans text-slate-400">
                              {entry.supplier_name ? `${entry.supplier_name} (${entry.invoice_no || 'No Inv'})` : '-'}
                            </td>
                            <td className="px-3 py-2 font-sans text-slate-400 max-w-xs truncate" title={entry.notes || ''}>
                              {entry.notes || '-'}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: BILLS HISTORY */}
        {activeTab === 'history' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-slate-900/60 border border-slate-800">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <FileText className="w-5 h-5 text-cyan-400" />
                  Official ERP Production Bills
                </h2>
                <p className="text-xs text-slate-400">
                  Approved commercial bills with full material breakdown, GST invoices, and production costing.
                </p>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={billSearch}
                    onChange={(e) => setBillSearch(e.target.value)}
                    placeholder="Search bill, client, worker..."
                    className="bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800 text-xs">
                  <button
                    onClick={() => setBillStatusFilter('ALL')}
                    className={`px-2.5 py-1 rounded font-medium transition ${
                      billStatusFilter === 'ALL' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setBillStatusFilter('APPROVED')}
                    className={`px-2.5 py-1 rounded font-medium transition ${
                      billStatusFilter === 'APPROVED' ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Approved
                  </button>
                  <button
                    onClick={() => setBillStatusFilter('REJECTED')}
                    className={`px-2.5 py-1 rounded font-medium transition ${
                      billStatusFilter === 'REJECTED' ? 'bg-rose-500/20 text-rose-400' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Rejected
                  </button>
                </div>
              </div>
            </div>

            {/* Bills Table */}
            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900 shadow-sm">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-950/80 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
                  <tr>
                    <th className="px-4 py-3">Bill Number</th>
                    <th className="px-4 py-3">Product</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Created By</th>
                    <th className="px-4 py-3 text-right">Selling Price</th>
                    <th className="px-4 py-3 text-right">GST</th>
                    <th className="px-4 py-3 text-right">Final Total</th>
                    <th className="px-4 py-3">Status &amp; Approved By</th>
                    <th className="px-4 py-3 text-center">Inspect</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {filteredAllBills.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center text-slate-500 font-sans">
                        No official bills match the selected filter.
                      </td>
                    </tr>
                  ) : (
                    filteredAllBills.map((bill, bIdx) => (
                      <tr key={bill.id ? `${bill.id}-${bIdx}` : `history-bill-${bIdx}`} className="hover:bg-slate-800/30 transition">
                        <td className="px-4 py-2.5 font-bold text-white whitespace-nowrap">
                          #{bill.bill_number}
                        </td>
                        <td className="px-4 py-2.5 font-sans font-medium text-slate-200">
                          {bill.product_name}
                        </td>
                        <td className="px-4 py-2.5 font-sans text-slate-300">
                          {bill.customer_name}
                        </td>
                        <td className="px-4 py-2.5 font-sans text-slate-400">
                          @{bill.worker_username}
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-300">
                          ₹{parseFloat(bill.selling_price_inr?.toString() || '0').toFixed(2)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-400">
                          ₹{parseFloat(bill.gst_amount_inr?.toString() || '0').toFixed(2)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-bold text-emerald-400">
                          ₹{parseFloat(bill.final_total_inr?.toString() || '0').toFixed(2)}
                        </td>
                        <td className="px-4 py-2.5 font-sans">
                          {bill.status === 'APPROVED' ? (
                            <div className="flex flex-col items-start gap-1">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                Approved
                              </span>
                              <span className="text-[11px] text-emerald-300 font-mono">
                                by @{bill.decided_by_username || 'admin'}
                              </span>
                            </div>
                          ) : bill.status === 'REJECTED' ? (
                            <div className="flex flex-col items-start gap-1">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                                Rejected
                              </span>
                              <span className="text-[11px] text-rose-300 font-mono">
                                by @{bill.decided_by_username || 'admin'}
                              </span>
                            </div>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                              Pending
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              onClick={() => {
                                setInspectBill(bill);
                                setShowInspectModal(true);
                              }}
                              className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition"
                              title="Inspect bill items"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            {bill.status === 'APPROVED' && (
                              <button
                                onClick={() => openAndPrintTaxInvoice(bill, 'Duplicate Copy')}
                                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-sans font-bold text-[11px] flex items-center gap-1 shadow transition"
                                title="Download / Print Vishawkarma Steel Udyog Tax Invoice"
                              >
                                <Printer className="w-3.5 h-3.5" />
                                <span>Download Bill</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4B: WORKER MANAGEMENT */}
        {activeTab === 'workers' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between p-4 rounded-xl bg-slate-900/60 border border-slate-800">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <UserCheck className="w-5 h-5 text-emerald-400" />
                  Worker Account Management
                </h2>
                <p className="text-xs text-slate-400">
                  Create Worker accounts (Name &amp; Password), or block/unblock and delete workers directly from the dashboard.
                </p>
              </div>
              <span className="text-xs text-slate-300 bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700 font-mono">
                {workers.length} Workers
              </span>
            </div>

            <form onSubmit={handleCreateWorker} className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-emerald-400" />
                Create New Worker Account
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Worker Name *</label>
                  <input type="text" required value={newWorkerName} onChange={(e) => setNewWorkerName(e.target.value)} placeholder="e.g. worker3" className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Password *</label>
                  <input type="password" required value={newWorkerPassword} onChange={(e) => setNewWorkerPassword(e.target.value)} placeholder="Min 4 characters" className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white" />
                </div>
                <button type="submit" disabled={creatingWorker} className="w-full py-2 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow transition">
                  {creatingWorker ? 'Creating...' : '+ Create Worker Account'}
                </button>
              </div>
            </form>

            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900 shadow-sm">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-950/80 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
                  <tr>
                    <th className="px-4 py-3">Worker Name</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Bills</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {workers.map((w) => (
                    <tr key={w.id} className="hover:bg-slate-800/30 transition">
                      <td className="px-4 py-3 font-mono font-bold text-white">@{w.username}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${w.is_active ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-rose-500/15 text-rose-400 border-rose-500/30'}`}>
                          {w.is_active ? 'ACTIVE' : 'BLOCKED'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-300">{w.bills_count || 0}</td>
                      <td className="px-4 py-3 text-slate-400">{new Date(w.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button type="button" disabled={workerActionLoading === w.id} onClick={() => handleToggleBlockWorker(w)} className="px-3 py-1 rounded-lg text-xs font-semibold bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30">
                            {w.is_active ? 'Block' : 'Unblock'}
                          </button>
                          <button type="button" disabled={workerActionLoading === w.id} onClick={() => handleDeleteWorker(w)} className="px-3 py-1 rounded-lg text-xs font-semibold bg-rose-500/15 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30">
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 5: BOM & MASTERS */}
        {activeTab === 'masters' && (
          <div className="space-y-6">
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Layers className="w-5 h-5 text-indigo-400" />
                BOM Conversion Rules & Product Catalog
              </h2>
              <p className="text-xs text-slate-400">
                Configured frame perimeter formulas and metal weight conversions enforced across client and server.
              </p>
            </div>

            {/* Add New Product Master Form */}
            <form onSubmit={handleCreateMasterProduct} className="p-4 sm:p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-3 shadow-sm">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-indigo-400" />
                Add New Product to Catalog
              </h3>
              <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Product / Item Name *</label>
                  <input
                    type="text"
                    required
                    value={newMasterProductName}
                    onChange={(e) => setNewMasterProductName(e.target.value)}
                    placeholder="Enter any product name (e.g. Copper Door, Iron Window, Grill, Paint, etc.)"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={creatingMasterProduct}
                  className="sm:w-auto py-2.5 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-xs shadow transition"
                >
                  {creatingMasterProduct ? 'Adding...' : '+ Add Product to Catalog'}
                </button>
              </div>
            </form>

            {/* Products Table */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Active Products & Formulas</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {products.map((p, pIdx) => (
                  <div key={p.id ? `${p.id}-${pIdx}` : `product-${pIdx}`} className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between">
                        <h4 className="font-bold text-white text-base">{p.name}</h4>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono">
                          {p.frame_formula_type}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-2">
                        {p.frame_formula_type === 'DOOR_2L_PLUS_B'
                          ? 'Perimeter Formula: Feet = (2 × L) + B'
                          : p.frame_formula_type === 'WINDOW_2_L_PLUS_B'
                          ? 'Perimeter Formula: Feet = 2 × (L + B)'
                          : 'Custom calculation formula'}
                      </p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-slate-800/80 text-[11px] text-slate-500 flex items-center justify-between">
                      <span>Status: <strong className="text-emerald-400">Active Master</strong></span>
                      <span className="font-mono">{p.id.slice(0, 8)}...</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Configured Material Variants */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Material Variants & BOM Rules</h3>
              <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900 shadow-sm">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-950/80 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
                    <tr>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3">Variant Name</th>
                      <th className="px-4 py-3">Base Unit</th>
                      <th className="px-4 py-3 text-right">BOM Weight / Foot (g/ft)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {inventory.map((v, vIdx) => {
                      const vid = v.id || v.material_variant_id || `variant-${vIdx}`;
                      const currentBom = parseFloat(v.bom_weight_per_foot_grams?.toString() || '0');
                      const editVal = bomEdits[vid] !== undefined ? bomEdits[vid] : String(currentBom);
                      const isModified = bomEdits[vid] !== undefined && parseFloat(bomEdits[vid]) !== currentBom;

                      return (
                        <tr key={`${vid}-${vIdx}`} className="hover:bg-slate-800/30 transition">
                          <td className="px-4 py-2.5 font-sans font-bold text-slate-300">
                            {v.category}
                          </td>
                          <td className="px-4 py-2.5 font-sans font-medium text-white">
                            {v.material_name}
                          </td>
                          <td className="px-4 py-2.5 text-slate-400">
                            {v.base_unit}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <div className="inline-flex items-center justify-end gap-2">
                              <input
                                type="number"
                                step="any"
                                min="0"
                                value={editVal}
                                onChange={(e) =>
                                  setBomEdits((prev) => ({
                                    ...prev,
                                    [vid]: e.target.value,
                                  }))
                                }
                                className="w-28 bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-lg px-2.5 py-1 text-right text-xs font-bold text-emerald-400 focus:outline-none"
                              />
                              <span className="text-[11px] text-slate-400">g/ft</span>
                              <button
                                type="button"
                                onClick={() => handleSaveBomWeight(vid, currentBom)}
                                disabled={savingBomId === vid}
                                className={`px-2.5 py-1 rounded-lg font-sans font-bold text-[11px] transition ${
                                  isModified
                                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow'
                                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                                }`}
                              >
                                {savingBomId === vid ? 'Saving...' : 'Save'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ==================================================================== */}
      {/* BILL APPROVAL & REVIEW MODAL                                         */}
      {/* ==================================================================== */}
      {showApprovalModal && selectedBill && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto bg-slate-900 border-t sm:border border-slate-800 rounded-t-2xl sm:rounded-2xl p-4 sm:p-6 shadow-2xl space-y-4 sm:space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  Review Bill — #{selectedBill.bill_number}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Review production consumption and confirm approval or rejection.
                </p>
              </div>
              <button
                onClick={() => setShowApprovalModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            {/* Bill summary overview */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80 text-xs">
              <div>
                <span className="text-slate-500 uppercase text-[10px]">Product</span>
                <p className="font-semibold text-white">{selectedBill.product_name}</p>
              </div>
              <div>
                <span className="text-slate-500 uppercase text-[10px]">Customer</span>
                <p className="font-semibold text-white">{selectedBill.customer_name}</p>
              </div>
              <div>
                <span className="text-slate-500 uppercase text-[10px]">Worker</span>
                <p className="font-semibold text-white">@{selectedBill.worker_username}</p>
              </div>
              <div>
                <span className="text-slate-500 uppercase text-[10px]">Final Bill Total</span>
                <p className="font-bold text-emerald-400 font-mono text-sm">
                  ₹{parseFloat(selectedBill.final_total_inr?.toString() || '0').toFixed(2)}
                </p>
              </div>
            </div>

            {/* Consumed line items table */}
            <div className="space-y-1.5">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Materials to Consume
              </span>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/40">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-900 text-slate-400 text-[10px] uppercase border-b border-slate-800">
                    <tr>
                      <th className="px-3 py-2">Material</th>
                      <th className="px-3 py-2">Dimensions</th>
                      <th className="px-3 py-2 text-right">Feet</th>
                      <th className="px-3 py-2 text-right">Quantity</th>
                      <th className="px-3 py-2 text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50 font-mono text-[11px]">
                    {selectedBill.items?.map((item, itmIdx) => (
                      <tr key={item.id ? `${item.id}-${itmIdx}` : `modal-item-${itmIdx}`}>
                        <td className="px-3 py-1.5 font-sans font-medium text-slate-200">
                          {item.material_name}
                        </td>
                        <td className="px-3 py-1.5 text-slate-400">
                          {item.input_length && item.input_breadth ? `${item.input_length}' × ${item.input_breadth}'` : '-'}
                        </td>
                        <td className="px-3 py-1.5 text-right text-slate-300">
                          {item.calculated_feet ? `${item.calculated_feet} ft` : '-'}
                        </td>
                        <td className="px-3 py-1.5 text-right font-bold text-emerald-400">
                          {item.unit === 'GRAM' ? `${(item.actual_quantity_consumed / 1000).toFixed(2)} kg` : `${item.actual_quantity_consumed} ${item.unit}`}
                        </td>
                        <td className="px-3 py-1.5 text-right text-slate-300">
                          ₹{parseFloat(item.line_cost_inr?.toString() || '0').toFixed(0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Command Input Area */}
            <div className="space-y-3 pt-2 border-t border-slate-800">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Confirmation Action <span className="text-slate-500 font-normal">(Type Approve or reject)</span>
                </label>
                <input
                  type="text"
                  autoFocus
                  value={commandInput}
                  onChange={(e) => setCommandInput(e.target.value)}
                  placeholder="Enter Approve or reject"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white font-mono placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Dynamic Action Visuals */}
              {isApprove && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-400 flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div>
                    <strong className="block font-semibold">Bill Approval:</strong>
                    Consumes material stock from ERP inventory ledger and marks bill as Approved.
                  </div>
                </div>
              )}

              {isReject && (
                <div className="space-y-2">
                  <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-400 flex items-start gap-2">
                    <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <strong className="block font-semibold">Bill Rejection:</strong>
                      No inventory deducted. Rejection reason will remain visible on worker portal for strictly 24 hours.
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Reason for Rejection <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                      placeholder="e.g. Incorrect dimensions, out of stock, revised pricing needed"
                      className="w-full bg-slate-950 border border-rose-500/50 rounded-xl px-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-400"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Quick Mode Select Buttons */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-[11px] text-slate-400 mr-1">Quick Fill Mode:</span>
              <button
                type="button"
                onClick={() => setCommandInput('Approve')}
                className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-xs font-mono"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => setCommandInput('reject')}
                className="px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-xs font-mono"
              >
                Reject Bill
              </button>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowApprovalModal(false)}
                disabled={processingDecision}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs transition"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleExecuteDecision}
                disabled={!isValidCommand || processingDecision || (isReject && !rejectionReason.trim())}
                className={`px-5 py-2 rounded-xl font-bold text-xs tracking-wide transition shadow-lg flex items-center gap-1.5 ${
                  !isValidCommand
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    : isReject
                    ? 'bg-rose-600 hover:bg-rose-500 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                {processingDecision ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Processing...
                  </>
                ) : isReject ? (
                  'Confirm Rejection'
                ) : (
                  'Confirm Approval'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* ADD STOCK MODAL (with Purchase Scrap split)                           */}
      {/* ==================================================================== */}
      {showAddStockModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto bg-slate-900 border-t sm:border border-slate-800 rounded-t-2xl sm:rounded-2xl p-4 sm:p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Box className="w-5 h-5 text-emerald-400" />
                  Add Inventory &amp; Total Investment
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Add new product stock and investment to ERP inventory.
                </p>
              </div>
              <button
                onClick={() => setShowAddStockModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddStock} className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold text-slate-300">1. Product Name *</label>
                <button
                  type="button"
                  onClick={() => setStockUseNewProduct(!stockUseNewProduct)}
                  className="text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 underline"
                >
                  {stockUseNewProduct ? 'Select Existing Product' : '+ Enter New Product Name'}
                </button>
              </div>

              {stockUseNewProduct ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <input type="text" required value={stockProductName} onChange={(e) => setStockProductName(e.target.value)} placeholder="e.g. Galvanized Steel Sheet / MS Pipe" className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500" />
                  </div>
                  <select value={stockCategory} onChange={(e) => setStockCategory(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white">
                    <option value="COIL">COIL</option>
                    <option value="PIPE">PIPE</option>
                    <option value="HINGES">HINGES</option>
                    <option value="PAINT">PAINT</option>
                    <option value="OTHER">OTHER</option>
                  </select>
                </div>
              ) : (
                <select value={stockVariantId} onChange={(e) => setStockVariantId(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500">
                  {inventory.map((v, vIdx) => {
                    const vid = v.id || v.material_variant_id;
                    return (
                      <option key={`select-stock-${vid}-${vIdx}`} value={vid}>
                        {v.material_name} ({v.category} — {v.display_unit || v.base_unit})
                      </option>
                    );
                  })}
                </select>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">2. Measurement Unit *</label>
                  <select value={stockMeasurementUnit} onChange={(e) => setStockMeasurementUnit(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono">
                    <option value="kg">kg (Kilograms)</option>
                    <option value="ft">ft (Running Feet)</option>
                    <option value="pcs">pcs (Pieces)</option>
                    <option value="gram">gram (Grams)</option>
                    <option value="litre">litre (Litres)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">3. Quantity *</label>
                  <input type="number" step="any" required value={stockPurchasedQty} onChange={(e) => setStockPurchasedQty(e.target.value)} placeholder={`e.g. 50 (${stockMeasurementUnit})`} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-emerald-400 mb-1">4. Total Investment (₹) *</label>
                  <input type="number" step="any" required value={stockTotalInvestment} onChange={(e) => setStockTotalInvestment(e.target.value)} placeholder="e.g. 15000" className="w-full bg-slate-950 border border-emerald-500/50 rounded-xl px-3 py-2 text-xs text-emerald-300 font-bold font-mono" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Supplier</label>
                  <input type="text" value={stockSupplier} onChange={(e) => setStockSupplier(e.target.value)} placeholder="Vendor name" className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Invoice #</label>
                  <input type="text" value={stockInvoice} onChange={(e) => setStockInvoice(e.target.value)} placeholder="Inv-1029" className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Notes</label>
                <input
                  type="text"
                  value={stockNotes}
                  onChange={(e) => setStockNotes(e.target.value)}
                  placeholder="Optional delivery details..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddStockModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingStock}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs tracking-wide transition shadow flex items-center gap-1.5"
                >
                  {savingStock ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Record Receipt'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* SCRAP SALE MODAL                                                     */}
      {/* ==================================================================== */}
      {showScrapSaleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-amber-400" />
                  Record Floor Scrap Cash Sale
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Logs cash revenue from workshop scrap disposal.
                </p>
              </div>
              <button
                onClick={() => setShowScrapSaleModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleRecordScrapSale} className="space-y-4">
              {scrapSaleEntryId ? (
                <div className="p-3 rounded-xl bg-slate-950 border border-amber-500/30 text-xs">
                  <span className="text-slate-400 block text-[10px] uppercase">Selling Scrap Batch</span>
                  <span className="font-bold text-white text-sm">{scrapSaleItemLabel}</span>
                  <span className="block text-amber-400 font-mono mt-0.5">
                    Available in this batch: {scrapSaleMaxQty.toFixed(2)} {scrapSaleUnit}
                  </span>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Select Unsold Scrap Material</label>
                  <select
                    value={scrapSaleVariantId}
                    onChange={(e) => {
                      const vid = e.target.value;
                      setScrapSaleVariantId(vid);
                      const found = scrapSummary.find((s) => s.material_variant_id === vid);
                      if (found) {
                        setScrapSaleUnit(found.unit || 'KG');
                        setScrapSaleMaxQty(found.unsold_scrap);
                        setScrapSaleQtyKg(String(found.unsold_scrap));
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  >
                    {scrapSummary
                      .filter((s) => s.unsold_scrap > 0)
                      .map((s, sIdx) => (
                        <option key={`select-scrap-${s.material_variant_id}-${sIdx}`} value={s.material_variant_id}>
                          {s.material_name} ({s.category}) — Available: {s.unsold_scrap.toFixed(2)} {s.unit}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Quantity Sold ({scrapSaleUnit}) <span className="text-amber-400">*</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    max={scrapSaleMaxQty > 0 ? scrapSaleMaxQty : undefined}
                    required
                    value={scrapSaleQtyKg}
                    onChange={(e) => setScrapSaleQtyKg(e.target.value)}
                    placeholder="e.g. 25.5"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Sold Amount (₹) <span className="text-emerald-400">*</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={scrapSaleAmountInr}
                    onChange={(e) => setScrapSaleAmountInr(e.target.value)}
                    placeholder="e.g. 5100"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-emerald-300 font-bold focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Notes / Buyer (Optional)</label>
                <input
                  type="text"
                  value={scrapSaleNotes}
                  onChange={(e) => setScrapSaleNotes(e.target.value)}
                  placeholder="e.g. Sold to scrap dealer"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <p className="text-[11px] text-slate-400 bg-slate-950/70 p-2.5 rounded-lg border border-slate-800">
                Note: This scrap sale and ₹ amount will be recorded in the ERP scrap ledger.
              </p>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowScrapSaleModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingScrapSale}
                  className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs tracking-wide transition shadow flex items-center gap-1.5"
                >
                  {savingScrapSale ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Logging...
                    </>
                  ) : (
                    'Record Cash Sale'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* BILL INSPECT DRAWER / MODAL                                          */}
      {/* ==================================================================== */}
      {showInspectModal && inspectBill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <FileText className="w-5 h-5 text-cyan-400" />
                  Bill #{inspectBill.bill_number} Details
                </h3>
                <p className="text-xs text-slate-400">
                  {inspectBill.product_name} • Customer: {inspectBill.customer_name}
                </p>
              </div>
              <button
                onClick={() => setShowInspectModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs">
              <div>
                <span className="text-slate-500 text-[10px] uppercase">Selling Price</span>
                <p className="font-bold text-white font-mono">
                  ₹{parseFloat(inspectBill.selling_price_inr?.toString() || '0').toFixed(2)}
                </p>
              </div>
              <div>
                <span className="text-slate-500 text-[10px] uppercase">GST ({inspectBill.gst_rate || 18}%)</span>
                <p className="font-bold text-slate-300 font-mono">
                  ₹{parseFloat(inspectBill.gst_amount_inr?.toString() || '0').toFixed(2)}
                </p>
              </div>
              <div>
                <span className="text-slate-500 text-[10px] uppercase">Final Total</span>
                <p className="font-bold text-emerald-400 font-mono">
                  ₹{parseFloat(inspectBill.final_total_inr?.toString() || '0').toFixed(2)}
                </p>
              </div>
              <div>
                <span className="text-slate-500 text-[10px] uppercase">Status</span>
                <p className="font-bold text-white uppercase">{inspectBill.status}</p>
                {inspectBill.decided_by_username && (
                  <p className="text-[11px] text-emerald-400 font-mono mt-0.5">
                    by @{inspectBill.decided_by_username}
                  </p>
                )}
              </div>
            </div>

            {inspectBill.rejection_reason && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400">
                <strong>Rejection Reason:</strong> {inspectBill.rejection_reason}
              </div>
            )}

            <div className="space-y-1.5">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Line Items</span>
              <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/40">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-900 text-slate-400 text-[10px] uppercase border-b border-slate-800">
                    <tr>
                      <th className="px-3 py-2">Material</th>
                      <th className="px-3 py-2">Dimensions</th>
                      <th className="px-3 py-2 text-right">Running Feet</th>
                      <th className="px-3 py-2 text-right">Quantity</th>
                      <th className="px-3 py-2 text-right">Line Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50 font-mono text-[11px]">
                    {inspectBill.items?.map((item, insIdx) => (
                      <tr key={item.id ? `${item.id}-${insIdx}` : `inspect-item-${insIdx}`}>
                        <td className="px-3 py-2 font-sans font-medium text-slate-200">
                          {item.material_name}
                        </td>
                        <td className="px-3 py-2 text-slate-400">
                          {item.input_length && item.input_breadth ? `${item.input_length}' × ${item.input_breadth}'` : '-'}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-300">
                          {item.calculated_feet ? `${item.calculated_feet} ft` : '-'}
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-emerald-400">
                          {item.unit === 'GRAM' ? `${(item.actual_quantity_consumed / 1000).toFixed(2)} kg` : `${item.actual_quantity_consumed} ${item.unit}`}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-300">
                          ₹{parseFloat(item.line_cost_inr?.toString() || '0').toFixed(0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => openAndPrintTaxInvoice(inspectBill, 'Original Copy')}
                  className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow transition"
                >
                  <Printer className="w-4 h-4" />
                  Download / Print (Original Copy)
                </button>
                <button
                  onClick={() => openAndPrintTaxInvoice(inspectBill, 'Duplicate Copy')}
                  className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 shadow transition"
                >
                  <Printer className="w-4 h-4" />
                  Download / Print (Duplicate Copy)
                </button>
              </div>
              <button
                onClick={() => setShowInspectModal(false)}
                className="w-full sm:w-auto px-4 py-2.5 sm:py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Navigation Bar */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-slate-900/95 backdrop-blur border-t border-slate-800 pb-safe">
        <div className="grid grid-cols-6 gap-0.5 p-1">
          <button
            type="button"
            onClick={() => setActiveTab('queue')}
            className={`flex flex-col items-center justify-center py-1.5 rounded-lg text-[10px] font-semibold transition relative ${
              activeTab === 'queue' ? 'bg-emerald-500/15 text-emerald-400' : 'text-slate-400'
            }`}
          >
            <Clock className="w-4 h-4 mb-0.5" />
            <span>Queue</span>
            {pendingBills.length > 0 && (
              <span className="absolute top-1 right-2 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('inventory')}
            className={`flex flex-col items-center justify-center py-1.5 rounded-lg text-[10px] font-semibold transition ${
              activeTab === 'inventory' ? 'bg-emerald-500/15 text-emerald-400' : 'text-slate-400'
            }`}
          >
            <Box className="w-4 h-4 mb-0.5" />
            <span>Stock</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`flex flex-col items-center justify-center py-1.5 rounded-lg text-[10px] font-semibold transition ${
              activeTab === 'history' ? 'bg-emerald-500/15 text-emerald-400' : 'text-slate-400'
            }`}
          >
            <FileText className="w-4 h-4 mb-0.5" />
            <span>Bills</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('scrap')}
            className={`flex flex-col items-center justify-center py-1.5 rounded-lg text-[10px] font-semibold transition ${
              activeTab === 'scrap' ? 'bg-emerald-500/15 text-emerald-400' : 'text-slate-400'
            }`}
          >
            <TrendingUp className="w-4 h-4 mb-0.5" />
            <span>Scrap</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('workers')}
            className={`flex flex-col items-center justify-center py-1.5 rounded-lg text-[10px] font-semibold transition ${
              activeTab === 'workers' ? 'bg-emerald-500/15 text-emerald-400' : 'text-slate-400'
            }`}
          >
            <UserCheck className="w-4 h-4 mb-0.5" />
            <span>Workers</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('masters')}
            className={`flex flex-col items-center justify-center py-1.5 rounded-lg text-[10px] font-semibold transition ${
              activeTab === 'masters' ? 'bg-emerald-500/15 text-emerald-400' : 'text-slate-400'
            }`}
          >
            <Layers className="w-4 h-4 mb-0.5" />
            <span>BOM</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
