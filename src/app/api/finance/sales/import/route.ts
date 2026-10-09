import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { parsePetpoojaBuffer } from '@/lib/petpooja/parser';
import { loadMenuMasterLookupFromDb, resolveItemCategory, normalizeItemName } from '@/lib/petpooja/matcher';
import { suggestHindiName } from '@/lib/i18n/suggest-hindi';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const overwriteStr = formData.get('overwrite');
    const overwrite = overwriteStr === 'true' || overwriteStr === '1';

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 1. Parse buffer using Petpooja parser
    let parseResult;
    try {
      parseResult = parsePetpoojaBuffer(buffer, file.name);
    } catch (parseErr: any) {
      return NextResponse.json({ error: parseErr.message || 'Failed to parse file.' }, { status: 400 });
    }

    const { reportType, businessDate, fileChecksum, recordCount, totalNetSales, totalGrossSales, metadata, data } =
      parseResult;

    // 1b. Discontinue manual HOURLY_ITEM_SALES import
    if (reportType === 'HOURLY_ITEM_SALES') {
      return NextResponse.json({
        success: true,
        message:
          'Hourly Item Sales import has been streamlined out and is no longer required. Hourly analytics are now automatically derived from the Items Detailed Report. Please upload the Items Detailed Report instead.',
        streamlined: true,
      });
    }

    // 2. Duplicate Detection Check
    if (reportType !== 'MENU_MASTER') {
      const { data: existingBatch } = await supabase
        .from('sales_import_batches')
        .select('id, file_name, file_checksum, business_date, report_type, created_at, total_net_sales')
        .eq('business_date', businessDate)
        .eq('report_type', reportType)
        .maybeSingle();

      if (existingBatch && !overwrite) {
        return NextResponse.json(
          {
            isDuplicate: true,
            message: `A ${reportType} report for ${businessDate} was already imported (${existingBatch.file_name} on ${new Date(
              existingBatch.created_at
            ).toLocaleDateString()}). Set overwrite=true to replace it.`,
            existingBatch,
          },
          { status: 409 }
        );
      }

      if (existingBatch && overwrite) {
        // Delete old batch (cascades to orders, hourly items, executive summaries)
        await supabase.from('sales_import_batches').delete().eq('id', existingBatch.id);
      }
    }

    // 3. Create new batch record
    const { data: newBatch, error: batchErr } = await supabase
      .from('sales_import_batches')
      .insert({
        report_type: reportType,
        business_date: businessDate,
        file_name: file.name,
        file_checksum: fileChecksum,
        record_count: recordCount,
        total_net_sales: totalNetSales,
        total_gross_sales: totalGrossSales,
        raw_metadata: metadata,
        imported_by: user?.id || null,
      })
      .select()
      .single();

    if (batchErr) {
      return NextResponse.json({ error: `Failed to create batch: ${batchErr.message}` }, { status: 500 });
    }

    // 4. Ingest parsed data based on report type
    if (reportType === 'ORDERS_MASTER') {
      const ordersPayload = data.map((order) => ({
        batch_id: newBatch.id,
        business_date: businessDate,
        invoice_no: order.invoice_no,
        order_timestamp: order.order_timestamp,
        hour_of_day: order.hour_of_day,
        biller: order.biller,
        kot_numbers: order.kot_numbers,
        payment_type: order.payment_type,
        order_type: order.order_type,
        status: order.status,
        area: order.area,
        captain_name: order.captain_name,
        customer_name: order.customer_name,
        customer_phone: order.customer_phone,
        covers_pax: order.covers_pax,
        gross_amount: order.gross_amount,
        discount_amount: order.discount_amount,
        net_sales: order.net_sales,
        tax_amount: order.tax_amount,
        round_off: order.round_off,
        waived_off: order.waived_off,
        grand_total: order.grand_total,
      }));

      // Insert in chunks of 100
      for (let i = 0; i < ordersPayload.length; i += 100) {
        const chunk = ordersPayload.slice(i, i + 100);
        const { error: insErr } = await supabase.from('sales_orders').insert(chunk);
        if (insErr) {
          throw new Error(`Failed to insert orders: ${insErr.message}`);
        }
      }
    } else if (reportType === 'EXECUTIVE_SUMMARY') {
      const exec = data[0];
      const { error: execErr } = await supabase.from('sales_executive_summaries').insert({
        batch_id: newBatch.id,
        business_date: businessDate,
        successful_bills_count: exec.successful_bills_count,
        invoice_range: exec.invoice_range,
        sub_total: exec.sub_total,
        discount: exec.discount,
        delivery_charges: exec.delivery_charges,
        container_charges: exec.container_charges,
        service_charges: exec.service_charges,
        cgst: exec.cgst,
        sgst: exec.sgst,
        total_tax: exec.total_tax,
        round_off: exec.round_off,
        waived_off: exec.waived_off,
        grand_total: exec.grand_total,
        net_sales: exec.net_sales,
        cancelled_bills_count: exec.cancelled_bills_count,
        cancelled_amount: exec.cancelled_amount,
        order_type_breakdown: exec.order_type_breakdown,
        payment_mode_breakdown: exec.payment_mode_breakdown,
        raw_metadata: metadata,
      });
    } else if (reportType === 'ITEM_ORDER_DETAILS') {
      // Fetch authoritative Menu Master mapping & hierarchy directly from database
      const lookup = await loadMenuMasterLookupFromDb(supabase);

      const unmappedItemsMap = new Map<string, number>();

      const itemsPayload = data.map((item: any) => {
        const resolution = resolveItemCategory(item.item_name, lookup);

        if (!resolution.isMatched || resolution.category === 'Uncategorized') {
          const cleanName = item.item_name.trim();
          if (!unmappedItemsMap.has(cleanName)) {
            unmappedItemsMap.set(cleanName, Number(item.unit_price) || 0);
          }
        }

        return {
          batch_id: newBatch.id,
          business_date: businessDate,
          order_timestamp: item.order_timestamp,
          hour_of_day: item.hour_of_day,
          invoice_no: item.invoice_no,
          payment_type: item.payment_type,
          order_type: item.order_type,
          area: item.area,
          table_no: item.table_no,
          server_name: item.server_name,
          captain_name: item.captain_name,
          covers: item.covers,
          item_name: item.item_name,
          variation: item.variation,
          parent_category: resolution.parentCategory,
          category: resolution.category,
          raw_group_name: item.raw_group_name,
          raw_category: item.raw_category,
          unit_price: item.unit_price,
          quantity: item.quantity,
          subtotal: item.subtotal,
          discount_amount: item.discount_amount,
          tax_amount: item.tax_amount,
          net_sales: item.net_sales,
          final_total: item.final_total,
          status: item.status,
          customer_phone: item.customer_phone,
          customer_name: item.customer_name,
        };
      });

      // Insert in chunks of 100
      for (let i = 0; i < itemsPayload.length; i += 100) {
        const chunk = itemsPayload.slice(i, i + 100);
        const { error: insErr } = await supabase.from('sales_order_items').insert(chunk);
        if (insErr) {
          throw new Error(`Failed to insert detailed order items: ${insErr.message}`);
        }
      }

      // 4b. Automatically derive and synchronize sales_hourly_items from ITEM_ORDER_DETAILS
      const hourlyAggregationMap = new Map<
        string,
        {
          hour_of_day: number;
          hour_label: string;
          item_name: string;
          parent_category: string;
          category: string;
          unit_price: number;
          total_subtotal: number;
          quantity: number;
          net_amount: number;
          discount_amount: number;
          tax_amount: number;
          total_sales: number;
          net_sales: number;
        }
      >();

      for (const item of itemsPayload) {
        if (item.status && item.status !== 'Success') continue;

        const h = item.hour_of_day ?? 12;
        const displayH = h % 12 === 0 ? 12 : h % 12;
        const displayMeridiem = h >= 12 ? 'PM' : 'AM';
        const hourLabel = `${String(displayH).padStart(2, '0')}:00 ${displayMeridiem}`;
        const key = `${h}__${item.item_name}__${item.parent_category}__${item.category}`;

        const existing = hourlyAggregationMap.get(key);
        if (existing) {
          existing.quantity += Number(item.quantity) || 0;
          existing.total_subtotal += (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);
          existing.net_amount += Number(item.net_sales) || 0;
          existing.discount_amount += Number(item.discount_amount) || 0;
          existing.tax_amount += Number(item.tax_amount) || 0;
          existing.total_sales += Number(item.final_total) || 0;
          existing.net_sales += Number(item.net_sales) || 0;
        } else {
          hourlyAggregationMap.set(key, {
            hour_of_day: h,
            hour_label: hourLabel,
            item_name: item.item_name,
            parent_category: item.parent_category,
            category: item.category,
            unit_price: Number(item.unit_price) || 0,
            total_subtotal: (Number(item.quantity) || 0) * (Number(item.unit_price) || 0),
            quantity: Number(item.quantity) || 0,
            net_amount: Number(item.net_sales) || 0,
            discount_amount: Number(item.discount_amount) || 0,
            tax_amount: Number(item.tax_amount) || 0,
            total_sales: Number(item.final_total) || 0,
            net_sales: Number(item.net_sales) || 0,
          });
        }
      }

      // Clear any pre-existing hourly items for this business date before repopulating
      await supabase.from('sales_hourly_items').delete().eq('business_date', businessDate);

      const derivedHourlyPayload = Array.from(hourlyAggregationMap.values()).map((row) => ({
        batch_id: newBatch.id,
        business_date: businessDate,
        hour_of_day: row.hour_of_day,
        hour_label: row.hour_label,
        item_name: row.item_name,
        parent_category: row.parent_category,
        category: row.category,
        unit_price: row.quantity > 0 ? Math.round((row.total_subtotal / row.quantity) * 100) / 100 : row.unit_price,
        quantity: row.quantity,
        net_amount: Math.round(row.net_amount * 100) / 100,
        discount_amount: Math.round(row.discount_amount * 100) / 100,
        tax_amount: Math.round(row.tax_amount * 100) / 100,
        total_sales: Math.round(row.total_sales * 100) / 100,
        net_sales: Math.round(row.net_sales * 100) / 100,
      }));

      for (let i = 0; i < derivedHourlyPayload.length; i += 100) {
        const chunk = derivedHourlyPayload.slice(i, i + 100);
        const { error: hInsErr } = await supabase.from('sales_hourly_items').insert(chunk);
        if (hInsErr) {
          console.error('Failed to insert derived hourly items:', hInsErr);
        }
      }

      // Discover and register genuinely newly seen items into pos_menu_items with needs_setup: true
      if (unmappedItemsMap.size > 0) {
        const { data: allMenuItems } = await supabase
          .from('pos_menu_items')
          .select('name, normalized_name, needs_setup, category');

        const existingNames = new Set((allMenuItems || []).map((e) => e.name.toLowerCase().trim()));
        const existingNorms = new Set(
          (allMenuItems || []).map((e) => e.normalized_name || normalizeItemName(e.name))
        );

        const newItemsToRegister: any[] = [];
        for (const [name, price] of unmappedItemsMap.entries()) {
          const norm = normalizeItemName(name);
          if (!existingNames.has(name.toLowerCase()) && !existingNorms.has(norm)) {
            newItemsToRegister.push({
              name,
              normalized_name: norm,
              parent_category: 'Uncategorized',
              category: 'General',
              price,
              gst_percent: 5.0,
              tax_type: 'GST',
              is_active: true,
              needs_setup: true,
              name_hi: suggestHindiName(name, 'menu_item').suggestion,
              name_hi_is_custom: false,
            });
          }
        }

        if (newItemsToRegister.length > 0) {
          for (let i = 0; i < newItemsToRegister.length; i += 100) {
            const chunk = newItemsToRegister.slice(i, i + 100);
            await supabase.from('pos_menu_items').insert(chunk);
          }
        }
      }
    } else if (reportType === 'MENU_MASTER') {
      // Fetch existing items to preserve human-customized Hindi names
      const names = data.map((d: any) => d.name).filter(Boolean);
      const { data: existingMenuItems } = await supabase
        .from('pos_menu_items')
        .select('name, name_hi, name_hi_is_custom')
        .in('name', names);

      const existingMap = new Map((existingMenuItems || []).map((m: any) => [m.name, m]));

      const enrichedMenuItems = data.map((item: any) => {
        const existing = existingMap.get(item.name);
        if (existing?.name_hi && existing?.name_hi_is_custom) {
          return {
            ...item,
            name_hi: existing.name_hi,
            name_hi_is_custom: true,
            needs_setup: false,
          };
        }
        const hindi = existing?.name_hi || suggestHindiName(item.name, 'menu_item').suggestion;
        return {
          ...item,
          name_hi: hindi,
          name_hi_is_custom: false,
          needs_setup: !item.category || item.category === 'Uncategorized',
        };
      });

      // Upsert menu items on conflict (name)
      for (let i = 0; i < enrichedMenuItems.length; i += 100) {
        const chunk = enrichedMenuItems.slice(i, i + 100);
        const { error: menuErr } = await supabase.from('pos_menu_items').upsert(chunk, {
          onConflict: 'name',
        });
        if (menuErr) {
          throw new Error(`Failed to upsert menu items: ${menuErr.message}`);
        }
      }
    }

    // 5. Log audit action
    try {
      await supabase.from('audit_logs').insert({
        user_id: user?.id || null,
        action: 'CREATE',
        entity_type: 'Sales Import',
        entity_id: newBatch.id,
        details: {
          report_type: reportType,
          business_date: businessDate,
          file_name: file.name,
          record_count: recordCount,
          total_net_sales: totalNetSales,
        },
      });
    } catch {
      // Ignore audit log failure
    }

    return NextResponse.json({
      success: true,
      reportType,
      businessDate,
      recordCount,
      totalNetSales,
      totalGrossSales,
      batch: newBatch,
      message: `Successfully imported ${recordCount} records from ${file.name} for ${businessDate}.`,
    });
  } catch (err: any) {
    console.error('Import error:', err);
    return NextResponse.json({ error: err.message || 'Internal import error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const searchParams = request.nextUrl.searchParams;
    const month = searchParams.get('month');

    let query = supabase.from('sales_import_batches').select('*');

    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [yearStr, monthStr] = month.split('-');
      const y = parseInt(yearStr, 10);
      const m = parseInt(monthStr, 10);
      const startDate = `${yearStr}-${monthStr}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const endDate = `${yearStr}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
      query = query
        .gte('business_date', startDate)
        .lte('business_date', endDate)
        .order('business_date', { ascending: false });
    } else {
      const limit = parseInt(searchParams.get('limit') || '50', 10);
      query = query.order('created_at', { ascending: false }).limit(limit);
    }

    const { data: batches, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ batches: batches || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to fetch import history' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const searchParams = request.nextUrl.searchParams;
    let batchId = searchParams.get('batch_id');

    if (!batchId) {
      try {
        const body = await request.json();
        batchId = body.batchId || body.batch_id;
      } catch (_) {}
    }

    if (!batchId) {
      return NextResponse.json({ error: 'Missing batch_id parameter.' }, { status: 400 });
    }

    // Fetch batch details first
    const { data: batch, error: fetchErr } = await supabase
      .from('sales_import_batches')
      .select('id, file_name, report_type, business_date, total_net_sales, record_count')
      .eq('id', batchId)
      .maybeSingle();

    if (fetchErr || !batch) {
      return NextResponse.json({ error: 'Import batch not found.' }, { status: 404 });
    }

    // Delete child records explicitly for safety, then delete parent batch
    await supabase.from('sales_orders').delete().eq('batch_id', batchId);
    await supabase.from('sales_hourly_items').delete().eq('batch_id', batchId);
    await supabase.from('sales_executive_summaries').delete().eq('batch_id', batchId);
    await supabase.from('sales_order_items').delete().eq('batch_id', batchId);

    const { error: delErr } = await supabase
      .from('sales_import_batches')
      .delete()
      .eq('id', batchId);

    if (delErr) {
      return NextResponse.json({ error: `Failed to delete batch: ${delErr.message}` }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `Successfully deleted ${batch.report_type} import for ${batch.business_date} (${batch.file_name}).`,
      deletedBatch: batch,
    });
  } catch (err: any) {
    console.error('Error deleting import batch:', err);
    return NextResponse.json({ error: err.message || 'Internal error deleting import batch.' }, { status: 500 });
  }
}

