import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { hasPermission, canViewCosting } from '../src/lib/rbac.ts';

const source = fs.readFileSync(new URL('../src/lib/sops/auth.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

async function resolve({ user = true, profile = null, error = null }) {
  let reads = 0;
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => { reads++; return { data: profile, error }; },
  };
  const dependencies = {
    'next/server': {},
    '@/lib/supabase/server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: user ? { id: 'fixture' } : null } }) } }) },
    '@/lib/supabase/admin': { createAdminClient: () => ({ from: table => { assert.equal(table, 'profiles'); return query; } }) },
    '@/lib/rbac': { hasPermission, canViewCosting },
  };
  const exports = {};
  new Function('exports', 'require', 'process', compiled)(exports, name => {
    assert.ok(name in dependencies);
    return dependencies[name];
  }, { env: { NODE_ENV: 'production' } });
  const result = await exports.resolveCallerAuth(new Request('http://localhost/api'));
  return { result, reads };
}

test('combined role lookup retains permission decisions with one profile read', async () => {
  for (const name of ['Admin', 'General Manager', 'Storekeeper', 'Accountant', 'Cashier', 'Gate Staff', 'Owner']) {
    for (const codes of [[], ['sops.menu.view'], ['sops.recipes.view', 'sops.recipes.manage', 'sops.costing.view']]) {
      const role = { name, role_permissions: codes.map(code => ({ permissions: { code } })) };
      for (const relation of [role, [role]]) {
        const { result, reads } = await resolve({ profile: { role: relation } });
        assert.equal(reads, 1);
        assert.equal(result.roleName, name);
        assert.deepEqual(result.permissionCodes, codes);
        assert.equal(result.canViewMenu, hasPermission(name, codes, 'sops.menu.view'));
        assert.equal(result.canViewRecipes, hasPermission(name, codes, 'sops.recipes.view'));
        assert.equal(result.canManageRecipes, hasPermission(name, codes, 'sops.recipes.manage'));
        assert.equal(result.hasCostAccess, canViewCosting(name, codes));
      }
    }
  }
});

test('missing identity, profile, role and failed combined query deny access', async () => {
  for (const scenario of [{ user: false }, {}, { profile: { role: null } }, { error: { code: 'READ_FAILED' } }]) {
    const { result, reads } = await resolve(scenario);
    assert.equal(reads, scenario.user === false ? 0 : 1);
    assert.equal(result.roleName, null);
    assert.deepEqual(result.permissionCodes, []);
    for (const key of ['canViewMenu', 'canViewRecipes', 'canManageRecipes', 'hasCostAccess']) assert.equal(result[key], false);
  }
});
