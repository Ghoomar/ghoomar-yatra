import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parsePetpoojaAttendanceBuffer } from '@/lib/petpooja/attendance-parser';

async function getSupabase() {
  try {
    return await createServerSupabaseClient();
  } catch {
    return createAdminClient();
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await getSupabase();
    const url = new URL(request.url);
    const searchParams = request.nextUrl ? request.nextUrl.searchParams : url.searchParams;
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const month = searchParams.get('month'); // e.g. '2026-11'
    const businessDate = searchParams.get('business_date') || searchParams.get('date');

    let query = supabase
      .from('attendance_import_batches')
      .select('*')
      .order('business_date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);

    if (businessDate) {
      query = query.eq('business_date', businessDate);
    } else if (month) {
      const startOfMonth = `${month}-01`;
      const endOfMonth = `${month}-31`;
      query = query.gte('business_date', startOfMonth).lte('business_date', endOfMonth);
    }

    const { data: batches, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ batches: batches || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to fetch attendance import history.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await getSupabase();
    let user: any = null;
    try {
      const { data: authData } = await supabase.auth.getUser();
      user = authData?.user || null;
    } catch {
      // In tests/admin fallback
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const overwriteStr = formData.get('overwrite');
    const overwrite = overwriteStr === 'true' || overwriteStr === '1';

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 1. Parse buffer using Petpooja attendance parser
    let parseResult;
    try {
      parseResult = parsePetpoojaAttendanceBuffer(buffer, file.name);
    } catch (parseErr: any) {
      return NextResponse.json({ error: parseErr.message || 'Failed to parse attendance file.' }, { status: 400 });
    }

    const {
      businessDate,
      fileChecksum,
      recordCount,
      fdCount,
      hdCount,
      absentCount,
      records,
    } = parseResult;

    // 2. Employee mapping resolution (deterministic by petpooja_emp_id ONLY)
    const { data: employees, error: empErr } = await supabase
      .from('employees')
      .select('id, petpooja_emp_id, name, department:departments(name, name_hi), role:employee_roles(name, name_hi)')
      .not('petpooja_emp_id', 'is', null);

    if (empErr) {
      return NextResponse.json({ error: `Failed to load employee master mappings: ${empErr.message}` }, { status: 500 });
    }

    const empMap = new Map<number, any>();
    (employees || []).forEach((e) => {
      if (e.petpooja_emp_id !== null && e.petpooja_emp_id !== undefined) {
        empMap.set(Number(e.petpooja_emp_id), e);
      }
    });

    const unmappedEmployees: any[] = [];
    const mappedRows: any[] = [];

    for (const rec of records) {
      const matchedEmp = empMap.get(rec.petpoojaEmpId);
      if (!matchedEmp) {
        unmappedEmployees.push({
          petpoojaEmpId: rec.petpoojaEmpId,
          employeeName: rec.employeeName,
          department: rec.department,
          designation: rec.designation,
          status: rec.status,
        });
      } else {
        mappedRows.push({
          employee_id: matchedEmp.id,
          business_date: businessDate,
          status: rec.status, // FD, HD, or Absent verbatim
          shift_multiplier: rec.shiftMultiplier, // 1.0, 0.5, or 0.0
          source: 'petpooja_biometric',
          petpooja_emp_id: rec.petpoojaEmpId,
          punch_in: rec.punchIn,
          punch_out: rec.punchOut,
          working_hours: rec.workingHours,
          break_hours: rec.breakHours,
          notes: `Petpooja biometric import (${file.name})`,
          marked_by: user?.id || null,
          raw_metadata: rec.rawRow,
        });
      }
    }

    // Fail atomic if any employee is unmapped!
    if (unmappedEmployees.length > 0) {
      return NextResponse.json(
        {
          error: 'UNMAPPED_EMPLOYEES',
          message: `${unmappedEmployees.length} employees in the file are not mapped in Yatra. All Petpooja employee IDs must be assigned to Yatra employees in People -> Employees before importing biometric attendance.`,
          unmappedCount: unmappedEmployees.length,
          mappedCount: mappedRows.length,
          totalCount: records.length,
          unmapped: unmappedEmployees,
        },
        { status: 422 }
      );
    }

    // 3. Duplicate / Idempotency Check & Atomic Execution
    const batchPayload = {
      business_date: businessDate,
      file_name: file.name,
      file_checksum: fileChecksum,
      record_count: recordCount,
      mapped_count: mappedRows.length,
      unmapped_count: 0,
      fd_count: fdCount,
      hd_count: hdCount,
      absent_count: absentCount,
      report_structure: 'ATTENDANCE_MASTER',
      source: 'petpooja_biometric',
      imported_by: user?.id || null,
      raw_metadata: {
        fileName: file.name,
        totalRows: records.length,
        fdCount,
        hdCount,
        absentCount,
      },
    };

    // 3. Duplicate / Idempotency Check & Atomic Stored Procedure Execution
    const { data: rpcData, error: rpcErr } = await supabase.rpc('fn_import_biometric_attendance_atomic', {
      p_batch: batchPayload,
      p_records: mappedRows,
      p_overwrite: overwrite,
    });

    if (rpcErr) {
      if (rpcErr.message?.includes('DUPLICATE_IMPORT')) {
        const { data: existingBatches } = await supabase
          .from('attendance_import_batches')
          .select('*')
          .eq('business_date', businessDate)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(1);

        const existingBatch = existingBatches && existingBatches.length > 0 ? existingBatches[0] : null;

        return NextResponse.json(
          {
            isDuplicate: true,
            message: `Attendance for ${businessDate} was already imported (${existingBatch?.file_name || 'previous batch'} on ${new Date(
              existingBatch?.created_at || Date.now()
            ).toLocaleDateString()}). Set overwrite=true to safely update this date's biometric attendance.`,
            existingBatch,
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: `Biometric attendance import failed: ${rpcErr.message}` },
        { status: 500 }
      );
    }

    if (!rpcData?.success) {
      return NextResponse.json(
        { error: 'Biometric attendance import failed: unexpected database function response.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      businessDate,
      fileChecksum,
      recordCount: records.length,
      mappedCount: mappedRows.length,
      fdCount,
      hdCount,
      absentCount,
      batch: rpcData.batch,
      message: `Successfully imported biometric attendance for ${businessDate} (${mappedRows.length} staff records).`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error importing attendance.' }, { status: 500 });
  }
}
