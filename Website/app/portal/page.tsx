'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Package,
  LogOut,
  Plus,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  FileText,
  Calculator,
  Trash2,
  Layers,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';
import { calculateRunningFeet, calculateGst, FrameFormulaType } from '@/lib/calculations';

interface Product {
  id: string;
  name: string;
  frame_formula_type: FrameFormulaType;
  description: string | null;
}

interface MaterialVariant {
  id: string;
  category: 'COIL' | 'PIPE' | 'HINGES' | 'PAINT' | 'OTHER';
  name: string;
  base_unit: string;
  bom_weight_per_foot_grams: number;
  unit_cost_inr: number;
  current_stock: number;
}

interface MaterialLineState {
  productId: string;
  materialVariantId: string;
  pieceCount: string;
  inputLength: string;
  inputBreadth: string;
  inputWeightKg: string;
  quantityConsumed: string;
  itemPrice: string;
}

interface BillItem {
  id: string;
  material_name: string;
  category: string;
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
  customer_name: string;
  production_cost_inr: number;
  selling_price_inr: number;
  gst_rate: number;
  gst_amount_inr: number;
  final_total_inr: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejection_reason: string | null;
  decided_at: string | null;
  created_at: string;
  items?: BillItem[];
}

export default function WorkerPortalPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'generate'>('dashboard');
  const [workerUsername, setWorkerUsername] = useState('Worker');
  const [products, setProducts] = useState<Product[]>([]);
  const [variants, setVariants] = useState<MaterialVariant[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);

  // Form states for Bill Generation
  const [selectedProductId, setSelectedProductId] = useState('');
  const [showNewProductBox, setShowNewProductBox] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [newProductFormula, setNewProductFormula] = useState<FrameFormulaType>('DOOR_2L_PLUS_B');
  const [savingNewProduct, setSavingNewProduct] = useState(false);

  const [customerName, setCustomerName] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [gstRate, setGstRate] = useState('0');
  const [materialLines, setMaterialLines] = useState<MaterialLineState[]>([
    { productId: '', materialVariantId: '', pieceCount: '1', inputLength: '7', inputBreadth: '3', inputWeightKg: '', quantityConsumed: '', itemPrice: '' },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    checkAuth();
    loadCatalog();
    loadBills();
  }, []);

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) {
        router.push('/login');
        return;
      }
      const data = await res.json();
      if (data.user.role === 'ADMIN') {
        router.push('/admin');
        return;
      }
      setWorkerUsername(data.user.username);
    } catch (_) {
      router.push('/login');
    }
  };

  const loadCatalog = async () => {
    try {
      const res = await fetch('/api/products');
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products || []);
        setVariants(data.variants || []);
        if (data.products && data.products.length > 0) {
          setSelectedProductId(data.products[0].id);
        }
      }
    } catch (e) {
      console.error('Catalog load error:', e);
    }
  };

  const loadBills = async () => {
    try {
      const res = await fetch('/api/bills');
      if (res.ok) {
        const data = await res.json();
        const cutoff = Date.now() - 48 * 60 * 60 * 1000;
        const recentBills = (data.bills || []).filter((b: Bill) => {
          const createdTs = new Date(b.created_at).getTime();
          return isNaN(createdTs) || createdTs >= cutoff;
        });
        setBills(recentBills);
      }
    } catch (e) {
      console.error('Bills load error:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  // Material Line Helpers
  const addMaterialLine = () => {
    setMaterialLines([
      ...materialLines,
      {
        productId: selectedProductId !== 'OTHER' ? selectedProductId : '',
        materialVariantId: '',
        pieceCount: '1',
        inputLength: '7',
        inputBreadth: '3',
        inputWeightKg: '',
        quantityConsumed: '',
        itemPrice: '',
      },
    ]);
  };

  const removeMaterialLine = (index: number) => {
    if (materialLines.length === 1) return;
    setMaterialLines(materialLines.filter((_, i) => i !== index));
  };

  const updateMaterialLine = (index: number, field: keyof MaterialLineState, value: string) => {
    const updated = [...materialLines];
    updated[index] = { ...updated[index], [field]: value };

    // If user selected "OTHER" in a row's productId, open the inline new product creator
    if (field === 'productId' && value === 'OTHER') {
      setShowNewProductBox(true);
    }

    // If user selected a discrete material (PAINT / HINGES), auto-set productId to 'DIRECT'
    if (field === 'materialVariantId') {
      const chosenV = variants.find((v) => v.id === value);
      if (chosenV && (chosenV.category === 'PAINT' || chosenV.category === 'HINGES')) {
        updated[index].productId = 'DIRECT';
      } else if (chosenV && (!updated[index].productId || updated[index].productId === 'DIRECT')) {
        updated[index].productId = products[0]?.id || '';
      }
    }

    setMaterialLines(updated);
  };

  const handleAddNewProduct = async () => {
    if (!newProductName.trim()) {
      setFormError('Please enter a name for the new product');
      return;
    }
    setSavingNewProduct(true);
    setFormError('');
    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newProductName.trim(),
          frame_formula_type: newProductFormula,
        }),
      });
      const data = await res.json();
      if (res.ok && data.product) {
        const updatedProducts = [...products.filter((p) => p.id !== data.product.id), data.product];
        setProducts(updatedProducts);
        setSelectedProductId(data.product.id);
        // Assign new product to any line that had 'OTHER' selected
        setMaterialLines((prev) =>
          prev.map((l, idx) =>
            l.productId === 'OTHER' || (idx === prev.length - 1 && !l.productId)
              ? { ...l, productId: data.product.id }
              : l
          )
        );
        setShowNewProductBox(false);
        setNewProductName('');
      } else {
        setFormError(data.error || 'Failed to add product');
      }
    } catch {
      setFormError('Network error while adding product');
    } finally {
      setSavingNewProduct(false);
    }
  };

  const selectedProduct = products.find((p) => p.id === selectedProductId);
  const formulaType: FrameFormulaType =
    selectedProductId === 'OTHER'
      ? newProductFormula
      : selectedProduct
      ? selectedProduct.frame_formula_type
      : 'DOOR_2L_PLUS_B';

  // Live Calculations for Preview (supports per-line product formula & individual item prices)
  let totalMetalWeightKg = 0;
  let totalRunningFeet = 0;
  let estimatedProductionCost = 0;
  let combinedItemsPrice = 0;

  materialLines.forEach((line) => {
    const linePriceVal = parseFloat(line.itemPrice);
    if (!isNaN(linePriceVal) && linePriceVal > 0) {
      combinedItemsPrice += linePriceVal;
    }

    const v = variants.find((item) => item.id === line.materialVariantId);
    if (!v) return;

    const lineProd = products.find((p) => p.id === (line.productId || selectedProductId));
    const lineFormula: FrameFormulaType = lineProd ? lineProd.frame_formula_type : formulaType;

    const isDim = v.category === 'COIL' || v.category === 'PIPE' || v.base_unit === 'FEET';
    const pcs = Math.max(1, parseInt(line.pieceCount || '1', 10) || 1);
    if (isDim) {
      const feet = calculateRunningFeet(
        lineFormula,
        parseFloat(line.inputLength) || 0,
        parseFloat(line.inputBreadth) || 0,
        pcs
      );
      totalRunningFeet += feet;
      const autoGrams = feet * (Number(v.bom_weight_per_foot_grams) || 0);
      const explicitKg = parseFloat(line.inputWeightKg);
      const lineWeightKg = !isNaN(explicitKg) && explicitKg > 0 ? explicitKg : autoGrams / 1000.0;
      totalMetalWeightKg += lineWeightKg;
      if (v.base_unit === 'GRAM') {
        estimatedProductionCost += lineWeightKg * 1000.0 * (Number(v.unit_cost_inr) || 0);
      } else if (v.base_unit === 'FEET') {
        estimatedProductionCost += feet * (Number(v.unit_cost_inr) || 0);
      } else {
        estimatedProductionCost += lineWeightKg * (Number(v.unit_cost_inr) || 0);
      }
    } else {
      const qty = parseFloat(line.quantityConsumed) || parseFloat(line.inputWeightKg) || 0;
      if (v.base_unit === 'KG') totalMetalWeightKg += qty;
      estimatedProductionCost += qty * (Number(v.unit_cost_inr) || 0);
    }
  });

  const effectiveBaseAmount =
    combinedItemsPrice > 0 ? combinedItemsPrice : parseFloat(sellingPrice) || 0;

  const numericGstRate = !isNaN(parseFloat(gstRate)) ? parseFloat(gstRate) : 0;
  const { gstAmountInr, finalTotalInr } = calculateGst(
    effectiveBaseAmount,
    numericGstRate
  );

  const handleSubmitBill = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!customerName.trim()) {
      setFormError('Customer name is required');
      return;
    }
    if (effectiveBaseAmount <= 0) {
      setFormError('Please enter individual item prices or a base selling price');
      return;
    }

    for (let i = 0; i < materialLines.length; i++) {
      if (!materialLines[i].materialVariantId) {
        setFormError(`Please select a material for item #${i + 1}`);
        return;
      }
    }

    // Determine primary product_id from the first line that has a frame product selected, or fallback to first product
    const firstLineWithProduct = materialLines.find(
      (l) => l.productId && l.productId !== 'DIRECT' && l.productId !== 'OTHER'
    );
    const resolvedPrimaryProductId =
      firstLineWithProduct?.productId ||
      (selectedProductId && selectedProductId !== 'OTHER' ? selectedProductId : products[0]?.id);

    setSubmitting(true);
    try {
      const payload = {
        product_id: resolvedPrimaryProductId,
        custom_product_name: newProductName.trim() || undefined,
        custom_formula_type: newProductFormula || undefined,
        customer_name: customerName.trim(),
        selling_price_inr: effectiveBaseAmount,
        gst_rate: numericGstRate,
        items: materialLines.map((line) => ({
          product_id:
            line.productId && line.productId !== 'DIRECT' && line.productId !== 'OTHER'
              ? line.productId
              : resolvedPrimaryProductId,
          material_variant_id: line.materialVariantId,
          piece_count: line.pieceCount ? parseInt(line.pieceCount, 10) : 1,
          input_length: line.inputLength ? parseFloat(line.inputLength) : undefined,
          input_breadth: line.inputBreadth ? parseFloat(line.inputBreadth) : undefined,
          input_weight_kg: line.inputWeightKg ? parseFloat(line.inputWeightKg) : undefined,
          quantity_consumed: line.quantityConsumed ? parseFloat(line.quantityConsumed) : undefined,
          item_price_inr: line.itemPrice ? parseFloat(line.itemPrice) : undefined,
        })),
      };

      const res = await fetch('/api/bills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || 'Failed to submit bill');
        return;
      }

      alert('Production bill submitted successfully to the Admin approval queue!');
      setCustomerName('');
      setSellingPrice('');
      setNewProductName('');
      setShowNewProductBox(false);
      setMaterialLines([
        { productId: '', materialVariantId: '', pieceCount: '1', inputLength: '7', inputBreadth: '3', inputWeightKg: '', quantityConsumed: '', itemPrice: '' },
      ]);
      loadCatalog();
      loadBills();
      setActiveTab('dashboard');
    } catch (err: any) {
      setFormError(err.message || 'Network error occurred');
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <Clock className="w-3.5 h-3.5" />
            PENDING APPROVAL
          </span>
        );
      case 'APPROVED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            <CheckCircle className="w-3.5 h-3.5" />
            APPROVED
          </span>
        );
      case 'REJECTED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/30">
            <XCircle className="w-3.5 h-3.5" />
            REJECTED
          </span>
        );
      default:
        return null;
    }
  };

  const pendingCount = bills.filter((b) => b.status === 'PENDING').length;
  const approvedRecentCount = bills.filter((b) => b.status === 'APPROVED').length;
  const rejectedRecentCount = bills.filter((b) => b.status === 'REJECTED').length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-24 sm:pb-16">
      {/* Top Navbar */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-3.5 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 shrink-0 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/30">
              <Package className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-bold text-slate-100 tracking-tight truncate">Worker Production Portal</h1>
              <p className="text-[11px] sm:text-xs text-slate-400 truncate">Operator: <span className="text-indigo-400 font-mono font-medium">{workerUsername}</span></p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Header Navigation */}
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`hidden sm:flex px-3.5 py-1.5 rounded-lg border text-xs font-semibold transition items-center gap-1.5 ${
                activeTab === 'dashboard'
                  ? 'bg-indigo-600 text-white border-indigo-500 shadow'
                  : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Dashboard ({bills.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('generate')}
              className={`hidden sm:flex px-3.5 py-1.5 rounded-lg border text-xs font-semibold transition items-center gap-1.5 ${
                activeTab === 'generate'
                  ? 'bg-indigo-600 text-white border-indigo-500 shadow'
                  : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Bill</span>
            </button>

            <button
              onClick={handleLogout}
              className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3.5 sm:px-6 lg:px-8 pt-4 sm:pt-6">
        {/* ===================================================================
            TAB 1: WORKER DASHBOARD
            =================================================================== */}
        {activeTab === 'dashboard' && (
          <div className="space-y-4 sm:space-y-6">
            {/* Quick Metrics - Mobile-first 3-col compact grid */}
            <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 sm:p-4 shadow">
                <span className="text-[10px] sm:text-xs font-semibold text-amber-400 uppercase tracking-wider block truncate">Pending</span>
                <p className="text-xl sm:text-2xl font-black text-slate-100 mt-1">{pendingCount}</p>
                <p className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5 truncate">In queue</p>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 sm:p-4 shadow">
                <span className="text-[10px] sm:text-xs font-semibold text-emerald-400 uppercase tracking-wider block truncate">Approved (48h)</span>
                <p className="text-xl sm:text-2xl font-black text-slate-100 mt-1">{approvedRecentCount}</p>
                <p className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5 truncate">48h window</p>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 sm:p-4 shadow">
                <span className="text-[10px] sm:text-xs font-semibold text-red-400 uppercase tracking-wider block truncate">Rejected (48h)</span>
                <p className="text-xl sm:text-2xl font-black text-slate-100 mt-1">{rejectedRecentCount}</p>
                <p className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5 truncate">48h window</p>
              </div>
            </div>

            {/* Bills List */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-xl overflow-hidden">
              <div className="p-3.5 sm:p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold text-slate-100">Submitted Bill History (Last 48 Hours)</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Any bill older than 48 hours is automatically hidden and cleaned up from history view.
                  </p>
                </div>
                <button
                  onClick={() => setActiveTab('generate')}
                  className="w-full sm:w-auto justify-center px-4 py-2.5 sm:py-2 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-md shadow-indigo-500/20 transition"
                >
                  <Plus className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                  <span>+ Generate Bill</span>
                </button>
              </div>

              {loading ? (
                <div className="py-12 text-center text-slate-400 text-sm">Loading orders...</div>
              ) : bills.length === 0 ? (
                <div className="py-16 text-center">
                  <FileText className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                  <p className="text-sm font-medium text-slate-300">No active orders</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Click &quot;+ Generate Bill&quot; to submit a new manufacturing order.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-800/60">
                  {bills.map((bill) => (
                    <div key={bill.id} className="p-4 hover:bg-slate-800/30 transition-colors">
                      <div className="flex items-start justify-between flex-wrap gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-slate-200">#{bill.bill_number}</span>
                            <span className="text-xs px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 font-medium">
                              {bill.product_name}
                            </span>
                            {getStatusBadge(bill.status)}
                          </div>
                          <p className="text-xs text-slate-300 mt-1">Customer: <b className="text-slate-100">{bill.customer_name}</b></p>
                          <p className="text-[11px] text-slate-500 mt-0.5 font-mono">
                            Submitted: {new Date(bill.created_at).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>

                        <div className="text-right">
                          <p className="text-base font-black text-emerald-400 font-mono">
                            ₹{parseFloat(bill.final_total_inr.toString()).toFixed(2)}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            Base: ₹{parseFloat(bill.selling_price_inr.toString()).toFixed(2)} + GST ({bill.gst_rate}%): ₹{parseFloat(bill.gst_amount_inr.toString()).toFixed(2)}
                          </p>
                        </div>
                      </div>

                      {/* Rejection Reason Alert if applicable */}
                      {bill.status === 'REJECTED' && bill.rejection_reason && (
                        <div className="mt-3 p-2.5 rounded-lg bg-red-950/40 border border-red-500/30 flex items-start gap-2 text-xs text-red-300">
                          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold">Rejection Reason:</span> {bill.rejection_reason}
                            <span className="block text-[10px] text-red-400/70 mt-0.5">This rejected bill will automatically clear in 24 hours.</span>
                          </div>
                        </div>
                      )}

                      {/* Consumed Materials Breakdown */}
                      {bill.items && bill.items.length > 0 && (
                        <div className="mt-3 pt-2.5 border-t border-slate-800/60 flex flex-wrap gap-2 text-xs font-mono">
                          {bill.items.map((it, idx) => (
                            <span key={idx} className="px-2 py-1 bg-slate-950 rounded border border-slate-800 text-slate-300">
                              {it.material_name}:{' '}
                              {it.input_length && it.input_breadth
                                ? `${it.input_length}x${it.input_breadth}ft (${it.calculated_feet}ft)`
                                : ''}{' '}
                              <b className="text-amber-400">
                                {it.unit === 'GRAM' ? `${(parseFloat(it.actual_quantity_consumed.toString()) / 1000.0).toFixed(2)} kg` : `${it.actual_quantity_consumed} ${it.unit}`}
                              </b>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===================================================================
            TAB 2: GENERATE PRODUCTION BILL
            =================================================================== */}
        {activeTab === 'generate' && (
          <form onSubmit={handleSubmitBill} className="max-w-4xl mx-auto space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl">
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-800">
                <div>
                  <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                    <Calculator className="w-4 h-4 text-indigo-400" />
                    New Manufacturing Production Order
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Dimensional input ($L \times B$) automatically calculates running feet and metal weight.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2.5 py-1 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono">
                    {formulaType === 'DOOR_2L_PLUS_B' ? 'Rule: (2L + B)' : 'Rule: 2(L + B)'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveTab('dashboard')}
                    className="text-xs px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition"
                  >
                    ← Back to Dashboard
                  </button>
                </div>
              </div>

              {formError && (
                <div className="mb-4 p-3 bg-red-950/60 border border-red-500/50 rounded-lg text-xs text-red-200 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Step 1: Customer Name Only (Items are chosen per line below) */}
              <div className="mb-5">
                <label className="block text-xs font-semibold uppercase text-slate-400 mb-1.5">
                  1. Customer Name
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="e.g. Ramesh Hardware / Amit Sharma"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>

              {/* Inline Add New Product Creator when "+ Add New Product" or "Other" is active */}
              {showNewProductBox && (
                <div className="mb-5 p-4 rounded-xl bg-indigo-950/25 border border-indigo-500/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-indigo-300 uppercase tracking-wider">
                      Add New Product to Catalog
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowNewProductBox(false)}
                      className="text-xs text-slate-400 hover:text-white"
                    >
                      ✕ Close
                    </button>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
                    <div className="flex-1">
                      <label className="block text-[11px] text-slate-300 mb-1">New Product / Item Name *</label>
                      <input
                        type="text"
                        value={newProductName}
                        onChange={(e) => setNewProductName(e.target.value)}
                        placeholder="Enter any product or item name (e.g. Copper Door, Paint, Grill, Lock, etc.)"
                        className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 text-xs focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={savingNewProduct}
                      onClick={handleAddNewProduct}
                      className="sm:w-auto py-2.5 px-5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition shadow flex items-center justify-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {savingNewProduct ? 'Saving...' : 'Save & Select Product'}
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: Material Lines, Measurements & Auto-Calculated Length / Weight */}
              <div className="space-y-3 mb-5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <label className="text-xs font-semibold uppercase text-slate-400 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-indigo-400" />
                    2. Measurements, Material Used &amp; Automated Length / Weight Calculation
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowNewProductBox(!showNewProductBox)}
                      className="text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700 font-semibold flex items-center gap-1 transition"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {showNewProductBox ? 'Hide New Product' : '+ Add New Product'}
                    </button>
                    <button
                      type="button"
                      onClick={addMaterialLine}
                      className="text-xs px-3 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 font-semibold flex items-center gap-1 transition"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      + Add Another Item
                    </button>
                  </div>
                </div>

                {materialLines.map((line, idx) => {
                  const selectedV = variants.find((v) => v.id === line.materialVariantId);
                  const isDirectItem =
                    line.productId === 'DIRECT' ||
                    selectedV?.category === 'PAINT' ||
                    selectedV?.category === 'HINGES';
                  const lineProd = !isDirectItem
                    ? products.find((p) => p.id === (line.productId || selectedProductId))
                    : null;
                  const lineFormula: FrameFormulaType = lineProd ? lineProd.frame_formula_type : formulaType;
                  const pcs = Math.max(1, parseInt(line.pieceCount || '1', 10) || 1);
                  const isDimensional =
                    !isDirectItem &&
                    (selectedV?.category === 'COIL' ||
                      selectedV?.category === 'PIPE' ||
                      selectedV?.base_unit === 'FEET');
                  const feet = isDimensional
                    ? calculateRunningFeet(
                        lineFormula,
                        parseFloat(line.inputLength) || 0,
                        parseFloat(line.inputBreadth) || 0,
                        pcs
                      )
                    : 0;
                  const grams = isDimensional
                    ? feet * (Number(selectedV?.bom_weight_per_foot_grams) || 0)
                    : 0;
                  const autoWeightKg = (grams / 1000.0).toFixed(2);

                  return (
                    <div key={idx} className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
                      <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-800/70">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-400 font-mono">
                          Item #{idx + 1}{' '}
                          {isDirectItem
                            ? `— ${selectedV ? selectedV.name : 'Direct Item (Paint / Hardware)'}`
                            : lineProd
                            ? `— ${lineProd.name}`
                            : ''}
                        </span>
                        {materialLines.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeMaterialLine(idx)}
                            className="text-slate-400 hover:text-red-400 text-xs flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 border border-slate-800"
                            title="Remove Line"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Remove</span>
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">Item Built *</label>
                          <select
                            value={
                              isDirectItem
                                ? 'DIRECT'
                                : line.productId || (selectedProductId !== 'OTHER' ? selectedProductId : '')
                            }
                            onChange={(e) => updateMaterialLine(idx, 'productId', e.target.value)}
                            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          >
                            {products.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                            <option value="DIRECT">Direct Item (Paint / Hinges / Other)</option>
                            <option value="OTHER">Other / + Add New Product...</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">Material Used *</label>
                          <select
                            value={line.materialVariantId}
                            onChange={(e) => updateMaterialLine(idx, 'materialVariantId', e.target.value)}
                            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            required
                          >
                            <option value="">Choose Material...</option>
                            {variants.map((v) => (
                              <option key={v.id} value={v.id}>
                                [{v.category}] {v.name} (Stock: {v.base_unit === 'GRAM' ? `${(v.current_stock / 1000).toFixed(1)} kg` : `${v.current_stock} ${v.base_unit}`})
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">Pieces / Count (InvenTree)</label>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={line.pieceCount}
                            onChange={(e) => updateMaterialLine(idx, 'pieceCount', e.target.value)}
                            placeholder="1"
                            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-emerald-400 mb-1">
                            Item #{idx + 1} Price (₹)
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            value={line.itemPrice}
                            onChange={(e) => updateMaterialLine(idx, 'itemPrice', e.target.value)}
                            placeholder="e.g. 2500 (combines in total)"
                            className="w-full px-3 py-2 bg-slate-900 border border-emerald-500/40 rounded-lg text-emerald-300 text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                        </div>
                      </div>

                      {/* Dimensional Inputs for Coil / Pipe */}
                      {isDimensional ? (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-center bg-slate-900/60 p-3 rounded-lg border border-slate-800/80">
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1 font-mono">Length (L ft)</label>
                            <input
                              type="number"
                              step="0.01"
                              value={line.inputLength}
                              onChange={(e) => updateMaterialLine(idx, 'inputLength', e.target.value)}
                              placeholder="7"
                              className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-100 text-xs font-mono"
                              required
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1 font-mono">Breadth (B ft)</label>
                            <input
                              type="number"
                              step="0.01"
                              value={line.inputBreadth}
                              onChange={(e) => updateMaterialLine(idx, 'inputBreadth', e.target.value)}
                              placeholder="3"
                              className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-100 text-xs font-mono"
                              required
                            />
                          </div>
                          <div>
                            <span className="block text-[11px] text-slate-400 mb-1 font-mono">Auto Length Used</span>
                            <span className="block px-2.5 py-1.5 bg-slate-950/80 border border-indigo-500/40 rounded text-indigo-300 font-mono text-xs font-bold">
                              {feet.toFixed(2)} ft
                            </span>
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1 font-mono">Weight (kg) (Auto: {autoWeightKg})</label>
                            <input
                              type="number"
                              step="0.01"
                              value={line.inputWeightKg}
                              onChange={(e) => updateMaterialLine(idx, 'inputWeightKg', e.target.value)}
                              placeholder={`${autoWeightKg} kg (auto)`}
                              className="w-full px-2.5 py-1.5 bg-slate-950 border border-amber-500/40 rounded text-amber-300 text-xs font-mono font-bold"
                            />
                          </div>
                        </div>
                      ) : selectedV ? (
                        <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800/80 sm:w-1/2">
                          <label className="block text-[11px] text-slate-400 mb-1 font-mono">
                            Quantity / Weight Consumed ({selectedV.base_unit})
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            value={line.quantityConsumed}
                            onChange={(e) => updateMaterialLine(idx, 'quantityConsumed', e.target.value)}
                            placeholder={selectedV.base_unit === 'PIECE' ? 'e.g. 3' : 'e.g. 5'}
                            className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-100 text-xs font-mono"
                            required
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {/* Step 3: Commercials, Optional GST (0% Default) & Combined Total Amount */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-slate-800">
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-400 mb-1.5">
                    4. Combined Items Price / Base (₹)
                  </label>
                  {combinedItemsPrice > 0 ? (
                    <div className="w-full px-3.5 py-2.5 bg-slate-950 border border-indigo-500/40 rounded-lg text-indigo-300 text-sm font-mono font-bold flex items-center justify-between">
                      <span>₹{combinedItemsPrice.toFixed(2)}</span>
                      <span className="text-[10px] text-slate-400 font-normal">Auto-summed from {materialLines.length} item(s)</span>
                    </div>
                  ) : (
                    <input
                      type="number"
                      step="0.01"
                      value={sellingPrice}
                      onChange={(e) => setSellingPrice(e.target.value)}
                      placeholder="Enter item prices above or total here"
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                      required={combinedItemsPrice <= 0}
                    />
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-400 mb-1.5">
                    5. GST (Optional — 0% Default)
                  </label>
                  <select
                    value={gstRate}
                    onChange={(e) => setGstRate(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                  >
                    <option value="0">0% (No GST — Default)</option>
                    <option value="5">5% GST</option>
                    <option value="12">12% GST</option>
                    <option value="18">18% (Standard GST)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase text-emerald-400 mb-1.5">
                    6. Final Combined Total (₹)
                  </label>
                  <div className="w-full px-3.5 py-2.5 bg-slate-950/90 border border-emerald-500/40 rounded-lg text-emerald-400 text-sm font-mono font-black flex items-center justify-between">
                    <span>₹{finalTotalInr.toFixed(2)}</span>
                    <span className="text-[10px] text-slate-400 font-normal">Incl. ₹{gstAmountInr.toFixed(2)} GST</span>
                  </div>
                </div>
              </div>

              {/* Step 4: Summary Card */}
              <div className="mt-5 p-3.5 sm:p-4 bg-slate-950 rounded-xl border border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
                <div>
                  <p className="text-[11px] sm:text-xs text-slate-400">Auto Length Used:</p>
                  <p className="text-sm sm:text-base font-bold text-indigo-300">{totalRunningFeet.toFixed(2)} ft</p>
                </div>
                <div>
                  <p className="text-[11px] sm:text-xs text-slate-400">Total Metal Weight:</p>
                  <p className="text-sm sm:text-base font-bold text-amber-300">{totalMetalWeightKg.toFixed(2)} kg</p>
                </div>
                <div>
                  <p className="text-[11px] sm:text-xs text-slate-400">GST Amount ({gstRate}%):</p>
                  <p className="text-sm sm:text-base font-bold text-slate-300">₹{gstAmountInr.toFixed(2)}</p>
                </div>
                <div className=" sm:text-right">
                  <p className="text-[11px] sm:text-xs text-slate-400">Final Total Amount:</p>
                  <p className="text-lg sm:text-xl font-black text-emerald-400">₹{finalTotalInr.toFixed(2)}</p>
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="flex flex-col-reverse sm:flex-row gap-2.5 sm:gap-3 pt-5">
                <button
                  type="button"
                  onClick={() => setActiveTab('dashboard')}
                  className="w-full sm:flex-1 py-3 min-h-[46px] bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-semibold rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full sm:flex-1 py-3 min-h-[46px] bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-colors shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2"
                >
                  {submitting ? 'Submitting Order...' : 'Submit to Admin Queue'}
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </form>
        )}
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-slate-900/95 backdrop-blur border-t border-slate-800 pb-safe">
        <div className="grid grid-cols-2 gap-1 p-1.5">
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className={`flex flex-col items-center justify-center py-2 rounded-xl text-[11px] font-semibold transition ${
              activeTab === 'dashboard'
                ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Clock className="w-4 h-4 mb-0.5" />
            <span>48h History ({bills.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('generate')}
            className={`flex flex-col items-center justify-center py-2 rounded-xl text-[11px] font-semibold transition ${
              activeTab === 'generate'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Plus className="w-4 h-4 mb-0.5" />
            <span>+ Create Bill</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
