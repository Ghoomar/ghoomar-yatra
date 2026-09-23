import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { HourlyCategoryDataPoint, SalesAnalyticsResponse } from '@/lib/types/sales';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const searchParams = request.nextUrl.searchParams;

    // Dates
    let startDate = searchParams.get('start_date');
    let endDate = searchParams.get('end_date');

    // If no date provided, find latest available date with data
    if (!startDate) {
      const { data: latestDateRow } = await supabase
        .from('sales_import_batches')
        .select('business_date')
        .order('business_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      const defaultDate = latestDateRow?.business_date || new Date().toISOString().substring(0, 10);
      startDate = defaultDate;
      endDate = defaultDate;
    } else if (!endDate) {
      endDate = startDate;
    }

    // Granular filter parameters
    const parentCategoryFilter = searchParams.get('parent_category');
    const categoryFilter = searchParams.get('category');
    const itemFilter = searchParams.get('item');
    const captainFilter = searchParams.get('captain');
    const paymentTypeFilter = searchParams.get('payment_type');
    const orderTypeFilter = searchParams.get('order_type');

    // 1. Fetch Hourly Items in date range
    let hourlyQuery = supabase
      .from('sales_hourly_items')
      .select('*')
      .gte('business_date', startDate)
      .lte('business_date', endDate);

    if (parentCategoryFilter) {
      hourlyQuery = hourlyQuery.eq('parent_category', parentCategoryFilter);
    }
    if (categoryFilter) {
      hourlyQuery = hourlyQuery.eq('category', categoryFilter);
    }
    if (itemFilter) {
      hourlyQuery = hourlyQuery.ilike('item_name', `%${itemFilter}%`);
    }

    // 2. Fetch Orders in date range
    let ordersQuery = supabase
      .from('sales_orders')
      .select('*')
      .gte('business_date', startDate)
      .lte('business_date', endDate)
      .eq('status', 'Success');

    if (captainFilter) {
      ordersQuery = ordersQuery.eq('captain_name', captainFilter);
    }
    if (paymentTypeFilter) {
      ordersQuery = ordersQuery.eq('payment_type', paymentTypeFilter);
    }
    if (orderTypeFilter) {
      ordersQuery = ordersQuery.eq('order_type', orderTypeFilter);
    }

    // 3. Fetch Reconciliation Row
    const reconQuery = supabase
      .from('daily_sales_reconciliation')
      .select('*')
      .gte('business_date', startDate)
      .lte('business_date', endDate)
      .limit(1);

    const [hourlyRes, ordersRes, reconRes] = await Promise.all([hourlyQuery, ordersQuery, reconQuery]);

    const hourlyItems = hourlyRes.data || [];
    const orders = ordersRes.data || [];
    const reconciliation = reconRes.data && reconRes.data.length > 0 ? reconRes.data[0] : null;

    // Compute Executive KPIs
    let netSales = 0;
    let grossSales = 0;
    let totalTax = 0;
    let totalDiscounts = 0;
    let totalItemsSold = 0;
    let totalBills = orders.length;

    const hasGranularFilters = Boolean(
      parentCategoryFilter || categoryFilter || itemFilter || captainFilter || paymentTypeFilter || orderTypeFilter
    );

    if (!hasGranularFilters && reconciliation && reconciliation.exec_grand_total) {
      // 1. Authoritative Executive Summary standard of truth
      netSales = Number(reconciliation.exec_net_sales) || 0;
      grossSales = Number(reconciliation.exec_grand_total) || 0;
      totalBills = orders.length > 0 ? orders.length : Number(reconciliation.exec_bills_count) || 0;
      totalTax = orders.length > 0
        ? orders.reduce((sum, o) => sum + (Number(o.tax_amount) || 0), 0)
        : hourlyItems.reduce((sum, h) => sum + (Number(h.tax_amount) || 0), 0);
      totalDiscounts = orders.length > 0
        ? orders.reduce((sum, o) => sum + (Number(o.discount_amount) || 0), 0)
        : hourlyItems.reduce((sum, h) => sum + (Number(h.discount_amount) || 0), 0);
    } else if (orders.length > 0) {
      // 2. Authoritative Orders Master bills standard
      netSales = orders.reduce((sum, o) => sum + (Number(o.net_sales) || 0), 0);
      grossSales = orders.reduce((sum, o) => sum + (Number(o.grand_total) || 0), 0);
      totalTax = orders.reduce((sum, o) => sum + (Number(o.tax_amount) || 0), 0);
      totalDiscounts = orders.reduce((sum, o) => sum + (Number(o.discount_amount) || 0), 0);
    } else if (hourlyItems.length > 0) {
      // 3. Fallback to hourly items only if neither Executive nor Orders Master exists
      netSales = hourlyItems.reduce((sum, h) => sum + (Number(h.net_sales) || 0), 0);
      grossSales = hourlyItems.reduce((sum, h) => sum + (Number(h.total_sales) || 0), 0);
      totalTax = hourlyItems.reduce((sum, h) => sum + (Number(h.tax_amount) || 0), 0);
      totalDiscounts = hourlyItems.reduce((sum, h) => sum + (Number(h.discount_amount) || 0), 0);
    }

    totalItemsSold = hourlyItems.reduce((sum, h) => sum + (Number(h.quantity) || 0), 0);
    const averageOrderValue = totalBills > 0 ? Math.round((netSales / totalBills) * 100) / 100 : 0;

    // Compute Hourly Stacked Breakdown (0..23 hours)
    const parentCategoriesSet = new Set<string>();
    const hourMap = new Map<number, HourlyCategoryDataPoint>();

    for (let h = 0; h < 24; h++) {
      const displayH = h % 12 === 0 ? 12 : h % 12;
      const meridiem = h >= 12 ? 'PM' : 'AM';
      const label = `${String(displayH).padStart(2, '0')}:00 ${meridiem}`;

      hourMap.set(h, {
        hour: h,
        hour_label: label,
        total_sales: 0,
        total_quantity: 0,
        categories: {},
      });
    }

    hourlyItems.forEach((item) => {
      const h = item.hour_of_day;
      const parentCat = item.parent_category || 'Other';
      parentCategoriesSet.add(parentCat);

      const hourData = hourMap.get(h);
      if (hourData) {
        const itemNet = Number(item.net_sales) || 0;
        const itemQty = Number(item.quantity) || 0;

        hourData.total_sales = Math.round((hourData.total_sales + itemNet) * 100) / 100;
        hourData.total_quantity = Math.round((hourData.total_quantity + itemQty) * 100) / 100;

        if (!hourData.categories[parentCat]) {
          hourData.categories[parentCat] = { amount: 0, quantity: 0 };
        }
        hourData.categories[parentCat].amount =
          Math.round((hourData.categories[parentCat].amount + itemNet) * 100) / 100;
        hourData.categories[parentCat].quantity =
          Math.round((hourData.categories[parentCat].quantity + itemQty) * 100) / 100;
      }
    });

    const hourlyArray = Array.from(hourMap.values());
    const parentCategoriesList = Array.from(parentCategoriesSet);

    // Derived Breakdown 1: Parent Categories
    const parentCatMap = new Map<string, { amount: number; quantity: number }>();
    hourlyItems.forEach((item) => {
      const p = item.parent_category || 'Other';
      const prev = parentCatMap.get(p) || { amount: 0, quantity: 0 };
      parentCatMap.set(p, {
        amount: prev.amount + (Number(item.net_sales) || 0),
        quantity: prev.quantity + (Number(item.quantity) || 0),
      });
    });

    const byParentCategory = Array.from(parentCatMap.entries())
      .map(([name, data]) => ({
        name,
        amount: Math.round(data.amount * 100) / 100,
        quantity: Math.round(data.quantity * 100) / 100,
        sharePercent: netSales > 0 ? Math.round((data.amount / netSales) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    // Derived Breakdown 2: Subcategories
    const catMap = new Map<string, { parent: string; amount: number; quantity: number }>();
    hourlyItems.forEach((item) => {
      const c = item.category || 'General';
      const prev = catMap.get(c) || { parent: item.parent_category || 'Other', amount: 0, quantity: 0 };
      catMap.set(c, {
        parent: prev.parent,
        amount: prev.amount + (Number(item.net_sales) || 0),
        quantity: prev.quantity + (Number(item.quantity) || 0),
      });
    });

    const byCategory = Array.from(catMap.entries())
      .map(([name, data]) => ({
        name,
        parent: data.parent,
        amount: Math.round(data.amount * 100) / 100,
        quantity: Math.round(data.quantity * 100) / 100,
      }))
      .sort((a, b) => b.amount - a.amount);

    // Derived Breakdown 3: Top Selling Items
    const itemSalesMap = new Map<string, { parentCategory: string; amount: number; quantity: number }>();
    hourlyItems.forEach((item) => {
      const name = item.item_name;
      const prev = itemSalesMap.get(name) || {
        parentCategory: item.parent_category || 'Other',
        amount: 0,
        quantity: 0,
      };
      itemSalesMap.set(name, {
        parentCategory: prev.parentCategory,
        amount: prev.amount + (Number(item.net_sales) || 0),
        quantity: prev.quantity + (Number(item.quantity) || 0),
      });
    });

    const byTopItems = Array.from(itemSalesMap.entries())
      .map(([name, data]) => ({
        name,
        parentCategory: data.parentCategory,
        amount: Math.round(data.amount * 100) / 100,
        quantity: Math.round(data.quantity * 100) / 100,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 15);

    // Derived Breakdown 4: Payment Modes
    const paymentMap = new Map<string, number>();
    orders.forEach((o) => {
      const p = o.payment_type || 'Unknown';
      const cur = paymentMap.get(p) || 0;
      paymentMap.set(p, cur + (Number(o.grand_total) || 0));
    });

    const byPaymentMode = Array.from(paymentMap.entries())
      .map(([name, amount]) => ({
        name,
        amount: Math.round(amount * 100) / 100,
        sharePercent: grossSales > 0 ? Math.round((amount / grossSales) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    // Derived Breakdown 5: Captain Performance
    const captainMap = new Map<string, { count: number; covers: number; net: number }>();
    orders.forEach((o) => {
      const cap = o.captain_name || 'Unassigned';
      const prev = captainMap.get(cap) || { count: 0, covers: 0, net: 0 };
      captainMap.set(cap, {
        count: prev.count + 1,
        covers: prev.covers + (Number(o.covers_pax) || 1),
        net: prev.net + (Number(o.net_sales) || 0),
      });
    });

    const byCaptain = Array.from(captainMap.entries())
      .map(([name, d]) => ({
        name,
        ordersCount: d.count,
        coversPax: d.covers,
        netSales: Math.round(d.net * 100) / 100,
        avgOrder: d.count > 0 ? Math.round((d.net / d.count) * 100) / 100 : 0,
      }))
      .sort((a, b) => b.netSales - a.netSales);

    // Derived Breakdown 6: Order Types
    const orderTypeMap = new Map<string, { count: number; net: number }>();
    orders.forEach((o) => {
      const t = o.order_type || 'Dine In';
      const prev = orderTypeMap.get(t) || { count: 0, net: 0 };
      orderTypeMap.set(t, {
        count: prev.count + 1,
        net: prev.net + (Number(o.net_sales) || 0),
      });
    });

    const byOrderType = Array.from(orderTypeMap.entries())
      .map(([name, d]) => ({
        name,
        count: d.count,
        netSales: Math.round(d.net * 100) / 100,
        sharePercent: netSales > 0 ? Math.round((d.net / netSales) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.netSales - a.netSales);

    // Derived Breakdown 7: Diagnostic for Unmatched Petpooja Items
    const unmatchedItemsMap = new Map<string, { quantity: number; amount: number }>();
    hourlyItems.forEach((item) => {
      if (item.parent_category === 'Uncategorized') {
        const name = item.item_name;
        const prev = unmatchedItemsMap.get(name) || { quantity: 0, amount: 0 };
        unmatchedItemsMap.set(name, {
          quantity: prev.quantity + (Number(item.quantity) || 0),
          amount: prev.amount + (Number(item.net_sales) || 0),
        });
      }
    });

    const unmatchedItems = Array.from(unmatchedItemsMap.entries())
      .map(([name, d]) => ({
        itemName: name,
        quantity: Math.round(d.quantity * 100) / 100,
        amount: Math.round(d.amount * 100) / 100,
      }))
      .sort((a, b) => b.amount - a.amount);

    // Filter Options
    const { data: allMenu } = await supabase
      .from('pos_menu_items')
      .select('parent_category, category, name')
      .order('parent_category');

    const parentCatOptions = Array.from(new Set((allMenu || []).map((m) => m.parent_category).filter(Boolean)));
    const catOptions = Array.from(new Set((allMenu || []).map((m) => m.category).filter(Boolean)));
    const itemOptions = Array.from(new Set((allMenu || []).map((m) => m.name).filter(Boolean)));
    const captainOptions = Array.from(new Set(orders.map((o) => o.captain_name).filter(Boolean)));
    const paymentOptions = Array.from(new Set(orders.map((o) => o.payment_type).filter(Boolean)));
    const orderTypeOptions = Array.from(new Set(orders.map((o) => o.order_type).filter(Boolean)));

    const response: SalesAnalyticsResponse = {
      dateRange: { start: startDate || '', end: endDate || startDate || '' },
      kpis: {
        netSales: Math.round(netSales * 100) / 100,
        grossSales: Math.round(grossSales * 100) / 100,
        totalBills,
        totalItemsSold,
        totalTax: Math.round(totalTax * 100) / 100,
        totalDiscounts: Math.round(totalDiscounts * 100) / 100,
        averageOrderValue,
      },
      hourly: hourlyArray,
      parentCategoriesList,
      breakdowns: {
        byParentCategory,
        byCategory,
        byTopItems,
        byPaymentMode,
        byCaptain,
        byOrderType,
        unmatchedItems,
      },
      reconciliation,
      allBills: orders,
      activeFilterOptions: {
        parentCategories: parentCatOptions,
        categories: catOptions,
        items: itemOptions,
        captains: captainOptions,
        paymentTypes: paymentOptions,
        orderTypes: orderTypeOptions,
      },
    };

    return NextResponse.json(response);
  } catch (err: any) {
    console.error('Analytics error:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch sales analytics.' }, { status: 500 });
  }
}
