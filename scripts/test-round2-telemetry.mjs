import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { suppressProfilingTelemetry } from '../src/lib/telemetry/profiling.ts';

test('telemetry suppression requires explicit local opt-in and cannot apply on Vercel', () => {
  const optedIn = { YATRA_LOCAL_PERF_NO_TELEMETRY: '1' };
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
    assert.equal(suppressProfilingTelemetry(`http://${host}:3101/api`, optedIn), true);
  }
  for (const env of [{}, { YATRA_LOCAL_PERF_NO_TELEMETRY: 'true' }, { ...optedIn, VERCEL: '1' }, { ...optedIn, VERCEL_ENV: 'production' }]) {
    assert.equal(suppressProfilingTelemetry('http://localhost:3101/api', env), false);
  }
  for (const url of ['https://yatra-ecru.vercel.app/api', 'http://localhost.example/api', 'invalid']) {
    assert.equal(suppressProfilingTelemetry(url, optedIn), false);
  }
});

for (const endpoint of ['heartbeat', 'reliability']) {
  test(`${endpoint}: local suppression never creates a write client, production retains writes, authentication remains required`, async () => {
    const source = fs.readFileSync(new URL(`../src/app/api/admin/telemetry/${endpoint}/route.ts`, import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    for (const scenario of [
      { user: true, url: 'http://localhost:3101/api', env: { YATRA_LOCAL_PERF_NO_TELEMETRY: '1' }, writes: 0, status: 200 },
      { user: true, url: 'https://yatra-ecru.vercel.app/api', env: {}, writes: 1, status: 200 },
      { user: false, url: 'http://localhost:3101/api', env: { YATRA_LOCAL_PERF_NO_TELEMETRY: '1' }, writes: 0, status: 401 },
    ]) {
      let writes = 0;
      let clients = 0;
      const dependencies = {
        'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
        '@/lib/supabase/server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: scenario.user ? { id: 'test' } : null } }) } }) },
        '@/lib/supabase/admin': { createAdminClient: () => { clients++; return { from: () => ({ upsert: async () => { writes++; }, insert: async () => { writes++; } }) }; } },
        '@/lib/telemetry/profiling': { suppressProfilingTelemetry: url => suppressProfilingTelemetry(url, scenario.env) },
      };
      const exports = {};
      new Function('exports', 'require', compiled)(exports, name => {
        assert.ok(name in dependencies, `Unexpected import: ${name}`);
        return dependencies[name];
      });
      const result = await exports.POST(new Request(scenario.url, { method: 'POST', body: JSON.stringify({ deviceId: 'mock', eventType: 'mock' }) }));
      assert.equal(result.status, scenario.status);
      assert.equal(writes, scenario.writes);
      assert.equal(clients, scenario.writes);
      if (scenario.user && !scenario.writes) assert.equal(result.body.suppressed, true);
    }
  });
}
