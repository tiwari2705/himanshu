/**
 * Manufacturing, Unit Conversion & BOM Calculation Engine
 * Modeled directly on InvenTree (part/models.py BomItem.get_required_quantity & InvenTree/conversion.py)
 * Enforced on both Client Preview and Server-Side Validation.
 */

export type FrameFormulaType = 'DOOR_2L_PLUS_B' | 'WINDOW_2_L_PLUS_B' | 'CUSTOM';
export type MaterialCategory = 'COIL' | 'PIPE' | 'HINGES' | 'PAINT' | 'OTHER';

/**
 * Unit conversion helper modeled on InvenTree/conversion.py (convert_physical_value).
 * Supports mass (kg, g, ton), length (ft, in, m, cm, mm, plus ' and " shorthand),
 * volume (litre, ml), and discrete counts (pcs, piece, dozen).
 */
export function convertPhysicalValue(
  rawValue: number | string,
  fromUnit: string,
  toUnit?: string
): number {
  let strVal = String(rawValue ?? '').trim();
  if (!strVal) return 0;

  let inferredUnit = (fromUnit || '').trim().toLowerCase();

  // InvenTree imperial shorthand support: e.g. 7' -> feet, 36" -> inches
  if (strVal.endsWith("'") && (strVal.match(/'/g) || []).length === 1) {
    strVal = strVal.replace("'", '').trim();
    inferredUnit = 'ft';
  } else if (strVal.endsWith('"') && (strVal.match(/"/g) || []).length === 1) {
    strVal = strVal.replace('"', '').trim();
    inferredUnit = 'in';
  }

  // InvenTree engineering notation support: e.g. 1K2 -> 1.2K
  const engMatch = strVal.match(/^(\d+)([kKmMgG])(\d+)$/);
  if (engMatch) {
    const [, left, prefix, right] = engMatch;
    const baseNum = parseFloat(`${left}.${right}`);
    const mult = prefix.toLowerCase() === 'k' ? 1000 : prefix === 'M' ? 1e6 : 1;
    return baseNum * mult;
  }

  const num = parseFloat(strVal);
  if (isNaN(num)) return 0;

  const target = (toUnit || inferredUnit).trim().toLowerCase();
  if (!target || target === inferredUnit) return num;

  // Mass conversions (base: gram)
  const massToGram: Record<string, number> = {
    g: 1,
    gm: 1,
    gram: 1,
    grams: 1,
    kg: 1000,
    kgs: 1000,
    kilogram: 1000,
    kilograms: 1000,
    ton: 1_000_000,
    metric_ton: 1_000_000,
  };

  if (massToGram[inferredUnit] && massToGram[target]) {
    return (num * massToGram[inferredUnit]) / massToGram[target];
  }

  // Length conversions (base: feet)
  const lengthToFeet: Record<string, number> = {
    ft: 1,
    feet: 1,
    foot: 1,
    in: 1 / 12,
    inch: 1 / 12,
    inches: 1 / 12,
    m: 3.280839895,
    meter: 3.280839895,
    meters: 3.280839895,
    cm: 0.03280839895,
    mm: 0.003280839895,
  };

  if (lengthToFeet[inferredUnit] && lengthToFeet[target]) {
    return (num * lengthToFeet[inferredUnit]) / lengthToFeet[target];
  }

  // Volume conversions (base: litre)
  const volToLitre: Record<string, number> = {
    l: 1,
    ltr: 1,
    litre: 1,
    litres: 1,
    liter: 1,
    ml: 0.001,
  };

  if (volToLitre[inferredUnit] && volToLitre[target]) {
    return (num * volToLitre[inferredUnit]) / volToLitre[target];
  }

  // Discrete count conversions (base: piece)
  const countToPiece: Record<string, number> = {
    pcs: 1,
    pc: 1,
    piece: 1,
    pieces: 1,
    nos: 1,
    dozen: 12,
  };

  if (countToPiece[inferredUnit] && countToPiece[target]) {
    return (num * countToPiece[inferredUnit]) / countToPiece[target];
  }

  return num;
}

/**
 * InvenTree BomItem.get_required_quantity implementation (part/models.py lines 3507-3555):
 * Total material = (quantity * piece_count * build_quantity) * (1 + attrition/100) + setup_quantity
 * Rounded up to nearest rounding_multiple if specified.
 */
export function getRequiredQuantity(params: {
  quantity: number;
  pieceCount?: number;
  buildQuantity?: number;
  attritionPercent?: number;
  setupQuantity?: number;
  roundingMultiple?: number | null;
}): number {
  const qty = Math.max(0, Number(params.quantity) || 0);
  const pieceCount = Math.max(1, Math.floor(Number(params.pieceCount) || 1));
  const buildQty = Math.max(1, Number(params.buildQuantity) || 1);
  const attrition = Math.max(0, Number(params.attritionPercent) || 0);
  const setupQty = Math.max(0, Number(params.setupQuantity) || 0);
  const rounding = params.roundingMultiple ? Number(params.roundingMultiple) : 0;

  // Base requirement: quantity * piece_count * build_quantity
  let required = qty * pieceCount * buildQty;

  // Account for percentage attrition (cutting/production loss)
  if (attrition > 0) {
    required *= 1 + attrition / 100.0;
  }

  // Account for fixed setup quantity loss
  if (setupQty > 0) {
    required += setupQty;
  }

  // Round up to nearest multiple if specified
  if (rounding > 0) {
    required = Math.ceil(required / rounding) * rounding;
  }

  return Number(required.toFixed(5));
}

export interface DimensionalInput {
  formulaType: FrameFormulaType;
  lengthFeet: number;
  breadthFeet: number;
  pieceCount?: number;
  attritionPercent?: number;
  setupQuantity?: number;
  roundingMultiple?: number | null;
  bomWeightPerFootGrams: number; // e.g. 1000 for Coil, 600 for 1x1 Pipe
  unitCostInr?: number;
}

export interface DimensionalResult {
  runningFeet: number;
  consumedGrams: number;
  consumedKg: number;
  lineCostInr: number;
}

/**
 * Calculates running feet based on product formula type (adapted from InvenTree BOM & dimensional formulas):
 * - DOOR_2L_PLUS_B: (2 * L) + B
 * - WINDOW_2_L_PLUS_B: 2 * (L + B)
 * - CUSTOM: if B > 0 then 2 * (L + B), else L
 * Total running feet = per_piece_perimeter * piece_count
 */
export function calculateRunningFeet(
  formulaType: FrameFormulaType,
  lengthFeet: number,
  breadthFeet: number,
  pieceCount: number = 1
): number {
  const l = Math.max(0, Number(lengthFeet) || 0);
  const b = Math.max(0, Number(breadthFeet) || 0);
  const pcs = Math.max(1, Number(pieceCount) || 1);

  if (l === 0 && b === 0) return 0;

  let singlePerimeter = 0;
  switch (formulaType) {
    case 'DOOR_2L_PLUS_B':
      singlePerimeter = b > 0 ? 2 * l + b : l;
      break;
    case 'WINDOW_2_L_PLUS_B':
      singlePerimeter = b > 0 ? 2 * (l + b) : l;
      break;
    case 'CUSTOM':
    default:
      singlePerimeter = b > 0 ? 2 * (l + b) : l;
      break;
  }

  return getRequiredQuantity({
    quantity: singlePerimeter,
    pieceCount: pcs,
    buildQuantity: 1,
  });
}

/**
 * Calculates consumed weight and line cost for dimensional materials (Coil & Pipe)
 * using InvenTree's BomItem.get_required_quantity logic
 */
export function calculateDimensionalMaterial(input: DimensionalInput): DimensionalResult {
  const singlePieceFeet = calculateRunningFeet(
    input.formulaType,
    input.lengthFeet,
    input.breadthFeet,
    1
  );

  const runningFeet = getRequiredQuantity({
    quantity: singlePieceFeet,
    pieceCount: input.pieceCount || 1,
    buildQuantity: 1,
    attritionPercent: input.attritionPercent || 0,
    setupQuantity: input.setupQuantity || 0,
    roundingMultiple: input.roundingMultiple || null,
  });

  const bomGrams = Math.max(0, Number(input.bomWeightPerFootGrams) || 0);
  const consumedGrams = runningFeet * bomGrams;
  const consumedKg = consumedGrams / 1000.0;

  const unitCost = Number(input.unitCostInr) || 0;
  // unitCostInr is cost per base_unit (GRAM)
  const lineCostInr = consumedGrams * unitCost;

  return {
    runningFeet: Number(runningFeet.toFixed(2)),
    consumedGrams: Number(consumedGrams.toFixed(2)),
    consumedKg: Number(consumedKg.toFixed(4)),
    lineCostInr: Number(lineCostInr.toFixed(2)),
  };
}

/**
 * Calculates GST amount and final total (GST-Exclusive):
 * GST Amount = Selling Price * (GST Rate / 100)
 * Final Total = Selling Price + GST Amount
 */
export function calculateGst(
  sellingPriceInr: number,
  gstRatePercent: number = 0
): { gstAmountInr: number; finalTotalInr: number } {
  const sp = Math.max(0, Number(sellingPriceInr) || 0);
  const rate = Math.max(0, typeof gstRatePercent === 'number' && !isNaN(gstRatePercent) ? gstRatePercent : 0);

  const gstAmountInr = sp * (rate / 100.0);
  const finalTotalInr = sp + gstAmountInr;

  return {
    gstAmountInr: Number(gstAmountInr.toFixed(2)),
    finalTotalInr: Number(finalTotalInr.toFixed(2)),
  };
}

/**
 * Validates and aggregates complete bill items for a production order
 */
export interface MaterialLineItemInput {
  materialVariantId: string;
  category: MaterialCategory;
  name: string;
  formulaType?: FrameFormulaType;
  pieceCount?: number;
  attritionPercent?: number;
  setupQuantity?: number;
  roundingMultiple?: number;
  itemPriceInr?: number;
  inputLength?: number;
  inputBreadth?: number;
  bomWeightPerFootGrams?: number;
  quantityConsumed?: number;
  inputWeightKg?: number;
  unit: string;
  unitCostInr: number;
}

export interface CalculatedBillSummary {
  calculatedItems: {
    materialVariantId: string;
    pieceCount: number;
    inputLength: number | null;
    inputBreadth: number | null;
    calculatedFeet: number | null;
    actualQuantityConsumed: number;
    unit: string;
    lineCostInr: number;
    itemPriceInr: number;
    metalWeightKg: number;
  }[];
  totalMetalWeightKg: number;
  productionCostInr: number;
  combinedItemsPriceInr: number;
  sellingPriceInr: number;
  gstRate: number;
  gstAmountInr: number;
  finalTotalInr: number;
}

export function calculateBillSummary(
  formulaType: FrameFormulaType,
  items: MaterialLineItemInput[],
  sellingPriceInr: number,
  gstRatePercent: number = 0
): CalculatedBillSummary {
  let totalMetalWeightKg = 0;
  let productionCostInr = 0;
  let combinedItemsPriceInr = 0;

  const calculatedItems = items.map((item) => {
    let calculatedFeet: number | null = null;
    let actualQuantityConsumed = 0;
    let lineCostInr = 0;
    let metalWeightKg = 0;
    const lineFormula = item.formulaType || formulaType;
    const pcs = Math.max(1, Math.floor(Number(item.pieceCount) || 1));
    const itemPrice = Math.max(0, Number(item.itemPriceInr) || 0);
    combinedItemsPriceInr += itemPrice;

    const hasDimensions =
      (item.inputLength !== undefined && item.inputLength > 0) ||
      (item.inputBreadth !== undefined && item.inputBreadth > 0);

    if (item.category === 'COIL' || item.category === 'PIPE' || item.unit === 'FEET' || (hasDimensions && (item.unit === 'GRAM' || item.unit === 'KG'))) {
      const dim = calculateDimensionalMaterial({
        formulaType: lineFormula,
        lengthFeet: item.inputLength || 0,
        breadthFeet: item.inputBreadth || 0,
        pieceCount: pcs,
        attritionPercent: item.attritionPercent || 0,
        setupQuantity: item.setupQuantity || 0,
        roundingMultiple: item.roundingMultiple || null,
        bomWeightPerFootGrams: item.bomWeightPerFootGrams || (item.unit === 'GRAM' ? 1000 : 0),
        unitCostInr: item.unitCostInr,
      });

      calculatedFeet = dim.runningFeet;

      if (item.unit === 'GRAM') {
        if (item.inputWeightKg !== undefined && item.inputWeightKg > 0) {
          actualQuantityConsumed = item.inputWeightKg * 1000.0;
          metalWeightKg = item.inputWeightKg;
        } else {
          actualQuantityConsumed = dim.consumedGrams;
          metalWeightKg = dim.consumedKg;
        }
        lineCostInr = actualQuantityConsumed * (Number(item.unitCostInr) || 0);
      } else if (item.unit === 'KG') {
        if (item.inputWeightKg !== undefined && item.inputWeightKg > 0) {
          actualQuantityConsumed = item.inputWeightKg;
          metalWeightKg = item.inputWeightKg;
        } else if (dim.consumedKg > 0) {
          actualQuantityConsumed = dim.consumedKg;
          metalWeightKg = dim.consumedKg;
        } else {
          actualQuantityConsumed = getRequiredQuantity({ quantity: Math.max(0, Number(item.quantityConsumed) || 0), pieceCount: pcs });
          metalWeightKg = actualQuantityConsumed;
        }
        lineCostInr = actualQuantityConsumed * (Number(item.unitCostInr) || 0);
      } else if (item.unit === 'FEET') {
        actualQuantityConsumed = calculatedFeet > 0 ? calculatedFeet : getRequiredQuantity({ quantity: Math.max(0, Number(item.quantityConsumed) || 0), pieceCount: pcs });
        metalWeightKg = item.inputWeightKg !== undefined && item.inputWeightKg > 0 ? item.inputWeightKg : dim.consumedKg;
        lineCostInr = actualQuantityConsumed * (Number(item.unitCostInr) || 0);
      } else {
        actualQuantityConsumed = Math.max(0, Number(item.quantityConsumed) || calculatedFeet || 0);
        lineCostInr = actualQuantityConsumed * (Number(item.unitCostInr) || 0);
      }

      totalMetalWeightKg += metalWeightKg;
    } else {
      const baseQty = Math.max(0, Number(item.quantityConsumed) || Number(item.inputWeightKg) || 0);
      actualQuantityConsumed = getRequiredQuantity({
        quantity: baseQty,
        pieceCount: pcs,
        attritionPercent: item.attritionPercent || 0,
        setupQuantity: item.setupQuantity || 0,
        roundingMultiple: item.roundingMultiple || null,
      });
      if (item.unit === 'KG') {
        metalWeightKg = actualQuantityConsumed;
        totalMetalWeightKg += metalWeightKg;
      } else if (item.unit === 'GRAM') {
        metalWeightKg = actualQuantityConsumed / 1000.0;
        totalMetalWeightKg += metalWeightKg;
      } else if (item.inputWeightKg && item.inputWeightKg > 0) {
        metalWeightKg = Number(item.inputWeightKg);
        totalMetalWeightKg += metalWeightKg;
      }
      lineCostInr = actualQuantityConsumed * (Number(item.unitCostInr) || 0);
    }

    productionCostInr += lineCostInr;

    return {
      materialVariantId: item.materialVariantId,
      pieceCount: pcs,
      inputLength: item.inputLength !== undefined ? Number(item.inputLength) : null,
      inputBreadth: item.inputBreadth !== undefined ? Number(item.inputBreadth) : null,
      calculatedFeet,
      actualQuantityConsumed: Number(actualQuantityConsumed.toFixed(4)),
      unit: item.unit,
      lineCostInr: Number(lineCostInr.toFixed(2)),
      itemPriceInr: Number(itemPrice.toFixed(2)),
      metalWeightKg: Number(metalWeightKg.toFixed(4)),
    };
  });

  const effectiveSellingPrice =
    Number(sellingPriceInr) > 0 ? Number(sellingPriceInr) : combinedItemsPriceInr;

  const { gstAmountInr, finalTotalInr } = calculateGst(effectiveSellingPrice, gstRatePercent);

  return {
    calculatedItems,
    totalMetalWeightKg: Number(totalMetalWeightKg.toFixed(4)),
    productionCostInr: Number(productionCostInr.toFixed(2)),
    combinedItemsPriceInr: Number(combinedItemsPriceInr.toFixed(2)),
    sellingPriceInr: Number(effectiveSellingPrice.toFixed(2)),
    gstRate: Number(gstRatePercent),
    gstAmountInr,
    finalTotalInr,
  };
}
