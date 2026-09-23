import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const srcDir = path.join(__dirname, '..', 'src');
const localesDir = path.join(srcDir, 'locales');
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

const enDict = {};
const hiDict = {};

for (const file of enFiles) {
  const enFilePath = path.join(enDir, file);
  const hiFilePath = path.join(hiDir, file);
  const namespace = file.replace('.json', '');

  if (!fs.existsSync(hiFilePath)) {
    console.error(`❌ Missing Hindi translation file: ${file}`);
    hasError = true;
    continue;
  }

  const enJson = JSON.parse(fs.readFileSync(enFilePath, 'utf8'));
  const hiJson = JSON.parse(fs.readFileSync(hiFilePath, 'utf8'));

  enDict[namespace] = enJson;
  hiDict[namespace] = hiJson;

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
  console.error(`❌ i18n dictionary parity check FAILED. Please resolve missing keys above.\n`);
  process.exit(1);
} else {
  console.log(`🎉 All ${totalCheckedKeys} translation keys have 100% English/Hindi parity!\n`);
}

// ==========================================
// 2. AUDIT CODE REFERENCES AGAINST DICTIONARY
// ==========================================
console.log('🔍 Auditing codebase for runtime translation key validity...\n');

function keyExistsInDict(dict, fullPath) {
  const parts = fullPath.split('.');
  let curr = dict;
  for (const p of parts) {
    if (curr && typeof curr === 'object' && p in curr) {
      curr = curr[p];
    } else {
      return false;
    }
  }
  return typeof curr === 'string';
}

function getCodeFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.next') {
        results = results.concat(getCodeFiles(filePath));
      }
    } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
      results.push(filePath);
    }
  }
  return results;
}

const codeFiles = getCodeFiles(srcDir);
const referencedKeys = new Map();
const staticRegex = /\bt\(\s*['"]([a-zA-Z0-9_.-]+)['"]/g;

for (const filePath of codeFiles) {
  if (filePath.includes('src\\locales') || filePath.includes('src/locales')) continue;
  if (filePath.includes('src\\lib\\i18n\\') || filePath.includes('src/lib/i18n/')) continue;

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    let match;
    staticRegex.lastIndex = 0;
    while ((match = staticRegex.exec(line)) !== null) {
      const key = match[1];
      if (!referencedKeys.has(key)) {
        referencedKeys.set(key, new Set());
      }
      const relPath = path.relative(path.join(__dirname, '..'), filePath);
      referencedKeys.get(key).add(`${relPath}:${lineNum}`);
    }
  });
}

let codeError = false;
const missingCodeEn = [];
const missingCodeHi = [];

for (const [key, locations] of referencedKeys.entries()) {
  const inEn = keyExistsInDict(enDict, key);
  const inHi = keyExistsInDict(hiDict, key);

  if (!inEn) {
    missingCodeEn.push({ key, locations: Array.from(locations) });
    codeError = true;
  }
  if (!inHi) {
    missingCodeHi.push({ key, locations: Array.from(locations) });
    codeError = true;
  }
}

if (codeError) {
  if (missingCodeEn.length > 0) {
    console.error(`❌ ${missingCodeEn.length} key(s) referenced in code are MISSING in English:`);
    for (const { key, locations } of missingCodeEn) {
      console.error(`  - "${key}" at ${locations[0]}`);
    }
  }
  if (missingCodeHi.length > 0) {
    console.error(`❌ ${missingCodeHi.length} key(s) referenced in code are MISSING in Hindi:`);
    for (const { key, locations } of missingCodeHi) {
      console.error(`  - "${key}" at ${locations[0]}`);
    }
  }
  console.error(`\n❌ Code runtime key audit FAILED.\n`);
  process.exit(1);
} else {
  console.log(`✅ All ${referencedKeys.size} translation keys referenced in code exist in both English & Hindi dictionaries.`);
  console.log(`🎉 100% dictionary parity AND 100% code reference integrity verified!\n`);
  process.exit(0);
}
