import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { HourlyCategoryDataPoint, SalesAnalyticsResponse } from '@/lib/types/sales';
import { getOrderBusinessUnit } from '@/lib/sales/business-units';

async function fetchAllRows<T = any>(queryBuilder: any): Promise<T[]> {
  const PAGE_SIZE = 1000;
  const allRows: T[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await queryBuilder.range(from, to);
    if (error) throw error;
    if (data && data.length > 0) {
      allRows.push(...data);
      if (data.length < PAGE_SIZE) {
        hasMore = false;
      } else {
        page++;
      }
    } else {
      hasMore = false;
    }
  }
  return allRows;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const searchParams = request.nextUrl.searchParams;

    // Dates
    const selectedDate = searchParams.get('selected_date');
    let startDate = selectedDate || searchParams.get('start_date');
    let endDate = selectedDate || searchParams.get('end_date');

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

    // Fetch master menu, translations, reconciliation, and check date coverage
    const [
      { data: dbParents },
      { data: dbCats },
      { data: allMenu },
      reconRes,
      execRes,
      { data: itemDateRows },
    ] = await Promise.all([
      supabase.from('pos_parent_categories').select('name, name_hi, color').order('display_order'),
      supabase.from('pos_categories').select('name, name_hi').order('display_order'),
      supabase.from('pos_menu_items').select('parent_category, category, name').order('name'),
      supabase
        .from('daily_sales_reconciliation')
        .select('*')
        .gte('business_date', startDate)
        .lte('business_date', endDate)
        .order('business_date'),
      supabase
        .from('sales_executive_summaries')
        .select('*')
        .gte('business_date', startDate)
        .lte('business_date', endDate)
        .order('business_date', { ascending: false }),
      supabase
        .from('sales_order_items')
        .select('business_date')
        .gte('business_date', startDate)
        .lte('business_date', endDate),
    ]);

    // Build multi-day or single-day reconciliation object
    let reconciliation: any = null;
    const reconRows = reconRes.data || [];
    if (reconRows.length > 0) {
      if (startDate === endDate) {
        reconciliation = reconRows[0];
      } else {
        const totalExecNet = reconRows.reduce((sum, r) => sum + (Number(r.exec_net_sales) || 0), 0);
        const totalExecGrand = reconRows.reduce((sum, r) => sum + (Number(r.exec_grand_total) || 0), 0);
        const totalExecBills = reconRows.reduce((sum, r) => sum + (Number(r.exec_bills_count) || 0), 0);
        const totalOrdersNet = reconRows.reduce((sum, r) => sum + (Number(r.orders_net_sales) || 0), 0);
        const totalOrdersGrand = reconRows.reduce((sum, r) => sum + (Number(r.orders_grand_total) || 0), 0);
        const totalOrdersCount = reconRows.reduce((sum, r) => sum + (Number(r.orders_count) || 0), 0);
        const totalHourlyNet = reconRows.reduce((sum, r) => sum + (Number(r.hourly_net_sales) || 0), 0);
        const totalHourlyItems = reconRows.reduce((sum, r) => sum + (Number(r.hourly_items_sold) || 0), 0);

        const hasDiff = reconRows.some(
          (r) => r.reconciliation_status === 'Difference Found' || Math.abs(Number(r.orders_exec_diff || 0)) > 0.05
        );
        const anyMissingSummary = reconRows.some((r) => r.reconciliation_status === 'Missing Executive Summary');
        const anyOnlySummary = reconRows.some((r) => r.reconciliation_status === 'Only Executive Summary Imported');

        let status = 'Reconciled';
        if (hasDiff) status = 'Difference Found';
        else if (anyMissingSummary) status = 'Missing Executive Summary';
        else if (anyOnlySummary) status = 'Only Executive Summary Imported';

        const granularNet = totalOrdersNet > 0 ? totalOrdersNet : totalHourlyNet;
        const diff = Math.round((granularNet - totalExecNet) * 100) / 100;

        reconciliation = {
          business_date: `${startDate} to ${endDate}`,
          exec_net_sales: Math.round(totalExecNet * 100) / 100,
          exec_grand_total: Math.round(totalExecGrand * 100) / 100,
          exec_bills_count: totalExecBills,
          orders_net_sales: Math.round(totalOrdersNet * 100) / 100,
          orders_grand_total: Math.round(totalOrdersGrand * 100) / 100,
          orders_count: totalOrdersCount,
          hourly_net_sales: Math.round(totalHourlyNet * 100) / 100,
          hourly_items_sold: totalHourlyItems,
          orders_exec_diff: diff,
          hourly_exec_diff: Math.round((totalHourlyNet - totalExecNet) * 100) / 100,
          reconciliation_status: status,
        };
      }
    }

    // Filter Options Metadata
    const parentCategoryColors: Record<string, string> = {};
    const parentCategoryTranslations: Record<string, string> = {
      'All Day Breakfast': 'ऑल डे नाश्ता',
      'Beverages': 'बेवरेज',
      'Chinese': 'चाइनीज़',
      'Indian': 'भारतीय भोजन',
      'Indian Meals': 'भारतीय भोजन',
      'Italian': 'इटालियन',
      'Main Course': 'मुख्य भोजन',
      'Rajasthani': 'राजस्थानी',
      'Soya Specials': 'सोया स्पेशल',
      'Soya Chaap Special': 'सोया स्पेशल',
      'Other': 'अन्य',
      'Uncategorized': 'अनवर्गीकृत',
    };
    const categoryTranslations: Record<string, string> = {};

    (dbParents || []).forEach((p: any) => {
      if (p.name) {
        if (p.color) {
          parentCategoryColors[p.name.trim().toLowerCase()] = p.color;
        }
        if (p.name_hi) {
          parentCategoryTranslations[p.name] = p.name_hi;
        }
      }
    });

    (dbCats || []).forEach((c: any) => {
      if (c.name && c.name_hi) {
        categoryTranslations[c.name] = c.name_hi;
      }
    });

    const parentCatOptions =
      dbParents && dbParents.length > 0
        ? dbParents.map((p) => p.name)
        : Array.from(new Set((allMenu || []).map((m) => m.parent_category).filter(Boolean)));

    const catOptions =
      dbCats && dbCats.length > 0
        ? dbCats.map((c) => c.name)
        : Array.from(new Set((allMenu || []).map((m) => m.category).filter(Boolean)));
    const itemOptions = Array.from(new Set((allMenu || []).map((m) => m.name).filter(Boolean)));

    // =========================================================================
    // HYBRID DATA FETCHING: AUTHORITATIVE ORDER ITEMS + LEGACY ORDERS & HOURLY
    // =========================================================================
    const detailedDates = new Set((itemDateRows || []).map((r) => r.business_date));

    // 1. Fetch detailed invoice-linked items for dates that have them
    let detailedItems: any[] = [];
    if (detailedDates.size > 0) {
      let itemQuery = supabase
        .from('sales_order_items')
        .select('*')
        .gte('business_date', startDate)
        .lte('business_date', endDate)
        .eq('status', 'Success');

      if (parentCategoryFilter) itemQuery = itemQuery.eq('parent_category', parentCategoryFilter);
      if (categoryFilter) itemQuery = itemQuery.eq('category', categoryFilter);
      if (itemFilter) itemQuery = itemQuery.ilike('item_name', `%${itemFilter}%`);
      if (captainFilter) itemQuery = itemQuery.eq('captain_name', captainFilter);
      if (paymentTypeFilter) itemQuery = itemQuery.eq('payment_type', paymentTypeFilter);
      if (orderTypeFilter) {
        if (orderTypeFilter === 'Snacks Stall') {
          itemQuery = itemQuery.ilike('order_type', 'Delivery%').neq('area', 'LANCHO').not('payment_type', 'ilike', '%lancho%');
        } else if (orderTypeFilter === 'Lancho') {
          itemQuery = itemQuery.or('area.eq.LANCHO,order_type.eq.LANCHO,payment_type.ilike.%lancho%');
        } else if (orderTypeFilter === 'Takeaway') {
          itemQuery = itemQuery.or('order_type.eq.Pick Up,order_type.eq.Pickup,order_type.eq.Takeaway,area.eq.Parcel');
        } else if (orderTypeFilter === 'Dine In') {
          itemQuery = itemQuery.ilike('order_type', 'Dine%');
        } else {
          itemQuery = itemQuery.eq('order_type', orderTypeFilter);
        }
      }

      detailedItems = await fetchAllRows(itemQuery);
    }

    // 2. Fetch legacy orders and hourly items for dates NOT in detailedDates
    let legacyOrders: any[] = [];
    let legacyHourly: any[] = [];
    const isSingleDayCovered = startDate === endDate && detailedDates.has(startDate);

    if (!isSingleDayCovered) {
      let hourlyQuery = supabase
        .from('sales_hourly_items')
        .select('*')
        .gte('business_date', startDate)
        .lte('business_date', endDate);

      if (parentCategoryFilter) hourlyQuery = hourlyQuery.eq('parent_category', parentCategoryFilter);
      if (categoryFilter) hourlyQuery = hourlyQuery.eq('category', categoryFilter);
      if (itemFilter) hourlyQuery = hourlyQuery.ilike('item_name', `%${itemFilter}%`);

      let ordersQuery = supabase
        .from('sales_orders')
        .select('*')
        .gte('business_date', startDate)
        .lte('business_date', endDate)
        .eq('status', 'Success');

      if (captainFilter) ordersQuery = ordersQuery.eq('captain_name', captainFilter);
      if (paymentTypeFilter) ordersQuery = ordersQuery.eq('payment_type', paymentTypeFilter);
      if (orderTypeFilter) {
        if (orderTypeFilter === 'Snacks Stall') {
          ordersQuery = ordersQuery.ilike('order_type', 'Delivery%').neq('area', 'LANCHO').not('payment_type', 'ilike', '%lancho%');
        } else if (orderTypeFilter === 'Lancho') {
          ordersQuery = ordersQuery.or('area.eq.LANCHO,order_type.eq.LANCHO,payment_type.ilike.%lancho%');
        } else if (orderTypeFilter === 'Takeaway') {
          ordersQuery = ordersQuery.or('order_type.eq.Pick Up,order_type.eq.Pickup,order_type.eq.Takeaway,area.eq.Parcel');
        } else if (orderTypeFilter === 'Dine In') {
          ordersQuery = ordersQuery.ilike('order_type', 'Dine%');
        } else {
          ordersQuery = ordersQuery.eq('order_type', orderTypeFilter);
        }
      }

      const [allHourlyRows, allOrderRows] = await Promise.all([
        fetchAllRows(hourlyQuery),
        fetchAllRows(ordersQuery),
      ]);

      legacyOrders = allOrderRows.filter((o) => !detailedDates.has(o.business_date));
      legacyHourly = allHourlyRows.filter((h) => !detailedDates.has(h.business_date));
    }

    // Compute Executive KPIs
    const hasItemFilters = Boolean(parentCategoryFilter || categoryFilter || itemFilter);

    const detailedNet = detailedItems.reduce((sum, i) => sum + (Number(i.net_sales) || 0), 0);
    const detailedGross = detailedItems.reduce((sum, i) => sum + (Number(i.final_total) || 0), 0);
    const detailedTax = detailedItems.reduce((sum, i) => sum + (Number(i.tax_amount) || 0), 0);
    const detailedDiscounts = detailedItems.reduce((sum, i) => sum + (Number(i.discount_amount) || 0), 0);
    const detailedQty = detailedItems.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
    const detailedBillsCount = new Set(detailedItems.map((i) => i.invoice_no)).size;

    let legacyNet = 0;
    let legacyGross = 0;
    let legacyTax = 0;
    let legacyDiscounts = 0;
    let legacyQty = legacyHourly.reduce((sum, h) => sum + (Number(h.quantity) || 0), 0);
    let legacyBillsCount = 0;

    if (hasItemFilters) {
      legacyNet = legacyHourly.reduce((sum, h) => sum + (Number(h.net_sales) || 0), 0);
      legacyGross = legacyHourly.reduce((sum, h) => sum + (Number(h.total_sales) || 0), 0);
      legacyTax = legacyHourly.reduce((sum, h) => sum + (Number(h.tax_amount) || 0), 0);
      legacyDiscounts = legacyHourly.reduce((sum, h) => sum + (Number(h.discount_amount) || 0), 0);
      legacyBillsCount = 0;
    } else {
      legacyNet = legacyOrders.reduce((sum, o) => sum + (Number(o.net_sales) || 0), 0);
      legacyGross = legacyOrders.reduce((sum, o) => sum + (Number(o.grand_total) || 0), 0);
      legacyTax = legacyOrders.reduce((sum, o) => sum + (Number(o.tax_amount) || 0), 0);
      legacyDiscounts = legacyOrders.reduce((sum, o) => sum + (Number(o.discount_amount) || 0), 0);
      legacyBillsCount = legacyOrders.length;
    }

    const netSales = Math.round((detailedNet + legacyNet) * 100) / 100;
    const grossSales = Math.round((detailedGross + legacyGross) * 100) / 100;
    const totalTax = Math.round((detailedTax + legacyTax) * 100) / 100;
    const totalDiscounts = Math.round((detailedDiscounts + legacyDiscounts) * 100) / 100;
    const totalItemsSold = Math.round((detailedQty + legacyQty) * 100) / 100;
    const totalBills = detailedBillsCount + legacyBillsCount;
    const averageOrderValue = totalBills > 0 ? Math.round((netSales / totalBills) * 100) / 100 : 0;

    // Compute Hourly Stacked Breakdown (0..23 hours cumulative across entire period)
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

    const processItemForHourly = (item: any) => {
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
    };

    detailedItems.forEach(processItemForHourly);
    legacyHourly.forEach(processItemForHourly);

    const hourlyArray = Array.from(hourMap.values());
    const parentCategoriesList = Array.from(parentCategoriesSet);

    // Breakdown 1: Parent Categories
    const parentCatMap = new Map<string, { amount: number; quantity: number }>();
    const processParentCat = (item: any) => {
      const p = item.parent_category || 'Other';
      const prev = parentCatMap.get(p) || { amount: 0, quantity: 0 };
      parentCatMap.set(p, {
        amount: prev.amount + (Number(item.net_sales) || 0),
        quantity: prev.quantity + (Number(item.quantity) || 0),
      });
    };
    detailedItems.forEach(processParentCat);
    legacyHourly.forEach(processParentCat);

    const byParentCategory = Array.from(parentCatMap.entries())
      .map(([name, d]) => ({
        name,
        amount: Math.round(d.amount * 100) / 100,
        quantity: Math.round(d.quantity * 100) / 100,
        sharePercent: netSales > 0 ? Math.round((d.amount / netSales) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    // Breakdown 2: Subcategories
    const catMap = new Map<string, { parent: string; amount: number; quantity: number }>();
    const processCat = (item: any) => {
      const c = item.category || 'General';
      const prev = catMap.get(c) || { parent: item.parent_category || 'Other', amount: 0, quantity: 0 };
      catMap.set(c, {
        parent: prev.parent,
        amount: prev.amount + (Number(item.net_sales) || 0),
        quantity: prev.quantity + (Number(item.quantity) || 0),
      });
    };
    detailedItems.forEach(processCat);
    legacyHourly.forEach(processCat);

    const byCategory = Array.from(catMap.entries())
      .map(([name, d]) => ({
        name,
        parent: d.parent,
        amount: Math.round(d.amount * 100) / 100,
        quantity: Math.round(d.quantity * 100) / 100,
      }))
      .sort((a, b) => b.amount - a.amount);

    // Breakdown 3: Top Selling Items
    const itemSalesMap = new Map<string, { parentCategory: string; amount: number; quantity: number }>();
    const processTopItem = (item: any) => {
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
    };
    detailedItems.forEach(processTopItem);
    legacyHourly.forEach(processTopItem);

    const byTopItems = Array.from(itemSalesMap.entries())
      .map(([name, d]) => ({
        name,
        parentCategory: d.parentCategory,
        amount: Math.round(d.amount * 100) / 100,
        quantity: Math.round(d.quantity * 100) / 100,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 15);

    // Breakdown 4: Payment Modes
    const paymentMap = new Map<string, number>();
    detailedItems.forEach((item) => {
      const p = item.payment_type || 'Unknown';
      const cur = paymentMap.get(p) || 0;
      paymentMap.set(p, cur + (Number(item.final_total) || 0));
    });
    legacyOrders.forEach((o) => {
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

    // Breakdown 5: Captain Performance
    const captainMap = new Map<string, { invoices: Set<string>; count: number; covers: number; net: number }>();
    detailedItems.forEach((item) => {
      const cap = item.captain_name || 'Unassigned';
      const prev = captainMap.get(cap) || { invoices: new Set(), count: 0, covers: 0, net: 0 };
      prev.invoices.add(item.invoice_no);
      prev.net += Number(item.net_sales) || 0;
      prev.covers += Number(item.covers) || 1;
      captainMap.set(cap, prev);
    });
    legacyOrders.forEach((o) => {
      const cap = o.captain_name || 'Unassigned';
      const prev = captainMap.get(cap) || { invoices: new Set(), count: 0, covers: 0, net: 0 };
      prev.count += 1;
      prev.net += Number(o.net_sales) || 0;
      prev.covers += Number(o.covers_pax) || 1;
      captainMap.set(cap, prev);
    });

    const byCaptain = Array.from(captainMap.entries())
      .map(([name, d]) => {
        const count = d.invoices.size + d.count;
        return {
          name,
          ordersCount: count,
          coversPax: d.covers,
          netSales: Math.round(d.net * 100) / 100,
          avgOrder: count > 0 ? Math.round((d.net / count) * 100) / 100 : 0,
        };
      })
      .sort((a, b) => b.netSales - a.netSales);

    // Breakdown 6: Order Types / Business Units
    const orderTypeMap = new Map<string, { invoices: Set<string>; count: number; net: number }>();
    detailedItems.forEach((item) => {
      const ot = getOrderBusinessUnit({ order_type: item.order_type, area: item.area, payment_type: item.payment_type });
      const prev = orderTypeMap.get(ot) || { invoices: new Set(), count: 0, net: 0 };
      prev.invoices.add(item.invoice_no);
      prev.net += Number(item.net_sales) || 0;
      orderTypeMap.set(ot, prev);
    });
    legacyOrders.forEach((o) => {
      const ot = getOrderBusinessUnit(o);
      const prev = orderTypeMap.get(ot) || { invoices: new Set(), count: 0, net: 0 };
      prev.count += 1;
      prev.net += Number(o.net_sales) || 0;
      orderTypeMap.set(ot, prev);
    });

    const byOrderType = Array.from(orderTypeMap.entries())
      .map(([name, d]) => {
        const count = d.invoices.size + d.count;
        return {
          name,
          count,
          netSales: Math.round(d.net * 100) / 100,
          sharePercent: netSales > 0 ? Math.round((d.net / netSales) * 1000) / 10 : 0,
        };
      })
      .sort((a, b) => b.netSales - a.netSales);

    // Unmatched Items Diagnostic
    const unmatchedItemsMap = new Map<string, { quantity: number; amount: number }>();
    detailedItems.forEach((item) => {
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

    const captainOptions = Array.from(
      new Set([
        ...detailedItems.map((i) => i.captain_name),
        ...legacyOrders.map((o) => o.captain_name),
      ].filter(Boolean))
    );
    const paymentOptions = Array.from(
      new Set([
        ...detailedItems.map((i) => i.payment_type),
        ...legacyOrders.map((o) => o.payment_type),
      ].filter(Boolean))
    );
    const orderTypeOptions = ['Dine In', 'Snacks Stall', 'Takeaway', 'Lancho'];

    const response: SalesAnalyticsResponse = {
      dateRange: { start: startDate || '', end: endDate || startDate || '' },
      kpis: {
        netSales,
        grossSales,
        totalBills,
        totalItemsSold,
        totalTax,
        totalDiscounts,
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
      parentCategoryColors,
      parentCategoryTranslations,
      categoryTranslations,
      reconciliation,
      allBills: [], // Delegated to server-side paginated /api/finance/sales/bills endpoint
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
