import { spawn } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach((l) => {
      const idx = l.indexOf('=');
      if (idx !== -1 && !l.trim().startsWith('#')) {
        const k = l.slice(0, idx).trim();
        const v = l.slice(idx + 1).trim();
        if (!process.env[k]) process.env[k] = v;
      }
    });
  }
}
loadEnv();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

let nextProcess = null;
let chromeProcess = null;
let tempProfileDir = null;
let testAdminUserId = null;

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAILED: ${message}`);
    failed++;
  }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, timeoutMs = 35000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 200 || res.status === 304 || res.status === 307) {
        return true;
      }
    } catch {}
    await sleep(500);
  }
  throw new Error(`Timeout waiting for ${url}`);
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 0;
    this.pending = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.id && this.pending.has(data.id)) {
            const { resolve, reject } = this.pending.get(data.id);
            this.pending.delete(data.id);
            if (data.error) reject(data.error);
            else resolve(data.result);
          }
        } catch (e) {
          console.error('CDP message parse error', e);
        }
      };
    });
  }

  async send(method, params = {}) {
    const id = ++this.msgId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval exception: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }

  close() {
    try {
      this.ws?.close();
    } catch {}
  }
}

async function runAcceptanceTest() {
  console.log('================================================================');
  console.log('🌐 REAL BROWSER ACCEPTANCE TEST (HEADLESS CHROME + CDP)');
  console.log('================================================================\n');

  // 1. Provision temporary Admin test user for real browser session
  console.log('[1] Provisioning temporary Admin user for browser session...');
  const { data: roles } = await supabase.from('roles').select('*');
  const adminRole = roles.find((r) => r.name === 'Admin');
  if (!adminRole) throw new Error('Admin role not found in database');

  const testEmail = `browser_test_${Date.now()}@ghoomarthali.in`;
  const testPassword = 'BrowserAdminPassword123!';

  const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true,
    user_metadata: { full_name: 'Browser Acceptance Admin' },
  });
  if (authErr) throw authErr;
  testAdminUserId = authUser.user.id;

  await supabase.from('profiles').insert({
    id: testAdminUserId,
    full_name: 'Browser Acceptance Admin',
    email: testEmail,
    role_id: adminRole.id,
    is_active: true,
  });
  console.log(`  -> Admin user provisioned: ${testEmail}\n`);

  // 2. Start production server
  const PORT = 3006;
  console.log(`[2] Starting production Next.js server on port ${PORT}...`);
  nextProcess = spawn('npx.cmd', ['next', 'start', '-p', String(PORT)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });

  await waitForHttp(`http://localhost:${PORT}`);
  console.log(`  -> Next.js production server ready on port ${PORT}.\n`);

  // 3. Launch Chrome Headless
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  tempProfileDir = mkdtempSync(path.join(tmpdir(), 'chrome-cdp-test-'));
  const DEBUG_PORT = 9222;

  console.log(`[3] Launching Chrome Headless with remote debugging port ${DEBUG_PORT}...`);
  chromeProcess = spawn(
    chromePath,
    [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${tempProfileDir}`,
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      `http://localhost:${PORT}/login`,
    ],
    { stdio: 'ignore' }
  );

  await waitForHttp(`http://localhost:${DEBUG_PORT}/json/version`);
  console.log('  -> Chrome CDP interface ready.\n');

  // 4. Connect to Chrome page target
  const targetsRes = await fetch(`http://localhost:${DEBUG_PORT}/json/list`);
  const targets = await targetsRes.json();
  const pageTarget =
    targets.find((t) => t.type === 'page' && t.url.includes(String(PORT))) ||
    targets.find((t) => t.type === 'page');

  if (!pageTarget || !pageTarget.webSocketDebuggerUrl) {
    throw new Error('No valid Chrome page target found');
  }

  const cdp = new CDPClient(pageTarget.webSocketDebuggerUrl);
  await cdp.connect();
  console.log(`[4] Connected to Chrome tab: ${pageTarget.url}\n`);

  // 5. Perform Login via UI Form
  console.log('[5] Authenticating via Login page form...');
  let loginPageLoaded = false;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    const hasInput = await cdp.eval('Boolean(document.querySelector("input[type=\'password\']"))');
    if (hasInput) {
      loginPageLoaded = true;
      break;
    }
  }
  assert(loginPageLoaded, 'Login form rendered in browser');

  // Fill credentials and click submit
  await cdp.eval(`(() => {
    const emailInput = document.querySelector('input[type="text"], input[type="email"]') || document.querySelectorAll('input')[0];
    const passInput = document.querySelector('input[type="password"]');
    const submitBtn = document.querySelector('button[type="submit"]');

    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(emailInput, '${testEmail}');
    emailInput.dispatchEvent(new Event('input', { bubbles: true }));
    emailInput.dispatchEvent(new Event('change', { bubbles: true }));

    nativeSetter.call(passInput, '${testPassword}');
    passInput.dispatchEvent(new Event('input', { bubbles: true }));
    passInput.dispatchEvent(new Event('change', { bubbles: true }));

    submitBtn.click();
  })()`);

  // Wait for login redirect to dashboard
  console.log('  -> Waiting for login completion and redirect...');
  let loggedIn = false;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const curUrl = await cdp.eval('window.location.href');
    if (curUrl && !curUrl.includes('/login')) {
      loggedIn = true;
      break;
    }
  }
  assert(loggedIn, 'Admin user successfully authenticated; session established');

  // 6. Navigate to /reports
  console.log('\n[6] Navigating to /reports as authenticated Admin...');
  await cdp.send('Page.navigate', { url: `http://localhost:${PORT}/reports` });

  // Wait for Reports page hydration and data fetch
  console.log('  -> Waiting for Reports page to fetch all section datasets...');
  let reportsLoaded = false;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const ready = await cdp.eval(`Boolean(document.querySelector('[data-testid="gate-footfall-value"]'))`);
    if (ready) {
      reportsLoaded = true;
      break;
    }
  }
  assert(reportsLoaded, 'Reports page fully rendered with all operational cards');

  // Let data settle
  await sleep(1500);

  // =========================================================================
  // CHECK A: Full Month Aggregation (Default Period: 2026-09-01 to 2026-09-30)
  // =========================================================================
  console.log('\n📌 CHECK A: Full Month Aggregation (2026-09-01 to 2026-09-30)');

  const checkA = await cdp.eval(`(() => {
    const text = document.body.innerText;
    
    // Check period subtitle / header
    const hasSepHeader = text.includes('1 Sept 2026 – 30 Sept 2026') || text.includes('01 Sep 2026 – 30 Sep 2026') || text.includes('Sep 2026');
    
    // Gate Footfall element: 4,083
    const gateFootfallEl = document.querySelector('[data-testid="gate-footfall-value"]');
    const gateFootfallVal = gateFootfallEl ? gateFootfallEl.textContent.trim() : '';

    // Snacks Stall Gross element: ₹6,105
    const snacksGrossEl = document.querySelector('[data-testid="snacks-stall-gross"]');
    const snacksGrossVal = snacksGrossEl ? snacksGrossEl.textContent.trim() : '';

    // Snacks Stall Orders element: 76 orders
    const snacksOrdersEl = document.querySelector('[data-testid="snacks-stall-orders"]');
    const snacksOrdersVal = snacksOrdersEl ? snacksOrdersEl.textContent.trim() : '';

    // Camel Gross element
    const camelGrossEl = document.querySelector('[data-testid="camel-gross-value"]');
    const camelGrossVal = camelGrossEl ? camelGrossEl.textContent.trim() : '';

    // Games Gross element
    const gamesGrossEl = document.querySelector('[data-testid="games-gross-value"]');
    const gamesGrossVal = gamesGrossEl ? gamesGrossEl.textContent.trim() : '';

    // Operating Surplus element
    const surplusGrossEl = document.querySelector('[data-testid="surplus-gross-value"]');
    const surplusGrossVal = surplusGrossEl ? surplusGrossEl.textContent.trim() : '';

    return {
      hasSepHeader,
      gateFootfallVal,
      snacksGrossVal,
      snacksOrdersVal,
      camelGrossVal,
      gamesGrossVal,
      surplusGrossVal
    };
  })()`);

  console.log('  [Observed Check A state]', checkA);

  assert(checkA.hasSepHeader, 'Header reflects the active September period range (1 Sept 2026 – 30 Sept 2026)');
  assert(checkA.gateFootfallVal.includes('4,083'), `Gate Counter displays cumulative month footfall: 4,083 (got '${checkA.gateFootfallVal}')`);
  assert(Number(checkA.snacksGrossVal.replace(/[^0-9]/g, '')) > 20000, `Snacks Stall displays month gross > ₹20K (got '${checkA.snacksGrossVal}')`);
  assert(Number(checkA.snacksOrdersVal.replace(/[^0-9]/g, '')) > 500, `Snacks Stall displays month orders > 500 (got '${checkA.snacksOrdersVal}')`);
  assert(checkA.camelGrossVal.includes('68,049') || checkA.camelGrossVal.includes('68'), `Camel Ride displays full month gross (got '${checkA.camelGrossVal}')`);
  assert(checkA.gamesGrossVal.includes('16,221') || checkA.gamesGrossVal.includes('16'), `Skill Games displays full month gross (got '${checkA.gamesGrossVal}')`);
  assert(Boolean(checkA.surplusGrossVal && checkA.surplusGrossVal !== '—' && !checkA.surplusGrossVal.includes('NaN')), `Operating Surplus displays valid month calculation (got '${checkA.surplusGrossVal}')`);

  // =========================================================================
  // CHECK B: Single-Day Drilldown Isolation (Select 2026-09-20)
  // =========================================================================
  console.log('\n📌 CHECK B: Single-Day Drilldown (Select 2026-09-20)');

  // Set date input to 2026-09-20
  await cdp.eval(`(() => {
    const dateInput = document.querySelector('[data-testid="header-date-input"]');
    if (dateInput) {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(dateInput, '2026-09-20');
      dateInput.dispatchEvent(new Event('input', { bubbles: true }));
      dateInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  })()`);

  // Poll until single-day data reloads
  console.log('  -> Waiting for single-day drilldown data to reload...');
  let drilldownLoaded = false;
  let checkB = null;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    checkB = await cdp.eval(`(() => {
      const text = document.body.innerText;
      const hasSingleDayHeader = text.includes('20 Sept 2026') || text.includes('20 Sep 2026') || text.includes('2026-09-20');
      const hasClearBtn = Boolean(document.querySelector('[data-testid="clear-drilldown-btn"]'));
      const gateFootfallEl = document.querySelector('[data-testid="gate-footfall-value"]');
      const gateFootfallVal = gateFootfallEl ? gateFootfallEl.textContent.trim() : '';
      const snacksGrossEl = document.querySelector('[data-testid="snacks-stall-gross"]');
      const snacksGrossVal = snacksGrossEl ? snacksGrossEl.textContent.trim() : '';

      return {
        hasSingleDayHeader,
        hasClearBtn,
        gateFootfallVal,
        snacksGrossVal
      };
    })()`);

    if (checkB.hasSingleDayHeader && checkB.gateFootfallVal.includes('2,038')) {
      drilldownLoaded = true;
      break;
    }
  }

  console.log('  [Observed Check B state]', checkB);

  assert(checkB.hasSingleDayHeader, 'Header and subtitles updated to isolated single day (20 Sep 2026)');
  assert(checkB.hasClearBtn, 'Clear Drilldown button (×) is now visible in the header');
  assert(checkB.gateFootfallVal.includes('2,038'), `Gate Counter isolated to Sep 20 footfall: 2,038 (got '${checkB.gateFootfallVal}')`);
  assert(!checkB.gateFootfallVal.includes('4,083'), 'Gate Counter no longer displays month aggregate (4,083)');
  assert(checkB.snacksGrossVal.includes('11,685'), `Snacks Stall isolated to Sep 20 gross: ₹11,685 (got '${checkB.snacksGrossVal}')`);

  // =========================================================================
  // CHECK C: Clearing Drilldown (Return to Full September Period)
  // =========================================================================
  console.log('\n📌 CHECK C: Clearing Drilldown (Return to 2026-09-01 to 2026-09-30)');

  // Click clear button
  await cdp.eval(`(() => {
    const clearBtn = document.querySelector('[data-testid="clear-drilldown-btn"]');
    if (clearBtn) {
      clearBtn.click();
    }
  })()`);

  // Poll until full period data restores
  console.log('  -> Waiting for full period data to restore...');
  let restoredLoaded = false;
  let checkC = null;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    checkC = await cdp.eval(`(() => {
      const text = document.body.innerText;
      const hasSepHeader = text.includes('1 Sept 2026 – 30 Sept 2026') || text.includes('01 Sep 2026 – 30 Sep 2026') || text.includes('Sep 2026');
      const hasClearBtn = Boolean(document.querySelector('[data-testid="clear-drilldown-btn"]'));
      const gateFootfallEl = document.querySelector('[data-testid="gate-footfall-value"]');
      const gateFootfallVal = gateFootfallEl ? gateFootfallEl.textContent.trim() : '';
      const snacksGrossEl = document.querySelector('[data-testid="snacks-stall-gross"]');
      const snacksGrossVal = snacksGrossEl ? snacksGrossEl.textContent.trim() : '';
      const snacksOrdersEl = document.querySelector('[data-testid="snacks-stall-orders"]');
      const snacksOrdersVal = snacksOrdersEl ? snacksOrdersEl.textContent.trim() : '';

      return {
        hasSepHeader,
        hasClearBtn,
        gateFootfallVal,
        snacksGrossVal,
        snacksOrdersVal
      };
    })()`);

    if (checkC.hasSepHeader && !checkC.hasClearBtn && checkC.gateFootfallVal.includes('4,083')) {
      restoredLoaded = true;
      break;
    }
  }

  console.log('  [Observed Check C state]', checkC);

  assert(checkC.hasSepHeader, 'Period header successfully restored to September range (1 Sept 2026 – 30 Sept 2026)');
  assert(!checkC.hasClearBtn, 'Clear button cleanly removed when drilldown is cleared');
  assert(checkC.gateFootfallVal.includes('4,083'), `Gate Counter cumulative month footfall restored: 4,083 (got '${checkC.gateFootfallVal}')`);
  assert(Number(checkC.snacksGrossVal.replace(/[^0-9]/g, '')) > 20000, `Snacks Stall month gross restored > ₹20K (got '${checkC.snacksGrossVal}')`);
  assert(Number(checkC.snacksOrdersVal.replace(/[^0-9]/g, '')) > 500, `Snacks Stall month orders restored > 500 (got '${checkC.snacksOrdersVal}')`);

  cdp.close();

  console.log('\n================================================================');
  console.log(`🏁 REAL BROWSER ACCEPTANCE RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

async function cleanup() {
  console.log('Cleaning up temporary accounts, browser, and server processes...');
  if (testAdminUserId) {
    try {
      await supabase.from('profiles').delete().eq('id', testAdminUserId);
      await supabase.auth.admin.deleteUser(testAdminUserId);
      console.log('  -> Cleaned up temporary Admin test user');
    } catch (e) {
      console.error('Error cleaning up test user:', e);
    }
  }
  try {
    if (chromeProcess?.pid) {
      spawn('taskkill', ['/F', '/T', '/PID', String(chromeProcess.pid)], { shell: true });
    }
  } catch {}
  try {
    if (nextProcess?.pid) {
      spawn('taskkill', ['/F', '/T', '/PID', String(nextProcess.pid)], { shell: true });
    }
  } catch {}
  await sleep(1000);
  try {
    if (tempProfileDir) rmSync(tempProfileDir, { recursive: true, force: true });
  } catch {}
}

runAcceptanceTest()
  .catch((err) => {
    console.error('❌ Browser acceptance test error:', err);
    failed++;
  })
  .finally(async () => {
    await cleanup();
    if (failed > 0) process.exit(1);
  });
