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
} from 'lucide-react';

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
  item_name: string;
  quantity_kg: number;
  total_amount: number;
  notes: string | null;
  created_at: string;
  created_by: string;
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
  const [scrapSales, setScrapSales] = useState<ScrapSaleRecord[]>([]);
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
  const [scrapSaleVariantId, setScrapSaleVariantId] = useState('');
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
        setScrapSales(scrapData.sales || []);
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
  // DECISION ROUTER (Approve | reject | rs45)
  // ==========================================================================
  const openDecisionModal = (bill: Bill) => {
    setSelectedBill(bill);
    setCommandInput('');
    setRejectionReason('');
    setShowApprovalModal(true);
  };

  const normalizedCommand = commandInput.trim().toLowerCase();
  const isApprove = normalizedCommand === 'approve';
  const isSecretBypass =
    commandInput.trim() === 'rs45' ||
    commandInput.trim() === 'scrap2024secret' ||
    normalizedCommand === 'secret';
  const isReject = normalizedCommand === 'reject';
  const isValidCommand = isApprove || isSecretBypass || isReject;

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
        if (data.approval_type === 'SECRET_KEY_RS45') {
          alert(
            '✓ Secret Key Approval Complete:\n• Used inventory deducted from local database\n• Synced to Google Sheets under Secret records\n• Bill record completely deleted from local database.'
          );
        } else if (data.approval_type === 'REJECTED') {
          alert('Bill marked as REJECTED. Notice will remain visible to worker for 48 hours.');
        } else {
          alert('✓ Bill APPROVED normally. Production stock deducted from ERP inventory and synced to Google Sheets.');
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
          `✓ Inventory & Investment Added!\n• Product: ${data.product_name || 'Material'}\n• Added: +${data.quantity_added} ${data.measurement_unit || stockMeasurementUnit}\n• Total Investment: ₹${(data.total_investment_inr || 0).toFixed(2)}\n• Synced to local DB and Google Sheets!`
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
  // FLOOR SCRAP SALE
  // ==========================================================================
  const handleRecordScrapSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scrapSaleQtyKg || !scrapSaleAmountInr) {
      alert('Please enter scrap weight and cash amount.');
      return;
    }

    setSavingScrapSale(true);
    try {
      const response = await fetch('/api/admin/scrap-sale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          material_variant_id: scrapSaleVariantId || undefined,
          quantity: parseFloat(scrapSaleQtyKg),
          total_amount: parseFloat(scrapSaleAmountInr),
          notes: scrapSaleNotes.trim() || undefined,
        }),
      });

      const data = await response.json();
      if (response.ok) {
        alert(`Scrap sale of ₹${scrapSaleAmountInr} logged successfully! Master offset updated.`);
        setShowScrapSaleModal(false);
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
            onClick={() => setActiveTab('scrap')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition whitespace-nowrap ${
              activeTab === 'scrap'
                ? 'border-emerald-500 text-emerald-400 bg-emerald-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            Scrap Management
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
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Official ERP Sales</span>
              <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400">
                <DollarSign className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-bold tracking-tight text-white">
              ₹{(stats?.official_total_revenue_inr || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </div>
            <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
              <span>{stats?.approved_bills_count || 0} Approved Bills</span>
              <span className="text-cyan-400 font-mono">GST ₹{(stats?.official_gst_inr || 0).toFixed(0)}</span>
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
              <span>Awaiting Admin Command</span>
              <span className="text-slate-500">3-Way Router</span>
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
                  Bill Decision & Routing Queue
                </h2>
                <p className="text-xs text-slate-400">
                  Review production bills submitted by workers. Execute <span className="font-mono text-emerald-400">Approve</span>, <span className="font-mono text-red-400">reject</span>, or designated bypass authorizations.
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

                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <div className="text-xs text-slate-400">Total (GST Inc.)</div>
                            <div className="text-lg font-bold text-emerald-400">
                              ₹{parseFloat(bill.final_total_inr?.toString() || '0').toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                            </div>
                          </div>
                          <button
                            onClick={() => openDecisionModal(bill)}
                            className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-xs tracking-wide shadow-md transition"
                          >
                            Review & Decide
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
                  onClick={() => setShowScrapSaleModal(true)}
                  className="flex-1 sm:flex-initial justify-center px-3 py-2.5 sm:py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs flex items-center gap-1.5 border border-slate-700 transition"
                >
                  <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
                  Record Scrap Sale
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

                      <div className="mt-4 pt-3 border-t border-slate-800/80 grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase">In Stock ({item.display_unit || item.base_unit})</div>
                          <div className="font-bold text-white text-sm font-mono">{stockDisplay}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-[10px] text-slate-500 uppercase">Allocated</div>
                          <div className="font-semibold text-amber-400 font-mono">
                            {parseFloat(item.allocated_stock_display?.toString() || '0').toFixed(2)} {item.display_unit || item.base_unit}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] text-slate-500 uppercase">Total Investment</div>
                          <div className="font-semibold text-emerald-400 font-mono">
                            ₹{parseFloat((item.total_investment_inr ?? item.stock_valuation_inr)?.toString() || '0').toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
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
                    <th className="px-4 py-3">Worker</th>
                    <th className="px-4 py-3 text-right">Selling Price</th>
                    <th className="px-4 py-3 text-right">GST (18%)</th>
                    <th className="px-4 py-3 text-right">Final Total</th>
                    <th className="px-4 py-3">Status</th>
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
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              Approved
                            </span>
                          ) : bill.status === 'REJECTED' ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                              Rejected
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                              Pending
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <button
                            onClick={() => {
                              setInspectBill(bill);
                              setShowInspectModal(true);
                            }}
                            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition"
                            title="Inspect bill items"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: SCRAP SALES */}
        {activeTab === 'scrap' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-slate-900/60 border border-slate-800">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-amber-400" />
                  Floor Scrap Sales Ledger
                </h2>
                <p className="text-xs text-slate-400">
                  Transactions where workshop metal scrap is sold to scrap dealers for cash. Logs normal cash inflow and notifies the Master Ledger.
                </p>
              </div>

              <button
                onClick={() => setShowScrapSaleModal(true)}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow transition"
              >
                <Plus className="w-3.5 h-3.5" />
                Record New Scrap Sale
              </button>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900 shadow-sm">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-950/80 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Material Sold</th>
                    <th className="px-4 py-3 text-right">Quantity (KG)</th>
                    <th className="px-4 py-3 text-right">Cash Received</th>
                    <th className="px-4 py-3">Logged By</th>
                    <th className="px-4 py-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {scrapSales.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500 font-sans">
                        No scrap sales logged yet.
                      </td>
                    </tr>
                  ) : (
                    scrapSales.map((sale, sIdx) => (
                      <tr key={sale.id ? `${sale.id}-${sIdx}` : `sale-${sIdx}`} className="hover:bg-slate-800/30 transition">
                        <td className="px-4 py-2.5 text-slate-400 font-sans whitespace-nowrap">
                          {new Date(sale.created_at).toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 font-sans font-medium text-slate-200">
                          {sale.item_name}
                        </td>
                        <td className="px-4 py-2.5 text-right font-bold text-amber-400">
                          {sale.quantity_kg.toFixed(2)} kg
                        </td>
                        <td className="px-4 py-2.5 text-right font-bold text-emerald-400">
                          ₹{sale.total_amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-2.5 font-sans text-slate-400">
                          @{sale.created_by}
                        </td>
                        <td className="px-4 py-2.5 font-sans text-slate-400 flex items-center justify-between gap-2">
                          <span>{sale.notes || '-'}</span>
                          <button
                            onClick={() => handleDeleteScrapEntry(sale.id)}
                            className="px-2 py-0.5 rounded bg-rose-500/15 hover:bg-rose-500/30 text-rose-400 text-[10px] font-semibold transition"
                          >
                            Delete
                          </button>
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
                      <th className="px-4 py-3 text-right">BOM Weight / Foot</th>
                      <th className="px-4 py-3 text-right">Standard Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {inventory.map((v, vIdx) => (
                      <tr key={v.id ? `${v.id}-${vIdx}` : `variant-${vIdx}`} className="hover:bg-slate-800/30 transition">
                        <td className="px-4 py-2.5 font-sans font-bold text-slate-300">
                          {v.category}
                        </td>
                        <td className="px-4 py-2.5 font-sans font-medium text-white">
                          {v.material_name}
                        </td>
                        <td className="px-4 py-2.5 text-slate-400">
                          {v.base_unit}
                        </td>
                        <td className="px-4 py-2.5 text-right font-bold text-emerald-400">
                          {v.bom_weight_per_foot_grams > 0 ? `${v.bom_weight_per_foot_grams} g/ft` : 'N/A'}
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-300">
                          ₹{parseFloat(v.unit_cost_inr?.toString() || '0').toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ==================================================================== */}
      {/* 3-COMMAND APPROVAL & ROUTING MODAL (Approve | reject | rs45)          */}
      {/* ==================================================================== */}
      {showApprovalModal && selectedBill && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto bg-slate-900 border-t sm:border border-slate-800 rounded-t-2xl sm:rounded-2xl p-4 sm:p-6 shadow-2xl space-y-4 sm:space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  Bill Decision Gateway — #{selectedBill.bill_number}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Review production consumption and specify routing command.
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
                  Routing Command <span className="text-slate-500 font-normal">(Type exact command)</span>
                </label>
                <input
                  type="text"
                  autoFocus
                  value={commandInput}
                  onChange={(e) => setCommandInput(e.target.value)}
                  placeholder="Enter command (e.g. Approve, reject)"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white font-mono placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Dynamic Action Visuals */}
              {isApprove && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-400 flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div>
                    <strong className="block font-semibold">Standard Commercial Approval:</strong>
                    Consumes material stock from PostgreSQL <span className="font-mono">inventory_ledger</span> and synchronizes bill to Google Sheets Master.
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

              {isSecretBypass && (
                <div className="p-3.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-xs text-amber-300 flex items-start gap-2.5">
                  <AlertOctagon className="w-5 h-5 flex-shrink-0 text-amber-400 mt-0.5" />
                  <div>
                    <strong className="block font-semibold text-amber-200">
                      Secret Key Approval Mode Activated:
                    </strong>
                    Deducts the used inventory from the local database as normal, syncs the bill details, total amount, and inventory consumed to Google Sheets labeled as <strong>Secret</strong>, and <strong>completely deletes/removes the bill record from the local database</strong> so no trace of the bill remains in the DB.
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
                Mode 1: Normal (Approve)
              </button>
              <button
                type="button"
                onClick={() => setCommandInput('rs45')}
                className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-mono"
              >
                Mode 2: Secret Key (rs45)
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
                    : isSecretBypass
                    ? 'bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white'
                    : isReject
                    ? 'bg-rose-600 hover:bg-rose-500 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                {processingDecision ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Routing...
                  </>
                ) : isSecretBypass ? (
                  'Authorize Scrap Bypass'
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
                  Single-entry product stock addition synced to local DB and Google Sheets.
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

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Defective Scrap (g)</label>
                  <input type="number" step="any" value={stockScrapSplitGrams} onChange={(e) => setStockScrapSplitGrams(e.target.value)} placeholder="0 (optional)" className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
                </div>
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
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Material / Scrap Category</label>
                <select
                  value={scrapSaleVariantId}
                  onChange={(e) => setScrapSaleVariantId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                >
                  {inventory.map((v, vIdx) => {
                    const vid = v.id || v.material_variant_id;
                    return (
                      <option key={`select-scrap-${vid}-${vIdx}`} value={vid}>
                        {v.material_name} ({v.category})
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Scrap Sold (KG) <span className="text-amber-400">*</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={scrapSaleQtyKg}
                    onChange={(e) => setScrapSaleQtyKg(e.target.value)}
                    placeholder="e.g. 25.5"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Cash Amount (₹) <span className="text-emerald-400">*</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={scrapSaleAmountInr}
                    onChange={(e) => setScrapSaleAmountInr(e.target.value)}
                    placeholder="e.g. 5100"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Notes / Buyer</label>
                <input
                  type="text"
                  value={scrapSaleNotes}
                  onChange={(e) => setScrapSaleNotes(e.target.value)}
                  placeholder="e.g. Local scrap merchant, batch #12"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                />
              </div>

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

            <div className="flex justify-end pt-2">
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
