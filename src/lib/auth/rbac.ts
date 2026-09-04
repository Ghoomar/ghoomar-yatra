import { RoleName } from '../types/database';

export type AppPermission = 
  | 'sales:view' | 'sales:create' | 'sales:edit' | 'sales:delete'
  | 'inventory:view' | 'inventory:create' | 'inventory:edit' | 'inventory:delete'
  | 'expenses:view' | 'expenses:create' | 'expenses:edit' | 'expenses:delete' | 'expenses:approve'
  | 'purchases:view' | 'purchases:create' | 'purchases:edit' | 'purchases:delete'
  | 'people:view' | 'people:create' | 'people:edit'
  | 'operations:view' | 'operations:gate' | 'operations:closing' | 'operations:reopen'
  | 'admin:manage';

export const ROLE_DEFAULT_PERMISSIONS: Record<RoleName, AppPermission[]> = {
  'Admin': [
    'sales:view', 'sales:create', 'sales:edit', 'sales:delete',
    'inventory:view', 'inventory:create', 'inventory:edit', 'inventory:delete',
    'expenses:view', 'expenses:create', 'expenses:edit', 'expenses:delete', 'expenses:approve',
    'purchases:view', 'purchases:create', 'purchases:edit', 'purchases:delete',
    'people:view', 'people:create', 'people:edit',
    'operations:view', 'operations:gate', 'operations:closing', 'operations:reopen',
    'admin:manage'
  ],
  'Owner': [
    'sales:view', 'sales:create',
    'inventory:view',
    'expenses:view', 'expenses:create', 'expenses:approve',
    'purchases:view',
    'people:view',
    'operations:view', 'operations:gate', 'operations:closing'
  ],
  'General Manager': [
    'sales:view', 'sales:create',
    'inventory:view',
    'expenses:view', 'expenses:create', 'expenses:approve',
    'purchases:view',
    'people:view', 'people:create', 'people:edit',
    'operations:view', 'operations:gate', 'operations:closing'
  ],
  'Accountant': [
    'sales:view', 'sales:create', 'sales:edit',
    'inventory:view',
    'expenses:view', 'expenses:create', 'expenses:edit',
    'purchases:view', 'purchases:create', 'purchases:edit',
    'people:view',
    'operations:view', 'operations:closing'
  ],
  'Cashier': [
    'sales:view', 'sales:create',
    'operations:view'
  ],
  'Storekeeper': [
    'inventory:view', 'inventory:create', 'inventory:edit',
    'purchases:view', 'purchases:create'
  ],
  'Department Head': [
    'inventory:view', 'inventory:create',
    'people:view', 'people:create',
    'operations:view'
  ],
  'Gate Staff': [
    'operations:gate'
  ],
  'Viewer': [
    'sales:view', 'inventory:view', 'expenses:view', 'purchases:view', 'people:view', 'operations:view'
  ]
};

export function hasPermission(role: RoleName, permission: AppPermission): boolean {
  if (role === 'Admin') return true;
  return ROLE_DEFAULT_PERMISSIONS[role]?.includes(permission) ?? false;
}
