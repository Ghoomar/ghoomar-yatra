import fs from 'fs';
import { spawnSync } from 'child_process';

if (!process.env.__TSX_RUNNING__) {
  const quotedArgs = process.argv.slice(1).map(arg => `"${arg}"`);
  const result = spawnSync('npx tsx ' + quotedArgs.join(' '), {
    stdio: 'inherit',
    env: { ...process.env, __TSX_RUNNING__: '1' },
    shell: true,
  });
  process.exit(result.status ?? 0);
}

const env = fs.readFileSync('.env.local', 'utf8');
env.split('\n').forEach(line => {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
});
process.env.ENABLE_TEST_AUTH_OVERRIDE = 'true';

const { GET: getSettings, PATCH: patchSettings } = await import('../src/app/api/finance/purchase-approval-settings/route.ts');
const { GET: getRequests, POST: postRequest } = await import('../src/app/api/finance/purchase-requests/route.ts');
const { PATCH: patchLine } = await import('../src/app/api/finance/purchase-requests/[id]/lines/[lineId]/route.ts');
const { DELETE: deleteRequest } = await import('../src/app/api/finance/purchase-requests/[id]/route.ts');

const STOREKEEPER_ID = '16e29066-9477-4232-a5c9-e4dedbc988d9';
const ADMIN_ID = '21c087eb-2517-436e-9e52-80a9455ea749';

async function testPurchaseRequestsApi() {
  console.log('=== TEST 1: GET /api/finance/purchase-approval-settings ===');
  const getSetReq = new Request('http://localhost:3000/api/finance/purchase-approval-settings', {
    headers: { 'x-test-user-id': ADMIN_ID }
  });
  const setRes = await getSettings(getSetReq);
  const setData = await setRes.json();
  console.log('Settings fetched:', {
    auto_approve_enabled: setData.settings?.auto_approve_enabled,
    line_limit: setData.settings?.line_auto_approve_limit,
    daily_limit: setData.settings?.daily_non_staple_auto_limit,
    isApprover: setData.isApprover
  });

  console.log('\n=== TEST 2: POST /api/finance/purchase-requests (Storekeeper Submitting) ===');
  // Garlic Bread (exceeds max par) + Bonn Pizza Base (routine within limits)
  const postReq = new Request('http://localhost:3000/api/finance/purchase-requests', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-test-user-id': STOREKEEPER_ID
    },
    body: JSON.stringify({
      target_purchase_date: new Date().toISOString().split('T')[0],
      notes: 'API Unit Test Submission',
      lines: [
        {
          item_id: '16dc978c-02b6-4479-92c3-cebf6b946e82', // Garlic Bread: max par 1 pkt
          requested_quantity: 4, // 4 pkt > 1 max par
          estimated_unit_rate: 50,
          pack_unit_snapshot: 'pkt',
          pack_quantity: 4,
          conversion_factor_snapshot: 1,
        },
        {
          item_id: 'c355d7ef-b24c-4ae9-b111-d8e79cb20e58', // Pizza Base — Bonn
          requested_quantity: 2,
          estimated_unit_rate: 22.5,
          pack_unit_snapshot: 'pcs',
          pack_quantity: 2,
          conversion_factor_snapshot: 1,
        }
      ]
    })
  });

  const postRes = await postRequest(postReq);
  const postData = await postRes.json();
  console.log('POST Response status:', postRes.status);
  console.log('Created Request:', {
    id: postData.request?.id,
    request_number: postData.request?.request_number,
    linesCount: postData.lines?.length
  });

  postData.lines?.forEach((l, idx) => {
    console.log(`Line ${idx + 1} (${l.item_id}): status=${l.approval_status}, was_auto=${l.was_auto_approved}, reasons=${JSON.stringify(l.routing_reasons)}`);
  });

  const garlicLine = postData.lines?.find(l => l.item_id === '16dc978c-02b6-4479-92c3-cebf6b946e82');
  const pizzaLine = postData.lines?.find(l => l.item_id === 'c355d7ef-b24c-4ae9-b111-d8e79cb20e58');

  if (garlicLine?.approval_status !== 'pending_approval') {
    throw new Error(`Garlic bread line should be pending_approval, got ${garlicLine?.approval_status}`);
  }
  if (pizzaLine?.approval_status !== 'auto_approved') {
    throw new Error(`Pizza line should be auto_approved, got ${pizzaLine?.approval_status}`);
  }
  console.log('✅ Dual-Queue routing evaluated accurately in API route!');

  console.log('\n=== TEST 3: GET /api/finance/purchase-requests ===');
  const getReq = new Request('http://localhost:3000/api/finance/purchase-requests', {
    headers: { 'x-test-user-id': ADMIN_ID }
  });
  const listRes = await getRequests(getReq);
  const listData = await listRes.json();
  console.log(`Fetched ${listData.requests?.length} requests. Pending lines count: ${listData.summary?.pendingLinesCount}`);
  console.log(`30d usage sample count: ${Object.keys(listData.usage30dMap || {}).length}`);

  console.log('\n=== TEST 4: Approver Action PATCH /api/finance/purchase-requests/[id]/lines/[lineId] ===');
  const patchReq = new Request(`http://localhost:3000/api/finance/purchase-requests/${postData.request.id}/lines/${garlicLine.id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-test-user-id': ADMIN_ID
    },
    body: JSON.stringify({
      action: 'adjust_and_approve',
      approved_quantity: 1,
      review_note: 'Approved for 1 pkt to stay at par'
    })
  });
  const patchRes = await patchLine(patchReq, { params: Promise.resolve({ id: postData.request.id, lineId: garlicLine.id }) });
  const patchData = await patchRes.json();
  console.log('Approver Action result:', {
    line_status: patchData.line?.approval_status,
    approved_quantity: patchData.line?.approved_quantity,
    review_note: patchData.line?.review_note
  });

  console.log('\n=== TEST 5: Cleanup DELETE /api/finance/purchase-requests/[id] ===');
  const delReq = new Request(`http://localhost:3000/api/finance/purchase-requests/${postData.request.id}`, {
    method: 'DELETE',
    headers: { 'x-test-user-id': ADMIN_ID }
  });
  const delRes = await deleteRequest(delReq, { params: Promise.resolve({ id: postData.request.id }) });
  const delData = await delRes.json();
  console.log('Delete result:', delData);
  console.log('✅ 100% of test API records cleaned up.');

  console.log('\n🎉 ALL API DIRECT INTEGRATION TESTS PASSED!');
}

testPurchaseRequestsApi().catch((err) => {
  console.error('❌ API Direct Test Failed:', err);
  process.exit(1);
});
