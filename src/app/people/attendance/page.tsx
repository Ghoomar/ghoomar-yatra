'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  X,
  History,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Search,
  Fingerprint,
  Info,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import { getTodayBusinessDate } from '@/lib/utils';
import { useI18n } from '@/lib/i18n/context';
import { getLocalizedMasterName } from '@/lib/i18n/master-data';
import { AttendanceImportBatch } from '@/lib/types/database';

interface AttendanceReviewRow {
  employee_id: string;
  petpooja_emp_id?: number | null;
  employee_code?: string | null;
  name: string;
  department?: any;
  role?: any;
  status: 'FD' | 'HD' | 'Absent' | 'Present' | 'Half Day' | 'Weekly Off' | 'Leave';
  shift_multiplier: number;
  punch_in: string | null;
  punch_out: string | null;
  working_hours: string | null;
  break_hours: string | null;
  overtime_hours: number;
  source: string;
  notes: string | null;
}

export default function BiometricAttendancePage() {
  const { t, locale, formatDate } = useI18n();
  const [businessDate, setBusinessDate] = useState<string>(() => getTodayBusinessDate());

  // Data states
  const [rows, setRows] = useState<AttendanceReviewRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isReported, setIsReported] = useState<boolean>(false);
  const [currentBatch, setCurrentBatch] = useState<AttendanceImportBatch | null>(null);
  const [stats, setStats] = useState({
    totalEmployees: 0,
    reportedCount: 0,
    fdCount: 0,
    hdCount: 0,
    absentCount: 0,
    totalMultiplier: 0,
  });

  // UI / Filter states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'FD' | 'HD' | 'Absent'>('ALL');
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [historyBatches, setHistoryBatches] = useState<AttendanceImportBatch[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);

  // Upload states
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Modals
  const [duplicateModal, setDuplicateModal] = useState<{
    isOpen: boolean;
    message: string;
    existingBatch?: any;
  }>({ isOpen: false, message: '' });

  const [unmappedModal, setUnmappedModal] = useState<{
    isOpen: boolean;
    unmapped: any[];
    message: string;
  }>({ isOpen: false, unmapped: [], message: '' });

  // 1. Fetch attendance review data for selected date
  const loadDailyAttendance = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/people/attendance?business_date=${businessDate}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load attendance.');

      setRows(data.rows || []);
      setIsReported(Boolean(data.isReported));
      setCurrentBatch(data.batch || null);
      if (data.stats) {
        setStats(data.stats);
      }
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: t('attendance.messages.loadFailed') });
    } finally {
      setLoading(false);
    }
  };

  // 2. Fetch import history batches
  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch('/api/people/attendance/import?limit=50');
      const data = await res.json();
      if (res.ok) {
        setHistoryBatches(data.batches || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadDailyAttendance();
  }, [businessDate]);

  useEffect(() => {
    if (showHistory) {
      loadHistory();
    }
  }, [showHistory]);

  // Date navigation helpers
  const handlePrevDay = () => {
    const d = new Date(businessDate);
    d.setDate(d.getDate() - 1);
    setBusinessDate(d.toISOString().substring(0, 10));
  };

  const handleNextDay = () => {
    const d = new Date(businessDate);
    d.setDate(d.getDate() + 1);
    setBusinessDate(d.toISOString().substring(0, 10));
  };

  // Drag & drop handlers
  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  // Upload execution
  const executeUpload = async (fileToUpload: File, overwrite: boolean = false) => {
    setUploading(true);
    setMessage(null);

    const formData = new FormData();
    formData.append('file', fileToUpload);
    if (overwrite) {
      formData.append('overwrite', 'true');
    }

    try {
      const res = await fetch('/api/people/attendance/import', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (res.status === 409 && data.isDuplicate) {
        setDuplicateModal({
          isOpen: true,
          message: data.message,
          existingBatch: data.existingBatch,
        });
        return;
      }

      if (res.status === 422 && data.error === 'UNMAPPED_EMPLOYEES') {
        setUnmappedModal({
          isOpen: true,
          unmapped: data.unmapped || [],
          message: data.message,
        });
        return;
      }

      if (!res.ok) {
        throw new Error(data.error || data.message || 'Import failed.');
      }

      // Success
      setMessage({
        type: 'success',
        text: t('attendance.messages.importSuccess', { date: data.businessDate, count: data.mappedCount }),
      });

      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setDuplicateModal({ isOpen: false, message: '' });

      // Automatically jump to imported business date
      if (data.businessDate) {
        setBusinessDate(data.businessDate);
      } else {
        loadDailyAttendance();
      }

      if (showHistory) {
        loadHistory();
      }
    } catch (err: any) {
      console.error(err);
      setMessage({
        type: 'error',
        text: t('attendance.messages.importFailed', { error: err.message }),
      });
    } finally {
      setUploading(false);
    }
  };

  // Filtered rows for daily review
  const filteredRows = rows.filter((r) => {
    const matchesSearch =
      r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.employee_code && r.employee_code.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (r.department && (r.department.name || '').toLowerCase().includes(searchQuery.toLowerCase())) ||
      (r.petpooja_emp_id && String(r.petpooja_emp_id).includes(searchQuery));

    if (statusFilter === 'ALL') return matchesSearch;
    if (statusFilter === 'FD') return matchesSearch && (r.status === 'FD' || r.status === 'Present');
    if (statusFilter === 'HD') return matchesSearch && (r.status === 'HD' || r.status === 'Half Day');
    if (statusFilter === 'Absent') return matchesSearch && (r.status === 'Absent' || r.status === 'Weekly Off' || r.status === 'Leave');
    return matchesSearch;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-stone-200 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-stone-900">
              {t('attendance.title')}
            </h1>
            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-medium text-xs flex items-center gap-1">
              <Fingerprint className="h-3 w-3" />
              {t('attendance.biometric.sourceBadge')}
            </Badge>
          </div>
          <p className="text-sm text-stone-500 mt-1 flex items-center gap-1.5">
            <Info className="h-4 w-4 text-amber-600 shrink-0" />
            <span>{t('attendance.biometric.sourceNotice')}</span>
          </p>
        </div>

        {/* Date Selector & History Button */}
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-1.5 text-xs text-stone-700 border-stone-300"
          >
            <History className="h-3.5 w-3.5 text-stone-500" />
            {showHistory ? t('attendance.import.hideHistory') : t('attendance.import.viewHistory')}
          </Button>

          <div className="flex items-center bg-white border border-stone-300 rounded-lg p-0.5 shadow-2xs">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrevDay}
              className="h-8 w-8 p-0 border-0 hover:bg-stone-100"
              title="Previous Day"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            <input
              type="date"
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
              className="px-2 text-xs font-semibold text-stone-900 bg-transparent border-0 focus:outline-none cursor-pointer"
            />

            <Button
              variant="outline"
              size="sm"
              onClick={handleNextDay}
              className="h-8 w-8 p-0 border-0 hover:bg-stone-100"
              title="Next Day"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setBusinessDate(getTodayBusinessDate())}
            className="text-xs"
          >
            Today
          </Button>
        </div>
      </div>

      {/* Message Banner */}
      {message && (
        <div
          className={`flex items-center justify-between p-3.5 rounded-xl border text-xs font-medium ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : message.type === 'warning'
              ? 'bg-amber-50 text-amber-800 border-amber-200'
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {message.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            ) : message.type === 'warning' ? (
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
            )}
            <span>{message.text}</span>
          </div>
          <button
            onClick={() => setMessage(null)}
            className="p-1 hover:bg-black/5 rounded-md text-stone-500"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* SECTION 1: Petpooja Biometric File Import */}
      <Card className="border-stone-200 shadow-xs">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UploadCloud className="h-5 w-5 text-amber-600" />
              <div>
                <CardTitle className="text-base text-stone-900">
                  {t('attendance.import.title')}
                </CardTitle>
                <CardDescription className="text-xs text-stone-500">
                  {t('attendance.import.subtitle')}
                </CardDescription>
              </div>
            </div>
            <span className="text-[11px] font-mono font-medium text-stone-500 bg-stone-100 px-2 py-0.5 rounded border border-stone-200">
              .xlsx, .xls, .csv
            </span>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleFileDrop}
            className={`border-2 border-dashed rounded-xl p-6 text-center transition-all ${
              file
                ? 'border-amber-400 bg-amber-50/30'
                : 'border-stone-300 hover:border-amber-400 bg-stone-50/50 hover:bg-stone-50'
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".xlsx,.xls,.csv"
              className="hidden"
              id="attendance-file-input"
            />

            {!file ? (
              <label
                htmlFor="attendance-file-input"
                className="cursor-pointer flex flex-col items-center justify-center gap-2"
              >
                <div className="h-10 w-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
                  <FileSpreadsheet className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-stone-800">
                    {t('attendance.import.dropzoneText')}
                  </p>
                  <p className="text-[11px] text-stone-400 mt-0.5">
                    {t('attendance.import.dropzoneHint')}
                  </p>
                </div>
              </label>
            ) : (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
                    <FileSpreadsheet className="h-5 w-5" />
                  </div>
                  <div className="text-left">
                    <p className="text-xs font-bold text-stone-900 truncate max-w-xs sm:max-w-md">
                      {file.name}
                    </p>
                    <p className="text-[11px] text-stone-400 font-mono">
                      {(file.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    disabled={uploading}
                    className="text-xs"
                  >
                    {t('attendance.import.cancel')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => executeUpload(file, false)}
                    disabled={uploading}
                    className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium flex items-center gap-1.5"
                  >
                    {uploading ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        {t('attendance.import.uploading')}
                      </>
                    ) : (
                      <>
                        <UploadCloud className="h-3.5 w-3.5" />
                        {t('attendance.import.uploadButton')}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* SECTION 2: Import History Section (Collapsible) */}
      {showHistory && (
        <Card className="border-stone-200 shadow-xs">
          <CardHeader className="pb-3 border-b border-stone-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-stone-600" />
                <CardTitle className="text-sm font-bold text-stone-900">
                  {t('attendance.import.history.title')}
                </CardTitle>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={loadHistory}
                disabled={loadingHistory}
                className="h-7 text-[11px]"
              >
                <RefreshCw className={`h-3 w-3 mr-1 ${loadingHistory ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-3">
            {loadingHistory ? (
              <div className="py-8 text-center text-xs text-stone-400">Loading history...</div>
            ) : historyBatches.length === 0 ? (
              <div className="py-8 text-center text-xs text-stone-400">
                No attendance imports found.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                      <th className="py-2 px-3">{t('attendance.import.history.date')}</th>
                      <th className="py-2 px-3">{t('attendance.import.history.fileName')}</th>
                      <th className="py-2 px-3 text-center">{t('attendance.import.history.records')}</th>
                      <th className="py-2 px-3 text-center">{t('attendance.import.history.breakdown')}</th>
                      <th className="py-2 px-3">{t('attendance.import.history.importedAt')}</th>
                      <th className="py-2 px-3 font-mono">{t('attendance.import.history.checksum')}</th>
                      <th className="py-2 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {historyBatches.map((b) => (
                      <tr key={b.id} className="hover:bg-stone-50/80">
                        <td className="py-2 px-3 font-bold text-stone-900">
                          {b.business_date ? String(b.business_date).substring(0, 10) : '—'}
                        </td>
                        <td className="py-2 px-3 text-stone-700">{b.file_name}</td>
                        <td className="py-2 px-3 text-center font-semibold text-stone-800">{b.record_count}</td>
                        <td className="py-2 px-3 text-center">
                          <span className="text-emerald-700 font-semibold">{b.fd_count} FD</span>
                          {' / '}
                          <span className="text-amber-700 font-semibold">{b.hd_count} HD</span>
                          {' / '}
                          <span className="text-rose-700 font-semibold">{b.absent_count} Abs</span>
                        </td>
                        <td className="py-2 px-3 text-stone-500 text-[11px]">
                          {new Date(b.created_at).toLocaleString()}
                        </td>
                        <td className="py-2 px-3 font-mono text-[10px] text-stone-400">
                          {b.file_checksum.substring(0, 12)}...
                        </td>
                        <td className="py-2 px-3 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const dStr = b.business_date ? String(b.business_date).substring(0, 10) : '';
                              if (dStr) setBusinessDate(dStr);
                            }}
                            className="h-6 px-2 text-[10px]"
                          >
                            View Day
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* SECTION 3: Read-Only Biometric Attendance Review */}
      <Card className="border-stone-200 shadow-xs">
        <CardHeader className="pb-3 border-b border-stone-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-bold text-stone-900">
                  Attendance Review: {businessDate}
                </CardTitle>
                {currentBatch ? (
                  <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[11px] font-semibold flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3" />
                    Biometric Verified ({currentBatch.file_name})
                  </Badge>
                ) : (
                  <Badge className="bg-stone-100 text-stone-500 border-stone-200 text-[11px] font-normal">
                    {t('attendance.biometric.unrecorded')}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-stone-500 mt-1">
                {t('attendance.biometric.readOnlyBanner')}
              </p>
            </div>

            {/* Status filters & search */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 bg-stone-100 p-0.5 rounded-lg border border-stone-200">
                {(['ALL', 'FD', 'HD', 'Absent'] as const).map((st) => (
                  <button
                    key={st}
                    onClick={() => setStatusFilter(st)}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer ${
                      statusFilter === st
                        ? 'bg-white text-stone-900 shadow-xs'
                        : 'text-stone-500 hover:text-stone-800'
                    }`}
                  >
                    {st === 'ALL' ? 'All Staff' : st === 'FD' ? 'FD (1.0)' : st === 'HD' ? 'HD (0.5)' : 'Absent (0)'}
                  </button>
                ))}
              </div>

              <div className="relative">
                <Search className="h-3.5 w-3.5 text-stone-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder={t('attendance.messages.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="rounded-lg border border-stone-300 pl-8 pr-3 py-1.5 text-xs text-stone-900 focus:outline-none focus:border-amber-500 w-44 sm:w-56"
                />
              </div>
            </div>
          </div>
        </CardHeader>

        {/* Daily KPI Badges */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 p-4 bg-stone-50/50 border-b border-stone-100">
          <div className="bg-white p-3 rounded-xl border border-stone-200 shadow-2xs">
            <span className="text-[11px] font-medium text-stone-500 block">{t('attendance.stats.totalStaff')}</span>
            <span className="text-lg font-bold text-stone-900">{stats.totalEmployees}</span>
          </div>
          <div className="bg-white p-3 rounded-xl border border-emerald-200 shadow-2xs">
            <span className="text-[11px] font-medium text-emerald-700 block">{t('attendance.stats.fullDay')}</span>
            <span className="text-lg font-bold text-emerald-800">{stats.fdCount}</span>
          </div>
          <div className="bg-white p-3 rounded-xl border border-amber-200 shadow-2xs">
            <span className="text-[11px] font-medium text-amber-700 block">{t('attendance.stats.halfDay')}</span>
            <span className="text-lg font-bold text-amber-800">{stats.hdCount}</span>
          </div>
          <div className="bg-white p-3 rounded-xl border border-rose-200 shadow-2xs">
            <span className="text-[11px] font-medium text-rose-700 block">{t('attendance.stats.absent')}</span>
            <span className="text-lg font-bold text-rose-800">{stats.absentCount}</span>
          </div>
          <div className="bg-white p-3 rounded-xl border border-purple-200 shadow-2xs col-span-2 sm:col-span-1">
            <span className="text-[11px] font-medium text-purple-700 block">{t('attendance.stats.totalDays')}</span>
            <span className="text-lg font-bold text-purple-900 font-mono">{stats.totalMultiplier}</span>
          </div>
        </div>

        <CardContent className="pt-0">
          {loading ? (
            <div className="py-16 text-center text-xs text-stone-400 flex items-center justify-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin text-amber-600" />
              Loading daily attendance...
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="py-16 text-center text-xs text-stone-400">
              {t('attendance.messages.notReported', { date: businessDate })}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                    <th className="py-2.5 px-3">{t('attendance.table.petpoojaId')}</th>
                    <th className="py-2.5 px-3">{t('attendance.table.staffMember')}</th>
                    <th className="py-2.5 px-3">{t('attendance.table.deptRole')}</th>
                    <th className="py-2.5 px-3 text-center">{t('attendance.table.status')}</th>
                    <th className="py-2.5 px-3 text-center">{t('attendance.table.punchIn')}</th>
                    <th className="py-2.5 px-3 text-center">{t('attendance.table.punchOut')}</th>
                    <th className="py-2.5 px-3 text-center">{t('attendance.table.workingHours')}</th>
                    <th className="py-2.5 px-3 text-center">{t('attendance.table.breakHours')}</th>
                    <th className="py-2.5 px-3 text-center">{t('attendance.table.attendance')}</th>
                    <th className="py-2.5 px-3 text-right">{t('attendance.table.source')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {filteredRows.map((r) => {
                    const isFD = r.status === 'FD' || r.status === 'Present';
                    const isHD = r.status === 'HD' || r.status === 'Half Day';
                    const isAbsent = !isFD && !isHD;

                    return (
                      <tr key={r.employee_id} className="hover:bg-stone-50/80 transition-colors">
                        <td className="py-2.5 px-3 font-mono font-bold text-stone-700">
                          {r.petpooja_emp_id ? `#${r.petpooja_emp_id}` : '—'}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-stone-900">
                          <div>{r.name}</div>
                          {r.employee_code && (
                            <span className="text-[10px] text-stone-400 font-mono font-normal">
                              {r.employee_code}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-stone-600">
                          <div>{getLocalizedMasterName(r.department, locale) || 'General'}</div>
                          <span className="text-[11px] text-stone-400">
                            {getLocalizedMasterName(r.role, locale) || 'Staff'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {isFD ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                              FD
                            </span>
                          ) : isHD ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                              HD
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                              Absent
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono text-stone-700 text-[11px]">
                          {r.punch_in || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono text-stone-700 text-[11px]">
                          {r.punch_out || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono font-medium text-stone-800 text-[11px]">
                          {r.working_hours || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono text-stone-500 text-[11px]">
                          {r.break_hours || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono font-bold text-stone-900 text-xs">
                          {r.shift_multiplier.toFixed(1)}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <span className="text-[10px] font-medium text-stone-500 bg-stone-100 px-2 py-0.5 rounded border border-stone-200 whitespace-nowrap">
                            {r.source === 'petpooja_biometric' ? 'Petpooja Biometric' : 'Legacy / Manual'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* MODAL 1: Overwrite Confirmation for Duplicate Import */}
      {duplicateModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-stone-200 overflow-hidden">
            <div className="flex items-center justify-between border-b border-stone-100 px-6 py-4 bg-amber-50">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                <h3 className="text-base font-bold text-amber-950">
                  {t('attendance.import.overwriteTitle')}
                </h3>
              </div>
              <button
                onClick={() => setDuplicateModal({ isOpen: false, message: '' })}
                className="p-1 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-xs text-stone-600 leading-relaxed">
                {duplicateModal.message}
              </p>
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-stone-100">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDuplicateModal({ isOpen: false, message: '' })}
                  disabled={uploading}
                >
                  {t('attendance.import.cancel')}
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    if (file) executeUpload(file, true);
                  }}
                  disabled={uploading}
                  className="bg-amber-600 hover:bg-amber-700 text-white font-medium"
                >
                  {uploading ? t('attendance.import.uploading') : t('attendance.import.overwriteConfirm')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Unmapped Employees Block Modal */}
      {unmappedModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-rose-200 overflow-hidden">
            <div className="flex items-center justify-between border-b border-stone-100 px-6 py-4 bg-rose-50">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-rose-600" />
                <h3 className="text-base font-bold text-rose-950">
                  {t('attendance.import.unmappedTitle')}
                </h3>
              </div>
              <button
                onClick={() => setUnmappedModal({ isOpen: false, unmapped: [], message: '' })}
                className="p-1 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-xs text-stone-700 leading-relaxed">
                {t('attendance.import.unmappedDesc')}
              </p>

              <div className="max-h-60 overflow-y-auto border border-stone-200 rounded-lg">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-stone-100 text-stone-600 font-semibold border-b border-stone-200">
                      <th className="py-2 px-3">Petpooja ID</th>
                      <th className="py-2 px-3">Name in File</th>
                      <th className="py-2 px-3">Dept / Desig</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {unmappedModal.unmapped.map((u, i) => (
                      <tr key={i} className="hover:bg-rose-50/50">
                        <td className="py-2 px-3 font-mono font-bold text-rose-700">#{u.petpoojaEmpId}</td>
                        <td className="py-2 px-3 font-medium text-stone-900">{u.employeeName}</td>
                        <td className="py-2 px-3 text-stone-500">
                          {u.department} • {u.designation}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-end pt-3 border-t border-stone-100">
                <Button
                  size="sm"
                  onClick={() => setUnmappedModal({ isOpen: false, unmapped: [], message: '' })}
                  className="bg-stone-800 hover:bg-stone-900 text-white"
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
