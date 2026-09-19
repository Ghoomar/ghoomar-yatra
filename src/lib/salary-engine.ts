import { SupabaseClient } from '@supabase/supabase-js';
import { EmployeeSalaryPeriod, EmployeeSalarySummaryRow } from './types/database';

export interface SalaryCalculationInput {
  monthlySalary: number;
  daysInMonth: number;
  presentDays: number;
  allottedWeeklyOff: number;
  attendancePenalties?: number;
  manualDeductions?: number;
  previousPendingSalary?: number;
}

export interface SalaryCalculationResult {
  presentDays: number;
  allottedWeeklyOff: number;
  perDaySalary: number;
  payDays: number;
  grossEarnedSalary: number;
  attendancePenalties: number;
  manualDeductions: number;
  totalDeductions: number;
  netEarnedSalary: number;
  previousPendingSalary: number;
  totalSalaryDue: number;
}

/**
 * Calculates earned salary, pay days, deductions, and total salary due for an employee period.
 * Adheres strictly to the authentic formula:
 * Total Salary Due = Previous Month Pending + Net Earned Salary
 */
export function calculateEmployeeSalaryPeriod(input: SalaryCalculationInput): SalaryCalculationResult {
  const {
    monthlySalary,
    daysInMonth,
    presentDays,
    allottedWeeklyOff,
    attendancePenalties = 0,
    manualDeductions = 0,
    previousPendingSalary = 0,
  } = input;

  const validDaysInMonth = daysInMonth > 0 ? daysInMonth : 30;
  const perDaySalary = Number((monthlySalary / validDaysInMonth).toFixed(2));
  const payDays = Number((presentDays + allottedWeeklyOff).toFixed(2));
  const grossEarnedSalary = Math.round(payDays * perDaySalary * 100) / 100;

  const totalDeductions = Math.round((attendancePenalties + manualDeductions) * 100) / 100;
  const netEarnedSalary = Math.round((grossEarnedSalary - totalDeductions) * 100) / 100;
  const totalSalaryDue = Math.round((previousPendingSalary + netEarnedSalary) * 100) / 100;

  return {
    presentDays,
    allottedWeeklyOff,
    perDaySalary,
    payDays,
    grossEarnedSalary,
    attendancePenalties,
    manualDeductions,
    totalDeductions,
    netEarnedSalary,
    previousPendingSalary,
    totalSalaryDue,
  };
}

/**
 * Derives previous month string 'YYYY-MM'
 */
export function getPreviousMonthString(salaryMonth: string): string {
  const [yearStr, monthStr] = salaryMonth.split('-');
  let year = parseInt(yearStr, 10);
  let month = parseInt(monthStr, 10);

  month -= 1;
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Derives next month string 'YYYY-MM'
 */
export function getNextMonthString(salaryMonth: string): string {
  const [yearStr, monthStr] = salaryMonth.split('-');
  let year = parseInt(yearStr, 10);
  let month = parseInt(monthStr, 10);

  month += 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Gets the number of days in a given salary month (YYYY-MM)
 */
export function getDaysInSalaryMonth(salaryMonth: string): number {
  const [yearStr, monthStr] = salaryMonth.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  return new Date(year, month, 0).getDate();
}

/**
 * Resolves previous month's closing pending balance for an employee.
 * If previous month was closed, uses closing_pending_salary.
 * If previous month was draft, calculates (total_salary_due - sum(payments)).
 * If no previous record, returns 0.
 */
export async function getPreviousMonthPendingSalary(
  supabase: SupabaseClient,
  employeeId: string,
  currentSalaryMonth: string
): Promise<number> {
  const prevMonth = getPreviousMonthString(currentSalaryMonth);

  const { data: prevPeriod, error } = await supabase
    .from('employee_salary_periods')
    .select('id, total_salary_due, closing_pending_salary, status')
    .eq('employee_id', employeeId)
    .eq('salary_month', prevMonth)
    .maybeSingle();

  if (error || !prevPeriod) {
    return 0;
  }

  if (prevPeriod.status === 'closed' && prevPeriod.closing_pending_salary !== null) {
    return Number(prevPeriod.closing_pending_salary);
  }

  // If draft, sum payments made against that period
  const { data: payments } = await supabase
    .from('employee_salary_payments')
    .select('amount')
    .eq('salary_period_id', prevPeriod.id);

  const totalPaid = (payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
  return Math.round((Number(prevPeriod.total_salary_due) - totalPaid) * 100) / 100;
}

/**
 * Synchronizes daily attendance records and allotments into employee_salary_periods
 * for a specific salary month.
 * Preserves manual deductions and notes. Does NOT overwrite closed periods.
 */
export async function syncMonthAttendanceToPeriods(
  supabase: SupabaseClient,
  salaryMonth: string
): Promise<{ success: boolean; updatedCount: number; message: string }> {
  try {
    const daysInMonth = getDaysInSalaryMonth(salaryMonth);
    const startDate = `${salaryMonth}-01`;
    const endDate = `${salaryMonth}-${String(daysInMonth).padStart(2, '0')}`;

    // 1. Fetch active employees
    const { data: employees, error: empErr } = await supabase
      .from('employees')
      .select('id, name, monthly_salary, allotted_weekly_off, employment_status')
      .eq('employment_status', 'Active');

    if (empErr || !employees) {
      throw new Error(`Failed to load employees: ${empErr?.message}`);
    }

    let updatedCount = 0;

    for (const emp of employees) {
      // Check if period already exists
      const { data: existingPeriod } = await supabase
        .from('employee_salary_periods')
        .select('*')
        .eq('employee_id', emp.id)
        .eq('salary_month', salaryMonth)
        .maybeSingle();

      // If closed, NEVER overwrite historical closed record
      if (existingPeriod && existingPeriod.status === 'closed') {
        continue;
      }

      // Fetch attendance in range
      const { data: attendanceRecords } = await supabase
        .from('attendance')
        .select('status, shift_multiplier, penalty_amount')
        .eq('employee_id', emp.id)
        .gte('business_date', startDate)
        .lte('business_date', endDate);

      let presentDays = 0;
      let attendancePenalties = 0;

      if (attendanceRecords && attendanceRecords.length > 0) {
        for (const att of attendanceRecords) {
          if (att.shift_multiplier !== null && att.shift_multiplier !== undefined) {
            presentDays += Number(att.shift_multiplier);
          } else {
            // Default shift multiplier based on status
            if (att.status === 'P' || att.status === 'Present') {
              presentDays += 1.0;
            } else if (att.status === 'HD' || att.status === 'Half Day') {
              presentDays += 0.5;
            } else if (att.status === '2P') {
              presentDays += 2.0;
            }
          }
          if (att.penalty_amount) {
            attendancePenalties += Number(att.penalty_amount);
          }
        }
      } else if (existingPeriod) {
        // Retain existing present_days if attendance not logged day-by-day
        presentDays = Number(existingPeriod.present_days) || 0;
      }

      const allottedWeeklyOff = emp.allotted_weekly_off !== null && emp.allotted_weekly_off !== undefined
        ? Number(emp.allotted_weekly_off)
        : (existingPeriod ? Number(existingPeriod.allotted_weekly_off) : 4);

      const manualDeductions = existingPeriod ? Number(existingPeriod.manual_deductions) || 0 : 0;
      const prevPending = existingPeriod
        ? Number(existingPeriod.previous_pending_salary)
        : await getPreviousMonthPendingSalary(supabase, emp.id, salaryMonth);

      const monthlySalary = Number(emp.monthly_salary) || (existingPeriod ? Number(existingPeriod.monthly_salary) : 0);

      const calc = calculateEmployeeSalaryPeriod({
        monthlySalary,
        daysInMonth,
        presentDays,
        allottedWeeklyOff,
        attendancePenalties,
        manualDeductions,
        previousPendingSalary: prevPending,
      });

      const periodPayload: Partial<EmployeeSalaryPeriod> = {
        employee_id: emp.id,
        salary_month: salaryMonth,
        monthly_salary: monthlySalary,
        days_in_month: daysInMonth,
        present_days: calc.presentDays,
        allotted_weekly_off: calc.allottedWeeklyOff,
        pay_days: calc.payDays,
        per_day_salary: calc.perDaySalary,
        gross_earned_salary: calc.grossEarnedSalary,
        attendance_penalties: calc.attendancePenalties,
        manual_deductions: calc.manualDeductions,
        total_deductions: calc.totalDeductions,
        net_earned_salary: calc.netEarnedSalary,
        previous_pending_salary: calc.previousPendingSalary,
        total_salary_due: calc.totalSalaryDue,
        status: 'draft',
      };

      if (existingPeriod) {
        await supabase
          .from('employee_salary_periods')
          .update({
            ...periodPayload,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingPeriod.id);
      } else {
        await supabase
          .from('employee_salary_periods')
          .insert(periodPayload);
      }

      updatedCount++;
    }

    return {
      success: true,
      updatedCount,
      message: `Successfully synchronized ${updatedCount} staff salary records for ${salaryMonth}.`,
    };
  } catch (err: any) {
    return {
      success: false,
      updatedCount: 0,
      message: err.message || 'Error synchronizing salary periods.',
    };
  }
}
