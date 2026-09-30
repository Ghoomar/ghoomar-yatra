import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { HourlyCategoryDataPoint, SalesAnalyticsResponse } from '@/lib/types/sales';
import { getOrderBusinessUnit } from '@/lib/sales/business-units';

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

    // Check if detailed invoice-linked item records exist for this period
    const { count: detailedItemsCount } = await supabase
      .from('sales_order_items')
      .select('*', { count: 'exact', head: true })
      .gte('business_date', startDate)
      .lte('business_date', endDate);

    const hasDetailedItems = Boolean(detailedItemsCount && detailedItemsCount > 0);

    // Fetch master menu and translations for color/category resolution
    const [
      { data: dbParents },
      { data: dbCats },
      { data: allMenu },
      reconRes,
      execRes,
    ] = await Promise.all([
      supabase.from('pos_parent_categories').select('name, name_hi, color').order('display_order'),
      supabase.from('pos_categories').select('name, name_hi').order('display_order'),
      supabase.from('pos_menu_items').select('parent_category, category, name').order('name'),
      supabase.from('daily_sales_reconciliation').select('*').gte('business_date', startDate).lte('business_date', endDate).limit(1),
      supabase.from('sales_executive_summaries').select('*').gte('business_date', startDate).lte('business_date', endDate).order('business_date', { ascending: false }).limit(1),
    ]);

    const reconciliation = reconRes.data && reconRes.data.length > 0 ? reconRes.data[0] : null;
    const execSummary = execRes.data && execRes.data.length > 0 ? execRes.data[0] : null;

    // Filter Options
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

    const parentCatOptions = dbParents && dbParents.length > 0
      ? dbParents.map((p) => p.name)
      : Array.from(new Set((allMenu || []).map((m) => m.parent_category).filter(Boolean)));

    const catOptions = dbCats && dbCats.length > 0
      ? dbCats.map((c) => c.name)
      : Array.from(new Set((allMenu || []).map((m) => m.category).filter(Boolean)));
    const itemOptions = Array.from(new Set((allMenu || []).map((m) => m.name).filter(Boolean)));

    // =========================================================================
    // PATH A: AUTHORITATIVE INVOICE-LINKED SALES ORDER ITEMS (EXACT ATTRIBUTION)
    // =========================================================================
    if (hasDetailedItems) {
      let itemQuery = supabase
        .from('sales_order_items')
        .select('*')
        .gte('business_date', startDate)
        .lte('business_date', endDate)
        .eq('status', 'Success')
        .limit(50000);

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

      // Also fetch distinct filter options from current period's detailed items
      const { data: filterOptionItems } = await supabase
        .from('sales_order_items')
        .select('captain_name, payment_type, order_type')
        .gte('business_date', startDate)
        .lte('business_date', endDate)
        .eq('status', 'Success')
        .limit(50000);

      const captainOptions = Array.from(
        new Set((filterOptionItems || []).map((i) => i.captain_name).filter(Boolean))
      );
      const paymentOptions = Array.from(
        new Set((filterOptionItems || []).map((i) => i.payment_type).filter(Boolean))
      );
      const orderTypeOptions = ['Dine In', 'Snacks Stall', 'Takeaway', 'Lancho'];

      const { data: matchedItems, error: itemsErr } = await itemQuery;
      if (itemsErr) throw itemsErr;

      const items = matchedItems || [];

      // Compute Exact KPIs
      const netSales = items.reduce((sum, i) => sum + (Number(i.net_sales) || 0), 0);
      const grossSales = items.reduce((sum, i) => sum + (Number(i.final_total) || 0), 0);
      const totalTax = items.reduce((sum, i) => sum + (Number(i.tax_amount) || 0), 0);
      const totalDiscounts = items.reduce((sum, i) => sum + (Number(i.discount_amount) || 0), 0);
      const totalItemsSold = items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
      const matchingInvoices = new Set(items.map((i) => i.invoice_no));
      const totalBills = matchingInvoices.size;
      const averageOrderValue = totalBills > 0 ? Math.round((netSales / totalBills) * 100) / 100 : 0;

      // Compute Hourly Stacked Breakdown (0..23 hours, cumulative across all days in period)
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

      items.forEach((item) => {
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
      items.forEach((item) => {
        const p = item.parent_category || 'Other';
        const prev = parentCatMap.get(p) || { amount: 0, quantity: 0 };
        parentCatMap.set(p, {
          amount: prev.amount + (Number(item.net_sales) || 0),
          quantity: prev.quantity + (Number(item.quantity) || 0),
        });
      });

      const byParentCategory = Array.from(parentCatMap.entries())
        .map(([name, d]) => ({
          name,
          amount: Math.round(d.amount * 100) / 100,
          quantity: Math.round(d.quantity * 100) / 100,
          sharePercent: netSales > 0 ? Math.round((d.amount / netSales) * 1000) / 10 : 0,
        }))
        .sort((a, b) => b.amount - a.amount);

      // Derived Breakdown 2: Subcategories
      const catMap = new Map<string, { parent: string; amount: number; quantity: number }>();
      items.forEach((item) => {
        const c = item.category || 'General';
        const prev = catMap.get(c) || { parent: item.parent_category || 'Other', amount: 0, quantity: 0 };
        catMap.set(c, {
          parent: prev.parent,
          amount: prev.amount + (Number(item.net_sales) || 0),
          quantity: prev.quantity + (Number(item.quantity) || 0),
        });
      });

      const byCategory = Array.from(catMap.entries())
        .map(([name, d]) => ({
          name,
          parent: d.parent,
          amount: Math.round(d.amount * 100) / 100,
          quantity: Math.round(d.quantity * 100) / 100,
        }))
        .sort((a, b) => b.amount - a.amount);

      // Derived Breakdown 3: Top Selling Items
      const itemSalesMap = new Map<string, { parentCategory: string; amount: number; quantity: number }>();
      items.forEach((item) => {
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
        .map(([name, d]) => ({
          name,
          parentCategory: d.parentCategory,
          amount: Math.round(d.amount * 100) / 100,
          quantity: Math.round(d.quantity * 100) / 100,
        }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 15);

      // Derived Breakdown 4: Payment Modes
      const paymentMap = new Map<string, number>();
      items.forEach((item) => {
        const p = item.payment_type || 'Unknown';
        const cur = paymentMap.get(p) || 0;
        paymentMap.set(p, cur + (Number(item.final_total) || 0));
      });

      const byPaymentMode = Array.from(paymentMap.entries())
        .map(([name, amount]) => ({
          name,
          amount: Math.round(amount * 100) / 100,
          sharePercent: grossSales > 0 ? Math.round((amount / grossSales) * 1000) / 10 : 0,
        }))
        .sort((a, b) => b.amount - a.amount);

      // Derived Breakdown 5: Captain Performance
      const captainMap = new Map<string, { invoices: Set<string>; covers: number; net: number }>();
      items.forEach((item) => {
        const cap = item.captain_name || 'Unassigned';
        const prev = captainMap.get(cap) || { invoices: new Set(), covers: 0, net: 0 };
        prev.invoices.add(item.invoice_no);
        prev.net += Number(item.net_sales) || 0;
        prev.covers += Number(item.covers) || 1;
        captainMap.set(cap, prev);
      });

      const byCaptain = Array.from(captainMap.entries())
        .map(([name, d]) => {
          const count = d.invoices.size;
          return {
            name,
            ordersCount: count,
            coversPax: d.covers,
            netSales: Math.round(d.net * 100) / 100,
            avgOrder: count > 0 ? Math.round((d.net / count) * 100) / 100 : 0,
          };
        })
        .sort((a, b) => b.netSales - a.netSales);

      // Derived Breakdown 6: Order Types / Business Units
      const orderTypeMap = new Map<string, { invoices: Set<string>; net: number }>();
      items.forEach((item) => {
        const ot = getOrderBusinessUnit({ order_type: item.order_type, area: item.area, payment_type: item.payment_type });
        const prev = orderTypeMap.get(ot) || { invoices: new Set(), net: 0 };
        prev.invoices.add(item.invoice_no);
        prev.net += Number(item.net_sales) || 0;
        orderTypeMap.set(ot, prev);
      });

      const byOrderType = Array.from(orderTypeMap.entries())
        .map(([name, d]) => ({
          name,
          count: d.invoices.size,
          netSales: Math.round(d.net * 100) / 100,
          sharePercent: netSales > 0 ? Math.round((d.net / netSales) * 1000) / 10 : 0,
        }))
        .sort((a, b) => b.netSales - a.netSales);

      // Diagnostic for Unmatched Items
      const unmatchedItemsMap = new Map<string, { quantity: number; amount: number }>();
      items.forEach((item) => {
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

      const response: SalesAnalyticsResponse = {
        dateRange: { start: startDate || '', end: endDate || startDate || '' },
        kpis: {
          netSales: Math.round(netSales * 100) / 100,
          grossSales: Math.round(grossSales * 100) / 100,
          totalBills,
          totalItemsSold: Math.round(totalItemsSold * 100) / 100,
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
    }

    // =========================================================================
    // PATH B: HISTORICAL FALLBACK (HOURLY ITEM SALES + ORDERS MASTER)
    // =========================================================================
    let hourlyQuery = supabase
      .from('sales_hourly_items')
      .select('*')
      .gte('business_date', startDate)
      .lte('business_date', endDate)
      .limit(50000);

    if (parentCategoryFilter) hourlyQuery = hourlyQuery.eq('parent_category', parentCategoryFilter);
    if (categoryFilter) hourlyQuery = hourlyQuery.eq('category', categoryFilter);
    if (itemFilter) hourlyQuery = hourlyQuery.ilike('item_name', `%${itemFilter}%`);

    let ordersQuery = supabase
      .from('sales_orders')
      .select('*')
      .gte('business_date', startDate)
      .lte('business_date', endDate)
      .eq('status', 'Success')
      .limit(50000);

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

    const [hourlyRes, ordersRes] = await Promise.all([hourlyQuery, ordersQuery]);

    const hourlyItems = hourlyRes.data || [];
    const orders = ordersRes.data || [];

    let netSales = 0;
    let grossSales = 0;
    let totalTax = 0;
    let totalDiscounts = 0;
    let totalItemsSold = 0;
    let totalBills = orders.length;

    const hasGranularFilters = Boolean(
      parentCategoryFilter || categoryFilter || itemFilter || captainFilter || paymentTypeFilter || orderTypeFilter
    );

    if (!hasGranularFilters && (execSummary || (reconciliation && reconciliation.exec_grand_total))) {
      netSales = execSummary ? Number(execSummary.net_sales) || 0 : Number(reconciliation?.exec_net_sales) || 0;
      grossSales = execSummary ? Number(execSummary.grand_total) || 0 : Number(reconciliation?.exec_grand_total) || 0;
      totalBills = orders.length > 0 ? orders.length : (execSummary ? Number(execSummary.successful_bills_count) || 0 : Number(reconciliation?.exec_bills_count) || 0);

      const execTax = execSummary ? (Number(execSummary.total_tax) || (Number(execSummary.cgst || 0) + Number(execSummary.sgst || 0))) : 0;
      totalTax = execTax > 0
        ? execTax
        : (orders.length > 0
          ? orders.reduce((sum, o) => sum + (Number(o.tax_amount) || 0), 0)
          : hourlyItems.reduce((sum, h) => sum + (Number(h.tax_amount) || 0), 0));

      const execDiscount = execSummary ? Number(execSummary.discount) || 0 : 0;
      totalDiscounts = execDiscount > 0
        ? execDiscount
        : (orders.length > 0
          ? orders.reduce((sum, o) => sum + (Number(o.discount_amount) || 0), 0)
          : hourlyItems.reduce((sum, h) => sum + (Number(h.discount_amount) || 0), 0));
    } else if (orders.length > 0) {
      netSales = orders.reduce((sum, o) => sum + (Number(o.net_sales) || 0), 0);
      grossSales = orders.reduce((sum, o) => sum + (Number(o.grand_total) || 0), 0);
      totalTax = orders.reduce((sum, o) => sum + (Number(o.tax_amount) || 0), 0);
      totalDiscounts = orders.reduce((sum, o) => sum + (Number(o.discount_amount) || 0), 0);
    } else if (hourlyItems.length > 0) {
      netSales = hourlyItems.reduce((sum, h) => sum + (Number(h.net_sales) || 0), 0);
      grossSales = hourlyItems.reduce((sum, h) => sum + (Number(h.total_sales) || 0), 0);
      totalTax = hourlyItems.reduce((sum, h) => sum + (Number(h.tax_amount) || 0), 0);
      totalDiscounts = hourlyItems.reduce((sum, h) => sum + (Number(h.discount_amount) || 0), 0);
    }

    totalItemsSold = hourlyItems.reduce((sum, h) => sum + (Number(h.quantity) || 0), 0);
    const averageOrderValue = totalBills > 0 ? Math.round((netSales / totalBills) * 100) / 100 : 0;

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

    const orderTypeMap = new Map<string, { count: number; net: number }>();
    orders.forEach((o) => {
      const t = getOrderBusinessUnit(o);
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

    const captainOptions = Array.from(new Set(orders.map((o) => o.captain_name).filter(Boolean)));
    const paymentOptions = Array.from(new Set(orders.map((o) => o.payment_type).filter(Boolean)));
    const orderTypeOptions = ['Dine In', 'Snacks Stall', 'Takeaway', 'Lancho'];

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
        unmatchedItems: [],
      },
      parentCategoryColors,
      parentCategoryTranslations,
      categoryTranslations,
      reconciliation,
      allBills: [],
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
