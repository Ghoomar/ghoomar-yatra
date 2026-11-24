import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { calculateInventoryVariance } from '@/lib/inventory/variance';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // RBAC Check: Strictly requires sops.costing.view, reports.view, finance.profitability, or Admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role:roles(name), role_permissions(permission:permissions(code))')
      .eq('id', user.id)
      .maybeSingle();

    const userRole = (profile?.role as any)?.name;
    const userPermissions = (profile?.role_permissions || []).map((rp: any) => rp?.permission?.code).filter(Boolean);

    const hasVariancePermission =
      userRole === 'Admin' ||
      userRole === 'Owner' ||
      userPermissions.includes('sops.costing.view') ||
      userPermissions.includes('reports.view') ||
      userPermissions.includes('finance.profitability') ||
      userPermissions.includes('admin.manage');

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

    const report = await calculateInventoryVariance(
      supabase,
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
