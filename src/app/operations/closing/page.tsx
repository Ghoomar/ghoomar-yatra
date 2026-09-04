'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { getTodayBusinessDate, formatINR } from '@/lib/utils';
import { useAppRole } from '@/components/layout/AppShell';
import { Lock, Unlock, CheckCircle, AlertCircle, RefreshCw, ShieldAlert, FileText, CheckCheck, Clock } from 'lucide-react';

interface ChecklistItem {
  key: string;
  label: string;
  isComplete: boolean;
  statusText: string;
  details?: string;
  isRequired: boolean;
}

export default function DailyClosingPage() {
  const supabase = createClient();
  const { role } = useAppRole();
  const [businessDate, setBusinessDate] = useState(getTodayBusinessDate());
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [dayStatus, setDayStatus] = useState<'open' | 'closed' | 'reopened'>('open');
  const [closedAt, setClosedAt] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [showReopenModal, setShowReopenModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Check business_days record
      const { data: bDay } = await supabase
        .from('business_days')
        .select('*')
        .eq('business_date', businessDate)
        .maybeSingle();

      if (bDay) {
        setDayStatus(bDay.status);
        setClosedAt(bDay.closed_at);
      } else {
        setDayStatus('open');
        setClosedAt(null);
      }

      // 2. Query individual operational modules for readiness
      const [
        { data: sales },
        { data: attendance },
        { data: expenses },
        { data: purchases },
        { data: issues },
        { data: activities },
        { data: visitors },
        { data: cars },
        { data: utilities },
      ] = await Promise.all([
        supabase.from('sales_reports').select('id, is_reported, net_sales').eq('business_date', businessDate).maybeSingle(),
        supabase.from('attendance').select('id').eq('business_date', businessDate).limit(1),
        supabase.from('expenses').select('id, amount').eq('business_date', businessDate),
        supabase.from('purchase_headers').select('id, net_amount').eq('business_date', businessDate),
        supabase.from('stock_movements').select('id').eq('business_date', businessDate).limit(1),
        supabase.from('activity_daily_records').select('id, is_reported').eq('business_date', businessDate),
        supabase.from('visitor_counter_events').select('increment').eq('business_date', businessDate),
        supabase.from('vehicle_counter_events').select('increment').eq('business_date', businessDate),
        supabase.from('meter_readings').select('id').eq('business_date', businessDate).limit(1),
      ]);

      const visitorTotal = (visitors || []).reduce((s: number, v: any) => s + (v.increment || 0), 0);
      const vehicleTotal = (cars || []).reduce((s: number, c: any) => s + (c.increment || 0), 0);
      const expenseTotal = (expenses || []).reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
      const purchaseTotal = (purchases || []).reduce((s: number, p: any) => s + Number(p.net_amount || 0), 0);

      const items: ChecklistItem[] = [
        {
          key: 'sales',
          label: 'Petpooja Sales & Collections',
          isComplete: Boolean(sales?.is_reported),
          statusText: sales?.is_reported
            ? `Reported: ${formatINR(Number(sales.net_sales || 0))}`
            : 'NOT REPORTED (Missing Petpooja upload)',
          isRequired: true,
        },
        {
          key: 'attendance',
          label: 'Staff Attendance Register',
          isComplete: Boolean(attendance && attendance.length > 0),
          statusText: attendance && attendance.length > 0 ? 'Muster Roll Submitted' : 'NOT SUBMITTED (Missing muster roll)',
          isRequired: true,
        },
        {
          key: 'visitors',
          label: 'Visitor Footfall Count (Zero PII Gate Counter)',
          isComplete: Boolean(visitors && visitors.length > 0),
          statusText: visitors && visitors.length > 0 ? `${visitorTotal} Visitors Logged` : 'No Counter Events Logged',
          isRequired: true,
        },
        {
          key: 'vehicles',
          label: 'Vehicle Origin Traffic (Zero PII Gate Counter)',
          isComplete: Boolean(cars && cars.length > 0),
          statusText: cars && cars.length > 0 ? `${vehicleTotal} Vehicles Logged` : 'No Vehicles Logged',
          isRequired: true,
        },
        {
          key: 'expenses',
          label: 'Operational Expenses & Petty Cash',
          isComplete: true, // Expenses may legitimately be zero
          statusText: `${expenses?.length || 0} vouchers (${formatINR(expenseTotal)})`,
          isRequired: false,
        },
        {
          key: 'purchases',
          label: 'Inward Purchases & Vendor Invoices',
          isComplete: true,
          statusText: `${purchases?.length || 0} bills recorded (${formatINR(purchaseTotal)})`,
          isRequired: false,
        },
        {
          key: 'inventory_issues',
          label: 'Kitchen Store Issues / Consumption',
          isComplete: Boolean(issues && issues.length > 0),
          statusText: issues && issues.length > 0 ? 'Material issues logged' : 'No store issues logged',
          isRequired: false,
        },
        {
          key: 'activities',
          label: 'Paid Activities Report (Camel, Pottery, etc.)',
          isComplete: Boolean(activities && activities.length > 0),
          statusText: activities && activities.length > 0 ? 'Activity revenue reported' : 'Not submitted',
          isRequired: false,
        },
        {
          key: 'utilities',
          label: 'Electricity, LPG & Diesel Meter Readings',
          isComplete: Boolean(utilities && utilities.length > 0),
          statusText: utilities && utilities.length > 0 ? 'Meter readings logged' : 'No readings entered',
          isRequired: false,
        },
      ];

      setChecklist(items);
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: 'Failed to verify closing status.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [businessDate]);

  const completedCount = checklist.filter((i) => i.isComplete).length;
  const completionPercent = checklist.length > 0 ? Math.round((completedCount / checklist.length) * 100) : 0;
  const requiredIncomplete = checklist.filter((i) => i.isRequired && !i.isComplete);

  const handleCloseDay = async () => {
    if (requiredIncomplete.length > 0) {
      alert(`Cannot close day: Missing required entries:\n- ${requiredIncomplete.map((i) => i.label).join('\n- ')}`);
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from('business_days').upsert(
        {
          business_date: businessDate,
          status: 'closed',
          closed_at: new Date().toISOString(),
          checklist_state: checklist,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'business_date' }
      );

      if (error) throw error;

      setDayStatus('closed');
      setClosedAt(new Date().toISOString());
      setMessage({ type: 'success', text: `Business Day ${businessDate} is officially CLOSED and locked.` });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Error closing day.' });
    } finally {
      setSaving(false);
    }
  };

  const handleReopenDay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reopenReason) return;
    setSaving(true);

    try {
      const { error } = await supabase
        .from('business_days')
        .update({
          status: 'reopened',
          reopened_at: new Date().toISOString(),
          reopen_reason: reopenReason,
          updated_at: new Date().toISOString(),
        })
        .eq('business_date', businessDate);

      if (error) throw error;

      setDayStatus('reopened');
      setShowReopenModal(false);
      setReopenReason('');
      setMessage({ type: 'success', text: `Business Day ${businessDate} reopened for administrative correction.` });
      loadData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Error reopening day.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <Lock className="h-6 w-6 text-amber-600" />
            Midnight Daily Closing Console
          </h1>
          <p className="text-sm text-stone-500">
            Final reconciliation, missing vs reported validation, and authoritative financial lock for 12:00 AM – 11:59 PM.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-white border border-stone-200 rounded-lg px-3 py-1.5 shadow-xs text-xs font-medium">
            <span className="text-stone-500">Date:</span>
            <input
              type="date"
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
              className="bg-transparent font-semibold text-stone-900 focus:outline-none cursor-pointer"
            />
          </div>
          <Button variant="outline" size="sm" onClick={loadData}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {message && (
        <div
          className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 ${
            message.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {message.type === 'success' ? <CheckCircle className="h-4 w-4 text-emerald-600" /> : <AlertCircle className="h-4 w-4 text-red-600" />}
          {message.text}
        </div>
      )}

      {/* Closing Status Card */}
      <Card className="border-2 border-stone-200">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold text-stone-400 uppercase tracking-wider">Business Day Status (12:00 AM – 11:59 PM)</div>
              <div className="text-2xl font-black text-stone-900 mt-1 flex items-center gap-2">
                {dayStatus === 'closed' ? (
                  <>
                    <Lock className="h-6 w-6 text-stone-700" />
                    <span className="text-stone-800">CLOSED & LOCKED</span>
                  </>
                ) : dayStatus === 'reopened' ? (
                  <>
                    <Unlock className="h-6 w-6 text-amber-600" />
                    <span className="text-amber-700">REOPENED (Admin Edit Active)</span>
                  </>
                ) : (
                  <>
                    <Unlock className="h-6 w-6 text-emerald-600" />
                    <span className="text-emerald-700">OPEN FOR DATA ENTRY</span>
                  </>
                )}
              </div>
              <div className="text-xs text-stone-500 mt-1 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-stone-400" />
                {closedAt ? `Closed at ${new Date(closedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : 'Operational data entry in progress'}
              </div>
            </div>

            <div className="text-right">
              <div className="text-xs font-semibold text-stone-500">Closing Completeness</div>
              <div className="text-3xl font-black text-stone-900 mt-0.5">{completionPercent}%</div>
              <div className="text-[11px] text-stone-400">{completedCount} / {checklist.length} modules verified</div>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-stone-100 rounded-full h-2.5 mt-4 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${completionPercent === 100 ? 'bg-emerald-600' : 'bg-amber-500'}`}
              style={{ width: `${completionPercent}%` }}
            />
          </div>

          {/* Action Buttons */}
          <div className="mt-6 pt-4 border-t border-stone-100 flex items-center justify-between">
            {dayStatus === 'closed' ? (
              <div className="flex items-center gap-2">
                <Badge variant="success">Financial records locked</Badge>
                {role === 'Admin' && (
                  <Button variant="outline" size="sm" onClick={() => setShowReopenModal(true)} className="gap-1 text-xs">
                    <Unlock className="h-3.5 w-3.5 text-amber-600" /> Reopen Business Day (Admin)
                  </Button>
                )}
              </div>
            ) : (
              <Button
                variant="primary"
                size="lg"
                onClick={handleCloseDay}
                disabled={saving || requiredIncomplete.length > 0}
                className="gap-2 bg-amber-600 hover:bg-amber-700 text-white"
              >
                <Lock className="h-4 w-4" /> {saving ? 'Closing...' : 'Close Business Day & Lock Records'}
              </Button>
            )}

            {requiredIncomplete.length > 0 && (
              <span className="text-xs font-medium text-rose-600 flex items-center gap-1">
                <AlertCircle className="h-3.5 w-3.5" /> {requiredIncomplete.length} mandatory checks incomplete
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Detailed Checklist Table */}
      <Card>
        <CardHeader>
          <CardTitle>Midnight Closing Checklist</CardTitle>
          <CardDescription>Explicit distinction between Reported ₹0 vs Missing unsubmitted reports</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="divide-y divide-stone-100">
            {checklist.map((item) => (
              <div key={item.key} className="py-3.5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  {item.isComplete ? (
                    <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                      <CheckCircle className="h-4 w-4" />
                    </div>
                  ) : item.isRequired ? (
                    <div className="w-7 h-7 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                      <AlertCircle className="h-4 w-4" />
                    </div>
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-stone-100 text-stone-500 flex items-center justify-center shrink-0">
                      <FileText className="h-4 w-4" />
                    </div>
                  )}

                  <div>
                    <div className="font-bold text-stone-900 text-xs sm:text-sm flex items-center gap-1.5">
                      {item.label}
                      {item.isRequired && (
                        <span className="text-[10px] bg-rose-50 text-rose-700 border border-rose-200 px-1.5 py-0.5 rounded font-semibold">
                          Required
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-stone-500 mt-0.5">{item.statusText}</div>
                  </div>
                </div>

                <div>
                  <Badge variant={item.isComplete ? 'success' : item.isRequired ? 'danger' : 'outline'}>
                    {item.isComplete ? 'Verified' : item.isRequired ? 'Missing' : 'Optional'}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Admin Reopen Modal */}
      {showReopenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl text-xs">
            <div className="flex items-center justify-between border-b pb-3">
              <h2 className="text-base font-bold text-stone-900 flex items-center gap-1.5">
                <ShieldAlert className="h-4 w-4 text-amber-600" /> Reopen Closed Business Day
              </h2>
              <button onClick={() => setShowReopenModal(false)} className="text-stone-400 hover:text-stone-700 text-lg">✕</button>
            </div>

            <form onSubmit={handleReopenDay} className="space-y-3">
              <p className="text-stone-600">
                Reopening a closed day is an auditable action. Normal users cannot alter posted data. Please provide the operational justification for reopening:
              </p>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Reason for Reopening</label>
                <textarea
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  placeholder="e.g. Petpooja sales missing late midnight settlement voucher"
                  required
                  rows={3}
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button type="button" variant="outline" onClick={() => setShowReopenModal(false)}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={saving} className="bg-amber-600 hover:bg-amber-700 text-white">
                  {saving ? 'Reopening...' : 'Confirm Reopen'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

