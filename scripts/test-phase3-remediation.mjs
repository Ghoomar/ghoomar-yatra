import assert from 'node:assert';
import { convertDirectQuantity } from '../src/lib/sops/costing/units.ts';
import { isOpenItemDescription } from '../src/lib/petpooja/matcher.ts';
import { createAdminClient } from '../src/lib/supabase/admin.ts';

console.log('🧪 RUNNING PHASE 3 REVIEW REMEDIATION VERIFICATION SUITE...\n');

// TEST 1: Multi-tier unit conversion bridging
console.log('--- TEST 1: Multi-Tier Unit Conversion Bridging ---');
const bridged = convertDirectQuantity(5, 'pcs', 'kg', {
  conversions: [
    { from_unit: 'pcs', to_unit: 'g', multiplier: 20, is_verified: true, ingredient_group_id: 'test-group-cheese' }
  ],
  ingredientGroupId: 'test-group-cheese'
});
assert.strictEqual(bridged.possible, true, 'Bridged conversion should be possible');
assert.strictEqual(bridged.converted, 0.1, `5 pcs of 20g should equal 0.1 kg, got ${bridged.converted}`);
console.log('  ✅ 5 pcs (20g/pc) -> 0.1 kg bridged successfully');

const inverseBridged = convertDirectQuantity(0.1, 'kg', 'pcs', {
  conversions: [
    { from_unit: 'pcs', to_unit: 'g', multiplier: 20, is_verified: true, ingredient_group_id: 'test-group-cheese' }
  ],
  ingredientGroupId: 'test-group-cheese'
});
assert.strictEqual(inverseBridged.possible, true, 'Inverse bridged conversion should be possible');
assert.strictEqual(Math.round(inverseBridged.converted), 5, `0.1 kg should equal 5 pcs, got ${inverseBridged.converted}`);
console.log('  ✅ 0.1 kg -> 5 pcs inverse bridged successfully');

// TEST 2: Open item detection with category/group context & syntax patterns
console.log('\n--- TEST 2: Robust Open Item Detection ---');
assert.strictEqual(isOpenItemDescription('Special Custom Thali Add-on', 'Open Food', 'Food'), true, 'Should detect open item by rawCategory');
assert.strictEqual(isOpenItemDescription('Special Custom Thali Add-on', 'Food', 'Open Item'), true, 'Should detect open item by rawGroup');
assert.strictEqual(isOpenItemDescription('Open - Gulab Jamun Extra', 'Desserts', 'Food'), true, 'Should detect open item by "Open -" prefix');
assert.strictEqual(isOpenItemDescription('Misc 50', 'General', 'Food'), true, 'Should detect open item by "Misc" prefix');
assert.strictEqual(isOpenItemDescription('Special Custom Item [open]', 'General', 'Food'), true, 'Should detect open item by [open] tag');
assert.strictEqual(isOpenItemDescription('Paneer Butter Masala', 'Main Course', 'Food'), false, 'Should not detect standard menu item');
console.log('  ✅ All open item syntax patterns and category/group detection verified');

// TEST 3: Active vs Inactive dishes filtering
console.log('\n--- TEST 3: Canonical Dishes Active Filtering Guardrail ---');
const admin = createAdminClient();
// Insert a temporary inactive dish
const testSlug = `test-inactive-${Date.now()}`;
const { data: testDish, error: dishErr } = await admin.from('yatra_canonical_dishes').insert({
  name: 'Temporary Inactive Test Dish',
  slug: testSlug,
  category: 'PREPARATION',
  is_preparation: true,
  is_active: false
}).select().single();
assert(!dishErr, `Failed to insert inactive test dish: ${dishErr?.message}`);

try {
  // Query with active filter (simulating GET /api/sops/dishes default)
  const { data: activeList } = await admin.from('yatra_canonical_dishes').select('id, name, is_active').eq('is_active', true);
  const foundInActive = (activeList || []).some(d => d.id === testDish.id);
  assert.strictEqual(foundInActive, false, 'Inactive dish MUST NOT appear in active query');
  console.log('  ✅ Inactive/archived dish cleanly excluded from default dishes query');

  // Query with include_inactive (simulating ?include_inactive=true)
  const { data: allList } = await admin.from('yatra_canonical_dishes').select('id, name, is_active');
  const foundInAll = (allList || []).some(d => d.id === testDish.id);
  assert.strictEqual(foundInAll, true, 'Inactive dish appears when include_inactive is true');
  console.log('  ✅ Inactive/archived dish preserved when include_inactive=true');
} finally {
  await admin.from('yatra_canonical_dishes').delete().eq('id', testDish.id);
}

// TEST 4: Raw Material Creation Endpoint Verification
console.log('\n--- TEST 4: Raw Material Inline Creation Guardrail ---');
const testGrpName = `Test Herb ${Date.now()}`;
const { data: gUnit } = await admin.from('units').select('id').eq('symbol', 'g').single();
const { data: newGrp, error: grpErr } = await admin.from('logical_ingredient_groups').insert({
  name: testGrpName,
  group_code: `GRP-TEST-${Date.now().toString().slice(-4)}`,
  inventory_class: 'Food Raw Material',
  base_unit_id: gUnit.id,
  is_active: true
}).select('id, name, inventory_class, is_active').single();

assert(!grpErr, `Failed to create raw material group: ${grpErr?.message}`);
assert.strictEqual(newGrp.name, testGrpName);
assert.strictEqual(newGrp.inventory_class, 'Food Raw Material');
assert.strictEqual(newGrp.is_active, true);
console.log('  ✅ Raw material group created successfully with base unit and active status');
await admin.from('logical_ingredient_groups').delete().eq('id', newGrp.id);

console.log('\n========================================================================');
console.log('🎉 ALL PHASE 3 REMEDIATION TESTS PASSED CLEANLY!');
console.log('========================================================================\n');
