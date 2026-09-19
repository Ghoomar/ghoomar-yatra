import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { parsePetpoojaBuffer } from '@/lib/petpooja/parser';

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
    if (reportType === 'HOURLY_ITEM_SALES') {
      // Fetch Menu Master mapping to snapshot categories
      const { data: menuItems } = await supabase
        .from('pos_menu_items')
        .select('name, parent_category, category');

      const menuMap = new Map<string, { parentCategory: string; category: string }>();
      (menuItems || []).forEach((m) => {
        menuMap.set(m.name.toLowerCase().trim(), {
          parentCategory: m.parent_category,
          category: m.category,
        });
      });

      const hourlyPayload = data.map((item) => {
        const lowerName = item.item_name.toLowerCase().trim();
        const mapping = menuMap.get(lowerName) || {
          parentCategory: 'Uncategorized',
          category: 'General',
        };

        return {
          batch_id: newBatch.id,
          business_date: businessDate,
          hour_of_day: item.hour_of_day,
          hour_label: item.hour_label,
          item_name: item.item_name,
          parent_category: mapping.parentCategory,
          category: mapping.category,
          unit_price: item.unit_price,
          quantity: item.quantity,
          net_amount: item.net_amount,
          discount_amount: item.discount_amount,
          tax_amount: item.tax_amount,
          total_sales: item.total_sales,
          net_sales: item.net_sales,
        };
      });

      // Insert in chunks of 100
      for (let i = 0; i < hourlyPayload.length; i += 100) {
        const chunk = hourlyPayload.slice(i, i + 100);
        const { error: insErr } = await supabase.from('sales_hourly_items').insert(chunk);
        if (insErr) {
          throw new Error(`Failed to insert hourly items: ${insErr.message}`);
        }
      }
    } else if (reportType === 'ORDERS_MASTER') {
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
      if (execErr) {
        throw new Error(`Failed to insert executive summary: ${execErr.message}`);
      }
    } else if (reportType === 'MENU_MASTER') {
      // Upsert menu items on conflict (name)
      for (let i = 0; i < data.length; i += 100) {
        const chunk = data.slice(i, i + 100);
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
    const limit = parseInt(searchParams.get('limit') || '30', 10);

    const { data: batches, error } = await supabase
      .from('sales_import_batches')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

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

