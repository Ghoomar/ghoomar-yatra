import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const searchParams = request.nextUrl.searchParams;
    const employeeId = searchParams.get('employee_id');
    const salaryMonth = searchParams.get('salary_month');
    const salaryPeriodId = searchParams.get('salary_period_id');

    let query = supabase
      .from('employee_salary_payments')
      .select(`
        *,
        employee:employees(id, name, employee_code, monthly_salary)
      `)
      .order('payment_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (employeeId) {
      query = query.eq('employee_id', employeeId);
    }
    if (salaryMonth) {
      query = query.eq('salary_month', salaryMonth);
    }
    if (salaryPeriodId) {
      query = query.eq('salary_period_id', salaryPeriodId);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ payments: data || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to fetch payments' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const body = await request.json();
    const {
      employee_id,
      salary_period_id,
      salary_month,
      payment_date,
      amount,
      payment_method = 'Bank Transfer',
      reference_number,
      payment_type = 'Salary Payment',
      notes,
    } = body;

    if (!employee_id) {
      return NextResponse.json({ error: 'Employee ID is required.' }, { status: 400 });
    }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return NextResponse.json({ error: 'Valid payment amount (> 0) is required.' }, { status: 400 });
    }
    if (!payment_date) {
      return NextResponse.json({ error: 'Payment date is required.' }, { status: 400 });
    }

    // Determine salary month if omitted
    const effectiveMonth = salary_month || payment_date.substring(0, 7);

    // Resolve or confirm salary period ID
    let periodId = salary_period_id;
    if (!periodId) {
      const { data: period } = await supabase
        .from('employee_salary_periods')
        .select('id')
        .eq('employee_id', employee_id)
        .eq('salary_month', effectiveMonth)
        .maybeSingle();

      if (period) {
        periodId = period.id;
      }
    }

    const paymentPayload = {
      employee_id,
      salary_period_id: periodId || null,
      salary_month: effectiveMonth,
      payment_date,
      amount: Number(amount),
      payment_method,
      reference_number: reference_number?.trim() || null,
      payment_type,
      notes: notes?.trim() || null,
      recorded_by: user?.id || null,
    };

    const { data: newPayment, error: insertError } = await supabase
      .from('employee_salary_payments')
      .insert(paymentPayload)
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // Log audit entry
    try {
      await supabase.from('audit_logs').insert({
        user_id: user?.id || null,
        action: 'SALARY_PAYMENT',
        entity_type: 'Salary Payment',
        entity_id: newPayment.id,
        new_values: newPayment,
        details: {
          employee_id,
          salary_month: effectiveMonth,
          amount: Number(amount),
          payment_type,
          payment_method,
        },
      });
    } catch {
      // Audit log failures should not block successful payment response
    }

    return NextResponse.json({ success: true, payment: newPayment }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to record salary payment' }, { status: 500 });
  }
}
