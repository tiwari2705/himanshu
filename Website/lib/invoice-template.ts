/**
 * Vishawkarma Steel Udyog — Exact GST Tax Invoice Template & Number-to-Words Engine
 */

export interface InvoicePartyDetails {
  invoice_no?: string;
  invoice_date?: string;
  invoice_type?: string; // 'Credit' | 'Cash'
  copy_type?: string;    // 'Original Copy' | 'Duplicate Copy'
  seller_state?: string; // '06-Haryana'
  transport_mode?: string;
  vehicle_number?: string;
  date_time_of_supply?: string;
  place_of_supply?: string;
  party_name?: string;
  party_address?: string;
  party_phone?: string;
  party_gstin?: string;
  party_state?: string;
  party_state_code?: string;
  narration?: string;
}

export interface InvoiceLineItemDetail {
  item_detail?: string;
  hsn_code?: string;
  billing_qty?: number;
  uom?: string;
  rate?: number;
  gst_percent?: number;
  gst_amount?: number;
  taxable_amount?: number;
}

export const INDIAN_STATES = [
  { name: 'Haryana', code: '06' },
  { name: 'Rajasthan', code: '08' },
  { name: 'Punjab', code: '03' },
  { name: 'Delhi', code: '07' },
  { name: 'Uttar Pradesh', code: '09' },
  { name: 'Himachal Pradesh', code: '02' },
  { name: 'Chandigarh', code: '04' },
  { name: 'Uttarakhand', code: '05' },
  { name: 'Jammu & Kashmir', code: '01' },
  { name: 'Gujarat', code: '24' },
  { name: 'Maharashtra', code: '27' },
  { name: 'Madhya Pradesh', code: '23' },
  { name: 'Bihar', code: '10' },
];

export function getDefaultHsnAndUom(category?: string, productName?: string): { hsn: string; uom: string } {
  const cat = (category || '').toUpperCase();
  const prod = (productName || '').toUpperCase();
  if (cat === 'PIPE' || prod.includes('GRILL') || prod.includes('PIPE')) {
    return { hsn: '7306', uom: 'kg' };
  }
  if (cat === 'HINGES' || prod.includes('HINGE')) {
    return { hsn: '8302', uom: 'PCS' };
  }
  if (cat === 'PAINT' || prod.includes('PAINT') || prod.includes('PRIMER')) {
    return { hsn: '3208', uom: 'LTR' };
  }
  if (prod.includes('DOOR') || prod.includes('WINDOW') || prod.includes('FRAME') || cat === 'COIL') {
    return { hsn: '7308', uom: 'RMT' };
  }
  return { hsn: '7308', uom: 'kg' };
}

/**
 * Converts a number to Indian Rupees in Words (e.g., 55060 -> "Rs. Fifty Five Thousand and Sixty Only")
 */
export function numberToIndianWords(num: number): string {
  const n = Math.round(Math.max(0, Number(num) || 0));
  if (n === 0) return 'Rs. Zero Only';

  const ones = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'
  ];
  const tens = [
    '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'
  ];

  const twoDigits = (val: number): string => {
    if (val === 0) return '';
    if (val < 20) return ones[val];
    const t = Math.floor(val / 10);
    const o = val % 10;
    return tens[t] + (o > 0 ? ' ' + ones[o] : '');
  };

  let rem = n;
  const parts: string[] = [];

  const crore = Math.floor(rem / 10000000);
  rem %= 10000000;
  if (crore > 0) parts.push(twoDigits(crore) + ' Crore');

  const lakh = Math.floor(rem / 100000);
  rem %= 100000;
  if (lakh > 0) parts.push(twoDigits(lakh) + ' Lakh');

  const thousand = Math.floor(rem / 1000);
  rem %= 1000;
  if (thousand > 0) parts.push(twoDigits(thousand) + ' Thousand');

  const hundred = Math.floor(rem / 100);
  rem %= 100;
  if (hundred > 0) parts.push(ones[hundred] + ' Hundred');

  if (rem > 0) {
    if (parts.length > 0) {
      parts.push('and ' + twoDigits(rem));
    } else {
      parts.push(twoDigits(rem));
    }
  }

  return 'Rs. ' + parts.join(' ') + ' Only';
}

function esc(val: any): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function generateTaxInvoiceHtml(bill: any, copyOverride?: string): string {
  const details: InvoicePartyDetails = bill.invoice_details || {};
  const createdDate = bill.created_at ? new Date(bill.created_at) : new Date();
  const formattedDate =
    details.invoice_date ||
    `${String(createdDate.getDate()).padStart(2, '0')}/${String(createdDate.getMonth() + 1).padStart(2, '0')}/${createdDate.getFullYear()}`;
  const formattedTime = createdDate.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });

  const invoiceNo = details.invoice_no || bill.bill_number || '2026-2027/001';
  const invoiceType = details.invoice_type || 'Credit';
  const copyType = copyOverride || details.copy_type || 'Duplicate Copy';
  const sellerState = details.seller_state || '06-Haryana';
  const transportMode = details.transport_mode || 'Intra';
  const vehicleNo = details.vehicle_number || '-';
  const dateTimeSupply = details.date_time_of_supply || `${formattedDate.replace(/\//g, '-')} & ${formattedTime}`;
  const partyName = details.party_name || bill.customer_name || 'Customer';
  const partyAddress = details.party_address || '-';
  const partyGstin = details.party_gstin || '';
  const partyState = details.party_state || 'Haryana';
  const partyStateCode = details.party_state_code || (partyState.toLowerCase() === 'haryana' ? '06' : '08');
  const placeOfSupply = details.place_of_supply || (partyAddress !== '-' ? partyAddress : partyState);
  const narration = details.narration || '';

  const billGstRate = parseFloat(bill.gst_rate?.toString() || '0') || 0;
  const rawItems: any[] = bill.items || [];

  let totalTaxable = 0;
  let totalGst = 0;

  const lineRows = rawItems.map((it, idx) => {
    const meta: InvoiceLineItemDetail = it.item_details || {};
    const defaults = getDefaultHsnAndUom(it.category, it.material_name || bill.product_name);
    const itemDetail = (meta.item_detail || it.material_name || bill.product_name || 'STEEL FRAME').toUpperCase();
    const hsn = meta.hsn_code || defaults.hsn;
    const uom = meta.uom || (it.calculated_feet ? 'RMT' : it.unit === 'GRAM' ? 'kg' : it.unit || defaults.uom);

    const qty =
      meta.billing_qty !== undefined && meta.billing_qty > 0
        ? Number(meta.billing_qty)
        : it.calculated_feet && Number(it.calculated_feet) > 0
        ? Number(it.calculated_feet)
        : it.unit === 'GRAM'
        ? Number(it.actual_quantity_consumed || 0) / 1000.0
        : Number(it.actual_quantity_consumed || 1);

    const lineTaxable =
      meta.taxable_amount !== undefined && meta.taxable_amount > 0
        ? Number(meta.taxable_amount)
        : rawItems.length === 1
        ? parseFloat(bill.selling_price_inr?.toString() || '0')
        : Number(meta.rate || 0) * qty || parseFloat(bill.selling_price_inr?.toString() || '0') / rawItems.length;

    const rate =
      meta.rate !== undefined && meta.rate > 0
        ? Number(meta.rate)
        : qty > 0
        ? lineTaxable / qty
        : lineTaxable;

    const gstPct = meta.gst_percent !== undefined ? Number(meta.gst_percent) : billGstRate;
    const lineGst =
      meta.gst_amount !== undefined && meta.gst_amount >= 0
        ? Number(meta.gst_amount)
        : lineTaxable * (gstPct / 100.0);

    totalTaxable += lineTaxable;
    totalGst += lineGst;

    return {
      sno: idx + 1,
      itemDetail,
      hsn,
      qty: qty.toFixed(2),
      uom,
      rate: rate.toFixed(2),
      gstPct: gstPct.toFixed(2),
      gstAmt: lineGst.toFixed(2),
      amount: lineTaxable.toFixed(2),
    };
  });

  if (lineRows.length === 0) {
    totalTaxable = parseFloat(bill.selling_price_inr?.toString() || '0');
    totalGst = parseFloat(bill.gst_amount_inr?.toString() || '0');
    lineRows.push({
      sno: 1,
      itemDetail: (bill.product_name || 'PRESSED STEEL DOOR & WINDOW FRAMES').toUpperCase(),
      hsn: '7308',
      qty: '1.00',
      uom: 'PCS',
      rate: totalTaxable.toFixed(2),
      gstPct: billGstRate.toFixed(2),
      gstAmt: totalGst.toFixed(2),
      amount: totalTaxable.toFixed(2),
    });
  }

  const isIntraState = String(partyStateCode).trim() === '06' || partyState.toLowerCase().includes('haryana');
  const cgst = isIntraState ? totalGst / 2.0 : 0;
  const sgst = isIntraState ? totalGst / 2.0 : 0;
  const igst = isIntraState ? 0 : totalGst;
  const grandTotalRounded = Math.round(totalTaxable + totalGst);
  const amountInWords = numberToIndianWords(grandTotalRounded);

  const itemsHtml = lineRows
    .map(
      (r) => `<tr class="item-row"><td class="col-sno">${r.sno}</td><td class="col-desc">${esc(r.itemDetail)}</td><td class="col-hsn">${esc(r.hsn)}</td><td class="col-qty">${r.qty}</td><td class="col-uom">${esc(r.uom)}</td><td class="col-rate">${r.rate}</td><td class="col-gstp">${r.gstPct}</td><td class="col-gst">${r.gstAmt}</td><td class="col-amt">${r.amount}</td></tr>`
    )
    .join('');

  const styles = `
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; background: #f1f5f9; padding: 16px; font-size: 12px; }
    .toolbar { max-width: 794px; margin: 0 auto 12px auto; display: flex; justify-content: space-between; align-items: center; background: #0f172a; color: #fff; padding: 10px 16px; border-radius: 8px; }
    .toolbar button { background: #10b981; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 13px; }
    .page { max-width: 794px; margin: 0 auto; background: #fff; border: 1.5px solid #111; padding: 10px 12px; }
    .top-bar { display: flex; justify-content: space-between; align-items: flex-start; font-size: 12px; margin-bottom: 2px; }
    .top-center { text-align: center; }
    .top-center .tax-title { font-weight: bold; font-size: 14px; }
    .top-center .credit-sub { font-weight: bold; font-size: 12px; }
    .top-right { text-align: right; font-size: 12px; }
    .company-name { text-align: center; font-size: 28px; font-weight: 800; margin-top: 2px; }
    .company-addr { text-align: center; font-size: 12.5px; font-weight: bold; margin-bottom: 6px; }
    .black-banner { background: #1e293b; color: #fff; text-align: center; font-weight: bold; font-size: 12.5px; padding: 4px 8px; border-top: 1.5px solid #111; border-bottom: 1.5px solid #111; }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1.5px solid #111; }
    .meta-col { padding: 4px 6px; font-size: 11.5px; line-height: 1.45; }
    .meta-col:first-child { border-right: 1.5px solid #111; }
    .meta-row { display: grid; grid-template-columns: 130px 10px 1fr; }
    .party-box { padding: 4px 6px; border-bottom: 1.5px solid #111; font-size: 11.5px; line-height: 1.45; }
    .party-header { font-weight: bold; text-decoration: underline; margin-bottom: 2px; }
    .party-row { display: grid; grid-template-columns: 95px 1fr; }
    table.items-table { width: 100%; border-collapse: collapse; border-bottom: 1.5px solid #111; }
    table.items-table th { border-bottom: 1.5px solid #111; border-right: 1px solid #111; padding: 4px 5px; font-size: 11.5px; font-weight: bold; background: #e2e8f0; }
    table.items-table th:last-child, table.items-table td:last-child { border-right: none; }
    table.items-table td { border-right: 1px solid #111; padding: 4px 5px; font-size: 11px; vertical-align: top; }
    .col-sno { width: 34px; text-align: left; } .col-desc { text-align: left; font-weight: 600; } .col-hsn { width: 55px; text-align: center; } .col-qty { width: 62px; text-align: right; } .col-uom { width: 48px; text-align: center; } .col-rate { width: 65px; text-align: right; } .col-gstp { width: 55px; text-align: right; } .col-gst { width: 68px; text-align: right; } .col-amt { width: 82px; text-align: right; font-weight: 600; }
    .filler-row td { height: 200px; }
    .bottom-grid { display: grid; grid-template-columns: 1.15fr 0.85fr; border-bottom: 1.5px solid #111; }
    .bottom-left { border-right: 1.5px solid #111; display: flex; flex-direction: column; justify-content: space-between; }
    .bank-box { padding: 6px; font-size: 11.5px; font-weight: bold; line-height: 1.5; }
    .words-box { border-top: 1px solid #111; padding: 4px 6px; font-size: 11px; }
    .gst-summary-bar { border-top: 1px solid #111; padding: 3px 6px; font-size: 11px; font-weight: bold; }
    .totals-table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
    .totals-table td { padding: 4px 6px; border-bottom: 1px solid #111; }
    .totals-table tr:last-child td { border-bottom: none; font-weight: 800; font-size: 13px; }
    .totals-table td:first-child { border-right: 1px solid #111; font-weight: bold; }
    .totals-table td:last-child { text-align: right; width: 110px; font-weight: bold; }
    .stamp-area { height: 95px; display: flex; align-items: center; justify-content: flex-end; padding-right: 36px; border-bottom: 1.5px solid #111; }
    .rubber-stamp { color: #1e3a8a; text-align: center; font-weight: bold; font-size: 14px; line-height: 1.25; }
    .footer-grid { display: grid; grid-template-columns: 1.3fr 0.7fr; font-size: 10px; }
    .terms-box { padding: 5px 6px; border-right: 1.5px solid #111; line-height: 1.35; font-weight: 600; }
    .sign-box { padding: 5px 6px; text-align: center; display: flex; flex-direction: column; justify-content: space-between; min-height: 68px; font-weight: bold; }
    .dev-credit { text-align: center; font-size: 10px; font-weight: bold; margin-top: 4px; }
    @media print { body { background: #fff; padding: 0; } .toolbar { display: none !important; } .page { max-width: 100%; border: 1.5px solid #000; } }
  `;
  // END_STYLES_PLACEHOLDER
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Tax Invoice - ${esc(invoiceNo)}</title><style>${styles}</style></head>
<body>
  <div class="toolbar">
    <div><strong>Vishawkarma Steel Udyog — GST Tax Invoice (${esc(invoiceNo)})</strong></div>
    <button onclick="window.print()">🖨️ Print / Download PDF</button>
  </div>
  <div class="page">
    <div class="top-bar">
      <div><strong>Gstin :06Beypj3805f2zb</strong></div>
      <div class="top-center"><div class="tax-title">TAX INVOICE</div><div class="credit-sub">${esc(invoiceType)}</div></div>
      <div class="top-right"><div><strong>9330300009</strong></div><div>${esc(copyType)}</div></div>
    </div>
    <div class="company-name">Vishawkarma Steel Udyog</div>
    <div class="company-addr">Shri Jiwan Nagar Road ,Dhani Lehranwali , Rania , Sirsa , Hry (125076)</div>
    <div class="black-banner">Stainless Steel And Colour Coated Pressed Door &amp; Window Frames,Gp Sheet Etc.</div>
    <div class="meta-grid">
      <div class="meta-col">
        <div class="meta-row"><span>Invoice No.</span><span>:</span><strong>${esc(invoiceNo)}</strong></div>
        <div class="meta-row"><span>Invoice Date.</span><span>:</span><span>${esc(formattedDate)}</span></div>
        <div class="meta-row"><span>State</span><span>:</span><span>${esc(sellerState)}</span></div>
      </div>
      <div class="meta-col">
        <div class="meta-row"><span>Transport Mode</span><span>:</span><span>${esc(transportMode)}</span></div>
        <div class="meta-row"><span>Vehicle Number</span><span>:</span><span>${esc(vehicleNo)}</span></div>
        <div class="meta-row"><span>Date &amp; Time of Supply</span><span>:</span><span>${esc(dateTimeSupply)}</span></div>
        <div class="meta-row"><span>Place of Supply</span><span>:</span><span>${esc(placeOfSupply)}</span></div>
      </div>
    </div>
    <div class="party-box">
      <div class="party-header">Party Details :</div>
      <div class="party-row"><span>Name</span><strong>${esc(partyName)}</strong></div>
      <div class="party-row"><span>Address</span><span>${esc(partyAddress)}</span></div>
      <div class="party-row"><span>GSTIN / UIN</span><strong>${esc(partyGstin || '-')}</strong></div>
      <div class="party-row"><span>State</span><span>${esc(partyState)} &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <strong>StateCode :</strong> ${esc(partyStateCode)}</span></div>
    </div>
    <table class="items-table">
      <thead>
        <tr>
          <th class="col-sno">S.No</th><th class="col-desc">ItemDetail</th><th class="col-hsn">HSN</th><th class="col-qty">Qty.</th><th class="col-uom">UOM</th><th class="col-rate">Rate</th><th class="col-gstp">GST(%)</th><th class="col-gst">GST</th><th class="col-amt">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
        <tr class="filler-row"><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
      </tbody>
    </table>
    <div class="bottom-grid">
      <div class="bottom-left">
        <div class="bank-box">
          <div>BANK DETAILS : Hdfc Bank</div>
          <div>A/c No. : 50200107392018</div>
          <div style="margin-top:6px;">IFSC : Hdfc0006644</div>
        </div>
        <div>
          <div class="words-box">Narration: ${esc(narration)}</div>
          <div class="words-box"><div style="font-weight:bold;">Total Invoice Amt in Words :</div><div>${esc(amountInWords)}</div></div>
          <div class="gst-summary-bar">GST (${billGstRate.toFixed(2)}%) - ${totalTaxable.toFixed(2)} + ${totalGst.toFixed(2)}</div>
        </div>
      </div>
      <div>
        <table class="totals-table">
          <tr><td>Total Amount Before Tax</td><td>${totalTaxable.toFixed(2)}</td></tr>
          <tr><td>Add CGST</td><td>${cgst.toFixed(2)}</td></tr>
          <tr><td>Add SGST</td><td>${sgst.toFixed(2)}</td></tr>
          <tr><td>Add IGST</td><td>${igst.toFixed(2)}</td></tr>
          <tr><td>Total Tax Amount GST</td><td>${totalGst.toFixed(2)}</td></tr>
          <tr><td>Total Amount After TAX</td><td>${grandTotalRounded}</td></tr>
        </table>
      </div>
    </div>
    <div class="stamp-area">
      <div class="rubber-stamp"><div>VISHAWKARMA STEEL UDYOG</div><div>Shri Jiwan Nagar Road,</div><div>Rania, Sirsa (Haryana)</div></div>
    </div>
    <div class="footer-grid">
      <div class="terms-box">1. All Disputes Subject To Sirsa Jurisdiction. &nbsp; 2. Goods Sold Are Under Manufacturer's Guarantee , Terms &amp; Conditions For Which We Are Not Liable And Only The Concerned Company Is Liable For Any Direct/Indirect Damage. &nbsp; 3. Goods Once Sold Will Not Be Taken Back At Any Cost (We Will Not Be Held Liable For Any Corrosion That May Occur On Our Goods)</div>
      <div class="sign-box"><div>Certified that the particulars given above are true and correct</div><div>For Vishawkarma Steel Udyog</div><div style="margin-top:14px;">Authorised Signatory</div></div>
    </div>
  </div>
  <div class="dev-credit">Software Developed By : Einix Infotech Pvt. Ltd. ,Hisar Road Sirsa (Haryana-125055), Ph. 9050073902</div>
</body>
</html>`;
}

export function openAndPrintTaxInvoice(bill: any, copyOverride?: string) {
  const html = generateTaxInvoiceHtml(bill, copyOverride);
  const win = window.open('', '_blank', 'width=900,height=1000');
  if (win) {
    win.document.open();
    win.document.write(html);
    win.document.close();
  }
}
