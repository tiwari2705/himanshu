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
  ShieldCheck,
  Printer,
  RefreshCw,
  Sun,
  Moon,
  LayoutGrid,
} from 'lucide-react';
import { calculateRunningFeet, calculateGst, FrameFormulaType } from '@/lib/calculations';
import { INDIAN_STATES, getDefaultHsnAndUom, openAndPrintTaxInvoice } from '@/lib/invoice-template';

function ImsCubeLogo({ className = 'w-8 h-8' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 44"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path d="M20 2L37 11.8L20 21.6L3 11.8L20 2Z" fill="#006EC4" />
      <path d="M2.2 13.4L19.2 23.2V42L2.2 32.2V13.4Z" fill="#FF1E6A" />
      <path d="M37.8 13.4L20.8 23.2V42L37.8 32.2V13.4Z" fill="#FFB800" />
    </svg>
  );
}


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
  hsnCode: string;
  uom: string;
  rate: string;
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
  item_details?: any;
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
  invoice_details?: any;
  decided_by_username?: string | null;
  decided_by_role?: string | null;
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
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      setIsDarkMode(document.documentElement.classList.contains('dark'));
    }
  }, []);

  const toggleTheme = (dark: boolean) => {
    setIsDarkMode(dark);
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', dark);
    }
  };


  // Form states for Bill Generation (including Vishawkarma Steel Udyog Tax Invoice fields)
  const [selectedProductId, setSelectedProductId] = useState('');
  const [showNewProductBox, setShowNewProductBox] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [newProductFormula, setNewProductFormula] = useState<FrameFormulaType>('DOOR_2L_PLUS_B');
  const [savingNewProduct, setSavingNewProduct] = useState(false);

  const [customerName, setCustomerName] = useState('');
  const [partyAddress, setPartyAddress] = useState('');
  const [partyGstin, setPartyGstin] = useState('');
  const [partyState, setPartyState] = useState('Haryana');
  const [partyStateCode, setPartyStateCode] = useState('06');
  const [invoiceType, setInvoiceType] = useState('Credit');
  const [transportMode, setTransportMode] = useState('Intra');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [placeOfSupply, setPlaceOfSupply] = useState('');
  const [narration, setNarration] = useState('');

  const [sellingPrice, setSellingPrice] = useState('');
  const [gstRate, setGstRate] = useState('0');
  const [materialLines, setMaterialLines] = useState<MaterialLineState[]>([
    { productId: '', materialVariantId: '', hsnCode: '7308', uom: 'RMT', rate: '', pieceCount: '1', inputLength: '7', inputBreadth: '3', inputWeightKg: '', quantityConsumed: '', itemPrice: '' },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Worker Bill Decision Gateway Modal states (Approve / reject / secret key)
  const [selectedDecisionBill, setSelectedDecisionBill] = useState<Bill | null>(null);
  const [showDecisionModal, setShowDecisionModal] = useState(false);
  const [commandInput, setCommandInput] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [processingDecision, setProcessingDecision] = useState(false);

  const openDecisionModal = (bill: Bill) => {
    setSelectedDecisionBill(bill);
    setCommandInput('');
    setRejectionReason('');
    setShowDecisionModal(true);
  };

  const trimmedCommand = commandInput.trim();
  const isApproveCmd = trimmedCommand.toLowerCase() === 'approve';
  const isRejectCmd = trimmedCommand.toLowerCase() === 'reject';
  const isValidDecisionCmd = trimmedCommand.length > 0;

  const handleExecuteDecision = async () => {
    if (!selectedDecisionBill || !isValidDecisionCmd) return;
    if (isRejectCmd && !rejectionReason.trim()) {
      alert('Please enter a rejection reason.');
      return;
    }

    setProcessingDecision(true);
    try {
      const res = await fetch('/api/admin/approve-bill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bill_id: selectedDecisionBill.id,
          confirmation_input: trimmedCommand,
          rejection_reason: isRejectCmd ? rejectionReason.trim() : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to process bill decision.');
        return;
      }

      setShowDecisionModal(false);
      setSelectedDecisionBill(null);
      setCommandInput('');
      setRejectionReason('');
      await Promise.all([loadCatalog(), loadBills()]);
    } catch {
      alert('Network error processing bill decision.');
    } finally {
      setProcessingDecision(false);
    }
  };

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
        hsnCode: '7308',
        uom: 'RMT',
        rate: '',
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

    if (field === 'productId' && value === 'OTHER') {
      setShowNewProductBox(true);
    }

    if (field === 'materialVariantId') {
      const chosenV = variants.find((v) => v.id === value);
      if (chosenV) {
        const def = getDefaultHsnAndUom(chosenV.category, chosenV.name);
        updated[index].hsnCode = def.hsn;
        updated[index].uom = def.uom;
        if (chosenV.category === 'PAINT' || chosenV.category === 'HINGES') {
          updated[index].productId = 'DIRECT';
        } else if (!updated[index].productId || updated[index].productId === 'DIRECT') {
          updated[index].productId = products[0]?.id || '';
        }
      }
    }

    // Auto-calculate Item Price when Rate is entered
    if (field === 'rate') {
      const rateNum = parseFloat(value);
      const line = updated[index];
      const chosenV = variants.find((v) => v.id === line.materialVariantId);
      const lineProd = products.find((p) => p.id === (line.productId || selectedProductId));
      const lineFormula: FrameFormulaType = lineProd ? lineProd.frame_formula_type : 'DOOR_2L_PLUS_B';
      const pcs = Math.max(1, parseInt(line.pieceCount || '1', 10) || 1);
      const isDim = chosenV?.category === 'COIL' || chosenV?.category === 'PIPE' || chosenV?.base_unit === 'FEET';
      const feet = isDim
        ? calculateRunningFeet(lineFormula, parseFloat(line.inputLength) || 0, parseFloat(line.inputBreadth) || 0, pcs)
        : 0;
      const grams = isDim ? feet * (Number(chosenV?.bom_weight_per_foot_grams) || 0) : 0;
      const weightKg = parseFloat(line.inputWeightKg) > 0 ? parseFloat(line.inputWeightKg) : grams / 1000.0;
      const billQty =
        line.uom.toUpperCase() === 'RMT' || line.uom.toUpperCase() === 'FT'
          ? feet
          : line.uom.toLowerCase() === 'kg'
          ? weightKg
          : parseFloat(line.quantityConsumed) || pcs;
      if (!isNaN(rateNum) && rateNum > 0 && billQty > 0) {
        updated[index].itemPrice = (rateNum * billQty).toFixed(2);
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

  const handlePreviewDraftInvoice = () => {
    const draftBill = {
      bill_number: 'DRAFT-PREVIEW',
      customer_name: customerName.trim() || 'Party Name',
      selling_price_inr: effectiveBaseAmount,
      gst_rate: numericGstRate,
      gst_amount_inr: gstAmountInr,
      final_total_inr: finalTotalInr,
      created_at: new Date().toISOString(),
      invoice_details: {
        invoice_type: invoiceType,
        party_name: customerName.trim() || 'Party Name',
        party_address: partyAddress.trim() || '-',
        party_gstin: partyGstin.trim() || '-',
        party_state: partyState,
        party_state_code: partyStateCode,
        transport_mode: transportMode,
        vehicle_number: vehicleNumber.trim() || '-',
        place_of_supply: placeOfSupply.trim() || partyAddress.trim() || partyState,
        narration: narration.trim(),
      },
      items: materialLines.map((line) => {
        const v = variants.find((item) => item.id === line.materialVariantId);
        const lineProd = products.find((p) => p.id === (line.productId || selectedProductId));
        const lineFormula: FrameFormulaType = lineProd ? lineProd.frame_formula_type : 'DOOR_2L_PLUS_B';
        const pcs = Math.max(1, parseInt(line.pieceCount || '1', 10) || 1);
        const isDim = v?.category === 'COIL' || v?.category === 'PIPE' || v?.base_unit === 'FEET';
        const feet = isDim ? calculateRunningFeet(lineFormula, parseFloat(line.inputLength) || 0, parseFloat(line.inputBreadth) || 0, pcs) : 0;
        const grams = isDim ? feet * (Number(v?.bom_weight_per_foot_grams) || 0) : 0;
        const weightKg = parseFloat(line.inputWeightKg) > 0 ? parseFloat(line.inputWeightKg) : grams / 1000.0;
        const billQty = line.uom.toUpperCase() === 'RMT' || line.uom.toUpperCase() === 'FT' ? feet : line.uom.toLowerCase() === 'kg' ? weightKg : parseFloat(line.quantityConsumed) || pcs;
        const lineAmt = parseFloat(line.itemPrice) || 0;
        return {
          material_name: v?.name || 'ITEM',
          category: v?.category || 'COIL',
          calculated_feet: feet,
          actual_quantity_consumed: v?.base_unit === 'GRAM' ? weightKg * 1000 : billQty,
          unit: v?.base_unit || 'KG',
          item_details: {
            item_detail: lineProd && line.productId !== 'DIRECT' ? `${lineProd.name} (${v?.name || ''})` : v?.name || 'ITEM',
            hsn_code: line.hsnCode || '7308',
            billing_qty: billQty || 1,
            uom: line.uom || 'RMT',
            rate: parseFloat(line.rate) || (billQty > 0 ? lineAmt / billQty : lineAmt),
            gst_percent: numericGstRate,
            gst_amount: lineAmt * (numericGstRate / 100.0),
            taxable_amount: lineAmt,
          },
        };
      }),
    };
    openAndPrintTaxInvoice(draftBill, 'Draft Preview');
  };

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
        invoice_details: {
          invoice_type: invoiceType,
          party_name: customerName.trim(),
          party_address: partyAddress.trim(),
          party_gstin: partyGstin.trim(),
          party_state: partyState,
          party_state_code: partyStateCode,
          transport_mode: transportMode,
          vehicle_number: vehicleNumber.trim(),
          place_of_supply: placeOfSupply.trim() || partyAddress.trim() || partyState,
          narration: narration.trim(),
        },
        items: materialLines.map((line) => {
          const v = variants.find((item) => item.id === line.materialVariantId);
          const lineProd = products.find((p) => p.id === (line.productId || selectedProductId));
          return {
            product_id:
              line.productId && line.productId !== 'DIRECT' && line.productId !== 'OTHER'
                ? line.productId
                : resolvedPrimaryProductId,
            material_variant_id: line.materialVariantId,
            item_detail:
              lineProd && line.productId !== 'DIRECT'
                ? `${lineProd.name} (${v?.name || ''})`
                : v?.name || 'STEEL ITEM',
            hsn_code: line.hsnCode || '7308',
            uom: line.uom || 'RMT',
            rate: line.rate ? parseFloat(line.rate) : undefined,
            piece_count: line.pieceCount ? parseInt(line.pieceCount, 10) : 1,
            input_length: line.inputLength ? parseFloat(line.inputLength) : undefined,
            input_breadth: line.inputBreadth ? parseFloat(line.inputBreadth) : undefined,
            input_weight_kg: line.inputWeightKg ? parseFloat(line.inputWeightKg) : undefined,
            quantity_consumed: line.quantityConsumed ? parseFloat(line.quantityConsumed) : undefined,
            item_price_inr: line.itemPrice ? parseFloat(line.itemPrice) : undefined,
            gst_percent: numericGstRate,
          };
        }),
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

      setCustomerName('');
      setPartyAddress('');
      setPartyGstin('');
      setVehicleNumber('');
      setPlaceOfSupply('');
      setNarration('');
      setSellingPrice('');
      setNewProductName('');
      setShowNewProductBox(false);
      setMaterialLines([
        { productId: '', materialVariantId: '', hsnCode: '7308', uom: 'RMT', rate: '', pieceCount: '1', inputLength: '7', inputBreadth: '3', inputWeightKg: '', quantityConsumed: '', itemPrice: '' },
      ]);
      await Promise.all([loadCatalog(), loadBills()]);
      setActiveTab('dashboard');
      if (data.bill) {
        openDecisionModal(data.bill);
      }
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
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
            <Clock className="w-3 h-3" />
            PENDING APPROVAL
          </span>
        );
      case 'APPROVED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
            <CheckCircle className="w-3 h-3" />
            APPROVED
          </span>
        );
      case 'REJECTED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800">
            <XCircle className="w-3 h-3" />
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
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B1120] text-slate-900 dark:text-slate-100 flex flex-col lg:flex-row pb-24 lg:pb-6">
      {/* Left Sidebar — Figma PNG 5 Soft Pastel Sky-Blue Navigation */}
      <aside className="hidden lg:flex w-[248px] shrink-0 flex-col justify-between rounded-[24px] bg-[#D6E8F8] dark:bg-[#111C33] p-5 m-3 mr-0 sticky top-3 h-[calc(100vh-1.5rem)] select-none">
        <div>
          <div className="flex items-center gap-3 px-2 pt-1 pb-7">
            <ImsCubeLogo className="w-8 h-9 shrink-0" />
            <div>
              <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-white block leading-none">
                Inventory
              </span>
              <span className="text-[10px] font-medium text-slate-600 dark:text-slate-400 block mt-0.5">
                Worker Portal
              </span>
            </div>
          </div>

          <nav className="space-y-1.5">
            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className={`w-full relative flex items-center justify-between px-3.5 py-3 rounded-xl text-sm transition-all ${
                activeTab === 'dashboard'
                  ? 'bg-[#C1DCF5] dark:bg-sky-900/50 text-[#006EC4] dark:text-sky-300 font-semibold'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-[#C9E2F7]/60 dark:hover:bg-slate-800/60 font-medium'
              }`}
            >
              {activeTab === 'dashboard' && (
                <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-[#006EC4] dark:bg-sky-400" />
              )}
              <span className="flex items-center gap-3">
                <LayoutGrid className="w-4 h-4 shrink-0" />
                <span>Dashboard</span>
              </span>
              <span
                className={`px-2 py-0.5 text-[11px] rounded-full font-bold ${
                  activeTab === 'dashboard'
                    ? 'bg-[#006EC4] text-white'
                    : 'bg-white/70 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                {bills.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('generate')}
              className={`w-full relative flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm transition-all ${
                activeTab === 'generate'
                  ? 'bg-[#C1DCF5] dark:bg-sky-900/50 text-[#006EC4] dark:text-sky-300 font-semibold'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-[#C9E2F7]/60 dark:hover:bg-slate-800/60 font-medium'
              }`}
            >
              {activeTab === 'generate' && (
                <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-[#006EC4] dark:bg-sky-400" />
              )}
              <Plus className="w-4 h-4 shrink-0" />
              <span>Create Bill</span>
            </button>
          </nav>
        </div>

        <div className="space-y-3 pt-4 border-t border-[#BFD8EE] dark:border-slate-800">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out ({workerUsername})</span>
          </button>

          <div className="bg-[#C5DEF3] dark:bg-slate-800 p-1 rounded-xl grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => toggleTheme(false)}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all ${
                !isDarkMode ? 'bg-[#006EC4] text-white shadow-sm' : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              <Sun className="w-3.5 h-3.5" />
              <span>Light</span>
            </button>
            <button
              type="button"
              onClick={() => toggleTheme(true)}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all ${
                isDarkMode ? 'bg-[#006EC4] text-white shadow-sm' : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              <Moon className="w-3.5 h-3.5" />
              <span>Dark</span>
            </button>
          </div>
        </div>
      </aside>


      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 bg-[#F8FAFC]/90 dark:bg-[#0B1120]/90 backdrop-blur-md border-b border-slate-200/70 dark:border-slate-800 px-3.5 sm:px-6 lg:px-8 py-3.5">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <div className="lg:hidden shrink-0">
                <ImsCubeLogo className="w-7 h-8" />
              </div>
              <div className="min-w-0">
                <h1 className="text-base sm:text-xl font-bold text-slate-900 dark:text-white tracking-tight truncate flex items-center gap-1.5">
                  <span>Hello {workerUsername}</span>
                  <span role="img" aria-label="wave">👋</span>
                </h1>
                <p className="text-[11px] sm:text-xs text-slate-400 truncate">
                  Worker Production Portal • Operator: <span className="text-[#006EC4] dark:text-sky-400 font-mono font-medium">{workerUsername}</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => toggleTheme(!isDarkMode)}
                className="lg:hidden p-2 rounded-xl bg-white dark:bg-[#152036] border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300"
                title="Toggle Theme"
              >
                {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>

              <div className="hidden sm:flex items-center gap-2.5 bg-white dark:bg-[#152036] border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-1.5 shadow-sm">
                <div className="w-8 h-8 rounded-lg bg-[#D6E8F8] dark:bg-sky-900/60 text-[#006EC4] dark:text-sky-300 font-bold text-xs flex items-center justify-center uppercase">
                  {workerUsername.slice(0, 2)}
                </div>
                <div className="text-left pr-1">
                  <div className="text-xs font-bold text-slate-900 dark:text-white leading-tight">{workerUsername}</div>
                  <div className="text-[10px] text-slate-400 leading-tight">Production Operator</div>
                </div>
              </div>

              <button
                onClick={handleLogout}
                className="lg:hidden p-2 text-slate-500 hover:text-red-500 bg-white dark:bg-[#152036] border border-slate-200 dark:border-slate-800 rounded-xl transition-colors"
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-7xl w-full mx-auto px-3.5 sm:px-6 lg:px-8 pt-4 sm:pt-6 flex-1">
          {activeTab === 'dashboard' && (
            <div className="space-y-4 sm:space-y-6">
              <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
                <div className="bg-white dark:bg-[#152036] border border-slate-200/80 dark:border-slate-800 rounded-2xl p-3.5 sm:p-5 shadow-ims-card flex flex-col items-center text-center">
                  <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#FFF4E5] dark:bg-amber-950/70 text-amber-500 flex items-center justify-center mb-2">
                    <Clock className="w-4 h-4 sm:w-5 sm:h-5" />
                  </div>
                  <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">{pendingCount}</p>
                  <span className="text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5 truncate">Pending (In queue)</span>
                </div>

                <div className="bg-white dark:bg-[#152036] border border-slate-200/80 dark:border-slate-800 rounded-2xl p-3.5 sm:p-5 shadow-ims-card flex flex-col items-center text-center">
                  <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#E6F9F0] dark:bg-emerald-950/70 text-emerald-500 flex items-center justify-center mb-2">
                    <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5" />
                  </div>
                  <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">{approvedRecentCount}</p>
                  <span className="text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5 truncate">Approved (48h)</span>
                </div>

                <div className="bg-white dark:bg-[#152036] border border-slate-200/80 dark:border-slate-800 rounded-2xl p-3.5 sm:p-5 shadow-ims-card flex flex-col items-center text-center">
                  <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-red-50 dark:bg-red-950/70 text-red-500 flex items-center justify-center mb-2">
                    <XCircle className="w-4 h-4 sm:w-5 sm:h-5" />
                  </div>
                  <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">{rejectedRecentCount}</p>
                  <span className="text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5 truncate">Rejected (48h)</span>
                </div>
              </div>


            {/* Bills List */}
            <div className="bg-white dark:bg-[#152036] border border-slate-200/80 dark:border-slate-800 rounded-2xl shadow-ims-card overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">Submitted Bill History (Last 48 Hours)</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Any bill older than 48 hours is automatically hidden and cleaned up from history view.
                  </p>
                </div>
                <button
                  onClick={() => setActiveTab('generate')}
                  className="w-full sm:w-auto justify-center px-4 py-2.5 sm:py-2 bg-[#006EC4] hover:bg-[#005A9E] text-white text-xs font-medium rounded-[10px] flex items-center gap-1.5 shadow-sm transition"
                >
                  <Plus className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                  <span>+ Generate Bill</span>
                </button>
              </div>

              {loading ? (
                <div className="py-12 text-center text-slate-400 text-sm">Loading orders...</div>
              ) : bills.length === 0 ? (
                <div className="py-16 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-[#EEF5FC] dark:bg-sky-950/60 text-[#006EC4] flex items-center justify-center mx-auto mb-3">
                    <FileText className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">Nothing found.</p>
                  <p className="text-xs text-slate-400 mt-1">
                    Click &quot;+ Generate Bill&quot; to submit a new manufacturing order.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {bills.map((bill) => (
                    <div key={bill.id} className="p-4 sm:p-5 hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors">
                      <div className="flex items-start justify-between flex-wrap gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-bold text-[#006EC4] dark:text-sky-400">#{bill.bill_number}</span>
                            <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#EEF5FC] dark:bg-sky-950/50 text-[#006EC4] dark:text-sky-300 border border-[#006EC4]/25 font-medium">
                              {bill.product_name}
                            </span>
                            {getStatusBadge(bill.status)}
                            {bill.status === 'APPROVED' && bill.decided_by_username && (
                              <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 font-mono">
                                Approved by @{bill.decided_by_username}
                              </span>
                            )}
                            {bill.status === 'REJECTED' && bill.decided_by_username && (
                              <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 font-mono">
                                Rejected by @{bill.decided_by_username}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-300 mt-1">Customer: <b className="text-slate-900 dark:text-white">{bill.customer_name}</b></p>
                          <p className="text-[11px] text-slate-400 mt-0.5 font-mono">
                            Submitted: {new Date(bill.created_at).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>


                        <div className="text-right flex flex-col items-end gap-2">
                          <div>
                            <p className="text-base font-bold text-slate-900 dark:text-white font-mono">
                              ₹{parseFloat(bill.final_total_inr.toString()).toFixed(2)}
                            </p>
                            <p className="text-[11px] text-slate-400">
                              Base: ₹{parseFloat(bill.selling_price_inr.toString()).toFixed(2)} + GST ({bill.gst_rate}%): ₹{parseFloat(bill.gst_amount_inr.toString()).toFixed(2)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {bill.status === 'PENDING' && (
                              <button
                                type="button"
                                onClick={() => openDecisionModal(bill)}
                                className="px-3.5 py-1.5 rounded-[10px] bg-[#006EC4] hover:bg-[#005A9E] text-white font-medium text-xs flex items-center gap-1.5 shadow-sm transition"
                              >
                                <ShieldCheck className="w-3.5 h-3.5" />
                                Review &amp; Approve
                              </button>
                            )}
                            {bill.status === 'APPROVED' && (
                              <button
                                type="button"
                                onClick={() => openAndPrintTaxInvoice(bill, 'Original Copy')}
                                className="px-3.5 py-1.5 rounded-[10px] bg-[#006EC4] hover:bg-[#005A9E] text-white font-medium text-xs flex items-center gap-1.5 shadow-sm transition"
                              >
                                <Printer className="w-3.5 h-3.5" />
                                Tax Invoice
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {bill.status === 'REJECTED' && bill.rejection_reason && (
                        <div className="mt-3 p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-500/30 flex items-start gap-2 text-xs text-red-700 dark:text-red-300">
                          <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold">Rejection Reason:</span> {bill.rejection_reason}
                            <span className="block text-[10px] text-red-500/80 mt-0.5">This rejected bill will automatically clear in 24 hours.</span>
                          </div>
                        </div>
                      )}

                      {bill.items && bill.items.length > 0 && (
                        <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/60 flex flex-wrap gap-2 text-xs font-mono">
                          {bill.items.map((it, idx) => (
                            <span key={idx} className="px-3 py-1 bg-[#EEF5FC] dark:bg-sky-950/40 rounded-full border border-[#006EC4]/30 text-slate-700 dark:text-slate-200">
                              {it.material_name}:{' '}
                              {it.input_length && it.input_breadth
                                ? `${it.input_length}x${it.input_breadth}ft (${it.calculated_feet}ft)`
                                : ''}{' '}
                              <b className="text-[#006EC4] dark:text-sky-400">
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
            <div className="bg-white dark:bg-[#152036] border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-ims-card">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-4 mb-5 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Calculator className="w-4 h-4 text-[#006EC4]" />
                    New Manufacturing Production Order
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Dimensional input ($L \times B$) automatically calculates running feet and metal weight.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs px-3 py-1 rounded-full bg-[#EEF5FC] dark:bg-sky-950/60 text-[#006EC4] dark:text-sky-300 border border-[#006EC4]/30 font-mono font-semibold">
                    {formulaType === 'DOOR_2L_PLUS_B' ? 'Rule: (2L + B)' : 'Rule: 2(L + B)'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveTab('dashboard')}
                    className="text-xs px-3.5 py-1.5 rounded-[10px] bg-white dark:bg-slate-800 hover:bg-slate-50 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium transition"
                  >
                    ← Back to Dashboard
                  </button>
                </div>
              </div>

              {formError && (
                <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-500/50 rounded-xl text-xs text-red-600 dark:text-red-200 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Step 1: Party Details & Transport Details */}
              <div className="mb-6 p-4 sm:p-5 rounded-2xl bg-[#F8FAFC] dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 space-y-3.5">
                <div className="flex items-center justify-between border-b border-slate-200/80 dark:border-slate-800 pb-2.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#006EC4] dark:text-sky-400">
                    1. Party Details &amp; Transport Info (Tax Invoice Header)
                  </span>
                  <span className="text-[11px] text-slate-400 font-mono">Vishawkarma Steel Udyog Format</span>
                </div>


                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Party / Customer Name <span className="text-red-500">*</span></label>
                    <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="e.g. Dashmesh Door Store" className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[10px] text-slate-900 dark:text-slate-100 text-xs focus:outline-none focus:border-[#006EC4]" required />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Party Address (City / Pin / Ph.)</label>
                    <input type="text" value={partyAddress} onChange={(e) => setPartyAddress(e.target.value)} placeholder="e.g. Shop No 01, Raisinghnagar Road, Sri Vijay Nagar (335704)" className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[10px] text-slate-900 dark:text-slate-100 text-xs focus:outline-none focus:border-[#006EC4]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Party GSTIN / UIN</label>
                    <input type="text" value={partyGstin} onChange={(e) => setPartyGstin(e.target.value.toUpperCase())} placeholder="e.g. 08AAUFD0041L1Z9" className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[10px] text-slate-900 dark:text-slate-100 text-xs font-mono" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Party State &amp; Code</label>
                    <select
                      value={`${partyState}|${partyStateCode}`}
                      onChange={(e) => {
                        const [st, code] = e.target.value.split('|');
                        setPartyState(st);
                        setPartyStateCode(code);
                      }}
                      className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[10px] text-slate-900 dark:text-slate-100 text-xs"
                    >
                      {INDIAN_STATES.map((st) => (
                        <option key={st.code} value={`${st.name}|${st.code}`}>
                          {st.name} (StateCode: {st.code})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Transport &amp; Bill Type</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      <select value={transportMode} onChange={(e) => setTransportMode(e.target.value)} className="w-full px-2 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[10px] text-slate-900 dark:text-slate-100 text-xs">
                        <option value="Intra">Intra</option>
                        <option value="By Road">By Road</option>
                        <option value="Self">Self</option>
                      </select>
                      <select value={invoiceType} onChange={(e) => setInvoiceType(e.target.value)} className="w-full px-2 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[10px] text-slate-900 dark:text-slate-100 text-xs">
                        <option value="Credit">Credit</option>
                        <option value="Cash">Cash</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Vehicle Number</label>
                    <input type="text" value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())} placeholder="e.g. HR57B4842" className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[10px] text-slate-900 dark:text-slate-100 text-xs font-mono" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Place of Supply</label>
                    <input type="text" value={placeOfSupply} onChange={(e) => setPlaceOfSupply(e.target.value)} placeholder="e.g. Sri Vijay Nagar (Rj)" className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[10px] text-slate-900 dark:text-slate-100 text-xs" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Narration / Remarks (Optional)</label>
                    <input type="text" value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Optional invoice narration..." className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[10px] text-slate-900 dark:text-slate-100 text-xs" />
                  </div>
                </div>
              </div>


              {showNewProductBox && (
                <div className="mb-5 p-4 rounded-2xl bg-[#EEF5FC] dark:bg-sky-950/30 border border-[#006EC4]/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#006EC4] dark:text-sky-300 uppercase tracking-wider">
                      Add New Product to Catalog
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowNewProductBox(false)}
                      className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white"
                    >
                      ✕ Close
                    </button>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">New Product / Item Name <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        value={newProductName}
                        onChange={(e) => setNewProductName(e.target.value)}
                        placeholder="Enter any product or item name (e.g. Copper Door, Paint, Grill, Lock, etc.)"
                        className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-[10px] text-slate-900 dark:text-slate-100 text-xs focus:outline-none focus:border-[#006EC4]"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={savingNewProduct}
                      onClick={handleAddNewProduct}
                      className="sm:w-auto py-2.5 px-5 bg-[#006EC4] hover:bg-[#005A9E] disabled:opacity-50 text-white text-xs font-medium rounded-[10px] transition shadow-sm flex items-center justify-center gap-1.5"
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
                  <label className="text-xs font-bold uppercase text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-[#006EC4]" />
                    2. Measurements, Material Used &amp; Automated Length / Weight Calculation
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowNewProductBox(!showNewProductBox)}
                      className="text-xs px-3 py-1.5 rounded-[10px] bg-white dark:bg-slate-800 hover:bg-slate-50 text-[#006EC4] dark:text-sky-300 border border-slate-200 dark:border-slate-700 font-medium flex items-center gap-1 transition"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {showNewProductBox ? 'Hide New Product' : '+ Add New Product'}
                    </button>
                    <button
                      type="button"
                      onClick={addMaterialLine}
                      className="text-xs px-3.5 py-1.5 rounded-[10px] bg-[#006EC4] hover:bg-[#005A9E] text-white font-medium flex items-center gap-1 transition shadow-sm"
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
                    <div key={idx} className="p-4 bg-[#F8FAFC] dark:bg-slate-900/70 rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-3.5">
                      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-200/80 dark:border-slate-800">
                        <span className="text-xs font-bold uppercase tracking-wider text-[#006EC4] dark:text-sky-400 font-mono">
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
                            className="text-slate-500 hover:text-red-600 text-xs flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                            title="Remove Line"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Remove</span>
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Item Built <span className="text-red-500">*</span></label>
                          <select
                            value={
                              isDirectItem
                                ? 'DIRECT'
                                : line.productId || (selectedProductId !== 'OTHER' ? selectedProductId : '')
                            }
                            onChange={(e) => updateMaterialLine(idx, 'productId', e.target.value)}
                            className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[10px] text-slate-900 dark:text-slate-100 text-xs focus:outline-none focus:border-[#006EC4]"
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
                          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Material Used <span className="text-red-500">*</span></label>
                          <select
                            value={line.materialVariantId}
                            onChange={(e) => updateMaterialLine(idx, 'materialVariantId', e.target.value)}
                            className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[10px] text-slate-900 dark:text-slate-100 text-xs focus:outline-none focus:border-[#006EC4]"
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
                          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">HSN &amp; UOM</label>
                          <div className="grid grid-cols-2 gap-1.5">
                            <input
                              type="text"
                              value={line.hsnCode}
                              onChange={(e) => updateMaterialLine(idx, 'hsnCode', e.target.value)}
                              placeholder="7308"
                              className="w-full px-2.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[10px] text-slate-900 dark:text-slate-100 text-xs font-mono"
                              title="HSN Code"
                            />
                            <select
                              value={line.uom}
                              onChange={(e) => updateMaterialLine(idx, 'uom', e.target.value)}
                              className="w-full px-2 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[10px] text-slate-900 dark:text-slate-100 text-xs font-mono"
                              title="Unit of Measure"
                            >
                              <option value="RMT">RMT</option>
                              <option value="kg">kg</option>
                              <option value="FT">FT</option>
                              <option value="PCS">PCS</option>
                              <option value="LTR">LTR</option>
                            </select>
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-[#006EC4] dark:text-sky-400 mb-1">
                            Rate &amp; Item #{idx + 1} Amount (₹)
                          </label>
                          <div className="grid grid-cols-2 gap-1.5">
                            <input
                              type="number"
                              step="0.01"
                              value={line.rate}
                              onChange={(e) => updateMaterialLine(idx, 'rate', e.target.value)}
                              placeholder="Rate"
                              className="w-full px-2.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[10px] text-slate-900 dark:text-slate-100 text-xs font-mono"
                              title="Rate per unit (optional)"
                            />
                            <input
                              type="number"
                              step="0.01"
                              value={line.itemPrice}
                              onChange={(e) => updateMaterialLine(idx, 'itemPrice', e.target.value)}
                              placeholder="Amount ₹"
                              className="w-full px-2.5 py-2.5 bg-white dark:bg-slate-900 border border-[#006EC4] rounded-[10px] text-[#006EC4] dark:text-sky-300 text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-[#006EC4]/20"
                            />
                          </div>
                        </div>
                      </div>


                      {isDimensional ? (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-center bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800">
                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1 font-mono">Length (L ft)</label>
                            <input
                              type="number"
                              step="0.01"
                              value={line.inputLength}
                              onChange={(e) => updateMaterialLine(idx, 'inputLength', e.target.value)}
                              placeholder="7"
                              className="w-full px-2.5 py-2 bg-[#F8FAFC] dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 text-xs font-mono"
                              required
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1 font-mono">Breadth (B ft)</label>
                            <input
                              type="number"
                              step="0.01"
                              value={line.inputBreadth}
                              onChange={(e) => updateMaterialLine(idx, 'inputBreadth', e.target.value)}
                              placeholder="3"
                              className="w-full px-2.5 py-2 bg-[#F8FAFC] dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 text-xs font-mono"
                              required
                            />
                          </div>
                          <div>
                            <span className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1 font-mono">Auto Length Used</span>
                            <span className="block px-2.5 py-2 bg-[#EEF5FC] dark:bg-sky-950/60 border border-[#006EC4]/30 rounded-lg text-[#006EC4] dark:text-sky-300 font-mono text-xs font-bold">
                              {feet.toFixed(2)} ft
                            </span>
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1 font-mono">Weight (kg) (Auto: {autoWeightKg})</label>
                            <input
                              type="number"
                              step="0.01"
                              value={line.inputWeightKg}
                              onChange={(e) => updateMaterialLine(idx, 'inputWeightKg', e.target.value)}
                              placeholder={`${autoWeightKg} kg (auto)`}
                              className="w-full px-2.5 py-2 bg-[#FFF4E5]/60 dark:bg-slate-950 border border-amber-400/50 rounded-lg text-amber-700 dark:text-amber-300 text-xs font-mono font-bold"
                            />
                          </div>
                        </div>
                      ) : selectedV ? (
                        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 sm:w-1/2">
                          <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1 font-mono">
                            Quantity / Weight Consumed ({selectedV.base_unit})
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            value={line.quantityConsumed}
                            onChange={(e) => updateMaterialLine(idx, 'quantityConsumed', e.target.value)}
                            placeholder={selectedV.base_unit === 'PIECE' ? 'e.g. 3' : 'e.g. 5'}
                            className="w-full px-2.5 py-2 bg-[#F8FAFC] dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 text-xs font-mono"
                            required
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>


              {/* Step 3: Commercials, Optional GST (0% Default) & Combined Total Amount */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    4. Combined Items Price / Base (₹)
                  </label>
                  {combinedItemsPrice > 0 ? (
                    <div className="w-full px-3.5 py-2.5 bg-[#EEF5FC] dark:bg-sky-950/50 border border-[#006EC4]/30 rounded-[10px] text-[#006EC4] dark:text-sky-300 text-sm font-mono font-bold flex items-center justify-between">
                      <span>₹{combinedItemsPrice.toFixed(2)}</span>
                      <span className="text-[10px] text-slate-500 font-normal">Auto-summed from {materialLines.length} item(s)</span>
                    </div>
                  ) : (
                    <input
                      type="number"
                      step="0.01"
                      value={sellingPrice}
                      onChange={(e) => setSellingPrice(e.target.value)}
                      placeholder="Enter item prices above or total here"
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-[10px] text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-[#006EC4] font-mono"
                      required={combinedItemsPrice <= 0}
                    />
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    5. GST (Optional — 0% Default)
                  </label>
                  <select
                    value={gstRate}
                    onChange={(e) => setGstRate(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-[10px] text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-[#006EC4] font-mono"
                  >
                    <option value="0">0% (No GST — Default)</option>
                    <option value="5">5% GST</option>
                    <option value="12">12% GST</option>
                    <option value="18">18% (Standard GST)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#006EC4] dark:text-sky-400 mb-1.5">
                    6. Final Combined Total (₹)
                  </label>
                  <div className="w-full px-3.5 py-2.5 bg-[#E6F9F0] dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-700 rounded-[10px] text-emerald-700 dark:text-emerald-300 text-sm font-mono font-bold flex items-center justify-between">
                    <span>₹{finalTotalInr.toFixed(2)}</span>
                    <span className="text-[10px] text-slate-500 font-normal">Incl. ₹{gstAmountInr.toFixed(2)} GST</span>
                  </div>
                </div>
              </div>


              {/* Step 4: Summary Card */}
              <div className="mt-5 p-4 bg-[#EEF5FC] dark:bg-slate-900 rounded-2xl border border-[#006EC4]/25 dark:border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
                <div>
                  <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">Auto Length Used:</p>
                  <p className="text-sm sm:text-base font-bold text-[#006EC4] dark:text-sky-300">{totalRunningFeet.toFixed(2)} ft</p>
                </div>
                <div>
                  <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">Total Metal Weight:</p>
                  <p className="text-sm sm:text-base font-bold text-amber-600 dark:text-amber-300">{totalMetalWeightKg.toFixed(2)} kg</p>
                </div>
                <div>
                  <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">GST Amount ({gstRate}%):</p>
                  <p className="text-sm sm:text-base font-bold text-slate-700 dark:text-slate-200">₹{gstAmountInr.toFixed(2)}</p>
                </div>
                <div className="sm:text-right">
                  <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">Final Total Amount:</p>
                  <p className="text-lg sm:text-xl font-bold text-emerald-600 dark:text-emerald-400">₹{finalTotalInr.toFixed(2)}</p>
                </div>
              </div>

              {/* Submit & Preview Buttons */}
              <div className="flex flex-col-reverse sm:flex-row gap-2.5 sm:gap-3 pt-5">
                <button
                  type="button"
                  onClick={() => setActiveTab('dashboard')}
                  className="w-full sm:w-auto px-5 py-3 min-h-[46px] bg-white dark:bg-slate-800 hover:bg-slate-50 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm font-medium rounded-[10px] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handlePreviewDraftInvoice}
                  className="w-full sm:flex-1 py-3 min-h-[46px] bg-[#EEF5FC] dark:bg-slate-900 hover:bg-[#D6E8F8] border border-[#006EC4]/30 text-[#006EC4] dark:text-sky-300 text-sm font-semibold rounded-[10px] transition-colors flex items-center justify-center gap-2"
                >
                  <FileText className="w-4 h-4" />
                  Preview Draft Tax Invoice
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full sm:flex-1 py-3 min-h-[46px] bg-[#006EC4] hover:bg-[#005A9E] disabled:opacity-50 text-white text-sm font-semibold rounded-[10px] transition-colors shadow-sm flex items-center justify-center gap-2"
                >
                  {submitting ? 'Generating Bill...' : 'Generate Bill & Proceed to Approve'}
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </form>
        )}
      </main>


      {/* WORKER BILL DECISION GATEWAY MODAL */}
      {showDecisionModal && selectedDecisionBill && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/30 backdrop-blur-md">
          <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto bg-white dark:bg-[#152036] border-t sm:border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-3xl p-5 sm:p-7 shadow-ims-modal space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-[#006EC4]" />
                  Bill Decision Gateway — #{selectedDecisionBill.bill_number}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Review production consumption and specify routing command.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowDecisionModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#F8FAFC] dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-800 text-xs">
              <div>
                <span className="text-slate-400 uppercase text-[10px]">Product</span>
                <p className="font-semibold text-slate-900 dark:text-white">{selectedDecisionBill.product_name}</p>
              </div>
              <div>
                <span className="text-slate-400 uppercase text-[10px]">Customer</span>
                <p className="font-semibold text-slate-900 dark:text-white">{selectedDecisionBill.customer_name}</p>
              </div>
              <div>
                <span className="text-slate-400 uppercase text-[10px]">Worker</span>
                <p className="font-semibold text-[#006EC4] dark:text-sky-400 font-mono">@{workerUsername}</p>
              </div>
              <div>
                <span className="text-slate-400 uppercase text-[10px]">Final Bill Total</span>
                <p className="font-bold text-emerald-600 dark:text-emerald-400 font-mono text-sm">
                  ₹{parseFloat(selectedDecisionBill.final_total_inr?.toString() || '0').toFixed(2)}
                </p>
              </div>
            </div>
            {selectedDecisionBill.items && selectedDecisionBill.items.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Materials to Consume</span>
                <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/40">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-[#F4F6F9] dark:bg-slate-900 text-slate-600 dark:text-slate-400 text-[10px] uppercase border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="px-3 py-2">Material</th>
                        <th className="px-3 py-2">Dimensions</th>
                        <th className="px-3 py-2 text-right">Feet</th>
                        <th className="px-3 py-2 text-right">Quantity</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50 font-mono text-[11px]">
                      {selectedDecisionBill.items.map((item, idx) => (
                        <tr key={item.id || `dec-item-${idx}`}>
                          <td className="px-3 py-2 font-sans font-medium text-slate-800 dark:text-slate-200">{item.material_name}</td>
                          <td className="px-3 py-2 text-slate-500">
                            {item.input_length && item.input_breadth ? `${item.input_length}' × ${item.input_breadth}'` : 'Direct'}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-300">{item.calculated_feet ? `${item.calculated_feet} ft` : '-'}</td>
                          <td className="px-3 py-2 text-right font-bold text-[#006EC4] dark:text-sky-400">
                            {item.unit === 'GRAM'
                              ? `${(parseFloat(item.actual_quantity_consumed.toString()) / 1000).toFixed(2)} kg`
                              : `${item.actual_quantity_consumed} ${item.unit}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Confirmation Action <span className="text-slate-400 font-normal">(Type Approve or reject)</span>
                </label>
                <input
                  type="text"
                  autoFocus
                  value={commandInput}
                  onChange={(e) => setCommandInput(e.target.value)}
                  placeholder="Enter Approve or reject"
                  className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-[10px] px-4 py-2.5 text-sm text-slate-900 dark:text-white font-mono placeholder-slate-400 focus:outline-none focus:border-[#006EC4]"
                />
              </div>


                {isApproveCmd && (
                  <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-xs text-emerald-700 dark:text-emerald-400 flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <strong className="block font-semibold">Bill Approval (@{workerUsername}):</strong>
                      Consumes material stock from ERP inventory ledger and marks bill as Approved by @{workerUsername}.
                    </div>
                  </div>
                )}

                {isRejectCmd && (
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Reason for Rejection <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                      placeholder="e.g. Incorrect dimensions, revised pricing needed"
                      className="w-full bg-white dark:bg-slate-950 border border-red-300 dark:border-rose-500/50 rounded-[10px] px-4 py-2.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-red-500"
                    />
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-[11px] text-slate-400 mr-1">Quick Fill Mode:</span>
                <button
                  type="button"
                  onClick={() => setCommandInput('Approve')}
                  className="px-3.5 py-1 rounded-full bg-[#EEF5FC] hover:bg-[#D6E8F8] text-[#006EC4] border border-[#006EC4]/40 text-xs font-medium transition"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => setCommandInput('reject')}
                  className="px-3.5 py-1 rounded-full bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 text-xs font-medium transition"
                >
                  Reject Bill
                </button>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowDecisionModal(false)}
                  disabled={processingDecision}
                  className="px-5 py-2.5 rounded-[10px] bg-white dark:bg-slate-800 hover:bg-slate-50 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium text-xs transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleExecuteDecision}
                  disabled={!isValidDecisionCmd || processingDecision || (isRejectCmd && !rejectionReason.trim())}
                  className={`px-6 py-2.5 rounded-[10px] font-medium text-xs transition shadow-sm flex items-center gap-1.5 ${
                    !isValidDecisionCmd
                      ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                      : isRejectCmd
                      ? 'bg-red-600 hover:bg-red-700 text-white'
                      : 'bg-[#006EC4] hover:bg-[#005A9E] text-white'
                  }`}
                >
                  {processingDecision ? 'Processing...' : isRejectCmd ? 'Confirm Rejection' : 'Confirm Approval'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Mobile Bottom Navigation Bar */}
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 dark:bg-[#111C33]/95 backdrop-blur border-t border-slate-200 dark:border-slate-800 pb-safe">
          <div className="grid grid-cols-2 gap-2 p-2 max-w-md mx-auto">
            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold transition ${
                activeTab === 'dashboard'
                  ? 'bg-[#006EC4] text-white shadow-sm'
                  : 'bg-[#EEF5FC] dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              <Clock className="w-4 h-4" />
              <span>48h History ({bills.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('generate')}
              className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold transition ${
                activeTab === 'generate'
                  ? 'bg-[#006EC4] text-white shadow-sm'
                  : 'bg-[#EEF5FC] dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              <Plus className="w-4 h-4" />
              <span>+ Create Bill</span>
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}

