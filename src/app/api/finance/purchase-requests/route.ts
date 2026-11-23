import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveFinanceCallerAuth } from '@/lib/auth/finance-auth';

const MANDI_EXEMPT_CATEGORIES = ['Dairy Products', 'Vegetables', 'Fruits'];

export async function GET(request: NextRequest) {
  try {
    const auth = await resolveFinanceCallerAuth(request);
    if (!auth || !auth.user) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    const admin = createAdminClient();
    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status'); // 'open', 'completed', 'cancelled', or null for all

    // 1. Fetch purchase requests with lines
    let query = admin
      .from('purchase_requests')
      .select(`
        id,
        request_number,
        target_purchase_date,
        status,
        notes,
        requested_by,
        created_at,
        updated_at,
        lines:purchase_request_lines(
          id,
          request_id,
          item_id,
          preferred_vendor_id,
          requested_quantity,
          approved_quantity,
          pack_unit_snapshot,
          pack_quantity,
          conversion_factor_snapshot,
          estimated_unit_rate,
          estimated_total,
          stock_at_request,
          min_par_snapshot,
          max_par_snapshot,
          abc_class_snapshot,
          approval_status,
          was_auto_approved,
          routing_reasons,
          reviewed_by,
          reviewed_at,
          review_note,
          converted_purchase_id,
          created_at,
          item:inventory_items(
            id,
            item_code,
            name,
            name_hi,
            brand_name,
            minimum_stock,
            max_stock_level,
            shelf_life_days,
            abc_class,
            abc_risk,
            last_counted_at,
            current_weighted_average_cost,
            unit:units!inventory_items_unit_id_fkey(id, symbol, symbol_hi, name, name_hi),
            category:inventory_categories(id, name, name_hi)
          ),
          preferred_vendor:vendors(
            id,
            name,
            name_hi,
            vendor_code
          )
        )
      `)
      .order('created_at', { ascending: false });

    if (statusFilter && ['open', 'completed', 'cancelled'].includes(statusFilter)) {
      query = query.eq('status', statusFilter);
    }

    const { data: requests, error: reqErr } = await query;
    if (reqErr) {
      console.error('Error fetching purchase requests:', reqErr);
      return NextResponse.json({ error: reqErr.message }, { status: 500 });
    }

    // 2. Collect all distinct item_ids to fetch current stock and 30-day consumption
    const allItemIds = new Set<string>();
    (requests || []).forEach((r: any) => {
      (r.lines || []).forEach((l: any) => {
        if (l.item_id) allItemIds.add(l.item_id);
      });
    });

    const itemIdsArray = Array.from(allItemIds);

    // Fetch current position for real-time stock
    const currentStockMap: Record<string, number> = {};
    if (itemIdsArray.length > 0) {
      const { data: posData } = await admin
        .from('inventory_current_position')
        .select('item_id, current_quantity')
        .in('item_id', itemIdsArray);

      (posData || []).forEach((p: any) => {
        currentStockMap[p.item_id] = Number(p.current_quantity) || 0;
      });
    }

    // 3. Compute 30-day usage lookup
    // (from last 30 days of stock_movements consumption/issues, falling back to 30-day purchases when consumption is 0 for Dairy/Mandi)
    const usage30dMap: Record<string, number> = {};
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: movements } = await admin
      .from('stock_movements')
      .select('item_id, movement_type, quantity')
      .gte('created_at', thirtyDaysAgo);

    const consumptionByItem: Record<string, number> = {};
    const purchaseByItem: Record<string, number> = {};

    (movements || []).forEach((m: any) => {
      const qty = Number(m.quantity) || 0;
      if (['issue', 'consumption', 'consumption_issue', 'spoilage', 'wastage', 'staff_food'].includes(m.movement_type)) {
        consumptionByItem[m.item_id] = (consumptionByItem[m.item_id] || 0) + qty;
      } else if (m.movement_type === 'purchase') {
        purchaseByItem[m.item_id] = (purchaseByItem[m.item_id] || 0) + qty;
      }
    });

    const allMovementItemIds = new Set([
      ...Object.keys(consumptionByItem),
      ...Object.keys(purchaseByItem),
      ...itemIdsArray,
    ]);

    allMovementItemIds.forEach((itemId) => {
      const cons = consumptionByItem[itemId] || 0;
      const purch = purchaseByItem[itemId] || 0;
      usage30dMap[itemId] = cons > 0 ? cons : purch;
    });

    // Attach live current_stock and usage_30d to lines
    const enrichedRequests = (requests || []).map((r: any) => ({
      ...r,
      lines: (r.lines || []).map((l: any) => ({
        ...l,
        current_stock: currentStockMap[l.item_id] ?? (Number(l.stock_at_request) || 0),
        usage_30d: usage30dMap[l.item_id] ?? 0,
      })),
    }));

    return NextResponse.json({ requests: enrichedRequests, usage30dMap });
  } catch (err: any) {
    console.error('Error in GET /api/finance/purchase-requests:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await resolveFinanceCallerAuth(request);
    if (!auth || !auth.user) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    const body = await request.json();
    const { target_purchase_date, notes, lines } = body;

    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json({ error: 'At least one item line is required' }, { status: 400 });
    }

    const admin = createAdminClient();

    // 1. Fetch policy settings
    const { data: settings, error: setErr } = await admin
      .from('purchase_approval_settings')
      .select('*')
      .eq('singleton', true)
      .single();

    if (setErr || !settings) {
      return NextResponse.json({ error: 'Failed to retrieve approval settings' }, { status: 500 });
    }

    const lineAutoApproveLimit = Number(settings.line_auto_approve_limit) || 1500;
    const dailyNonStapleLimit = Number(settings.daily_non_staple_auto_limit) || 5000;
    const highControlCountDays = Number(settings.high_control_count_interval_days) || 7;
    const autoApproveEnabled = settings.auto_approve_enabled !== false;

    // 2. Fetch all referenced items with units, category, current_stock, and WAC
    const itemIds = Array.from(new Set(lines.map((l: any) => l.item_id).filter(Boolean)));
    const { data: itemsData, error: itemErr } = await admin
      .from('inventory_items')
      .select(`
        id,
        item_code,
        name,
        name_hi,
        minimum_stock,
        max_stock_level,
        abc_class,
        last_counted_at,
        current_weighted_average_cost,
        category:inventory_categories(id, name),
        unit:units!inventory_items_unit_id_fkey(id, symbol)
      `)
      .in('id', itemIds);

    if (itemErr || !itemsData) {
      return NextResponse.json({ error: 'Failed to retrieve item master details' }, { status: 500 });
    }

    const itemMap = new Map<string, any>(itemsData.map((i: any) => [i.id, i]));

    // Fetch current live stock for these items
    const { data: posData } = await admin
      .from('inventory_current_position')
      .select('item_id, current_quantity')
      .in('item_id', itemIds);

    const stockMap = new Map<string, number>();
    (posData || []).forEach((p: any) => {
      stockMap.set(p.item_id, Number(p.current_quantity) || 0);
    });

    // 3. Fetch vendor prices for rate resolution
    const { data: vendorPrices } = await admin
      .from('vendor_items')
      .select('inventory_item_id, vendor_id, last_purchase_rate, last_purchase_date')
      .in('inventory_item_id', itemIds)
      .gt('last_purchase_rate', 0)
      .order('last_purchase_date', { ascending: false });

    // 4. Fetch open approved unpurchased quantities in DB:
    // Any line with approval_status IN ('auto_approved', 'approved'), not converted to PO, and not belonging to a cancelled request
    const { data: openApprovedLines } = await admin
      .from('purchase_request_lines')
      .select(`
        item_id, requested_quantity, approved_quantity,
        request:purchase_requests!inner(status)
      `)
      .in('item_id', itemIds)
      .in('approval_status', ['auto_approved', 'approved'])
      .is('converted_purchase_id', null)
      .neq('request.status', 'cancelled');

    const openApprovedQtyMap = new Map<string, number>();
    (openApprovedLines || []).forEach((row: any) => {
      const baseQty = Number(row.approved_quantity ?? row.requested_quantity) || 0;
      openApprovedQtyMap.set(row.item_id, (openApprovedQtyMap.get(row.item_id) || 0) + baseQty);
    });

    // 5. Fetch today's IST auto-approved non-staple spend in DB:
    // WHERE was_auto_approved = true AND approval_status IN ('auto_approved', 'purchased')
    // AND created_at >= midnight of current date in IST (Asia/Kolkata)
    // AND request status != 'cancelled'
    // AND item's category NOT IN ('Dairy Products', 'Vegetables', 'Fruits')
    const istDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const istMidnightIso = new Date(`${istDateStr}T00:00:00+05:30`).toISOString();

    const { data: todayAutoApprovedLines } = await admin
      .from('purchase_request_lines')
      .select(`
        estimated_total,
        request:purchase_requests!inner(status),
        item:inventory_items(
          category:inventory_categories(name)
        )
      `)
      .eq('was_auto_approved', true)
      .in('approval_status', ['auto_approved', 'purchased'])
      .neq('request.status', 'cancelled')
      .gte('created_at', istMidnightIso);

    let todayNonStapleAutoApprovedSpend = 0;
    (todayAutoApprovedLines || []).forEach((row: any) => {
      const catName = row.item?.category?.name;
      if (!MANDI_EXEMPT_CATEGORIES.includes(catName)) {
        todayNonStapleAutoApprovedSpend += Number(row.estimated_total) || 0;
      }
    });

    // Running trackers for the current submission
    const runningApprovedQtyByItem = new Map<string, number>();
    let runningRequestNonStapleSpend = 0;

    // 6. Evaluate each line
    const processedLines = lines.map((line: any) => {
      const item = itemMap.get(line.item_id);
      if (!item) {
        throw new Error(`Item ${line.item_id} not found`);
      }

      const currentStock = stockMap.get(line.item_id) ?? 0;
      const convFactor = Number(line.conversion_factor_snapshot) || 1;
      const packQty = line.pack_quantity != null && line.pack_quantity !== '' ? Number(line.pack_quantity) : null;
      const requestedBaseQty = packQty != null ? packQty * convFactor : Number(line.requested_quantity);

      if (isNaN(requestedBaseQty) || requestedBaseQty <= 0) {
        throw new Error(`Invalid requested quantity for ${item.name}`);
      }

      // Server-side pricing resolution:
      // Try preferred vendor rate, then any vendor rate, then current WAC
      let resolvedUnitRate = 0;
      if (line.preferred_vendor_id) {
        const prefRate = (vendorPrices || []).find(
          (vp: any) => vp.inventory_item_id === line.item_id && vp.vendor_id === line.preferred_vendor_id
        );
        if (prefRate?.last_purchase_rate) resolvedUnitRate = Number(prefRate.last_purchase_rate);
      }
      if (resolvedUnitRate <= 0) {
        const anyRate = (vendorPrices || []).find((vp: any) => vp.inventory_item_id === line.item_id);
        if (anyRate?.last_purchase_rate) resolvedUnitRate = Number(anyRate.last_purchase_rate);
      }
      if (resolvedUnitRate <= 0 && item.current_weighted_average_cost > 0) {
        resolvedUnitRate = Number(item.current_weighted_average_cost);
      }

      const estimatedTotal = Math.round(requestedBaseQty * resolvedUnitRate * 100) / 100;
      const categoryName = item.category?.name || '';
      const isMandiExempt = MANDI_EXEMPT_CATEGORIES.includes(categoryName);

      const routingReasons: string[] = [];

      // Check 1: Auto-approve policy master switch
      if (!autoApproveEnabled) {
        routingReasons.push('Auto-approval disabled');
      }

      // Check 2: Uncosted item / price unknown guard
      if (resolvedUnitRate <= 0 || estimatedTotal <= 0) {
        routingReasons.push('Estimated price unknown');
      }

      // Check 3: Max-Par & open approved basket check
      // (current_stock + open_approved_unpurchased_qty + running_request_approved_qty + requested_base_qty) <= max_stock_level
      const existingOpenApproved = openApprovedQtyMap.get(line.item_id) || 0;
      const runningSameItemApproved = runningApprovedQtyByItem.get(line.item_id) || 0;
      const totalProjectedStock = currentStock + existingOpenApproved + runningSameItemApproved + requestedBaseQty;

      if (item.max_stock_level == null) {
        routingReasons.push('Max-Par not set');
      } else if (totalProjectedStock > Number(item.max_stock_level)) {
        routingReasons.push('Exceeds Max-Par');
      }

      // Check 4: Line auto-approval limit (₹1,500)
      if (estimatedTotal > lineAutoApproveLimit) {
        routingReasons.push(`Over ₹${lineAutoApproveLimit.toLocaleString('en-IN')} limit`);
      }

      // Check 5: Daily non-staple anti-split limit (₹5,000)
      if (!isMandiExempt) {
        const projectedDailyNonStaple = todayNonStapleAutoApprovedSpend + runningRequestNonStapleSpend + estimatedTotal;
        if (projectedDailyNonStaple > dailyNonStapleLimit) {
          routingReasons.push('Daily auto-approval cap reached');
        }
      }

      // Check 6: Class A count recency check (7 days)
      if (item.abc_class === 'high_control') {
        if (!item.last_counted_at) {
          routingReasons.push('Weekly High-Control count overdue');
        } else {
          const lastCountDate = new Date(item.last_counted_at).getTime();
          const daysSinceCount = (Date.now() - lastCountDate) / (1000 * 60 * 60 * 24);
          if (daysSinceCount > highControlCountDays) {
            routingReasons.push('Weekly High-Control count overdue');
          }
        }
      }

      const isAutoApproved = routingReasons.length === 0;

      if (isAutoApproved) {
        // Record running totals for earlier lines within the same submission
        runningApprovedQtyByItem.set(line.item_id, runningSameItemApproved + requestedBaseQty);
        if (!isMandiExempt) {
          runningRequestNonStapleSpend += estimatedTotal;
        }
      }

      return {
        item_id: line.item_id,
        preferred_vendor_id: line.preferred_vendor_id || null,
        requested_quantity: requestedBaseQty,
        approved_quantity: isAutoApproved ? requestedBaseQty : null,
        pack_unit_snapshot: line.pack_unit_snapshot || null,
        pack_quantity: packQty,
        conversion_factor_snapshot: convFactor,
        estimated_unit_rate: resolvedUnitRate,
        estimated_total: estimatedTotal,
        stock_at_request: currentStock,
        min_par_snapshot: item.minimum_stock != null ? Number(item.minimum_stock) : null,
        max_par_snapshot: item.max_stock_level != null ? Number(item.max_stock_level) : null,
        abc_class_snapshot: item.abc_class || 'routine_monitoring',
        approval_status: isAutoApproved ? 'auto_approved' : 'pending_approval',
        was_auto_approved: isAutoApproved,
        routing_reasons: routingReasons,
      };
    });

    // 7. Atomic Request Creation
    const { data: reqNumData, error: reqNumErr } = await admin.rpc('generate_purchase_request_number');
    const requestNumber = reqNumData || `PR-${Date.now().toString().slice(-8)}`;

    const { data: requestHeader, error: headErr } = await admin
      .from('purchase_requests')
      .insert({
        request_number: requestNumber,
        target_purchase_date: target_purchase_date || new Date().toISOString().split('T')[0],
        status: 'open',
        notes: notes?.trim() || null,
        requested_by: auth.user.id,
      })
      .select()
      .single();

    if (headErr) {
      console.error('Error creating purchase request header:', headErr);
      return NextResponse.json({ error: headErr.message }, { status: 500 });
    }

    const linesToInsert = processedLines.map((l: any) => ({
      ...l,
      request_id: requestHeader.id,
    }));

    const { data: insertedLines, error: linesErr } = await admin
      .from('purchase_request_lines')
      .insert(linesToInsert)
      .select();

    if (linesErr) {
      console.error('Error inserting purchase request lines:', linesErr);
      // Rollback header
      await admin.from('purchase_requests').delete().eq('id', requestHeader.id);
      return NextResponse.json({ error: linesErr.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      request: requestHeader,
      lines: insertedLines,
    });
  } catch (err: any) {
    console.error('Error in POST /api/finance/purchase-requests:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
