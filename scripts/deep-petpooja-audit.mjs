import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env.local', 'utf8');
const envVars = Object.fromEntries(
  env.split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.split('=')[0].trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const supabase = createClient(envVars.NEXT_PUBLIC_SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY);

async function deepAudit() {
  const { data: batches } = await supabase.from('sales_import_batches').select('business_date').order('business_date');
  const uniqueDates = [...new Set(batches.map(b => b.business_date))];

  console.log('Testing across all ' + uniqueDates.length + ' dates...');

  let hourlyDiffCount = 0;
  let execOrdersNetDiffCount = 0;
  let coversMismatchCount = 0;
  const discrepancies = [];

  for (const date of uniqueDates) {
    const [{ data: hourly }, { data: items }, { data: orders }, { data: exec }] = await Promise.all([
      supabase.from('sales_hourly_items').select('net_sales, quantity').eq('business_date', date),
      supabase.from('sales_order_items').select('invoice_no, net_sales, quantity, covers, status').eq('business_date', date).eq('status', 'Success'),
      supabase.from('sales_orders').select('invoice_no, net_sales, grand_total, covers_pax, round_off, status').eq('business_date', date).eq('status', 'Success'),
      supabase.from('sales_executive_summaries').select('*').eq('business_date', date).maybeSingle(),
    ]);

    const hNet = Math.round((hourly || []).reduce((s, r) => s + Number(r.net_sales || 0), 0) * 100) / 100;
    const iNet = Math.round((items || []).reduce((s, r) => s + Number(r.net_sales || 0), 0) * 100) / 100;
    const oNet = Math.round((orders || []).reduce((s, r) => s + Number(r.net_sales || 0), 0) * 100) / 100;
    const eNet = exec ? Math.round(Number(exec.net_sales || 0) * 100) / 100 : null;

    if (Math.abs(hNet - iNet) > 0.05) {
      discrepancies.push({ date, type: 'Hourly_vs_Items_Net', hNet, iNet, diff: Math.round((hNet - iNet) * 100) / 100 });
      hourlyDiffCount++;
    }

    if (eNet !== null && Math.abs(oNet - eNet) > 0.05) {
      discrepancies.push({ date, type: 'Orders_vs_Exec_Net', oNet, eNet, diff: Math.round((oNet - eNet) * 100) / 100 });
      execOrdersNetDiffCount++;
    }

    // Check covers derivation from items vs orders
    const itemInvoices = {};
    (items || []).forEach(it => {
      if (!itemInvoices[it.invoice_no] || (it.covers || 0) > itemInvoices[it.invoice_no]) {
        itemInvoices[it.invoice_no] = it.covers || 0;
      }
    });
    const derivedPax = Object.values(itemInvoices).reduce((s, c) => s + c, 0);
    const orderPax = (orders || []).reduce((s, o) => s + (o.covers_pax || 0), 0);
    if (derivedPax !== orderPax) {
      discrepancies.push({ date, type: 'PAX_Mismatch', derivedPax, orderPax, diff: derivedPax - orderPax });
      coversMismatchCount++;
    }
  }

  console.log('\n--- AUDIT SUMMARY ACROSS ALL ' + uniqueDates.length + ' DATES ---');
  console.log('Hourly Item Sales vs Item Order Details Net Sales mismatches:', hourlyDiffCount);
  console.log('Orders Master vs Executive Summary Net Sales mismatches:', execOrdersNetDiffCount);
  console.log('Derived PAX (from Item Details) vs Orders Master PAX mismatches:', coversMismatchCount);

  if (discrepancies.length > 0) {
    console.log('\nSample discrepancies:');
    discrepancies.slice(0, 10).forEach(d => console.log(JSON.stringify(d)));
  } else {
    console.log('\n🎉 ZERO discrepancies across all 36 dates!');
  }
}

deepAudit().catch(console.error);
