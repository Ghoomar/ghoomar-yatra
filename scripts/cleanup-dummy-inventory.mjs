import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env.local', 'utf8');
const envVars = Object.fromEntries(
  env.split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => [l.split('=')[0].trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const supabase = createClient(envVars.NEXT_PUBLIC_SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY);

const PRESERVED_ITEM_CODES = ['CON-DSL-001', 'CON-LPG-001'];
const PRESERVED_ITEM_IDS = [
  'd1e5e100-0001-4000-a000-000000000001',
  '195c1900-0002-4000-a000-000000000002'
];

async function cleanupInventory() {
  console.log('=== STEP 1: AUDITING CURRENT INVENTORY ITEMS ===');
  const { data: allItems, error: fetchErr } = await supabase
    .from('inventory_items')
    .select('id, item_code, name, inventory_class, is_active')
    .order('item_code');

  if (fetchErr) throw fetchErr;

  console.log(`Found ${allItems.length} total inventory items in database:`);
  console.table(allItems);

  const itemsToDelete = allItems.filter(
    item => !PRESERVED_ITEM_CODES.includes(item.item_code) && !PRESERVED_ITEM_IDS.includes(item.id)
  );

  console.log(`\nIdentified ${itemsToDelete.length} dummy items for deletion (11 general + 5 uniform):`);
  console.table(itemsToDelete.map(i => ({ id: i.id, code: i.item_code, name: i.name, class: i.inventory_class })));

  const idsToDelete = itemsToDelete.map(i => i.id);

  console.log('\n=== STEP 2: DELETING DUMMY INVENTORY ITEMS ===');
  const { error: delErr } = await supabase
    .from('inventory_items')
    .delete()
    .in('id', idsToDelete);

  if (delErr) {
    console.error('Delete error:', delErr);
    throw delErr;
  }
  console.log(`Successfully deleted ${idsToDelete.length} dummy items.`);

  console.log('\n=== STEP 3: VERIFYING PRESERVED SYSTEM ANCHORS ===');
  const { data: remainingItems, error: remErr } = await supabase
    .from('inventory_items')
    .select('id, item_code, name, inventory_class, current_stock, current_weighted_average_cost, is_active')
    .order('item_code');

  if (remErr) throw remErr;

  console.log(`Remaining items in inventory_items (${remainingItems.length}):`);
  console.table(remainingItems);

  if (remainingItems.length !== 2) {
    throw new Error(`Expected exactly 2 preserved items, but found ${remainingItems.length}`);
  }

  const remainingCodes = remainingItems.map(i => i.item_code).sort();
  if (remainingCodes[0] !== 'CON-DSL-001' || remainingCodes[1] !== 'CON-LPG-001') {
    throw new Error(`Unexpected remaining items: ${remainingCodes.join(', ')}`);
  }

  console.log('\nSUCCESS: Inventory cleanup complete. System anchors CON-DSL-001 and CON-LPG-001 are safely preserved.');
}

cleanupInventory().catch(err => {
  console.error('Inventory cleanup failed:', err);
  process.exit(1);
});
