import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTodayBusinessDate } from '@/lib/utils';

export async function GET(request: NextRequest) {
  try {
    let supabase: any;
    try {
      supabase = await createServerSupabaseClient();
    } catch {
      supabase = createAdminClient();
    }
    const url = new URL(request.url);
    const searchParams = request.nextUrl ? request.nextUrl.searchParams : url.searchParams;
    const businessDate = searchParams.get('business_date') || getTodayBusinessDate();

    // 1. Fetch attendance for this date first
    const { data: attData, error: attErr } = await supabase
      .from('attendance')
      .select('id, employee_id, business_date, status, shift_multiplier, source, petpooja_emp_id, punch_in, punch_out, working_hours, break_hours, overtime_hours, notes')
      .eq('business_date', businessDate);

    if (attErr) {
      return NextResponse.json({ error: attErr.message }, { status: 500 });
    }

    // 2. Check if there is an import batch for this date (latest by created_at)
    const { data: batches } = await supabase
      .from('attendance_import_batches')
      .select('*')
      .eq('business_date', businessDate)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1);

    const batch = batches && batches.length > 0 ? batches[0] : null;

    // 3. Fetch active employees PLUS any employees who have attendance logged on this date
    const attEmpIds = (attData || []).map((a: any) => a.employee_id).filter(Boolean);
    let empQuery = supabase
      .from('employees')
      .select('id, petpooja_emp_id, employee_code, name, department_id, role_id, employment_status, department:departments(name, name_hi), role:employee_roles(name, name_hi)');

    if (attEmpIds.length > 0) {
      empQuery = empQuery.or(`employment_status.eq.Active,id.in.(${attEmpIds.join(',')})`);
    } else {
      empQuery = empQuery.eq('employment_status', 'Active');
    }

    const { data: emps, error: empErr } = await empQuery.order('name');
    if (empErr) {
      return NextResponse.json({ error: empErr.message }, { status: 500 });
    }

    const attMap = new Map<string, any>();
    (attData || []).forEach((a: any) => attMap.set(a.employee_id, a));

    let fdCount = 0;
    let hdCount = 0;
    let absentCount = 0;
    let totalMultiplier = 0;

    const rows = (emps || []).map((emp: any) => {
      const existing = attMap.get(emp.id);
      const status = existing ? existing.status : 'Absent';
      const shiftMultiplier = existing ? Number(existing.shift_multiplier) : 0.0;
      const source = existing?.source || (batch ? 'petpooja_biometric' : 'unrecorded');

      if (status === 'FD' || status === 'Present') fdCount++;
      else if (status === 'HD' || status === 'Half Day') hdCount++;
      else absentCount++;

      totalMultiplier += shiftMultiplier;

      return {
        employee_id: emp.id,
        petpooja_emp_id: emp.petpooja_emp_id,
        employee_code: emp.employee_code,
        name: emp.name,
        department: emp.department,
        role: emp.role,
        status,
        shift_multiplier: shiftMultiplier,
        punch_in: existing?.punch_in || null,
        punch_out: existing?.punch_out || null,
        working_hours: existing?.working_hours || null,
        break_hours: existing?.break_hours || null,
        overtime_hours: existing ? Number(existing.overtime_hours) : 0,
        source,
        notes: existing?.notes || null,
      };
    });

    const finalFdCount = batch ? batch.fd_count : fdCount;
    const finalHdCount = batch ? batch.hd_count : hdCount;
    const finalAbsentCount = batch ? batch.absent_count : absentCount;
    const finalTotalMultiplier = Math.round((finalFdCount * 1.0 + finalHdCount * 0.5) * 10) / 10;

    return NextResponse.json({
      businessDate,
      isReported: Boolean(attData && attData.length > 0),
      isBiometric: Boolean(batch || attData?.some((a: any) => a.source === 'petpooja_biometric')),
      batch: batch || null,
      stats: {
        totalEmployees: (emps || []).length,
        reportedCount: (attData || []).length,
        fdCount: finalFdCount,
        hdCount: finalHdCount,
        absentCount: finalAbsentCount,
        totalMultiplier: finalTotalMultiplier,
      },
      rows,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to load attendance.' }, { status: 500 });
  }
}
