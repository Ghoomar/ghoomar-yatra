import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import crypto from 'crypto';

function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(l => {
      const idx = l.indexOf('=');
      if (idx !== -1 && !l.trim().startsWith('#')) {
        const k = l.slice(0, idx).trim();
        const v = l.slice(idx + 1).trim();
        if (!process.env[k]) process.env[k] = v;
      }
    });
  }
}
loadEnv();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function cleanNumericValue(val) {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (!val) return 0;
  const cleaned = String(val)
    .replace(/&#\d+;/g, '')
    .replace(/&[a-zA-Z]+;/g, '')
    .replace(/[₹,$\s]/g, '')
    .trim();
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

function normalizeDateStringToIso(dateStr) {
  if (!dateStr) return '';
  const clean = String(dateStr).trim();
  const isoMatch = clean.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const dmyMatch = clean.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const mon = dmyMatch[2].padStart(2, '0');
    return `${dmyMatch[3]}-${mon}-${day}`;
  }
  return '';
}

async function loadMenuMasterLookup() {
  const [{ data: menuItems }, { data: aliases }] = await Promise.all([
    supabase.from('pos_menu_items').select('name, parent_category, category'),
    supabase.from('pos_menu_item_aliases').select('alias, canonical_name'),
  ]);

  const exactMap = new Map();
  (menuItems || []).forEach(m => {
    exactMap.set(m.name.toLowerCase().trim(), { parentCategory: m.parent_category, category: m.category });
  });

  const aliasMap = new Map();
  (aliases || []).forEach(a => {
    aliasMap.set(a.alias.toLowerCase().trim(), a.canonical_name.toLowerCase().trim());
  });

  return { exactMap, aliasMap };
}

function resolveItemCategory(name, lookup) {
  const clean = name.trim().toLowerCase();
  if (lookup.exactMap.has(clean)) {
    return { ...lookup.exactMap.get(clean), isMatched: true };
  }
  if (lookup.aliasMap.has(clean)) {
    const canon = lookup.aliasMap.get(clean);
    if (lookup.exactMap.has(canon)) {
      return { ...lookup.exactMap.get(canon), isMatched: true };
    }
  }
  return { parentCategory: 'Uncategorized', category: 'General', isMatched: false };
}

async function run() {
  console.log('=== Testing Ingest of Item Report With Customer/Order Details ===');
  const filePath = 'C:/Users/nirak/Downloads/Item_Report_With_CustomerOrder_Details_2026_09_29_19_57_20.xlsx';
  const buf = fs.readFileSync(filePath);
  const fileChecksum = crypto.createHash('sha256').update(buf).digest('hex');

  const wb = XLSX.read(buf, { type: 'buffer', raw: false, cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const sheetRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });

  // 1. Business Date
  let businessDate = '';
  for (let i = 0; i < Math.min(15, sheetRows.length); i++) {
    const row = sheetRows[i].map(c => String(c || '').trim());
    for (let c = 0; c < row.length; c++) {
      if (/(?:period|date)\s*:/i.test(row[c])) {
        const inlineVal = row[c].replace(/^(?:period|date)\s*:\s*/i, '').trim();
        const nextCell = row[c + 1] ? String(row[c + 1]).trim() : '';
        const parsed = normalizeDateStringToIso(nextCell || inlineVal);
        if (parsed) {
          businessDate = parsed;
          break;
        }
      }
    }
    if (businessDate) break;
  }
  console.log('Extracted Business Date:', businessDate);

  // 2. Headers
  const headerIndex = 5;
  const rawHeaders = sheetRows[headerIndex].map(h => String(h || '').trim());
  const col = {};
  rawHeaders.forEach((h, idx) => {
    const clean = h.toLowerCase().trim();
    if (clean === 'date') col.date = idx;
    if (clean === 'timestamp') col.timestamp = idx;
    if (clean.includes('invoice no.')) col.invoiceNo = idx;
    if (clean.includes('payment type')) col.paymentType = idx;
    if (clean === 'order type' || (clean.startsWith('order type') && !clean.includes('sub'))) col.orderType = idx;
    if (clean === 'area') col.area = idx;
    if (clean === 'item name' || clean === 'item') col.itemName = idx;
    if (clean === 'price') col.price = idx;
    if (clean.startsWith('qty')) col.qty = idx;
    if (clean.includes('sub total')) col.subTotal = idx;
    if (clean.startsWith('discount')) col.discount = idx;
    if (clean === 'tax' || clean.includes('total tax')) col.tax = idx;
    if (clean.includes('final total') || clean.includes('grand total')) col.finalTotal = idx;
    if (clean === 'status') col.status = idx;
    if (clean.includes('table no')) col.tableNo = idx;
    if (clean.includes('server name') || clean === 'biller') col.serverName = idx;
    if (clean.includes('covers') || clean.includes('pax')) col.covers = idx;
    if (clean === 'variation') col.variation = idx;
    if (clean === 'category') col.category = idx;
    if (clean.includes('group name')) col.groupName = idx;
    if (clean === 'phone' || clean.includes('mobile')) col.phone = idx;
    if (clean === 'name' || clean === 'customer name') col.name = idx;
    if (clean.includes('assign to') || clean.includes('captain')) col.assignTo = idx;
  });

  const rawItems = [];
  let totalNetSales = 0;
  let totalGrossSales = 0;

  for (let i = headerIndex + 1; i < sheetRows.length; i++) {
    const row = sheetRows[i];
    if (!row || row.length === 0) continue;
    const invoiceNo = String(row[col.invoiceNo] || '').trim();
    const itemName = String(row[col.itemName] || '').trim();
    if (!invoiceNo || !itemName) continue;
    if (['total', 'grand total', 'sub total', 'min.', 'max.', 'avg.'].includes(invoiceNo.toLowerCase())) continue;

    const timestampStr = String(row[col.timestamp] || '').trim();
    let hourOfDay = 12;
    if (timestampStr) {
      const m = timestampStr.match(/(\d{1,2}):(\d{2})/);
      if (m) hourOfDay = parseInt(m[1], 10);
    }

    const unitPrice = cleanNumericValue(row[col.price]);
    const quantity = cleanNumericValue(row[col.qty]) || 1;
    const subtotal = cleanNumericValue(row[col.subTotal]);
    const discountAmount = cleanNumericValue(row[col.discount]);
    const taxAmount = cleanNumericValue(row[col.tax]);
    const finalTotal = cleanNumericValue(row[col.finalTotal]);
    const netSales = Math.round((subtotal - discountAmount) * 100) / 100;
    const status = String(row[col.status] || 'Success').trim();

    if (status === 'Success') {
      totalNetSales += netSales;
      totalGrossSales += finalTotal;
    }

    rawItems.push({
      business_date: businessDate,
      order_timestamp: timestampStr || null,
      hour_of_day: hourOfDay,
      invoice_no: invoiceNo,
      payment_type: String(row[col.paymentType] || 'Cash').trim(),
      order_type: String(row[col.orderType] || 'Dine In').trim(),
      area: col.area !== undefined ? String(row[col.area] || '').trim() || null : null,
      table_no: col.tableNo !== undefined ? String(row[col.tableNo] || '').trim() || null : null,
      server_name: col.serverName !== undefined ? String(row[col.serverName] || '').trim() || null : null,
      captain_name: (col.assignTo !== undefined ? String(row[col.assignTo] || '').trim() : null) || (col.serverName !== undefined ? String(row[col.serverName] || '').trim() : null) || null,
      covers: col.covers !== undefined ? parseInt(String(row[col.covers] || '1'), 10) || 1 : 1,
      item_name: itemName,
      variation: col.variation !== undefined ? String(row[col.variation] || '').trim() || null : null,
      raw_category: col.category !== undefined ? String(row[col.category] || '').trim() || 'General' : 'General',
      raw_group_name: col.groupName !== undefined ? String(row[col.groupName] || '').trim() || null : null,
      unit_price: Math.round(unitPrice * 100) / 100,
      quantity: Math.round(quantity * 100) / 100,
      subtotal: Math.round(subtotal * 100) / 100,
      discount_amount: Math.round(discountAmount * 100) / 100,
      tax_amount: Math.round(taxAmount * 100) / 100,
      net_sales: netSales,
      final_total: Math.round(finalTotal * 100) / 100,
      status,
      customer_phone: col.phone !== undefined ? String(row[col.phone] || '').trim() || null : null,
      customer_name: col.name !== undefined ? String(row[col.name] || '').trim() || null : null,
    });
  }

  console.log(`Parsed ${rawItems.length} items (Total Net: ₹${totalNetSales.toFixed(2)}, Gross: ₹${totalGrossSales.toFixed(2)})`);

  // 3. Clean up existing batch for this date
  const { data: existingBatch } = await supabase
    .from('sales_import_batches')
    .select('id')
    .eq('business_date', businessDate)
    .eq('report_type', 'ITEM_ORDER_DETAILS')
    .maybeSingle();

  if (existingBatch) {
    console.log('Deleting existing batch to test deduplication:', existingBatch.id);
    await supabase.from('sales_order_items').delete().eq('batch_id', existingBatch.id);
    await supabase.from('sales_import_batches').delete().eq('id', existingBatch.id);
  }

  // 4. Create batch
  const { data: newBatch, error: bErr } = await supabase
    .from('sales_import_batches')
    .insert({
      report_type: 'ITEM_ORDER_DETAILS',
      business_date: businessDate,
      file_name: path.basename(filePath),
      file_checksum: fileChecksum,
      record_count: rawItems.length,
      total_net_sales: Math.round(totalNetSales * 100) / 100,
      total_gross_sales: Math.round(totalGrossSales * 100) / 100,
      raw_metadata: {
        totalRows: rawItems.length,
        successRows: rawItems.filter(r => r.status === 'Success').length,
        invoicesCount: new Set(rawItems.map(r => r.invoice_no)).size,
      },
    })
    .select()
    .single();

  if (bErr) throw bErr;
  console.log('Created batch:', newBatch.id);

  // 5. Categorize and insert
  const lookup = await loadMenuMasterLookup();
  const payload = rawItems.map(item => {
    const res = resolveItemCategory(item.item_name, lookup);
    return {
      ...item,
      batch_id: newBatch.id,
      parent_category: res.parentCategory,
      category: res.category,
    };
  });

  for (let i = 0; i < payload.length; i += 100) {
    const chunk = payload.slice(i, i + 100);
    const { error: insErr } = await supabase.from('sales_order_items').insert(chunk);
    if (insErr) throw insErr;
  }
  console.log('✓ Successfully inserted all items into sales_order_items');

  // 6. Verify in DB
  const { data: dbItems, error: fErr } = await supabase
    .from('sales_order_items')
    .select('*')
    .eq('business_date', businessDate);

  if (fErr) throw fErr;
  console.log(`DB verified count: ${dbItems.length} rows`);

  const successDb = dbItems.filter(r => r.status === 'Success');
  console.log(`Success DB rows: ${successDb.length}`);

  const netSum = successDb.reduce((s, r) => s + Number(r.net_sales), 0);
  const qtySum = successDb.reduce((s, r) => s + Number(r.quantity), 0);
  console.log(`Success Net Sales: ₹${netSum.toFixed(2)}, Qty: ${qtySum}`);

  // Reconcile hour x item combinations
  const comboMap = new Map();
  successDb.forEach(r => {
    const k = r.hour_of_day + '|||' + r.item_name;
    const prev = comboMap.get(k) || { qty: 0, net: 0 };
    prev.qty += Number(r.quantity);
    prev.net += Number(r.net_sales);
    comboMap.set(k, prev);
  });
  console.log(`Hour x Item combinations: ${comboMap.size}`);

  const targetCombos = 167;
  const targetNet = 54090.50;
  const targetQty = 574;

  if (comboMap.size === targetCombos && Math.abs(netSum - targetNet) < 0.01 && qtySum === targetQty) {
    console.log('🎉 PERFECT RECONCILIATION CONFIRMED: 167 combos, 574 qty, ₹54,090.50 Net Sales!');
  } else {
    console.error('❌ Reconciliation mismatch!');
  }
}

run().catch(console.error);
