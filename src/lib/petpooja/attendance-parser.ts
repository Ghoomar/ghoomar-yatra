import * as XLSX from 'xlsx';
import crypto from 'crypto';
/**
 * Parses a date string like "2026-09-18 to 2026-09-18", "18 Sep 2026 To 18 Sep 2026",
 * "18-09-2026 23:16", or "18-09-2026" into standard "YYYY-MM-DD".
 * Returns empty string if no valid date is matched. NEVER defaults to today's date.
 */
export function normalizeDateStringToIso(dateStr: any): string {
  if (dateStr === undefined || dateStr === null) return '';

  // Handle Excel date serial numbers (e.g. 46332 -> 2026-11-06)
  if (typeof dateStr === 'number' || (!isNaN(Number(dateStr)) && Number(dateStr) > 20000 && Number(dateStr) < 80000)) {
    try {
      const serial = Number(dateStr);
      const ssf = (XLSX as any).SSF;
      if (ssf && typeof ssf.parse_date_code === 'function') {
        const parsed = ssf.parse_date_code(serial);
        if (parsed && parsed.y && parsed.m && parsed.d) {
          const y = String(parsed.y);
          const m = String(parsed.m).padStart(2, '0');
          const d = String(parsed.d).padStart(2, '0');
          return `${y}-${m}-${d}`;
        }
      }
      // Math fallback
      const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
      return date.toISOString().substring(0, 10);
    } catch {
      // Fall through to string patterns
    }
  }

  const clean = String(dateStr).trim();

  // Pattern: "YYYY-MM-DD to YYYY-MM-DD" or "YYYY-MM-DD"
  const isoMatch = clean.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  // Pattern: "18 Sep 2026 To 18 Sep 2026", "18 Sep 2026", "18 September 2026"
  const textMonthMatch = clean.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/i);
  if (textMonthMatch) {
    const day = textMonthMatch[1].padStart(2, '0');
    const monStr = textMonthMatch[2].substring(0, 3).toLowerCase();
    const year = textMonthMatch[3];
    const months: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const mon = months[monStr];
    if (mon) {
      return `${year}-${mon}-${day}`;
    }
  }

  // Pattern: "19-09-2026" or "19/09/2026" or "19-09-2026 00:21"
  const dmyMatch = clean.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const mon = dmyMatch[2].padStart(2, '0');
    const year = dmyMatch[3];
    return `${year}-${mon}-${day}`;
  }

  return '';
}

export interface AttendanceRecord {
  petpoojaEmpId: number;
  employeeName: string;
  department: string;
  designation: string;
  businessDate: string; // YYYY-MM-DD
  dayOfWeek?: string;
  punchIn: string | null;
  punchOut: string | null;
  workingHours: string | null;
  breakHours: string | null;
  status: 'FD' | 'HD' | 'Absent';
  shiftMultiplier: number;
  rawRow: Record<string, any>;
}

export interface AttendanceParseResult {
  reportType: 'ATTENDANCE_MASTER';
  businessDate: string;
  fileChecksum: string;
  fileName: string;
  recordCount: number;
  fdCount: number;
  hdCount: number;
  absentCount: number;
  records: AttendanceRecord[];
  unrecognizedStatuses: { row: number; empId: number; status: string }[];
}

/**
 * Calculates SHA-256 checksum of uploaded buffer
 */
export function calculateFileChecksum(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Clean cell text
 */
function cleanText(val: any): string {
  if (val === undefined || val === null) return '';
  return String(val).trim();
}

/**
 * Parse Petpooja Attendance Excel/CSV buffer
 */
export function parsePetpoojaAttendanceBuffer(buffer: Buffer, fileName: string): AttendanceParseResult {
  const fileChecksum = calculateFileChecksum(buffer);

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', raw: false, cellDates: false });
  } catch (err: any) {
    throw new Error(`Invalid or unreadable spreadsheet file: ${err.message}`);
  }

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error('Uploaded workbook has no sheets.');
  }

  // Find the relevant attendance sheet
  let targetSheet: XLSX.WorkSheet | null = null;
  let targetSheetName = '';

  for (const name of workbook.SheetNames) {
    if (/attendance/i.test(name)) {
      targetSheet = workbook.Sheets[name];
      targetSheetName = name;
      break;
    }
  }

  // Fallback to first sheet
  if (!targetSheet) {
    targetSheetName = workbook.SheetNames[0];
    targetSheet = workbook.Sheets[targetSheetName];
  }

  if (!targetSheet) {
    throw new Error('Could not find a valid sheet in workbook.');
  }

  const rawRows: any[][] = XLSX.utils.sheet_to_json(targetSheet, {
    header: 1,
    defval: '',
    blankrows: false,
  });

  if (!rawRows || rawRows.length === 0) {
    throw new Error(`The attendance sheet "${targetSheetName}" is empty.`);
  }

  // Detect header row
  let headerIndex = -1;
  let colMap: {
    empId?: number;
    name?: number;
    dept?: number;
    desig?: number;
    date?: number;
    day?: number;
    punchIn?: number;
    punchOut?: number;
    workingHours?: number;
    breakHours?: number;
    status?: number;
  } = {};

  for (let r = 0; r < Math.min(15, rawRows.length); r++) {
    const row = rawRows[r].map((c) => cleanText(c).toLowerCase());

    const empIdIdx = row.findIndex((c) => /employee\s*(?:id|code|no)/i.test(c));
    const nameIdx = row.findIndex((c) => /employee\s*name/i.test(c) || /^name$/i.test(c));
    const dateIdx = row.findIndex((c) => /^date$/i.test(c) || /attendance\s*date/i.test(c));
    const statusIdx = row.findIndex((c) => /^status$/i.test(c));

    if (empIdIdx !== -1 && (dateIdx !== -1 || row.some((c) => /punch/i.test(c)))) {
      headerIndex = r;
      colMap.empId = empIdIdx;
      colMap.name = nameIdx !== -1 ? nameIdx : undefined;
      colMap.date = dateIdx !== -1 ? dateIdx : undefined;
      colMap.status = statusIdx !== -1 ? statusIdx : undefined;

      colMap.dept = row.findIndex((c) => /department/i.test(c));
      if (colMap.dept === -1) colMap.dept = undefined;

      colMap.desig = row.findIndex((c) => /designation/i.test(c));
      if (colMap.desig === -1) colMap.desig = undefined;

      colMap.day = row.findIndex((c) => /^day$/i.test(c));
      if (colMap.day === -1) colMap.day = undefined;

      colMap.punchIn = row.findIndex((c) => /punch\s*in/i.test(c) || /first\s*punch/i.test(c));
      if (colMap.punchIn === -1) colMap.punchIn = undefined;

      colMap.punchOut = row.findIndex((c) => /punch\s*out/i.test(c) || /last\s*punch/i.test(c));
      if (colMap.punchOut === -1) colMap.punchOut = undefined;

      colMap.workingHours = row.findIndex((c) => /working\s*hours/i.test(c) || /work\s*hours/i.test(c));
      if (colMap.workingHours === -1) colMap.workingHours = undefined;

      colMap.breakHours = row.findIndex((c) => /break/i.test(c));
      if (colMap.breakHours === -1) colMap.breakHours = undefined;

      break;
    }
  }

  if (headerIndex === -1 || colMap.empId === undefined) {
    throw new Error(
      `Unrecognized attendance report structure. Could not detect Petpooja attendance header row with "Employee ID". Found headers: [${(
        rawRows[0] || []
      )
        .map(cleanText)
        .join(', ')}]`
    );
  }

  if (colMap.date === undefined) {
    throw new Error(
      `Missing required "Date" column in attendance report. Detected columns: [${rawRows[headerIndex]
        .map(cleanText)
        .join(', ')}]`
    );
  }

  if (colMap.status === undefined) {
    throw new Error(
      `Missing required "Status" column in attendance report. Detected columns: [${rawRows[headerIndex]
        .map(cleanText)
        .join(', ')}]`
    );
  }

  // 1. Pre-scan all rows for attendance dates to validate single-day contract first
  const distinctDates = new Set<string>();
  for (let r = headerIndex + 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row || row.length === 0) continue;
    const rawEmpId = cleanText(row[colMap.empId]);
    if (!rawEmpId) continue;
    const rawDate = row[colMap.date];
    const isoDate = normalizeDateStringToIso(rawDate);
    // console.log('DEBUG row:', r, 'colMap.date:', colMap.date, 'rawDate:', rawDate, 'isoDate:', isoDate);
    if (isoDate) {
      distinctDates.add(isoDate);
    }
  }

  if (distinctDates.size === 0) {
    throw new Error('Unable to identify any valid attendance dates in the file.');
  }

  if (distinctDates.size > 1) {
    const dateList = Array.from(distinctDates).sort();
    throw new Error(
      `Multi-day attendance file rejected. Each import file must represent exactly ONE attendance date, but found ${
        distinctDates.size
      } dates (${dateList.slice(0, 3).join(', ')} ... ${dateList[dateList.length - 1]}). Please upload daily single-date exports.`
    );
  }

  const businessDate = Array.from(distinctDates)[0];
  const seenEmpIds = new Set<number>();
  const records: AttendanceRecord[] = [];
  const unrecognizedStatuses: { row: number; empId: number; status: string }[] = [];

  let fdCount = 0;
  let hdCount = 0;
  let absentCount = 0;

  for (let r = headerIndex + 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row || row.length === 0) continue;

    const rawEmpId = cleanText(row[colMap.empId]);
    if (!rawEmpId) continue; // Skip trailing empty rows

    const empId = parseInt(rawEmpId, 10);
    if (isNaN(empId)) {
      throw new Error(`Row ${r + 1}: Invalid non-numeric Petpooja Employee ID "${rawEmpId}".`);
    }

    if (seenEmpIds.has(empId)) {
      throw new Error(`Duplicate record for Employee ID ${empId} detected in the same attendance file at row ${r + 1}.`);
    }
    seenEmpIds.add(empId);

    const rawDate = row[colMap.date];
    const isoDate = normalizeDateStringToIso(rawDate);
    if (!isoDate) {
      throw new Error(`Row ${r + 1}: Unable to parse attendance date "${rawDate}".`);
    }
    distinctDates.add(isoDate);

    const name = colMap.name !== undefined ? cleanText(row[colMap.name]) : '';
    const dept = colMap.dept !== undefined ? cleanText(row[colMap.dept]) : '';
    const desig = colMap.desig !== undefined ? cleanText(row[colMap.desig]) : '';
    const dayOfWeek = colMap.day !== undefined ? cleanText(row[colMap.day]) : '';

    const rawPunchIn = colMap.punchIn !== undefined ? cleanText(row[colMap.punchIn]) : '';
    const rawPunchOut = colMap.punchOut !== undefined ? cleanText(row[colMap.punchOut]) : '';
    const rawWorkingHours = colMap.workingHours !== undefined ? cleanText(row[colMap.workingHours]) : '';
    const rawBreak = colMap.breakHours !== undefined ? cleanText(row[colMap.breakHours]) : '';

    const punchIn = rawPunchIn && rawPunchIn !== '-' ? rawPunchIn : null;
    const punchOut = rawPunchOut && rawPunchOut !== '-' ? rawPunchOut : null;
    const workingHours = rawWorkingHours && rawWorkingHours !== '-' ? rawWorkingHours : null;
    const breakHours = rawBreak && rawBreak !== '-' ? rawBreak : null;

    const rawStatus = cleanText(row[colMap.status]);
    let shiftMultiplier = 0.0;
    let status: 'FD' | 'HD' | 'Absent';

    if (rawStatus === 'FD' || rawStatus === 'P' || rawStatus === 'Present') {
      status = 'FD';
      shiftMultiplier = 1.0;
      fdCount++;
    } else if (rawStatus === 'HD' || rawStatus === 'Half Day') {
      status = 'HD';
      shiftMultiplier = 0.5;
      hdCount++;
    } else if (rawStatus === 'Absent' || rawStatus === 'A') {
      status = 'Absent';
      shiftMultiplier = 0.0;
      absentCount++;
    } else {
      unrecognizedStatuses.push({ row: r + 1, empId, status: rawStatus });
      status = 'Absent';
      shiftMultiplier = 0.0;
      absentCount++;
    }

    records.push({
      petpoojaEmpId: empId,
      employeeName: name,
      department: dept,
      designation: desig,
      businessDate: isoDate,
      dayOfWeek: dayOfWeek || undefined,
      punchIn,
      punchOut,
      workingHours,
      breakHours,
      status,
      shiftMultiplier,
      rawRow: {
        rawEmpId,
        rawName: name,
        rawDept: dept,
        rawDesig: desig,
        rawDate,
        rawStatus,
        rawPunchIn,
        rawPunchOut,
        rawWorkingHours,
        rawBreak,
      },
    });
  }

  if (records.length === 0) {
    throw new Error('No valid employee attendance records found in the file.');
  }


  if (unrecognizedStatuses.length > 0) {
    const samples = unrecognizedStatuses.slice(0, 5).map((u) => `Row ${u.row} (ID ${u.empId}): "${u.status}"`).join(', ');
    throw new Error(
      `Rejected file due to ${unrecognizedStatuses.length} unrecognized attendance statuses: ${samples}. Only FD, HD, and Absent are supported.`
    );
  }

  return {
    reportType: 'ATTENDANCE_MASTER',
    businessDate,
    fileChecksum,
    fileName,
    recordCount: records.length,
    fdCount,
    hdCount,
    absentCount,
    records,
    unrecognizedStatuses,
  };
}
