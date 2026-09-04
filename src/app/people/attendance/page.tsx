'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { getTodayBusinessDate, formatINR } from '@/lib/utils';
import { ClipboardCheck, CheckCircle, AlertCircle, Save, RefreshCw, UserCheck } from 'lucide-react';

interface AttendanceRow {
  employee_id: string;
  name: string;
  department_name?: string;
  role_name?: string;
  status: 'Present' | 'Absent' | 'Weekly Off' | 'Leave' | 'Half Day';
  overtime_hours: number;
  penalty_amount: number;
  notes: string;
}

export default function AttendancePage() {
  const supabase = createClient();
  const [businessDate, setBusinessDate] = useState(getTodayBusinessDate());
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isReported, setIsReported] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadData = async () => {
    setLoading(true);
    setMessage(null);
    try {
      // 1. Fetch active employees
      const { data: emps } = await supabase
        .from('employees')
        .select('id, name, department:departments(name), role:employee_roles(name)')
        .eq('employment_status', 'Active')
        .order('name');

      // 2. Fetch existing attendance for this business date
      const { data: attData } = await supabase
        .from('attendance')
        .select('*')
        .eq('business_date', businessDate);

      const hasEntries = attData && attData.length > 0;
      setIsReported(Boolean(hasEntries));

      setRows(
        (emps || []).map((emp: any) => {
          const existing = (attData || []).find((a) => a.employee_id === emp.id);
          return {
            employee_id: emp.id,
            name: emp.name,
            department_name: emp.department?.name,
            role_name: emp.role?.name,
            status: existing ? existing.status : 'Present',
            overtime_hours: existing ? Number(existing.overtime_hours) : 0,
            penalty_amount: existing ? Number(existing.penalty_amount) : 0,
            notes: existing?.notes || '',
          };
        })
      );
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: 'Failed to load attendance register.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [businessDate]);

  const handleMarkAllPresent = () => {
    setRows(rows.map((r) => ({ ...r, status: 'Present' })));
  };

  const handleSaveAttendance = async () => {
    setSaving(true);
    setMessage(null);

    try {
      for (const row of rows) {
        await supabase.from('attendance').upsert(
          {
            employee_id: row.employee_id,
            business_date: businessDate,
            status: row.status,
            overtime_hours: row.overtime_hours,
            penalty_amount: row.penalty_amount,
            notes: row.notes,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'employee_id,business_date' }
        );
      }

      setIsReported(true);
      setMessage({ type: 'success', text: `Attendance for ${rows.length} staff members saved successfully.` });
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: err.message || 'Failed to save attendance.' });
    } finally {
      setSaving(false);
    }
  };

  const presentCount = rows.filter((r) => r.status === 'Present').length;
  const absentCount = rows.filter((r) => r.status === 'Absent').length;
  const weeklyOffCount = rows.filter((r) => r.status === 'Weekly Off').length;
  const leaveCount = rows.filter((r) => r.status === 'Leave').length;
  const totalOvertime = rows.reduce((acc, r) => acc + (r.overtime_hours || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6 text-amber-600" />
            Daily Staff Attendance Register
          </h1>
          <p className="text-sm text-stone-500">
            Digital muster roll recorded from physical attendance register for midnight operational reporting.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-white border border-stone-200 rounded-lg px-3 py-1.5 shadow-2xs text-xs font-medium">
            <span className="text-stone-500">Date:</span>
            <input
              type="date"
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
              className="bg-transparent font-semibold text-stone-900 focus:outline-none cursor-pointer"
            />
          </div>
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-white border border-stone-200/80 rounded-xl text-xs shadow-2xs">
        <div className="flex items-center gap-2">
          <span className="text-stone-500 font-medium">Attendance Status:</span>
          {isReported ? (
            <Badge variant="success" className="gap-1">
              <CheckCircle className="h-3 w-3" /> RECORDED
            </Badge>
          ) : (
            <Badge variant="danger" className="gap-1">
              <AlertCircle className="h-3 w-3" /> NOT SUBMITTED FOR TODAY
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={handleMarkAllPresent} className="text-xs gap-1.5">
            <UserCheck className="h-3.5 w-3.5 text-emerald-600" /> Mark All Present
          </Button>
          <Button variant="amber" size="sm" onClick={handleSaveAttendance} disabled={saving} className="text-xs gap-1.5">
            <Save className="h-3.5 w-3.5" /> {saving ? 'Saving...' : 'Save Register'}
          </Button>
        </div>
      </div>

      {message && (
        <div className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 ${message.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
          {message.type === 'success' ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {message.text}
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card className="p-3">
          <div className="text-xs text-stone-500 font-medium">Present</div>
          <div className="text-2xl font-bold text-emerald-600 mt-1">{presentCount}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-stone-500 font-medium">Absent</div>
          <div className="text-2xl font-bold text-rose-600 mt-1">{absentCount}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-stone-500 font-medium">Weekly Off</div>
          <div className="text-2xl font-bold text-stone-600 mt-1">{weeklyOffCount}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-stone-500 font-medium">Leave</div>
          <div className="text-2xl font-bold text-amber-600 mt-1">{leaveCount}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-stone-500 font-medium">Overtime Hours</div>
          <div className="text-2xl font-bold text-sky-600 mt-1">{totalOvertime}h</div>
        </Card>
      </div>

      {/* Attendance Grid */}
      <Card>
        <CardHeader>
          <CardTitle>Attendance Roster ({rows.length} Staff)</CardTitle>
          <CardDescription>Rapid status selection with overtime and penalty logging</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {rows.length === 0 ? (
            <div className="py-12 text-center text-stone-400 text-xs">
              No active employees found. Please register employees first.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-500 font-semibold">
                    <th className="py-2 px-3">Staff Member</th>
                    <th className="py-2 px-3">Dept / Role</th>
                    <th className="py-2 px-3 text-center">Attendance Status</th>
                    <th className="py-2 px-3 text-center">OT (Hrs)</th>
                    <th className="py-2 px-3 text-center">Penalty (₹)</th>
                    <th className="py-2 px-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {rows.map((row, idx) => (
                    <tr key={row.employee_id} className="hover:bg-stone-50/80 transition-colors">
                      <td className="py-2.5 px-3 font-semibold text-stone-900">{row.name}</td>
                      <td className="py-2.5 px-3 text-stone-600">
                        {row.department_name || 'General'} • {row.role_name || 'Staff'}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center justify-center gap-1">
                          {(['Present', 'Absent', 'Weekly Off', 'Leave', 'Half Day'] as const).map((st) => (
                            <button
                              key={st}
                              type="button"
                              onClick={() => {
                                const next = [...rows];
                                next[idx].status = st;
                                setRows(next);
                              }}
                              className={`px-2 py-1 rounded text-[11px] font-semibold transition-all cursor-pointer ${
                                row.status === st
                                  ? st === 'Present'
                                    ? 'bg-emerald-600 text-white'
                                    : st === 'Absent'
                                    ? 'bg-rose-600 text-white'
                                    : 'bg-amber-600 text-white'
                                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                              }`}
                            >
                              {st === 'Present' ? 'P' : st === 'Absent' ? 'A' : st === 'Weekly Off' ? 'WO' : st === 'Leave' ? 'L' : 'HD'}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <input
                          type="number"
                          step="0.5"
                          value={row.overtime_hours || ''}
                          onChange={(e) => {
                            const next = [...rows];
                            next[idx].overtime_hours = parseFloat(e.target.value) || 0;
                            setRows(next);
                          }}
                          placeholder="0"
                          className="w-14 rounded border border-stone-300 p-1 text-center text-xs focus:outline-none focus:border-amber-500"
                        />
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <input
                          type="number"
                          step="50"
                          value={row.penalty_amount || ''}
                          onChange={(e) => {
                            const next = [...rows];
                            next[idx].penalty_amount = parseFloat(e.target.value) || 0;
                            setRows(next);
                          }}
                          placeholder="0"
                          className="w-18 rounded border border-stone-300 p-1 text-center text-xs text-rose-600 font-medium focus:outline-none focus:border-amber-500"
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        <input
                          type="text"
                          value={row.notes}
                          onChange={(e) => {
                            const next = [...rows];
                            next[idx].notes = e.target.value;
                            setRows(next);
                          }}
                          placeholder="Remarks..."
                          className="w-full rounded border border-stone-300 p-1 text-xs focus:outline-none focus:border-amber-500"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
