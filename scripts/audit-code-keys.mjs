import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const srcDir = path.join(__dirname, '..', 'src');
const localesDir = path.join(srcDir, 'locales');
const enDir = path.join(localesDir, 'en');
const hiDir = path.join(localesDir, 'hi');

// 1. Load dictionaries
function loadDictionaries(dir) {
  const dict = {};
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    const namespace = f.replace('.json', '');
    const content = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    dict[namespace] = content;
  }
  return dict;
}

const enDict = loadDictionaries(enDir);
const hiDict = loadDictionaries(hiDir);

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

// 2. Scan src files
function getFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.next') {
        results = results.concat(getFiles(filePath));
      }
    } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
      results.push(filePath);
    }
  }
  return results;
}

const codeFiles = getFiles(srcDir);
const referencedKeys = new Map(); // key -> Set of file:line
const dynamicCalls = [];

const staticRegex = /\bt\(\s*['"]([a-zA-Z0-9_.-]+)['"]/g;
const templateRegex = /\bt\(\s*`([^`]+)`/g;

for (const filePath of codeFiles) {
  // Skip locale definitions and the audit script itself
  if (filePath.includes('src\\locales') || filePath.includes('src/locales')) continue;
  if (filePath.includes('src\\lib\\i18n\\') || filePath.includes('src/lib/i18n/')) continue;

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    let match;

    // Static keys
    staticRegex.lastIndex = 0;
    while ((match = staticRegex.exec(line)) !== null) {
      const key = match[1];
      if (!referencedKeys.has(key)) {
        referencedKeys.set(key, new Set());
      }
      const relPath = path.relative(path.join(__dirname, '..'), filePath);
      referencedKeys.get(key).add(`${relPath}:${lineNum}`);
    }

    // Template literals
    templateRegex.lastIndex = 0;
    while ((match = templateRegex.exec(line)) !== null) {
      const tmpl = match[1];
      const relPath = path.relative(path.join(__dirname, '..'), filePath);
      dynamicCalls.push({ tmpl, location: `${relPath}:${lineNum}` });
    }
  });
}

console.log(`Found ${referencedKeys.size} distinct static translation keys referenced in code.`);
console.log(`Found ${dynamicCalls.length} dynamic/template translation calls.\n`);

const missingInEn = [];
const missingInHi = [];

for (const [key, locations] of referencedKeys.entries()) {
  const inEn = keyExistsInDict(enDict, key);
  const inHi = keyExistsInDict(hiDict, key);

  if (!inEn) {
    missingInEn.push({ key, locations: Array.from(locations) });
  }
  if (!inHi) {
    missingInHi.push({ key, locations: Array.from(locations) });
  }
}

if (missingInEn.length > 0) {
  console.error(`❌ ${missingInEn.length} key(s) referenced in code are MISSING in English dictionaries:`);
  for (const { key, locations } of missingInEn) {
    console.error(`  - "${key}"`);
    locations.slice(0, 3).forEach((loc) => console.error(`      at ${loc}`));
    if (locations.length > 3) console.error(`      ... and ${locations.length - 3} more`);
  }
} else {
  console.log(`✅ All ${referencedKeys.size} code-referenced keys exist in English dictionaries.`);
}

console.log('');

if (missingInHi.length > 0) {
  console.error(`❌ ${missingInHi.length} key(s) referenced in code are MISSING in Hindi dictionaries:`);
  for (const { key, locations } of missingInHi) {
    console.error(`  - "${key}"`);
    locations.slice(0, 3).forEach((loc) => console.error(`      at ${loc}`));
    if (locations.length > 3) console.error(`      ... and ${locations.length - 3} more`);
  }
} else {
  console.log(`✅ All ${referencedKeys.size} code-referenced keys exist in Hindi dictionaries.`);
}

if (dynamicCalls.length > 0) {
  console.log(`\nℹ️ Dynamic/Template Calls (inspect to verify valid prefixes/enums):`);
  dynamicCalls.forEach((d) => console.log(`  - \`${d.tmpl}\` at ${d.location}`));
}

if (missingInEn.length > 0 || missingInHi.length > 0) {
  process.exit(1);
} else {
  console.log('\n🎉 Audit complete: Zero missing runtime keys!');
  process.exit(0);
}
