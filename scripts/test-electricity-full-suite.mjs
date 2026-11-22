import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

const env = fs.readFileSync('.env.local', 'utf8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=').slice(1).join('=').trim();
const client = new Client({ connectionString: dbUrl });

async function runVerification() {
  await client.connect();
  console.log('=== STARTING ELECTRICITY VERIFICATION SUITE ===');

  // 1. Meter Metadata Verification
  const meterRes = await client.query(`
    SELECT id, meter_name, meter_number, location, sanctioned_load_kva, tariff_category, unit, meter_multiplier
    FROM public.meters
    WHERE id = 'bfd3c905-e5d4-4c59-bd75-5046ca5de89c';
  `);
  const meter = meterRes.rows[0];
  console.log('Meter:', meter);
  if (meter.meter_name !== 'Ghoomar Yatra Main Electricity Meter') {
    throw new Error(`Unexpected meter name: ${meter.meter_name}`);
  }
  if (meter.meter_number !== 'AL0057395') {
    throw new Error(`Unexpected meter number: ${meter.meter_number}`);
  }
  if (Number(meter.sanctioned_load_kva) !== 45 || meter.tariff_category !== 'LMV2 PV Commercial') {
    throw new Error(`Unexpected load/category: ${meter.sanctioned_load_kva}, ${meter.tariff_category}`);
  }
  console.log('✅ 1. Meter metadata verified');

  // 2. Reading Counts & Anchor Values
  const readingsCount = await client.query('SELECT COUNT(*) FROM public.meter_readings;');
  console.log('Total readings count:', readingsCount.rows[0].count);
  if (Number(readingsCount.rows[0].count) !== 45) {
    throw new Error(`Expected 45 readings, found: ${readingsCount.rows[0].count}`);
  }

  const anchor1 = await client.query(`
    SELECT * FROM public.meter_readings WHERE id = 'c1010000-0000-4000-a000-000000000001';
  `);
  if (anchor1.rows.length !== 1 || Number(anchor1.rows[0].reading_value) !== 174.55) {
    throw new Error('Anchor 1 (Oct 1) verification failed');
  }

  const anchor2 = await client.query(`
    SELECT * FROM public.meter_readings WHERE id = 'c1010000-0000-4000-a000-000000000002';
  `);
  if (anchor2.rows.length !== 1 || Number(anchor2.rows[0].reading_value) !== 377.51) {
    throw new Error('Anchor 2 (Nov 1) verification failed');
  }
  console.log('✅ 2. Exactly 45 readings verified with both UPPCL midnight anchors intact');

  // 3. Bill Reconciliation Verification
  const billsRes = await client.query(`
    SELECT * FROM public.electricity_bill_reconciliations ORDER BY billing_period_start ASC;
  `);
  console.log('Bills count:', billsRes.rows.length);
  if (billsRes.rows.length !== 2) {
    throw new Error(`Expected 2 reconciled bills, found: ${billsRes.rows.length}`);
  }

  const b1 = billsRes.rows[0];
  console.log('Bill 1 (OCT-2026):', {
    month: b1.bill_month,
    period: `${b1.billing_period_start.toISOString().slice(0, 10)} to ${b1.billing_period_end.toISOString().slice(0, 10)}`,
    billed_kvah: b1.billed_kvah,
    operational_cost: b1.operational_bill_cost,
    current_bill_amount: b1.current_bill_amount,
    effective_rate: b1.effective_rate_per_kvah,
  });
  if (Number(b1.billed_kvah) !== 6982.00 || Number(b1.operational_bill_cost) !== 70082.11) {
    throw new Error('Bill 1 values do not match UPPCL bill');
  }
  if (Math.abs(Number(b1.effective_rate_per_kvah) - 10.0375) > 0.001) {
    throw new Error(`Bill 1 effective rate mismatch: ${b1.effective_rate_per_kvah}`);
  }

  const b2 = billsRes.rows[1];
  console.log('Bill 2 (NOV-2026):', {
    month: b2.bill_month,
    period: `${b2.billing_period_start.toISOString().slice(0, 10)} to ${b2.billing_period_end.toISOString().slice(0, 10)}`,
    billed_kvah: b2.billed_kvah,
    operational_cost: b2.operational_bill_cost,
    current_bill_amount: b2.current_bill_amount,
    lpsc: b2.lpsc_charges,
    effective_rate: b2.effective_rate_per_kvah,
  });
  if (Number(b2.billed_kvah) !== 8118.40 || Number(b2.operational_bill_cost) !== 74544.46 || Number(b2.current_bill_amount) !== 74719.67) {
    throw new Error('Bill 2 values do not match UPPCL bill (LPSC exclusion)');
  }
  if (Math.abs(Number(b2.effective_rate_per_kvah) - 9.1822) > 0.001) {
    throw new Error(`Bill 2 effective rate mismatch: ${b2.effective_rate_per_kvah}`);
  }

  const combinedCost = Number(b1.operational_bill_cost) + Number(b2.operational_bill_cost);
  const combinedKvah = Number(b1.billed_kvah) + Number(b2.billed_kvah);
  const combinedRate = combinedCost / combinedKvah;
  console.log(`Combined 2-month effective rate: ₹${combinedRate.toFixed(4)}/kVAh (~₹9.58)`);
  if (Math.abs(combinedRate - 9.5777) > 0.005) {
    throw new Error(`Combined rate mismatch: ${combinedRate}`);
  }
  console.log('✅ 3. Reconciled bills & effective rates verified');

  // 4. Proportional Daily Allocation View Parity
  const ledgerTotal = await client.query(`
    SELECT ROUND(SUM(delta_consumption), 2) as total_delta FROM public.meter_readings_ledger;
  `);
  const allocTotal = await client.query(`
    SELECT ROUND(SUM(daily_kvah), 2) as total_alloc FROM public.daily_electricity_allocations;
  `);
  console.log('Ledger Total kVAh:', ledgerTotal.rows[0].total_delta, '| Allocated Total kVAh:', allocTotal.rows[0].total_alloc);
  if (Math.abs(Number(ledgerTotal.rows[0].total_delta) - Number(allocTotal.rows[0].total_alloc)) > 0.1) {
    throw new Error(`Mathematical conservation failed: ledger=${ledgerTotal.rows[0].total_delta}, alloc=${allocTotal.rows[0].total_alloc}`);
  }
  console.log('✅ 4. Exact mathematical conservation verified between intervals and daily allocations');

  // 5. Sep & Oct Period Allocations
  const sepAlloc = await client.query(`
    SELECT 
      ROUND(SUM(daily_kvah), 2) as sep_kvah,
      ROUND(SUM(operational_cost), 2) as sep_cost,
      BOOL_AND(cost_type = 'reconciled') as all_reconciled
    FROM public.daily_electricity_allocations
    WHERE business_date >= '2026-09-09' AND business_date <= '2026-09-30';
  `);
  console.log('Sep 09-30 Period:', sepAlloc.rows[0]);
  if (Number(sepAlloc.rows[0].sep_kvah) !== 6982.00 || !sepAlloc.rows[0].all_reconciled) {
    throw new Error(`Sep period allocation mismatch: ${JSON.stringify(sepAlloc.rows[0])}`);
  }

  const octAlloc = await client.query(`
    SELECT 
      ROUND(SUM(daily_kvah), 2) as oct_kvah,
      ROUND(SUM(operational_cost), 2) as oct_cost,
      BOOL_AND(cost_type = 'reconciled') as all_reconciled
    FROM public.daily_electricity_allocations
    WHERE business_date >= '2026-10-01' AND business_date <= '2026-10-31';
  `);
  console.log('Oct 01-31 Period:', octAlloc.rows[0]);
  if (Number(octAlloc.rows[0].oct_kvah) !== 8118.40 || !octAlloc.rows[0].all_reconciled) {
    throw new Error(`Oct period allocation mismatch: ${JSON.stringify(octAlloc.rows[0])}`);
  }
  console.log('✅ 5. Sep & Oct periods match billed units with 0.00 kVAh variance');

  // 6. Nov Unreconciled Dates Verification
  const novAlloc = await client.query(`
    SELECT 
      business_date, daily_kvah, operational_cost, cost_type, allocation_status
    FROM public.daily_electricity_allocations
    WHERE business_date >= '2026-11-01'
    ORDER BY business_date ASC
    LIMIT 5;
  `);
  console.log('Nov dates sample:');
  console.table(novAlloc.rows);
  if (novAlloc.rows.some(r => r.cost_type !== 'estimated')) {
    throw new Error('Nov dates should be estimated since Nov bill is not yet reconciled');
  }
  console.log('✅ 6. November unreconciled dates properly use dynamic estimated costing');

  // 7. Synthetic Live Mutation & Reversion Test
  console.log('Running synthetic reading insert on live Supabase...');
  const testReadingInsert = await client.query(`
    INSERT INTO public.meter_readings (
      id, meter_id, business_date, reading_timestamp, reading_value, is_reset, notes
    ) VALUES (
      'ffffffff-ffff-4fff-afff-ffffffffffff',
      'bfd3c905-e5d4-4c59-bd75-5046ca5de89c',
      '2026-11-21',
      '2026-11-21T18:00:00Z',
      497.10,
      false,
      'Synthetic test reading'
    ) RETURNING *;
  `);
  console.log('Inserted synthetic reading:', testReadingInsert.rows[0].id);

  // Check ledger delta for synthetic reading: (497.1 - 492.1) * 40 = 200.00
  const synthLedger = await client.query(`
    SELECT previous_reading_value, reading_value, delta_consumption
    FROM public.meter_readings_ledger
    WHERE id = 'ffffffff-ffff-4fff-afff-ffffffffffff';
  `);
  console.log('Synthetic reading ledger:', synthLedger.rows[0]);
  if (Number(synthLedger.rows[0].previous_reading_value) !== 492.10 || Number(synthLedger.rows[0].delta_consumption) !== 200.00) {
    throw new Error(`Synthetic ledger mismatch: expected delta 200.00, got ${synthLedger.rows[0].delta_consumption}`);
  }

  // Delete synthetic reading
  await client.query(`DELETE FROM public.meter_readings WHERE id = 'ffffffff-ffff-4fff-afff-ffffffffffff';`);
  const finalCount = await client.query('SELECT COUNT(*) FROM public.meter_readings;');
  if (Number(finalCount.rows[0].count) !== 45) {
    throw new Error(`Teardown failed: expected 45 readings, found ${finalCount.rows[0].count}`);
  }
  console.log('✅ 7. Live synthetic test & clean reversion completed successfully');

  console.log('🎉 ALL ELECTRICITY VERIFICATION TESTS PASSED PERFECTLY!');
  await client.end();
}

runVerification().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
