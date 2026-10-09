import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env.local', 'utf8');
const envVars = Object.fromEntries(
  env.split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => [l.split('=')[0].trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const supabase = createClient(envVars.NEXT_PUBLIC_SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY);

async function inspectSchema() {
  const specRes = await fetch(envVars.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/', {
    headers: {
      'apikey': envVars.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': 'Bearer ' + envVars.SUPABASE_SERVICE_ROLE_KEY
    }
  });
  const spec = await specRes.json();
  const definitions = spec.definitions || {};

  console.log(`Auditing ${Object.keys(definitions).length} exposed definitions...`);

  const results = [];

  for (const [tableName, tableDef] of Object.entries(definitions)) {
    const properties = Object.keys(tableDef.properties || {});
    
    // Count rows
    let rowCount = null;
    let fetchError = null;
    try {
      const { count, error } = await supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true });
      if (error) {
        fetchError = error.message;
      } else {
        rowCount = count;
      }
    } catch (err) {
      fetchError = err.message;
    }

    results.push({
      tableName,
      rowCount,
      error: fetchError,
      columnsCount: properties.length,
      columns: properties,
      required: tableDef.required || []
    });
  }

  // Sort by rowCount desc
  results.sort((a, b) => (b.rowCount ?? -1) - (a.rowCount ?? -1));

  fs.writeFileSync('scripts/table_audit_results.json', JSON.stringify(results, null, 2));
  console.log('Audit complete. Results saved to scripts/table_audit_results.json');
  
  // Print summary by row count
  console.log('\n--- TABLES WITH DATA (> 0 rows) ---');
  results.filter(r => r.rowCount > 0).forEach(r => {
    console.log(`${r.tableName.padEnd(35)} : ${String(r.rowCount).padStart(7)} rows`);
  });

  console.log('\n--- TABLES WITH 0 ROWS ---');
  results.filter(r => r.rowCount === 0).forEach(r => {
    console.log(`${r.tableName.padEnd(35)} : 0 rows`);
  });

  if (results.some(r => r.error)) {
    console.log('\n--- TABLES WITH ERRORS / PERMISSION ISSUES ---');
    results.filter(r => r.error).forEach(r => {
      console.log(`${r.tableName.padEnd(35)} : ERROR - ${r.error}`);
    });
  }
}

inspectSchema().catch(console.error);
