/**
 * Role-Based Access Control (RBAC) Constants, Module Mapping, and Evaluators
 */

export const ROUTE_PERMISSIONS: Record<string, string | string[]> = {
  '/dashboard': 'dashboard.view',
  '/operations/daily': 'operations.daily',
  '/operations/gate': 'operations.gate',
  '/finance/sales': 'finance.sales',
  '/finance/purchases': 'finance.purchases',
  '/finance/vendors': 'finance.vendors',
  '/finance/expenses': 'finance.expenses',
  '/finance/utilities': 'finance.utilities',
  '/finance/profitability': 'finance.profitability',
  '/inventory': ['inventory.stock', 'inventory.assets'],
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
  if (userPermissions.includes(requiredCode)) return true;
  if (requiredCode === 'finance.purchases' && userPermissions.includes('finance.vendors')) return true;
  if (requiredCode === 'finance.vendors' && userPermissions.includes('finance.purchases')) return true;
  return false;
}

/**
 * Returns the required permission for a pathname, or null if unrestricted.
 */
export function getRequiredPermissionForPath(pathname: string): string | string[] | null {
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

export interface LandingPageOption {
  route: string;
  labelKey: string;
  requiredPermission: string | string[];
  module: string;
}

export const LANDING_PAGE_OPTIONS: LandingPageOption[] = [
  { route: '/dashboard', labelKey: 'navigation.items.dashboard', requiredPermission: 'dashboard.view', module: 'dashboard' },
  { route: '/operations/daily', labelKey: 'navigation.items.dailyOperations', requiredPermission: 'operations.daily', module: 'operations' },
  { route: '/operations/gate', labelKey: 'navigation.items.gateCounter', requiredPermission: 'operations.gate', module: 'operations' },
  { route: '/finance/purchases', labelKey: 'navigation.items.purchases', requiredPermission: 'finance.purchases', module: 'finance' },
  { route: '/finance/expenses', labelKey: 'navigation.items.expenses', requiredPermission: 'finance.expenses', module: 'finance' },
  { route: '/finance/utilities', labelKey: 'navigation.items.utilities', requiredPermission: 'finance.utilities', module: 'finance' },
  { route: '/finance/profitability', labelKey: 'navigation.items.profitability', requiredPermission: 'finance.profitability', module: 'finance' },
  { route: '/inventory', labelKey: 'navigation.items.inventoryAndAssets', requiredPermission: ['inventory.stock', 'inventory.assets'], module: 'inventory' },
  { route: '/inventory/issues', labelKey: 'navigation.items.storeIssues', requiredPermission: 'inventory.issues', module: 'inventory' },
  { route: '/inventory/count', labelKey: 'navigation.items.physicalCount', requiredPermission: 'inventory.count', module: 'inventory' },
  { route: '/people/employees', labelKey: 'navigation.items.staffDirectory', requiredPermission: 'people.employees', module: 'people' },
  { route: '/people/attendance', labelKey: 'navigation.items.attendance', requiredPermission: 'people.attendance', module: 'people' },
  { route: '/people/financials', labelKey: 'navigation.items.staffFinancials', requiredPermission: 'people.financials', module: 'people' },
  { route: '/people/tips', labelKey: 'navigation.items.tips', requiredPermission: 'people.tips', module: 'people' },
  { route: '/uniforms', labelKey: 'navigation.items.uniforms', requiredPermission: 'uniforms.ledger', module: 'uniforms' },
  { route: '/reports', labelKey: 'navigation.items.reports', requiredPermission: 'reports.view', module: 'reports' },
  { route: '/admin', labelKey: 'navigation.items.settings', requiredPermission: 'admin.manage', module: 'admin' },
];

export const INITIAL_ROLE_DEFAULT_ROUTES: Record<string, string> = {
  'Admin': '/dashboard',
  'Accountant': '/finance/profitability',
  'Cashier': '/finance/purchases',
  'Gate Staff': '/operations/gate',
  'General Manager': '/operations/daily',
  'Owner': '/dashboard',
  'Storekeeper': '/inventory/issues',
  'Store Keeper': '/inventory/issues',
  'Viewer': '/dashboard',
  'Department Head': '/dashboard',
};

/**
 * Checks whether a given role and permission set is authorized to access a route.
 */
export function isRouteAuthorized(
  roleName: string | null | undefined,
  permissionCodes: string[] | null | undefined,
  route: string
): boolean {
  if (!route || typeof route !== 'string') return false;

  // Validate that the route is a registered application route
  const isRegisteredRoute =
    ROUTE_PERMISSIONS[route] !== undefined ||
    LANDING_PAGE_OPTIONS.some((opt) => opt.route === route);

  if (!isRegisteredRoute) return false;

  if (roleName === 'Admin') return true;
  if (!permissionCodes || permissionCodes.length === 0) return false;
  if (permissionCodes.includes('admin.manage')) return true;

  const required = getRequiredPermissionForPath(route);
  if (!required) return true; // Unrestricted registered route
  if (Array.isArray(required)) {
    return required.some((perm) => hasPermission(roleName, permissionCodes, perm));
  }
  return hasPermission(roleName, permissionCodes, required);
}

/**
 * Resolves the appropriate landing page for a user based on:
 * 1. Configured destination for the role (if valid & authorized)
 * 2. Initial role default fallback (if authorized)
 * 3. Deterministic search for first authorized page
 * 4. null if no page is accessible (prevents redirect loops)
 */
export function resolveLandingPage(
  roleName: string | null | undefined,
  permissionCodes: string[] | null | undefined,
  configuredLandingPage?: string | null
): string | null {
  if (!roleName) return null;

  // 1. If configuredLandingPage is specified, check if it's authorized
  if (configuredLandingPage && isRouteAuthorized(roleName, permissionCodes, configuredLandingPage)) {
    return configuredLandingPage;
  }

  // 2. Initial role default fallback
  const fallback = INITIAL_ROLE_DEFAULT_ROUTES[roleName];
  if (fallback && isRouteAuthorized(roleName, permissionCodes, fallback)) {
    return fallback;
  }

  // 3. Deterministic search for first authorized landing page from LANDING_PAGE_OPTIONS
  for (const option of LANDING_PAGE_OPTIONS) {
    if (isRouteAuthorized(roleName, permissionCodes, option.route)) {
      return option.route;
    }
  }

  // 4. No accessible page exists
  return null;
}
