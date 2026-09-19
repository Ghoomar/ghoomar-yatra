import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  syncMonthAttendanceToPeriods,
  getNextMonthString,
  getDaysInSalaryMonth,
  calculateEmployeeSalaryPeriod,
} from '@/lib/salary-engine';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const searchParams = request.nextUrl.searchParams;
    const salaryMonth = searchParams.get('salary_month') || new Date().toISOString().substring(0, 7);
    const employeeId = searchParams.get('employee_id');

    let query = supabase
      .from('employee_salary_summary')
      .select('*')
      .eq('salary_month', salaryMonth)
      .order('employee_name');

    if (employeeId) {
      query = query.eq('employee_id', employeeId);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const summaryRows = data || [];

    // Compute executive KPI aggregates for the month
    const totalDue = summaryRows.reduce((sum, r) => sum + (Number(r.total_salary_due) || 0), 0);
    const totalGiven = summaryRows.reduce((sum, r) => sum + (Number(r.total_salary_given) || 0), 0);
    const pendingBalance = summaryRows.reduce((sum, r) => sum + (Number(r.pending_salary_balance) || 0), 0);
    const netEarned = summaryRows.reduce((sum, r) => sum + (Number(r.net_earned_salary) || 0), 0);
    const totalDeductions = summaryRows.reduce((sum, r) => sum + (Number(r.total_deductions) || 0), 0);

    return NextResponse.json({
      salaryMonth,
      summary: {
        totalDue: Math.round(totalDue * 100) / 100,
        totalGiven: Math.round(totalGiven * 100) / 100,
        pendingBalance: Math.round(pendingBalance * 100) / 100,
        netEarned: Math.round(netEarned * 100) / 100,
        totalDeductions: Math.round(totalDeductions * 100) / 100,
        staffCount: summaryRows.length,
      },
      rows: summaryRows,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to fetch salary periods' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const body = await request.json();
    const { action, salary_month, period_id, employee_id, manual_deductions, notes } = body;

    // Action 1: Sync attendance and allotments for a month
    if (action === 'sync') {
      if (!salary_month) {
        return NextResponse.json({ error: 'salary_month is required for sync.' }, { status: 400 });
      }
      const syncResult = await syncMonthAttendanceToPeriods(supabase, salary_month);
      return NextResponse.json(syncResult);
    }

    // Action 2: Update manual deductions/notes for a draft period
    if (action === 'update') {
      if (!period_id) {
        return NextResponse.json({ error: 'period_id is required for update.' }, { status: 400 });
      }

      // Fetch existing period
      const { data: period, error: pErr } = await supabase
        .from('employee_salary_periods')
        .select('*')
        .eq('id', period_id)
        .single();

      if (pErr || !period) {
        return NextResponse.json({ error: 'Salary period not found.' }, { status: 404 });
      }

      if (period.status === 'closed') {
        return NextResponse.json({ error: 'Cannot edit a closed period. Historical record is locked.' }, { status: 400 });
      }

      const updatedManualDeductions = manual_deductions !== undefined ? Number(manual_deductions) : Number(period.manual_deductions);
      const updatedNotes = notes !== undefined ? notes : period.notes;

      const calc = calculateEmployeeSalaryPeriod({
        monthlySalary: Number(period.monthly_salary),
        daysInMonth: Number(period.days_in_month),
        presentDays: Number(period.present_days),
        allottedWeeklyOff: Number(period.allotted_weekly_off),
        attendancePenalties: Number(period.attendance_penalties),
        manualDeductions: updatedManualDeductions,
        previousPendingSalary: Number(period.previous_pending_salary),
      });

      const { data: updated, error: uErr } = await supabase
        .from('employee_salary_periods')
        .update({
          manual_deductions: calc.manualDeductions,
          total_deductions: calc.totalDeductions,
          net_earned_salary: calc.netEarnedSalary,
          total_salary_due: calc.totalSalaryDue,
          notes: updatedNotes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', period_id)
        .select()
        .single();

      if (uErr) {
        return NextResponse.json({ error: uErr.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, period: updated });
    }

    // Action 3: Close period (Lock historical period and initialize next month's opening balance)
    if (action === 'close') {
      if (!period_id && !salary_month) {
        return NextResponse.json({ error: 'period_id or salary_month is required to close.' }, { status: 400 });
      }

      let periodsToCloseQuery = supabase.from('employee_salary_periods').select('*');
      if (period_id) {
        periodsToCloseQuery = periodsToCloseQuery.eq('id', period_id);
      } else if (salary_month) {
        periodsToCloseQuery = periodsToCloseQuery.eq('salary_month', salary_month);
      }

      const { data: periodsToClose, error: listErr } = await periodsToCloseQuery;
      if (listErr || !periodsToClose || periodsToClose.length === 0) {
        return NextResponse.json({ error: 'No matching open periods found.' }, { status: 404 });
      }

      let closedCount = 0;

      for (const p of periodsToClose) {
        if (p.status === 'closed') continue;

        // Sum payments for this period
        const { data: payments } = await supabase
          .from('employee_salary_payments')
          .select('amount')
          .eq('salary_period_id', p.id);

        const totalPaid = (payments || []).reduce((sum, item) => sum + Number(item.amount), 0);
        const closingPending = Math.round((Number(p.total_salary_due) - totalPaid) * 100) / 100;

        // 1. Lock period
        await supabase
          .from('employee_salary_periods')
          .update({
            status: 'closed',
            closing_pending_salary: closingPending,
            updated_at: new Date().toISOString(),
          })
          .eq('id', p.id);

        // 2. Roll forward into next month
        const nextMonth = getNextMonthString(p.salary_month);
        const nextDaysInMonth = getDaysInSalaryMonth(nextMonth);

        // Check if next month period exists
        const { data: nextPeriod } = await supabase
          .from('employee_salary_periods')
          .select('id, status, monthly_salary, present_days, allotted_weekly_off, attendance_penalties, manual_deductions')
          .eq('employee_id', p.employee_id)
          .eq('salary_month', nextMonth)
          .maybeSingle();

        if (nextPeriod && nextPeriod.status === 'draft') {
          // Update previous_pending_salary on existing draft period
          const calc = calculateEmployeeSalaryPeriod({
            monthlySalary: Number(nextPeriod.monthly_salary),
            daysInMonth: nextDaysInMonth,
            presentDays: Number(nextPeriod.present_days),
            allottedWeeklyOff: Number(nextPeriod.allotted_weekly_off),
            attendancePenalties: Number(nextPeriod.attendance_penalties),
            manualDeductions: Number(nextPeriod.manual_deductions),
            previousPendingSalary: closingPending,
          });

          await supabase
            .from('employee_salary_periods')
            .update({
              previous_pending_salary: closingPending,
              total_salary_due: calc.totalSalaryDue,
              updated_at: new Date().toISOString(),
            })
            .eq('id', nextPeriod.id);
        } else if (!nextPeriod) {
          // Initialize next month's draft period
          const calc = calculateEmployeeSalaryPeriod({
            monthlySalary: Number(p.monthly_salary),
            daysInMonth: nextDaysInMonth,
            presentDays: 0,
            allottedWeeklyOff: Number(p.allotted_weekly_off),
            attendancePenalties: 0,
            manualDeductions: 0,
            previousPendingSalary: closingPending,
          });

          await supabase.from('employee_salary_periods').insert({
            employee_id: p.employee_id,
            salary_month: nextMonth,
            monthly_salary: Number(p.monthly_salary),
            days_in_month: nextDaysInMonth,
            present_days: 0,
            allotted_weekly_off: Number(p.allotted_weekly_off),
            pay_days: calc.payDays,
            per_day_salary: calc.perDaySalary,
            gross_earned_salary: calc.grossEarnedSalary,
            attendance_penalties: 0,
            manual_deductions: 0,
            total_deductions: 0,
            net_earned_salary: calc.netEarnedSalary,
            previous_pending_salary: closingPending,
            total_salary_due: calc.totalSalaryDue,
            status: 'draft',
          });
        }

        closedCount++;
      }

      // Log audit
      try {
        await supabase.from('audit_logs').insert({
          user_id: user?.id || null,
          action: 'STATUS_CHANGE',
          entity_type: 'Salary Period',
          details: {
            salary_month,
            period_id,
            closedCount,
          },
        });
      } catch {
        // Continue
      }

      return NextResponse.json({
        success: true,
        closedCount,
        message: `Successfully closed ${closedCount} salary period(s). Pending balances rolled forward.`,
      });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to process salary period request' }, { status: 500 });
  }
}
