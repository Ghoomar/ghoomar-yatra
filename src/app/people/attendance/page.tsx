'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { ClipboardCheck, CheckCircle, AlertCircle, Save, RefreshCw, UserCheck } from 'lucide-react';
import { getTodayBusinessDate } from '@/lib/utils';
import { useI18n } from '@/lib/i18n/context';
import { getLocalizedMasterName } from '@/lib/i18n/master-data';

interface AttendanceRow {
  employee_id: string;
  name: string;
  department_name?: string;
  role_name?: string;
  status: 'Present' | 'Absent' | 'Weekly Off' | 'Leave' | 'Half Day' | 'Double Shift';
  shift_multiplier: number;
  overtime_hours: number;
  penalty_amount: number;
  notes: string;
}

export default function AttendancePage() {
  const supabase = createClient();
  const { t, locale, formatDate } = useI18n();
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
        .select('id, name, department:departments(name, name_hi), role:employee_roles(name, name_hi)')
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
          const st = existing ? existing.status : 'Present';
          let defaultMult = 1.0;
          if (existing && existing.shift_multiplier !== null && existing.shift_multiplier !== undefined) {
            defaultMult = Number(existing.shift_multiplier);
          } else if (st === 'Half Day') {
            defaultMult = 0.5;
          } else if (st === 'Double Shift') {
            defaultMult = 2.0;
          } else if (st === 'Absent' || st === 'Weekly Off' || st === 'Leave') {
            defaultMult = 0;
          }

          return {
            employee_id: emp.id,
            name: emp.name,
            department_name: getLocalizedMasterName(emp.department, locale),
            role_name: getLocalizedMasterName(emp.role, locale),
            status: st,
            shift_multiplier: defaultMult,
            overtime_hours: existing ? Number(existing.overtime_hours) : 0,
            penalty_amount: existing ? Number(existing.penalty_amount) : 0,
            notes: existing?.notes || '',
          };
        })
      );
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: t('attendance.messages.loadFailed') });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [businessDate, locale]);

  const handleMarkAllPresent = () => {
    setRows(rows.map((r) => ({ ...r, status: 'Present', shift_multiplier: 1.0 })));
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
            shift_multiplier: row.shift_multiplier,
            overtime_hours: row.overtime_hours,
            penalty_amount: row.penalty_amount,
            notes: row.notes,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'employee_id,business_date' }
        );
      }

      setIsReported(true);
      setMessage({ type: 'success', text: t('attendance.messages.savedSuccess', { count: rows.length }) });
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: t('attendance.messages.saveFailed', { error: err.message || '' }) });
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
            {t('attendance.title')}
          </h1>
          <p className="text-sm text-stone-500">
            {t('attendance.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-white border border-stone-200 rounded-lg px-3 py-1.5 shadow-2xs text-xs font-medium">
            <span className="text-stone-500">{t('common.labels.date')}:</span>
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
          <span className="text-stone-500 font-medium">{t('attendance.statusLabel')}</span>
          {isReported ? (
            <Badge variant="success" className="gap-1">
              <CheckCircle className="h-3 w-3" /> {t('attendance.recorded')}
            </Badge>
          ) : (
            <Badge variant="danger" className="gap-1">
              <AlertCircle className="h-3 w-3" /> {t('attendance.notSubmitted')}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={handleMarkAllPresent} className="text-xs gap-1.5">
            <UserCheck className="h-3.5 w-3.5 text-emerald-600" /> {t('attendance.markAllPresent')}
          </Button>
          <Button variant="amber" size="sm" onClick={handleSaveAttendance} disabled={saving} className="text-xs gap-1.5">
            <Save className="h-3.5 w-3.5" /> {saving ? t('attendance.saving') : t('attendance.saveRegister')}
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
          <div className="text-xs text-stone-500 font-medium">{t('attendance.stats.present')}</div>
          <div className="text-2xl font-bold text-emerald-600 mt-1">{presentCount}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-stone-500 font-medium">{t('attendance.stats.absent')}</div>
          <div className="text-2xl font-bold text-rose-600 mt-1">{absentCount}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-stone-500 font-medium">{t('attendance.stats.weeklyOff')}</div>
          <div className="text-2xl font-bold text-stone-600 mt-1">{weeklyOffCount}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-stone-500 font-medium">{t('attendance.stats.leave')}</div>
          <div className="text-2xl font-bold text-amber-600 mt-1">{leaveCount}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-stone-500 font-medium">{t('attendance.stats.overtimeHours')}</div>
          <div className="text-2xl font-bold text-sky-600 mt-1">{totalOvertime}h</div>
        </Card>
      </div>

      {/* Attendance Grid */}
      <Card>
        <CardHeader>
          <CardTitle>{t('attendance.rosterTitle', { count: rows.length })}</CardTitle>
          <CardDescription>{t('attendance.rosterSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {rows.length === 0 ? (
            <div className="py-12 text-center text-stone-400 text-xs">
              {t('attendance.noStaffFound')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-500 font-semibold">
                    <th className="py-2 px-3">{t('attendance.table.staffMember')}</th>
                    <th className="py-2 px-3">{t('attendance.table.deptRole')}</th>
                    <th className="py-2 px-3 text-center">{t('attendance.table.status')}</th>
                    <th className="py-2 px-3 text-center">{t('attendance.table.otHours')}</th>
                    <th className="py-2 px-3 text-center">{t('attendance.table.penalty')}</th>
                    <th className="py-2 px-3">{t('attendance.table.notes')}</th>
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
                          {(
                            [
                              { st: 'Present', label: 'P', key: 'present', mult: 1.0, color: 'bg-emerald-600 text-white' },
                              { st: 'Absent', label: 'A', key: 'absent', mult: 0, color: 'bg-rose-600 text-white' },
                              { st: 'Weekly Off', label: 'WO', key: 'weeklyOff', mult: 0, color: 'bg-stone-700 text-white' },
                              { st: 'Half Day', label: 'HD', key: 'halfDay', mult: 0.5, color: 'bg-amber-600 text-white' },
                              { st: 'Double Shift', label: '2P', key: 'doubleShift', mult: 2.0, color: 'bg-indigo-600 text-white' },
                            ] as const
                          ).map(({ st, label, key, mult, color }) => (
                            <button
                              key={st}
                              type="button"
                              onClick={() => {
                                const next = [...rows];
                                next[idx].status = st as any;
                                next[idx].shift_multiplier = mult;
                                setRows(next);
                              }}
                              className={`px-2 py-1 rounded text-[11px] font-semibold transition-all cursor-pointer ${
                                row.status === st
                                  ? color
                                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                              }`}
                              title={`${t(`attendance.statusOptions.${key}`)} (${mult})`}
                            >
                              {label}
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
                          placeholder={t('attendance.table.remarksPlaceholder')}
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
