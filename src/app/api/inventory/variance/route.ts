import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveFinanceCallerAuth } from '@/lib/auth/finance-auth';
import { calculateInventoryVariance } from '@/lib/inventory/variance';

export async function GET(request: NextRequest) {
  try {
    const auth = await resolveFinanceCallerAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    // RBAC Check: Strictly requires sops.costing.view, reports.view, finance.profitability, admin.manage, or Admin
    const hasVariancePermission =
      auth.isAdmin ||
      auth.permissionCodes.includes('sops.costing.view') ||
      auth.permissionCodes.includes('reports.view') ||
      auth.permissionCodes.includes('finance.profitability') ||
      auth.permissionCodes.includes('admin.manage');

    if (!hasVariancePermission) {
      return NextResponse.json(
        { error: 'Forbidden: Costing permissions required to view inventory variance.' },
        { status: 403 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const requestedStart = searchParams.get('start_date');
    const requestedEnd = searchParams.get('end_date');
    const mode = (searchParams.get('mode') || 'movement_based') as 'movement_based' | 'count_bounded';

    // Default to last 7 days in IST
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istToday = new Date(now.getTime() + istOffset);
    const endStr = requestedEnd && /^\d{4}-\d{2}-\d{2}$/.test(requestedEnd) ? requestedEnd : istToday.toISOString().slice(0, 10);
    const istWeekAgo = new Date(istToday.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startStr = requestedStart && /^\d{4}-\d{2}-\d{2}$/.test(requestedStart) ? requestedStart : istWeekAgo.toISOString().slice(0, 10);

    const admin = createAdminClient();
    const report = await calculateInventoryVariance(
      admin,
      startStr,
      endStr,
      mode,
      true // caller has validated costing permission
    );

    return NextResponse.json({
      success: true,
      report,
    });
  } catch (err: any) {
    console.error('Inventory variance error:', err);
    return NextResponse.json({ error: err.message || 'Failed to calculate inventory variance' }, { status: 500 });
  }
}
