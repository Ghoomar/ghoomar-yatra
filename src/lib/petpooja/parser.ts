import * as XLSX from 'xlsx';
import crypto from 'crypto';
import { PetpoojaReportType } from '@/lib/types/sales';

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
 * Parses a date string like "2026-09-18 to 2026-09-18" or "18 Sep 2026 To 18 Sep 2026"
 * or "18-09-2026 23:16" into standard "YYYY-MM-DD"
 */
export function normalizeDateStringToIso(dateStr: string): string {
  if (!dateStr) return new Date().toISOString().substring(0, 10);

  const clean = dateStr.trim();

  // Pattern: "YYYY-MM-DD to YYYY-MM-DD"
  const isoRangeMatch = clean.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoRangeMatch) {
    return isoRangeMatch[1];
  }

  // Pattern: "18 Sep 2026 To 18 Sep 2026" or "18 Sep 2026"
  const textMonthMatch = clean.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  if (textMonthMatch) {
    const day = textMonthMatch[1].padStart(2, '0');
    const monStr = textMonthMatch[2].toLowerCase();
    const year = textMonthMatch[3];
    const months: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const mon = months[monStr] || '01';
    return `${year}-${mon}-${day}`;
  }

  // Pattern: "19-09-2026 00:21" or "19-09-2026"
  const dmyMatch = clean.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const mon = dmyMatch[2].padStart(2, '0');
    const year = dmyMatch[3];
    return `${year}-${mon}-${day}`;
  }

  return new Date().toISOString().substring(0, 10);
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
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];

  // Convert to 2D array of strings
  const sheetRows: any[][] = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    blankrows: false,
  });

  if (!sheetRows || sheetRows.length === 0) {
    throw new Error('The uploaded file is empty or could not be parsed.');
  }

  // Detect report type by scanning first 15 rows
  let detectedType: PetpoojaReportType | null = null;
  let headerRowIndex = -1;

  for (let i = 0; i < Math.min(15, sheetRows.length); i++) {
    const rowText = sheetRows[i].map((c) => String(c || '').trim()).join(' ');

    if (/Item Sale Report:\s*Hourly Wise/i.test(rowText) || /Hourly Wise/i.test(rowText)) {
      detectedType = 'HOURLY_ITEM_SALES';
    } else if (/Orders:\s*Master Report/i.test(rowText) || /Orders Master/i.test(rowText)) {
      detectedType = 'ORDERS_MASTER';
    } else if (/Executive Sales Report Summary/i.test(rowText) || /Billing \(Success\)/i.test(rowText)) {
      detectedType = 'EXECUTIVE_SUMMARY';
    } else if (/Parent_Category/i.test(rowText) && /GST%/i.test(rowText)) {
      detectedType = 'MENU_MASTER';
      headerRowIndex = i;
    }
  }

  // Secondary detection via column headers if header label was not found in top rows
  if (!detectedType) {
    for (let i = 0; i < Math.min(10, sheetRows.length); i++) {
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
      if (row.includes('billing (success)') || row.includes('executive sales report summary')) {
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
 * Parsers for each report type
 */

function parseHourlyItemSalesReport(sheetRows: any[][], fileName: string, fileChecksum: string): ParseResult {
  let businessDate = '';
  let headerIndex = -1;

  // Extract Date from row 0..4
  for (let i = 0; i < Math.min(6, sheetRows.length); i++) {
    const row = sheetRows[i].map((c) => String(c || '').trim());
    if (row[0] && row[0].toLowerCase().startsWith('date:')) {
      businessDate = normalizeDateStringToIso(row[1] || row[0]);
    }
    if (row.map((c) => c.toLowerCase()).includes('hour') && row.map((c) => c.toLowerCase()).includes('item')) {
      headerIndex = i;
    }
  }

  if (headerIndex === -1) headerIndex = 5; // Default header index

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
    if (clean === 'total sales') colIndex.totalSales = idx;
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

    // Stop if we hit Executive summary or trailing metadata
    if (firstCell.toLowerCase().startsWith('name:') || firstCell.toLowerCase().startsWith('restaurant name:')) {
      break;
    }

    // Update current hour if present on this line
    if (firstCell && /\d{1,2}(?::\d{2})?\s*(?:AM|PM)/i.test(firstCell)) {
      currentHour = firstCell;
    }

    if (!itemCell) continue;

    const { hourOfDay, hourLabel } = parseHourString(currentHour);

    const unitPrice = parseFloat(String(row[colIndex.price] || '0').replace(/,/g, '')) || 0;
    const quantity = parseFloat(String(row[colIndex.quantity] || '0').replace(/,/g, '')) || 0;
    const netAmount = parseFloat(String(row[colIndex.netAmount] || '0').replace(/,/g, '')) || 0;
    const discount = parseFloat(String(row[colIndex.discount] || '0').replace(/,/g, '')) || 0;
    const tax = parseFloat(String(row[colIndex.tax] || '0').replace(/,/g, '')) || 0;
    const totalSales = parseFloat(String(row[colIndex.totalSales] || '0').replace(/,/g, '')) || 0;
    const netSales = parseFloat(String(row[colIndex.netSales] || '0').replace(/,/g, '')) || netAmount - discount;

    totalNetSales += netSales;
    totalGrossSales += totalSales;

    data.push({
      hour_of_day: hourOfDay,
      hour_label: hourLabel,
      item_name: itemCell,
      unit_price: Math.round(unitPrice * 100) / 100,
      quantity: Math.round(quantity * 100) / 100,
      net_amount: Math.round(netAmount * 100) / 100,
      discount_amount: Math.round(discount * 100) / 100,
      tax_amount: Math.round(tax * 100) / 100,
      total_sales: Math.round(totalSales * 100) / 100,
      net_sales: Math.round(netSales * 100) / 100,
    });
  }

  if (!businessDate) {
    businessDate = new Date().toISOString().substring(0, 10);
  }

  return {
    reportType: 'HOURLY_ITEM_SALES',
    businessDate,
    fileChecksum,
    recordCount: data.length,
    totalNetSales: Math.round(totalNetSales * 100) / 100,
    totalGrossSales: Math.round(totalGrossSales * 100) / 100,
    metadata: { fileName, hourCount: new Set(data.map((d) => d.hour_of_day)).size },
    data,
  };
}

function parseOrdersMasterReport(sheetRows: any[][], fileName: string, fileChecksum: string): ParseResult {
  let businessDate = '';
  let headerIndex = -1;

  for (let i = 0; i < Math.min(6, sheetRows.length); i++) {
    const row = sheetRows[i].map((c) => String(c || '').trim());
    if (row[0] && row[0].toLowerCase().startsWith('date:')) {
      businessDate = normalizeDateStringToIso(row[1] || row[0]);
    }
    if (row.map((c) => c.toLowerCase()).includes('invoice no.') || row.map((c) => c.toLowerCase()).includes('biller')) {
      headerIndex = i;
    }
  }

  if (headerIndex === -1) headerIndex = 5;

  const rawHeaders = sheetRows[headerIndex].map((h) => String(h || '').trim().toLowerCase());
  const col: Record<string, number> = {};
  rawHeaders.forEach((h, idx) => {
    if (h.includes('invoice no')) col.invoiceNo = idx;
    if (h === 'date') col.date = idx;
    if (h === 'biller') col.biller = idx;
    if (h.includes('kot no')) col.kotNo = idx;
    if (h.includes('payment type')) col.paymentType = idx;
    if (h.includes('payment description')) col.paymentDesc = idx;
    if (h.includes('order type')) col.orderType = idx;
    if (h === 'status') col.status = idx;
    if (h === 'area') col.area = idx;
    if (h.includes('assign to')) col.assignTo = idx;
    if (h === 'phone') col.phone = idx;
    if (h === 'name') col.name = idx;
    if (h === 'persons') col.persons = idx;
    if (h.includes('my amount')) col.grossAmount = idx;
    if (h === 'discount') col.discount = idx;
    if (h.includes('net sales')) col.netSales = idx;
    if (h.includes('total tax')) col.tax = idx;
    if (h.includes('round off')) col.roundOff = idx;
    if (h.includes('waived off')) col.waivedOff = idx;
    if (h === 'total') col.total = idx;
  });

  const data: any[] = [];
  let totalNetSales = 0;
  let totalGrossSales = 0;

  for (let i = headerIndex + 1; i < sheetRows.length; i++) {
    const row = sheetRows[i];
    if (!row || row.length === 0) continue;

    const invoiceCell = String(row[col.invoiceNo !== undefined ? col.invoiceNo : 0] || '').trim();
    if (!invoiceCell || ['total', 'min.', 'max.', 'avg.'].includes(invoiceCell.toLowerCase())) {
      continue;
    }

    const rawDate = String(row[col.date] || '').trim();
    if (!businessDate && rawDate) {
      businessDate = normalizeDateStringToIso(rawDate);
    }

    // Extract hour of day from timestamp e.g. "18-09-2026 23:16"
    let hourOfDay = 12;
    let orderIsoTimestamp = new Date().toISOString();
    const timeMatch = rawDate.match(/(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      const d = timeMatch[1].padStart(2, '0');
      const m = timeMatch[2].padStart(2, '0');
      const y = timeMatch[3];
      const hr = parseInt(timeMatch[4], 10);
      const min = timeMatch[5];
      hourOfDay = hr;
      orderIsoTimestamp = `${y}-${m}-${d}T${String(hr).padStart(2, '0')}:${min}:00+05:30`;
    }

    const grossAmount = parseFloat(String(row[col.grossAmount] || '0').replace(/,/g, '')) || 0;
    const discountAmount = parseFloat(String(row[col.discount] || '0').replace(/,/g, '')) || 0;
    const netSales = parseFloat(String(row[col.netSales] || '0').replace(/,/g, '')) || grossAmount - discountAmount;
    const taxAmount = parseFloat(String(row[col.tax] || '0').replace(/,/g, '')) || 0;
    const roundOff = parseFloat(String(row[col.roundOff] || '0').replace(/,/g, '')) || 0;
    const waivedOff = parseFloat(String(row[col.waivedOff] || '0').replace(/,/g, '')) || 0;
    const grandTotal = parseFloat(String(row[col.total] || '0').replace(/,/g, '')) || netSales + taxAmount + roundOff + waivedOff;

    const covers = parseInt(String(row[col.persons] || '1'), 10) || 1;

    totalNetSales += netSales;
    totalGrossSales += grandTotal;

    data.push({
      invoice_no: invoiceCell,
      order_timestamp: orderIsoTimestamp,
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

  if (!businessDate) {
    businessDate = new Date().toISOString().substring(0, 10);
  }

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

  let currentSection = '';

  for (let i = 0; i < sheetRows.length; i++) {
    const row = sheetRows[i].map((c) => String(c || '').trim());
    if (row.length === 0) continue;

    const col0 = row[0].toLowerCase();
    const col1 = row[1] || '';

    if (col0.startsWith('period:')) {
      businessDate = normalizeDateStringToIso(col1 || row[0]);
    }

    if (col0.includes('billing (success)')) {
      currentSection = 'BILLING_SUCCESS';
      continue;
    }
    if (col0.includes('billing (cancel)')) {
      currentSection = 'BILLING_CANCEL';
      continue;
    }
    if (col0.includes('order type')) {
      currentSection = 'ORDER_TYPE';
      continue;
    }
    if (col0.includes('payment mode')) {
      currentSection = 'PAYMENT_MODE';
      continue;
    }
    if (col0.includes('complimentary') || col0.includes('sales return') || col0.includes('virtual wallet')) {
      currentSection = 'OTHER';
      continue;
    }

    // Section parsing
    if (currentSection === 'BILLING_SUCCESS') {
      const val = parseFloat(col1.replace(/,/g, '')) || 0;
      if (col0 === 'count') successfulBillsCount = parseInt(col1, 10) || 0;
      if (col0.includes('invoice nos')) invoiceRange = col1;
      if (col0 === 'sub total') subTotal = val;
      if (col0 === 'discount') discount = val;
      if (col0.includes('delivery charge')) deliveryCharges = val;
      if (col0.includes('container charge')) containerCharges = val;
      if (col0.includes('service charge')) serviceCharges = val;
      if (col0 === 'cgst') cgst = val;
      if (col0 === 'sgst') sgst = val;
      if (col0.includes('round off')) roundOff = val;
      if (col0.includes('waived off')) waivedOff = val;
      if (col0 === 'grand total') grandTotal = val;
      if (col0 === 'net sales') netSales = val;
    } else if (currentSection === 'BILLING_CANCEL') {
      if (col0 === 'count') cancelledCount = parseInt(col1, 10) || 0;
      if (col0 === 'amount') cancelledAmount = parseFloat(col1.replace(/,/g, '')) || 0;
    } else if (currentSection === 'ORDER_TYPE') {
      if (['order', 'no record found'].includes(col0)) continue;
      const oType = row[0];
      const count = parseInt(row[1] || '0', 10) || 0;
      const total = parseFloat(String(row[2] || '0').replace(/,/g, '')) || 0;
      const oNet = parseFloat(String(row[3] || '0').replace(/,/g, '')) || 0;
      if (oType) {
        orderTypeBreakdown[oType] = { count, total, netSales: oNet };
      }
    } else if (currentSection === 'PAYMENT_MODE') {
      if (['payment type', 'no record found'].includes(col0)) continue;
      const pMode = row[0];
      const pTotal = parseFloat(String(row[1] || '0').replace(/,/g, '')) || 0;
      if (pMode) {
        paymentModeBreakdown[pMode] = pTotal;
      }
    }
  }

  if (!businessDate) {
    businessDate = new Date().toISOString().substring(0, 10);
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
    totalNetSales: netSales,
    totalGrossSales: grandTotal,
    metadata: { fileName, invoiceRange, successfulBillsCount },
    data: [summaryData],
  };
}

function parseMenuMasterReport(sheetRows: any[][], fileName: string, fileChecksum: string, headerIndex: number): ParseResult {
  const actualHeaderIndex = headerIndex >= 0 ? headerIndex : 0;
  const rawHeaders = sheetRows[actualHeaderIndex].map((h) => String(h || '').trim().toLowerCase());

  const col: Record<string, number> = {};
  rawHeaders.forEach((h, idx) => {
    if (h === 'name') col.name = idx;
    if (h.includes('online_name')) col.onlineName = idx;
    if (h.includes('parent_category')) col.parentCategory = idx;
    if (h === 'category') col.category = idx;
    if (h.includes('online_display')) col.onlineDisplay = idx;
    if (h === 'price') col.price = idx;
    if (h.includes('gst')) col.gst = idx;
    if (h.includes('type')) col.taxType = idx;
  });

  const data: any[] = [];
  const currentDate = new Date().toISOString().substring(0, 10);

  for (let i = actualHeaderIndex + 1; i < sheetRows.length; i++) {
    const row = sheetRows[i];
    if (!row || row.length === 0) continue;

    const itemName = String(row[col.name !== undefined ? col.name : 0] || '').trim();
    if (!itemName) continue;

    const parentCat = String(row[col.parentCategory] || 'Main Course').trim();
    const category = String(row[col.category] || parentCat).trim();
    const price = parseFloat(String(row[col.price] || '0').replace(/,/g, '')) || 0;
    const gstPercent = parseFloat(String(row[col.gst] || '5').replace(/,/g, '')) || 5;
    const taxType = String(row[col.taxType] || 'F').trim();

    data.push({
      name: itemName,
      online_name: String(row[col.onlineName] || '').trim() || null,
      parent_category: parentCat,
      category,
      category_online_display: String(row[col.onlineDisplay] || '').trim() || null,
      price: Math.round(price * 100) / 100,
      gst_percent: gstPercent,
      tax_type: taxType,
      is_active: true,
    });
  }

  return {
    reportType: 'MENU_MASTER',
    businessDate: currentDate,
    fileChecksum,
    recordCount: data.length,
    totalNetSales: 0,
    totalGrossSales: 0,
    metadata: { fileName, itemsCount: data.length },
    data,
  };
}
