import * as XLSX from 'xlsx';
import crypto from 'crypto';
import { PetpoojaReportType } from '@/lib/types/sales';
import { normalizeItemName, resolveParentCategory } from './matcher';

export interface ParseResult {
  reportType: PetpoojaReportType;
  businessDate: string;
  fileChecksum: string;
  recordCount: number;
  totalNetSales: number;
  totalGrossSales: number;
  metadata: Record<string, any>;
  data: any[];
}

/**
 * Calculates SHA-256 checksum of an uploaded file buffer
 */
export function calculateFileChecksum(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Cleans string numbers containing HTML entities (like &#8377;), currency symbols, commas, or whitespace
 */
export function cleanNumericValue(val: any): number {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (!val) return 0;
  const cleaned = String(val)
    .replace(/&#\d+;/g, '') // decode/strip HTML entity codes like &#8377;
    .replace(/&[a-zA-Z]+;/g, '') // decode/strip named HTML entities like &nbsp;
    .replace(/[₹,$\s]/g, '') // remove currency symbol, dollar, commas, whitespace
    .trim();
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Parses a date string like "2026-09-18 to 2026-09-18", "18 Sep 2026 To 18 Sep 2026",
 * "18-09-2026 23:16", or "18-09-2026" into standard "YYYY-MM-DD".
 * Returns empty string if no valid date is matched. NEVER defaults to today's date.
 */
export function normalizeDateStringToIso(dateStr: string): string {
  if (!dateStr) return '';

  const clean = String(dateStr).trim();

  // Pattern: "YYYY-MM-DD to YYYY-MM-DD" or "YYYY-MM-DD"
  const isoMatch = clean.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  // Pattern: "18 Sep 2026 To 18 Sep 2026", "18 Sep 2026", "18 September 2026"
  const textMonthMatch = clean.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/i);
  if (textMonthMatch) {
    const day = textMonthMatch[1].padStart(2, '0');
    const monStr = textMonthMatch[2].substring(0, 3).toLowerCase();
    const year = textMonthMatch[3];
    const months: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const mon = months[monStr];
    if (mon) {
      return `${year}-${mon}-${day}`;
    }
  }

  // Pattern: "19-09-2026" or "19/09/2026" or "19-09-2026 00:21"
  const dmyMatch = clean.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const mon = dmyMatch[2].padStart(2, '0');
    const year = dmyMatch[3];
    return `${year}-${mon}-${day}`;
  }

  return '';
}

/**
 * Normalizes 12-hour AM/PM string (e.g. "2:00 PM", "12:00 AM", "10:00 PM")
 * into 24-hour integer (0..23) and formatted label ("02:00 PM")
 */
export function parseHourString(hourStr: string): { hourOfDay: number; hourLabel: string } {
  const clean = hourStr.trim().toUpperCase();
  const match = clean.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);

  if (!match) {
    return { hourOfDay: 12, hourLabel: '12:00 PM' };
  }

  let h = parseInt(match[1], 10);
  const m = match[2] || '00';
  const meridiem = match[3] ? match[3].toUpperCase() : 'AM';

  if (meridiem === 'PM' && h < 12) {
    h += 12;
  } else if (meridiem === 'AM' && h === 12) {
    h = 0;
  }

  const displayH = h % 12 === 0 ? 12 : h % 12;
  const displayMeridiem = h >= 12 ? 'PM' : 'AM';
  const hourLabel = `${String(displayH).padStart(2, '0')}:${m} ${displayMeridiem}`;

  return { hourOfDay: h, hourLabel };
}

/**
 * Parses raw Petpooja Excel (.xlsx, .xls) or CSV buffer into structured rows
 */
export function parsePetpoojaBuffer(buffer: Buffer, fileName: string): ParseResult {
  const fileChecksum = calculateFileChecksum(buffer);

  // Read workbook via SheetJS
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false, cellDates: false });

  // In multi-table HTML-based .xls files (e.g. Executive Summary), SheetJS puts each table into a separate sheet.
  // Combine rows across all sheets sequentially to preserve all tables and sections.
  const sheetRows: any[][] = [];
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;
    const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
      blankrows: false,
    });
    if (rows && rows.length > 0) {
      sheetRows.push(...rows);
    }
  }

  if (sheetRows.length === 0) {
    throw new Error('The uploaded file is empty or could not be parsed.');
  }

  // Detect report type by scanning rows
  let detectedType: PetpoojaReportType | null = null;
  let headerRowIndex = -1;

  for (let i = 0; i < Math.min(25, sheetRows.length); i++) {
    const rowText = sheetRows[i].map((c) => String(c || '').trim()).join(' ');

    if (/Item Sale Report:\s*Hourly Wise/i.test(rowText) || /Hourly Wise/i.test(rowText)) {
      detectedType = 'HOURLY_ITEM_SALES';
    } else if (/Orders:\s*Master Report/i.test(rowText) || /Orders Master/i.test(rowText)) {
      detectedType = 'ORDERS_MASTER';
    } else if (
      /Executive Sales Report Summary/i.test(rowText) ||
      /Billing \(Success\)/i.test(rowText) ||
      /Success Orders/i.test(rowText)
    ) {
      detectedType = 'EXECUTIVE_SUMMARY';
    } else if (/Parent_Category/i.test(rowText) && /GST%/i.test(rowText)) {
      detectedType = 'MENU_MASTER';
      headerRowIndex = i;
    }
  }

  // Secondary detection via column headers if header label was not found in top rows
  if (!detectedType) {
    for (let i = 0; i < Math.min(20, sheetRows.length); i++) {
      const row = sheetRows[i].map((c) => String(c || '').trim().toLowerCase());
      if (row.includes('hour') && row.includes('item') && row.some((c) => c.includes('net sales'))) {
        detectedType = 'HOURLY_ITEM_SALES';
        headerRowIndex = i;
        break;
      }
      if (row.includes('invoice no.') || (row.includes('biller') && row.includes('kot no.'))) {
        detectedType = 'ORDERS_MASTER';
        headerRowIndex = i;
        break;
      }
      if (
        row.includes('billing (success)') ||
        row.includes('success orders') ||
        row.includes('executive sales report summary') ||
        row.some((c) => c.includes('executive sales') || c.includes('success orders'))
      ) {
        detectedType = 'EXECUTIVE_SUMMARY';
        break;
      }
      if (row.includes('parent_category') || (row.includes('category') && row.includes('price'))) {
        detectedType = 'MENU_MASTER';
        headerRowIndex = i;
        break;
      }
    }
  }

  if (!detectedType) {
    throw new Error(
      'Unsupported Petpooja report format. Supported formats: Hourly Item Sales, Orders Master, Executive Sales Summary, or Menu Master.'
    );
  }

  // Delegate to specific parsers
  switch (detectedType) {
    case 'HOURLY_ITEM_SALES':
      return parseHourlyItemSalesReport(sheetRows, fileName, fileChecksum);
    case 'ORDERS_MASTER':
      return parseOrdersMasterReport(sheetRows, fileName, fileChecksum);
    case 'EXECUTIVE_SUMMARY':
      return parseExecutiveSummaryReport(sheetRows, fileName, fileChecksum);
    case 'MENU_MASTER':
      return parseMenuMasterReport(sheetRows, fileName, fileChecksum, headerRowIndex);
  }
}

/**
 * 1. HOURLY ITEM SALES REPORT
 */
function parseHourlyItemSalesReport(sheetRows: any[][], fileName: string, fileChecksum: string): ParseResult {
  let businessDate = '';
  let headerIndex = -1;

  // Extract Date from rows 0..15
  for (let i = 0; i < Math.min(15, sheetRows.length); i++) {
    const row = sheetRows[i].map((c) => String(c || '').trim());
    for (let c = 0; c < row.length; c++) {
      if (/(?:period|date)\s*:/i.test(row[c])) {
        const inlineVal = row[c].replace(/^(?:period|date)\s*:\s*/i, '').trim();
        const nextCell = row[c + 1] ? String(row[c + 1]).trim() : '';
        const candidate = nextCell || inlineVal;
        if (candidate) {
          const parsed = normalizeDateStringToIso(candidate);
          if (parsed) {
            businessDate = parsed;
            break;
          }
        }
      }
    }
    if (row.map((c) => c.toLowerCase()).includes('hour') && row.map((c) => c.toLowerCase()).includes('item')) {
      headerIndex = i;
    }
    if (businessDate && headerIndex !== -1) break;
  }

  if (!businessDate) {
    throw new Error(`Unable to extract report/business date from inside Hourly Item Sales report (${fileName}).`);
  }

  if (headerIndex === -1) headerIndex = 5; // Default fallback header index

  const rawHeaders = sheetRows[headerIndex].map((h) => String(h || '').trim());
  const colIndex: Record<string, number> = {};
  rawHeaders.forEach((h, idx) => {
    const clean = h.toLowerCase();
    if (clean === 'hour') colIndex.hour = idx;
    if (clean === 'item') colIndex.item = idx;
    if (clean === 'price') colIndex.price = idx;
    if (clean === 'quantity') colIndex.quantity = idx;
    if (clean.includes('net amount')) colIndex.netAmount = idx;
    if (clean.includes('discount')) colIndex.discount = idx;
    if (clean.includes('tax')) colIndex.tax = idx;
    if (clean.includes('total sales')) colIndex.totalSales = idx;
    if (clean.includes('net sales')) colIndex.netSales = idx;
  });

  let currentHour = '12:00 AM';
  const data: any[] = [];
  let totalNetSales = 0;
  let totalGrossSales = 0;

  for (let i = headerIndex + 1; i < sheetRows.length; i++) {
    const row = sheetRows[i];
    if (!row || row.length === 0) continue;

    const firstCell = String(row[0] || '').trim();
    const itemCell = String(row[colIndex.item !== undefined ? colIndex.item : 1] || '').trim();

    // Check for summary/statistical rows
    if (['total', 'min.', 'max.', 'avg.', 'sub total'].includes(firstCell.toLowerCase())) {
      continue;
    }
    if (['total', 'sub total'].includes(itemCell.toLowerCase())) {
      continue;
    }

    // Stop if we hit trailing restaurant metadata
    if (firstCell.toLowerCase().startsWith('name:') || firstCell.toLowerCase().startsWith('restaurant name:')) {
      break;
    }

    // Update current hour if present on this line
    if (firstCell && /\d{1,2}(?::\d{2})?\s*(?:AM|PM)/i.test(firstCell)) {
      currentHour = firstCell;
    }

    if (!itemCell) continue;

    const { hourOfDay, hourLabel } = parseHourString(currentHour);

    const unitPrice = cleanNumericValue(row[colIndex.price]);
    const quantity = cleanNumericValue(row[colIndex.quantity]);
    const netAmount = cleanNumericValue(row[colIndex.netAmount]);
    const discountAmount = cleanNumericValue(row[colIndex.discount]);
    const taxAmount = cleanNumericValue(row[colIndex.tax]);
    const totalSales = cleanNumericValue(row[colIndex.totalSales]);
    const netSales = cleanNumericValue(row[colIndex.netSales]) || netAmount;

    totalNetSales += netSales;
    totalGrossSales += totalSales;

    data.push({
      business_date: businessDate,
      hour_of_day: hourOfDay,
      hour_label: hourLabel,
      item_name: itemCell,
      unit_price: unitPrice,
      quantity,
      net_amount: netAmount,
      discount_amount: discountAmount,
      tax_amount: taxAmount,
      total_sales: totalSales,
      net_sales: netSales,
    });
  }

  return {
    reportType: 'HOURLY_ITEM_SALES',
    businessDate,
    fileChecksum,
    recordCount: data.length,
    totalNetSales: Math.round(totalNetSales * 100) / 100,
    totalGrossSales: Math.round(totalGrossSales * 100) / 100,
    metadata: { fileName, hourGroupsCount: new Set(data.map((d) => d.hour_of_day)).size },
    data,
  };
}

/**
 * 2. ORDERS MASTER REPORT
 */
function parseOrdersMasterReport(sheetRows: any[][], fileName: string, fileChecksum: string): ParseResult {
  let businessDate = '';
  let headerIndex = -1;

  // Scan top 15 rows for Date/Period and header row
  for (let i = 0; i < Math.min(15, sheetRows.length); i++) {
    const row = sheetRows[i].map((c) => String(c || '').trim());
    for (let c = 0; c < row.length; c++) {
      if (/(?:period|date)\s*:/i.test(row[c])) {
        const inlineVal = row[c].replace(/^(?:period|date)\s*:\s*/i, '').trim();
        const nextCell = row[c + 1] ? String(row[c + 1]).trim() : '';
        const candidate = nextCell || inlineVal;
        if (candidate) {
          const parsed = normalizeDateStringToIso(candidate);
          if (parsed) {
            businessDate = parsed;
            break;
          }
        }
      }
    }
    if (row.map((c) => c.toLowerCase()).includes('invoice no.')) {
      headerIndex = i;
    }
    if (businessDate && headerIndex !== -1) break;
  }

  if (headerIndex === -1) {
    for (let i = 0; i < Math.min(10, sheetRows.length); i++) {
      if (sheetRows[i].some((c) => String(c).toLowerCase().includes('invoice no.'))) {
        headerIndex = i;
        break;
      }
    }
  }

  if (headerIndex === -1) {
    throw new Error('Could not find header row (Invoice No.) in Orders Master report.');
  }

  const rawHeaders = sheetRows[headerIndex].map((h) => String(h || '').trim());
  const col: Record<string, number> = {};
  rawHeaders.forEach((h, idx) => {
    const clean = h.toLowerCase();
    if (clean.includes('invoice no.')) col.invoiceNo = idx;
    if (clean.includes('date') || clean.includes('timestamp')) col.timestamp = idx;
    if (clean === 'biller') col.biller = idx;
    if (clean.includes('kot no.')) col.kotNo = idx;
    if (clean.includes('payment type')) col.paymentType = idx;
    if (clean.includes('order type')) col.orderType = idx;
    if (clean === 'status') col.status = idx;
    if (clean === 'area') col.area = idx;
    if (clean.includes('assign to') || clean.includes('captain')) col.assignTo = idx;
    if (clean === 'name' || clean === 'customer name') col.name = idx;
    if (clean === 'phone' || clean.includes('mobile')) col.phone = idx;
    if (clean.includes('covers') || clean.includes('pax') || clean.includes('persons')) col.covers = idx;
    if (clean.includes('gross amount') || clean.includes('my amount')) col.grossAmount = idx;
    if (clean.includes('discount')) col.discount = idx;
    if (clean.includes('net sales')) col.netSales = idx;
    if (clean.includes('tax')) col.tax = idx;
    if (clean.includes('round off')) col.roundOff = idx;
    if (clean.includes('waived off')) col.waivedOff = idx;
    if (clean.includes('grand total') || clean.includes('total (') || clean === 'total') col.grandTotal = idx;
  });

  const data: any[] = [];
  let totalNetSales = 0;
  let totalGrossSales = 0;

  for (let i = headerIndex + 1; i < sheetRows.length; i++) {
    const row = sheetRows[i];
    if (!row || row.length === 0) continue;

    const invoiceNo = String(row[col.invoiceNo !== undefined ? col.invoiceNo : 0] || '').trim();
    if (!invoiceNo) continue;
    if (['total', 'grand total', 'sub total', 'min.', 'max.', 'avg.'].includes(invoiceNo.toLowerCase())) {
      continue;
    }

    const timestampStr = String(row[col.timestamp] || '').trim();
    let hourOfDay = 12;
    if (timestampStr) {
      const timePartMatch = timestampStr.match(/(\d{1,2}):(\d{2})/);
      if (timePartMatch) {
        hourOfDay = parseInt(timePartMatch[1], 10) || 12;
      }
      if (!businessDate) {
        businessDate = normalizeDateStringToIso(timestampStr);
      }
    }

    const grossAmount = cleanNumericValue(row[col.grossAmount]);
    const discountAmount = cleanNumericValue(row[col.discount]);
    const netSales = cleanNumericValue(row[col.netSales]);
    const taxAmount = cleanNumericValue(row[col.tax]);
    const roundOff = cleanNumericValue(row[col.roundOff]);
    const waivedOff = cleanNumericValue(row[col.waivedOff]);
    const grandTotal = cleanNumericValue(row[col.grandTotal]);
    const covers = parseInt(String(row[col.covers] || '0').replace(/,/g, ''), 10) || 0;

    totalNetSales += netSales;
    totalGrossSales += grandTotal;

    data.push({
      business_date: businessDate,
      invoice_no: invoiceNo,
      order_timestamp: timestampStr || null,
      hour_of_day: hourOfDay,
      biller: String(row[col.biller] || '').trim() || null,
      kot_numbers: String(row[col.kotNo] || '').trim() || null,
      payment_type: String(row[col.paymentType] || 'Cash').trim(),
      order_type: String(row[col.orderType] || 'Dine In').trim(),
      status: String(row[col.status] || 'Success').trim(),
      area: String(row[col.area] || '').trim() || null,
      captain_name: String(row[col.assignTo] || '').trim() || null,
      customer_name: String(row[col.name] || '').trim() || null,
      customer_phone: String(row[col.phone] || '').trim() || null,
      covers_pax: covers,
      gross_amount: Math.round(grossAmount * 100) / 100,
      discount_amount: Math.round(discountAmount * 100) / 100,
      net_sales: Math.round(netSales * 100) / 100,
      tax_amount: Math.round(taxAmount * 100) / 100,
      round_off: Math.round(roundOff * 100) / 100,
      waived_off: Math.round(waivedOff * 100) / 100,
      grand_total: Math.round(grandTotal * 100) / 100,
    });
  }

  if (!businessDate && data.length > 0 && data[0].order_timestamp) {
    businessDate = normalizeDateStringToIso(data[0].order_timestamp);
  }

  if (!businessDate) {
    throw new Error(`Unable to extract report/business date from inside Orders Master report (${fileName}).`);
  }

  // Synchronize business_date across data rows
  data.forEach((d) => {
    d.business_date = businessDate;
  });

  return {
    reportType: 'ORDERS_MASTER',
    businessDate,
    fileChecksum,
    recordCount: data.length,
    totalNetSales: Math.round(totalNetSales * 100) / 100,
    totalGrossSales: Math.round(totalGrossSales * 100) / 100,
    metadata: { fileName, billerCount: new Set(data.map((d) => d.biller).filter(Boolean)).size },
    data,
  };
}

/**
 * 3. EXECUTIVE SALES SUMMARY REPORT
 */
function parseExecutiveSummaryReport(sheetRows: any[][], fileName: string, fileChecksum: string): ParseResult {
  let businessDate = '';
  let successfulBillsCount = 0;
  let invoiceRange = '';
  let subTotal = 0;
  let discount = 0;
  let deliveryCharges = 0;
  let containerCharges = 0;
  let serviceCharges = 0;
  let cgst = 0;
  let sgst = 0;
  let roundOff = 0;
  let waivedOff = 0;
  let grandTotal = 0;
  let netSales = 0;
  let cancelledCount = 0;
  let cancelledAmount = 0;

  const orderTypeBreakdown: Record<string, { count: number; total: number; netSales: number }> = {};
  const paymentModeBreakdown: Record<string, number> = {};

  // 1. Scan for Period/Date across all rows
  for (let i = 0; i < sheetRows.length; i++) {
    const row = sheetRows[i].map((c) => String(c || '').trim());
    if (row.length === 0) continue;

    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (/(?:period|date)\s*:/i.test(cell)) {
        const inlineVal = cell.replace(/^(?:period|date)\s*:\s*/i, '').trim();
        const nextCell = row[c + 1] ? String(row[c + 1]).trim() : '';
        const candidate = nextCell || inlineVal;
        if (candidate) {
          const parsed = normalizeDateStringToIso(candidate);
          if (parsed) {
            businessDate = parsed;
            break;
          }
        }
      }
    }
    if (businessDate) break;
  }

  if (!businessDate) {
    throw new Error(
      `Unable to extract report/business date from inside Executive Sales Summary (${fileName}). Please check that the file includes a valid "Period:" or "Date:" field.`
    );
  }

  // 2. Parse sections
  let currentSection = '';

  for (let i = 0; i < sheetRows.length; i++) {
    const row = sheetRows[i].map((c) => String(c || '').trim());
    if (row.length === 0) continue;

    const col0 = row[0].toLowerCase();
    const col1 = row[1] || '';

    // Section headers detection (supports both Excel "Billing (Success)" and HTML table "Success Orders")
    if (
      (col0.includes('billing') && col0.includes('success')) ||
      col0.includes('success order') ||
      col0.includes('success bill')
    ) {
      currentSection = 'BILLING_SUCCESS';
      continue;
    }
    if (
      (col0.includes('billing') && col0.includes('cancel')) ||
      col0.includes('cancelled order') ||
      col0.includes('canceled order')
    ) {
      currentSection = 'BILLING_CANCEL';
      continue;
    }
    if (col0.includes('order type')) {
      currentSection = 'ORDER_TYPE';
      continue;
    }
    if (col0.includes('payment mode') || col0.includes('payment type')) {
      currentSection = 'PAYMENT_MODE';
      continue;
    }
    // Stop billing or payment mode parsing when reaching subsequent sections
    if (
      col0.includes('performance indicator') ||
      col0.includes('complimentary') ||
      col0.includes('sales return') ||
      col0.includes('virtual wallet') ||
      col0.includes('expense') ||
      col0.includes('withdrawal') ||
      col0.includes('cash top-up') ||
      col0.includes('online orders') ||
      col0.includes('advance order')
    ) {
      currentSection = 'OTHER';
      continue;
    }

    // Section parsing
    if (currentSection === 'BILLING_SUCCESS') {
      const val = cleanNumericValue(col1);
      if (col0 === 'count' || col0.startsWith('count')) successfulBillsCount = parseInt(String(col1).replace(/,/g, ''), 10) || 0;
      if (col0.includes('invoice nos') || col0.includes('invoice no')) invoiceRange = col1;
      if (col0 === 'sub total' || col0.startsWith('sub total')) subTotal = val;
      if (col0 === 'discount' || col0.startsWith('discount')) discount = val;
      if (col0.includes('delivery charge')) deliveryCharges = val;
      if (col0.includes('container charge')) containerCharges = val;
      if (col0.includes('service charge')) serviceCharges = val;
      if (col0 === 'cgst' || col0.includes('cgst')) cgst = val;
      if (col0 === 'sgst' || col0.includes('sgst')) sgst = val;
      if (col0.includes('round off')) roundOff = val;
      if (col0.includes('waived off')) waivedOff = val;
      if (col0 === 'grand total' || col0.startsWith('grand total')) grandTotal = val;
      if (col0 === 'net sales' || col0.startsWith('net sales')) netSales = val;
    } else if (currentSection === 'BILLING_CANCEL') {
      if (col0 === 'count' || col0.startsWith('count')) cancelledCount = parseInt(String(col1).replace(/,/g, ''), 10) || 0;
      if (col0 === 'amount' || col0.includes('amount')) cancelledAmount = cleanNumericValue(col1);
    } else if (currentSection === 'ORDER_TYPE') {
      if (['order', 'no record found'].includes(col0)) continue;
      const oType = row[0];
      const count = parseInt(String(row[1] || '0').replace(/,/g, ''), 10) || 0;
      const total = cleanNumericValue(row[2]);
      const oNet = cleanNumericValue(row[3]);
      if (oType) {
        orderTypeBreakdown[oType] = { count, total, netSales: oNet };
      }
    } else if (currentSection === 'PAYMENT_MODE') {
      if (['payment type', 'no record found'].includes(col0)) continue;
      const pMode = row[0];
      const pTotal = cleanNumericValue(row[1]);
      if (pMode) {
        paymentModeBreakdown[pMode] = pTotal;
      }
    }
  }

  // Defensive fallback: if Net Sales is 0 but Sub Total was reported, compute Net Sales = Sub Total - Discount
  if (netSales === 0 && subTotal > 0) {
    netSales = Math.round((subTotal - discount) * 100) / 100;
  }

  const summaryData = {
    business_date: businessDate,
    successful_bills_count: successfulBillsCount,
    invoice_range: invoiceRange,
    sub_total: subTotal,
    discount,
    delivery_charges: deliveryCharges,
    container_charges: containerCharges,
    service_charges: serviceCharges,
    cgst,
    sgst,
    total_tax: Math.round((cgst + sgst) * 100) / 100,
    round_off: roundOff,
    waived_off: waivedOff,
    grand_total: grandTotal,
    net_sales: netSales,
    cancelled_bills_count: cancelledCount,
    cancelled_amount: cancelledAmount,
    order_type_breakdown: orderTypeBreakdown,
    payment_mode_breakdown: paymentModeBreakdown,
  };

  return {
    reportType: 'EXECUTIVE_SUMMARY',
    businessDate,
    fileChecksum,
    recordCount: 1,
    totalNetSales: Math.round(netSales * 100) / 100,
    totalGrossSales: Math.round(grandTotal * 100) / 100,
    metadata: { fileName, invoiceRange, successfulBillsCount },
    data: [summaryData],
  };
}

/**
 * 4. MENU MASTER EXPORT
 */
function parseMenuMasterReport(sheetRows: any[][], fileName: string, fileChecksum: string, headerIndex: number): ParseResult {
  const actualHeaderIndex = headerIndex >= 0 ? headerIndex : 0;
  const rawHeaders = sheetRows[actualHeaderIndex].map((h) => String(h || '').trim().toLowerCase());

  const col: Record<string, number> = {};
  rawHeaders.forEach((h, idx) => {
    if (h.includes('parent_category') || h === 'parent category') col.parentCategory = idx;
    if (h === 'category' || h.includes('sub_category')) col.category = idx;
    if (h === 'item' || h === 'item name' || h.includes('item_name')) col.name = idx;
    if (h === 'price' || h.includes('rate')) col.price = idx;
    if (h.includes('gst%') || h.includes('gst_percent') || h.includes('tax%')) col.gstPercent = idx;
    if (h.includes('description')) col.description = idx;
    if (h.includes('item_type') || h === 'type') col.itemType = idx;
  });

  const data: any[] = [];

  for (let i = actualHeaderIndex + 1; i < sheetRows.length; i++) {
    const row = sheetRows[i];
    if (!row || row.length === 0) continue;

    const name = String(row[col.name !== undefined ? col.name : 2] || '').trim();
    if (!name) continue;

    const category = col.category !== undefined ? String(row[col.category] || '').trim() : 'General';
    const rawParent = col.parentCategory !== undefined ? String(row[col.parentCategory] || '').trim() : '';
    const parentCategory = resolveParentCategory(category, rawParent);
    const normalizedName = normalizeItemName(name);
    const price = cleanNumericValue(row[col.price !== undefined ? col.price : 3]);
    const gstPercent = cleanNumericValue(row[col.gstPercent !== undefined ? col.gstPercent : 4]);
    const description = col.description !== undefined ? String(row[col.description] || '').trim() : null;
    const itemType = col.itemType !== undefined ? String(row[col.itemType] || '').trim() : null;

    data.push({
      name,
      normalized_name: normalizedName,
      parent_category: parentCategory || 'Uncategorized',
      category: category || 'General',
      price,
      gst_percent: gstPercent,
      description: description || null,
      item_type: itemType || null,
      is_active: true,
      updated_at: new Date().toISOString(),
    });
  }

  return {
    reportType: 'MENU_MASTER',
    businessDate: '',
    fileChecksum,
    recordCount: data.length,
    totalNetSales: 0,
    totalGrossSales: 0,
    metadata: { fileName },
    data,
  };
}
