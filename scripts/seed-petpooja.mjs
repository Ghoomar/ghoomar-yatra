import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { parsePetpoojaBuffer } from '../src/lib/petpooja/parser.js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://zklzzfsxibewekkvslzg.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprbHp6ZnN4aWJld2Vra3ZzbHpnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NjM3MzEwMCwiZXhwIjoyMTAxOTQ5MTAwfQ.-vjzb3rlIt2w6JfwQfNf-t3cFZUPMKJEcE0wsjeF4Es';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function seed() {
  console.log('--- Starting Petpooja Seeding ---');

  // 1. MENU MASTER
  const menuPath = 'C:\\Users\\nirak\\Downloads\\petpooja menu export.csv';
  if (fs.existsSync(menuPath)) {
    console.log('\n[1/4] Seeding Menu Master...');
    const menuBuf = fs.readFileSync(menuPath);
    const menuParsed = parsePetpoojaBuffer(menuBuf, 'petpooja menu export.csv');
    console.log(`Parsed ${menuParsed.recordCount} menu items.`);
    for (let i = 0; i < menuParsed.data.length; i += 100) {
      const chunk = menuParsed.data.slice(i, i + 100);
      const { error } = await supabase.from('pos_menu_items').upsert(chunk, { onConflict: 'name' });
      if (error) console.error('Error seeding menu items chunk:', error);
    }
    console.log('✓ Menu Master seeded.');
  }

  // Fetch Menu Master mapping for hourly categorization
  const { data: menuItems } = await supabase.from('pos_menu_items').select('name, parent_category, category');
  const menuMap = new Map();
  (menuItems || []).forEach(m => {
    menuMap.set(m.name.toLowerCase().trim(), {
      parentCategory: m.parent_category,
      category: m.category,
    });
  });

  // 2. HOURLY ITEM SALES (2026-09-18)
  const hourlyPath = 'C:\\Users\\nirak\\.gemini\\antigravity\\brain\\9cfec205-e3f7-4240-b3e1-1205064ae2d9\\.user_uploaded\\media_1789811260606.csv';
  if (fs.existsSync(hourlyPath)) {
    console.log('\n[2/4] Seeding Hourly Item Sales...');
    const hourlyBuf = fs.readFileSync(hourlyPath);
    const hourlyParsed = parsePetpoojaBuffer(hourlyBuf, 'Hourly_Item_Sales_2026_09_18.csv');

    // Remove existing batch for 2026-09-18 HOURLY_ITEM_SALES
    await supabase.from('sales_import_batches').delete().eq('business_date', hourlyParsed.businessDate).eq('report_type', 'HOURLY_ITEM_SALES');

    const { data: batch, error: bErr } = await supabase.from('sales_import_batches').insert({
      report_type: hourlyParsed.reportType,
      business_date: hourlyParsed.businessDate,
      file_name: 'Hourly_Item_Sales_2026_09_18.csv',
      file_checksum: hourlyParsed.fileChecksum,
      record_count: hourlyParsed.recordCount,
      total_net_sales: hourlyParsed.totalNetSales,
      total_gross_sales: hourlyParsed.totalGrossSales,
      raw_metadata: hourlyParsed.metadata,
    }).select().single();

    if (bErr) throw bErr;

    const hourlyPayload = hourlyParsed.data.map(item => {
      const lower = item.item_name.toLowerCase().trim();
      const mapping = menuMap.get(lower) || {
        parentCategory: 'Uncategorized',
        category: 'General',
      };
      return {
        batch_id: batch.id,
        business_date: hourlyParsed.businessDate,
        hour_of_day: item.hour_of_day,
        hour_label: item.hour_label,
        item_name: item.item_name,
        parent_category: mapping.parentCategory,
        category: mapping.category,
        unit_price: item.unit_price,
        quantity: item.quantity,
        net_amount: item.net_amount,
        discount_amount: item.discount_amount,
        tax_amount: item.tax_amount,
        total_sales: item.total_sales,
        net_sales: item.net_sales,
      };
    });

    for (let i = 0; i < hourlyPayload.length; i += 100) {
      const chunk = hourlyPayload.slice(i, i + 100);
      const { error: insErr } = await supabase.from('sales_hourly_items').insert(chunk);
      if (insErr) throw insErr;
    }
    console.log(`✓ Hourly Item Sales seeded (${hourlyPayload.length} rows, Net Sales: ₹${hourlyParsed.totalNetSales}).`);
  }

  // 3. ORDERS MASTER (2026-09-18)
  const ordersPath = 'C:\\Users\\nirak\\Downloads\\Orders_Master_Report_2026_09_19_15_08_33.csv';
  if (fs.existsSync(ordersPath)) {
    console.log('\n[3/4] Seeding Orders Master...');
    const ordersBuf = fs.readFileSync(ordersPath);
    const ordersParsed = parsePetpoojaBuffer(ordersBuf, 'Orders_Master_Report_2026_09_18.csv');

    // Remove existing batch for 2026-09-18 ORDERS_MASTER
    await supabase.from('sales_import_batches').delete().eq('business_date', ordersParsed.businessDate).eq('report_type', 'ORDERS_MASTER');

    const { data: batch, error: bErr } = await supabase.from('sales_import_batches').insert({
      report_type: ordersParsed.reportType,
      business_date: ordersParsed.businessDate,
      file_name: 'Orders_Master_Report_2026_09_18.csv',
      file_checksum: ordersParsed.fileChecksum,
      record_count: ordersParsed.recordCount,
      total_net_sales: ordersParsed.totalNetSales,
      total_gross_sales: ordersParsed.totalGrossSales,
      raw_metadata: ordersParsed.metadata,
    }).select().single();

    if (bErr) throw bErr;

    const ordersPayload = ordersParsed.data.map(order => ({
      batch_id: batch.id,
      business_date: ordersParsed.businessDate,
      invoice_no: order.invoice_no,
      order_timestamp: order.order_timestamp,
      hour_of_day: order.hour_of_day,
      biller: order.biller,
      kot_numbers: order.kot_numbers,
      payment_type: order.payment_type,
      order_type: order.order_type,
      status: order.status,
      area: order.area,
      captain_name: order.captain_name,
      customer_name: order.customer_name,
      customer_phone: order.customer_phone,
      covers_pax: order.covers_pax,
      gross_amount: order.gross_amount,
      discount_amount: order.discount_amount,
      net_sales: order.net_sales,
      tax_amount: order.tax_amount,
      round_off: order.round_off,
      waived_off: order.waived_off,
      grand_total: order.grand_total,
    }));

    for (let i = 0; i < ordersPayload.length; i += 100) {
      const chunk = ordersPayload.slice(i, i + 100);
      const { error: insErr } = await supabase.from('sales_orders').insert(chunk);
      if (insErr) throw insErr;
    }
    console.log(`✓ Orders Master seeded (${ordersPayload.length} orders, Net Sales: ₹${ordersParsed.totalNetSales}).`);
  }

  // 4. EXECUTIVE SUMMARY (2026-09-18)
  const execPath = path.resolve('scripts/sample-executive-summary.csv');
  if (fs.existsSync(execPath)) {
    console.log('\n[4/4] Seeding Executive Sales Summary...');
    const execBuf = fs.readFileSync(execPath);
    const execParsed = parsePetpoojaBuffer(execBuf, 'Executive_Sales_Summary_2026_09_18.csv');

    // Remove existing batch for 2026-09-18 EXECUTIVE_SUMMARY
    await supabase.from('sales_import_batches').delete().eq('business_date', execParsed.businessDate).eq('report_type', 'EXECUTIVE_SUMMARY');

    const { data: batch, error: bErr } = await supabase.from('sales_import_batches').insert({
      report_type: execParsed.reportType,
      business_date: execParsed.businessDate,
      file_name: 'Executive_Sales_Summary_2026_09_18.csv',
      file_checksum: execParsed.fileChecksum,
      record_count: execParsed.recordCount,
      total_net_sales: execParsed.totalNetSales,
      total_gross_sales: execParsed.totalGrossSales,
      raw_metadata: execParsed.metadata,
    }).select().single();

    if (bErr) throw bErr;

    const exec = execParsed.data[0];
    const { error: insErr } = await supabase.from('sales_executive_summaries').insert({
      batch_id: batch.id,
      business_date: execParsed.businessDate,
      successful_bills_count: exec.successful_bills_count,
      invoice_range: exec.invoice_range,
      sub_total: exec.sub_total,
      discount: exec.discount,
      delivery_charges: exec.delivery_charges,
      container_charges: exec.container_charges,
      service_charges: exec.service_charges,
      cgst: exec.cgst,
      sgst: exec.sgst,
      total_tax: exec.total_tax,
      round_off: exec.round_off,
      waived_off: exec.waived_off,
      grand_total: exec.grand_total,
      net_sales: exec.net_sales,
      cancelled_bills_count: exec.cancelled_bills_count,
      cancelled_amount: exec.cancelled_amount,
      order_type_breakdown: exec.order_type_breakdown,
      payment_mode_breakdown: exec.payment_mode_breakdown,
      raw_metadata: execParsed.metadata,
    });
    if (insErr) throw insErr;
    console.log(`✓ Executive Summary seeded (Net Sales: ₹${execParsed.totalNetSales}).`);
  }

  console.log('\n--- Seeding Completed Successfully! ---');
}

seed().catch(err => {
  console.error('Seeding error:', err);
  process.exit(1);
});
