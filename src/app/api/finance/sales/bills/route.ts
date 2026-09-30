import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const searchParams = request.nextUrl.searchParams;

    const selectedDate = searchParams.get('selected_date');
    let startDate = selectedDate || searchParams.get('start_date');
    let endDate = selectedDate || searchParams.get('end_date') || startDate;

    if (!startDate) {
      const { data: latestDateRow } = await supabase
        .from('sales_import_batches')
        .select('business_date')
        .order('business_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      startDate = latestDateRow?.business_date || new Date().toISOString().substring(0, 10);
      endDate = startDate;
    }

    const effectiveStart = selectedDate || startDate;
    const effectiveEnd = selectedDate || endDate;

    // Filters
    const paymentType = searchParams.get('payment_type');
    const captain = searchParams.get('captain');
    const orderType = searchParams.get('order_type');
    const statusParam = searchParams.get('status');
    const parentCategory = searchParams.get('parent_category');
    const category = searchParams.get('category');
    const item = searchParams.get('item');
    const search = searchParams.get('search')?.trim();

    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(10, parseInt(searchParams.get('page_size') || '25', 10)));

    // Check if any item-level filters are active
    const hasItemFilters = Boolean(parentCategory || category || item);

    let matchingInvoices: string[] | null = null;

    if (hasItemFilters) {
      // Find invoices containing items matching the item filters
      let itemQuery = supabase
        .from('sales_order_items')
        .select('invoice_no')
        .gte('business_date', effectiveStart)
        .lte('business_date', effectiveEnd);

      if (statusParam && statusParam !== 'ALL') {
        itemQuery = itemQuery.eq('status', statusParam);
      } else {
        itemQuery = itemQuery.eq('status', 'Success');
      }

      if (parentCategory) itemQuery = itemQuery.eq('parent_category', parentCategory);
      if (category) itemQuery = itemQuery.eq('category', category);
      if (item) itemQuery = itemQuery.ilike('item_name', `%${item}%`);
      if (paymentType) itemQuery = itemQuery.eq('payment_type', paymentType);
      if (captain) itemQuery = itemQuery.eq('captain_name', captain);

      if (orderType && orderType !== 'ALL') {
        if (orderType === 'Snacks Stall') {
          itemQuery = itemQuery.ilike('order_type', 'Delivery%').neq('area', 'LANCHO').not('payment_type', 'ilike', '%lancho%');
        } else if (orderType === 'Lancho') {
          itemQuery = itemQuery.or('area.eq.LANCHO,order_type.eq.LANCHO,payment_type.ilike.%lancho%');
        } else if (orderType === 'Takeaway') {
          itemQuery = itemQuery.or('order_type.eq.Pick Up,order_type.eq.Pickup,order_type.eq.Takeaway,area.eq.Parcel');
        } else if (orderType === 'Dine In') {
          itemQuery = itemQuery.ilike('order_type', 'Dine%');
        } else {
          itemQuery = itemQuery.eq('order_type', orderType);
        }
      }

      const { data: matchingItemRows, error: itemErr } = await itemQuery.limit(50000);
      if (itemErr) throw itemErr;

      matchingInvoices = Array.from(new Set((matchingItemRows || []).map((r) => r.invoice_no)));

      // If item filters were applied and no items match, return empty bills
      if (matchingInvoices.length === 0) {
        return NextResponse.json({
          rows: [],
          page: 1,
          pageSize,
          totalCount: 0,
          totalPages: 0,
          totalNetSales: 0,
          totalGrandTotal: 0,
          totalCovers: 0,
        });
      }
    }

    // Function to apply common order filters
    const applyOrderFilters = (query: any) => {
      let q = query
        .gte('business_date', effectiveStart)
        .lte('business_date', effectiveEnd);

      if (statusParam && statusParam !== 'ALL') {
        q = q.eq('status', statusParam);
      }

      if (matchingInvoices !== null) {
        q = q.in('invoice_no', matchingInvoices);
      }
      if (paymentType) q = q.eq('payment_type', paymentType);
      if (captain) q = q.eq('captain_name', captain);

      if (orderType && orderType !== 'ALL') {
        if (orderType === 'Snacks Stall') {
          q = q.ilike('order_type', 'Delivery%').neq('area', 'LANCHO').not('payment_type', 'ilike', '%lancho%');
        } else if (orderType === 'Lancho') {
          q = q.or('area.eq.LANCHO,order_type.eq.LANCHO,payment_type.ilike.%lancho%');
        } else if (orderType === 'Takeaway') {
          q = q.or('order_type.eq.Pick Up,order_type.eq.Pickup,order_type.eq.Takeaway,area.eq.Parcel');
        } else if (orderType === 'Dine In') {
          q = q.ilike('order_type', 'Dine%');
        } else {
          q = q.eq('order_type', orderType);
        }
      }

      if (search) {
        q = q.or(
          `invoice_no.ilike.%${search}%,customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%,biller.ilike.%${search}%,captain_name.ilike.%${search}%,area.ilike.%${search}%`
        );
      }

      return q;
    };

    // 1. Paginated Query with Count
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let ordersQuery = supabase.from('sales_orders').select('*', { count: 'exact' });
    ordersQuery = applyOrderFilters(ordersQuery);

    const { data: rows, count, error } = await ordersQuery
      .order('order_timestamp', { ascending: false, nullsFirst: false })
      .order('invoice_no', { ascending: false })
      .range(from, to);

    if (error) throw error;

    // 2. Summary aggregates for total filtered set
    let summaryQuery = supabase.from('sales_orders').select('net_sales, grand_total, covers_pax');
    summaryQuery = applyOrderFilters(summaryQuery);
    const { data: sumRows } = await summaryQuery.limit(50000);

    let totalNetSales = 0;
    let totalGrandTotal = 0;
    let totalCovers = 0;

    (sumRows || []).forEach((r) => {
      totalNetSales += Number(r.net_sales) || 0;
      totalGrandTotal += Number(r.grand_total) || 0;
      totalCovers += Number(r.covers_pax) || 0;
    });

    return NextResponse.json({
      rows: rows || [],
      page,
      pageSize,
      totalCount: count || 0,
      totalPages: Math.ceil((count || 0) / pageSize),
      totalNetSales: Math.round(totalNetSales * 100) / 100,
      totalGrandTotal: Math.round(totalGrandTotal * 100) / 100,
      totalCovers,
    });
  } catch (err: any) {
    console.error('Bills pagination error:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch bills.' }, { status: 500 });
  }
}
