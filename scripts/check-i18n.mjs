import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const localesDir = path.join(__dirname, '..', 'src', 'locales');
const enDir = path.join(localesDir, 'en');
const hiDir = path.join(localesDir, 'hi');

function getKeys(obj, prefix = '') {
  let keys = [];
  for (const [key, val] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      keys = keys.concat(getKeys(val, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

const enFiles = fs.readdirSync(enDir).filter((f) => f.endsWith('.json'));
let hasError = false;
let totalCheckedKeys = 0;

console.log('🔍 Checking i18n translation key parity between English and Hindi...\n');

for (const file of enFiles) {
  const enFilePath = path.join(enDir, file);
  const hiFilePath = path.join(hiDir, file);

  if (!fs.existsSync(hiFilePath)) {
    console.error(`❌ Missing Hindi translation file: ${file}`);
    hasError = true;
    continue;
  }

  const enJson = JSON.parse(fs.readFileSync(enFilePath, 'utf8'));
  const hiJson = JSON.parse(fs.readFileSync(hiFilePath, 'utf8'));

  const enKeys = new Set(getKeys(enJson));
  const hiKeys = new Set(getKeys(hiJson));

  totalCheckedKeys += enKeys.size;

  const missingInHi = [...enKeys].filter((k) => !hiKeys.has(k));
  const missingInEn = [...hiKeys].filter((k) => !enKeys.has(k));

  if (missingInHi.length > 0) {
    console.error(`❌ [${file}] Missing ${missingInHi.length} key(s) in Hindi:`);
    missingInHi.forEach((k) => console.error(`    - ${k}`));
    hasError = true;
  }

  if (missingInEn.length > 0) {
    console.warn(`⚠️ [${file}] Extraneous ${missingInEn.length} key(s) in Hindi (not in English):`);
    missingInEn.forEach((k) => console.warn(`    - ${k}`));
    hasError = true;
  }

  if (missingInHi.length === 0 && missingInEn.length === 0) {
    console.log(`✅ [${file}] 100% parity (${enKeys.size} keys verified)`);
  }
}

console.log(`\n--------------------------------------------`);
if (hasError) {
  console.error(`❌ i18n parity check FAILED. Please resolve missing keys above.\n`);
  process.exit(1);
} else {
  console.log(`🎉 All ${totalCheckedKeys} translation keys have 100% English/Hindi parity!\n`);
  process.exit(0);
}
