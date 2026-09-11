/**
 * Role-Based Access Control (RBAC) Constants, Module Mapping, and Evaluators
 */

export const ROUTE_PERMISSIONS: Record<string, string> = {
  '/dashboard': 'dashboard.view',
  '/operations/gate': 'operations.gate',
  '/operations/activities': 'operations.activities',
  '/operations/closing': 'operations.closing',
  '/finance/sales': 'finance.sales',
  '/finance/purchases': 'finance.purchases',
  '/finance/vendors': 'finance.vendors',
  '/finance/expenses': 'finance.expenses',
  '/finance/utilities': 'finance.utilities',
  '/finance/profitability': 'finance.profitability',
  '/inventory': 'inventory.stock',
  '/inventory/issues': 'inventory.issues',
  '/inventory/assets': 'inventory.assets',
  '/inventory/count': 'inventory.count',
  '/people/employees': 'people.employees',
  '/people/attendance': 'people.attendance',
  '/people/financials': 'people.financials',
  '/people/tips': 'people.tips',
  '/uniforms': 'uniforms.ledger',
  '/reports': 'reports.view',
  '/admin': 'admin.manage',
};

export const MODULE_CATEGORIES: Record<string, { label: string; icon: string }> = {
  dashboard: { label: 'Command Center', icon: 'LayoutDashboard' },
  operations: { label: 'Village Operations', icon: 'Sparkles' },
  finance: { label: 'Finance & Accounts', icon: 'IndianRupee' },
  inventory: { label: 'Store & Inventory', icon: 'Package' },
  people: { label: 'Staff & Attendance', icon: 'Users' },
  uniforms: { label: 'Uniform Ledger', icon: 'Shirt' },
  reports: { label: 'Intelligence & Reports', icon: 'BarChart3' },
  admin: { label: 'System Administration', icon: 'Shield' },
};

/**
 * Evaluates whether a set of user permissions satisfies the required permission.
 * 'Admin' role or 'admin.manage' permission possesses universal administrative override.
 */
export function hasPermission(
  userRole: string | null | undefined,
  userPermissions: string[] | null | undefined,
  requiredCode: string
): boolean {
  if (userRole === 'Admin') return true;
  if (!userPermissions || userPermissions.length === 0) return false;
  if (userPermissions.includes('admin.manage')) return true;
  return userPermissions.includes(requiredCode);
}

/**
 * Returns the required permission for a pathname, or null if unrestricted.
 */
export function getRequiredPermissionForPath(pathname: string): string | null {
  // Exact match first
  if (ROUTE_PERMISSIONS[pathname]) {
    return ROUTE_PERMISSIONS[pathname];
  }

  // Prefix match for nested sub-routes
  for (const [route, perm] of Object.entries(ROUTE_PERMISSIONS)) {
    if (pathname.startsWith(route) && route !== '/') {
      return perm;
    }
  }

  return null;
}
