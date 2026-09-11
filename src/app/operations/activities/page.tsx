'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR, getTodayBusinessDate } from '@/lib/utils';
import { Sparkles, Save, RefreshCw, CheckCircle, AlertCircle, Settings2 } from 'lucide-react';
import { ActivityMasterModal } from '@/components/activities/ActivityMasterModal';
import { logAuditAction } from '@/lib/audit-logger';

interface ActivityRecord {
  activity_id: string;
  name: string;
  default_price: number;
  is_reported: boolean;
  units_sold: number;
  revenue: number;
  notes: string;
}

export default function ActivitiesPage() {
  const supabase = createClient();
  const [businessDate, setBusinessDate] = useState(getTodayBusinessDate());
  const [records, setRecords] = useState<ActivityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showMasterModal, setShowMasterModal] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const { data: acts } = await supabase.from('activities').select('*').order('name');
      const { data: recs } = await supabase
        .from('activity_daily_records')
        .select('*')
        .eq('business_date', businessDate);

      const relevantActivities = (acts || []).filter(
        (a) => a.is_active !== false || (recs || []).some((r) => r.activity_id === a.id)
      );

      setRecords(
        relevantActivities.map((a) => {
          const found = (recs || []).find((r) => r.activity_id === a.id);
          return {
            activity_id: a.id,
            name: a.name + (a.is_active === false ? ' (Archived)' : ''),
            default_price: Number(a.default_price) || 50,
            is_reported: found ? found.is_reported : false,
            units_sold: found ? Number(found.units_sold) : 0,
            revenue: found ? Number(found.revenue) : 0,
            notes: found?.notes || '',
          };
        })
      );
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: 'Failed to load activities.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [businessDate]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      for (const r of records) {
        await supabase.from('activity_daily_records').upsert(
          {
            business_date: businessDate,
            activity_id: r.activity_id,
            is_reported: true,
            units_sold: r.units_sold,
            revenue: r.revenue,
            notes: r.notes,
          },
          { onConflict: 'business_date,activity_id' }
        );
      }

      await logAuditAction({
        action: 'UPDATE',
        entityType: 'activity_daily_records',
        entityId: businessDate,
        newValues: {
          business_date: businessDate,
          total_revenue: records.reduce((s, r) => s + (r.revenue || 0), 0),
          units_sold: records.reduce((s, r) => s + (r.units_sold || 0), 0),
        },
      });

      setMessage({ type: 'success', text: 'Activity performance recorded successfully.' });
      loadData();
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: err.message || 'Error saving activity records.' });
    } finally {
      setSaving(false);
    }
  };

  const totalActivityRevenue = records.reduce((s, r) => s + (r.revenue || 0), 0);
  const totalRidesSold = records.reduce((s, r) => s + (r.units_sold || 0), 0);
  const allReported = records.length > 0 && records.every((r) => r.is_reported);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-amber-600" />
            Paid Activities & Experiences
          </h1>
          <p className="text-sm text-stone-500">
            Camel rides, Mehendi, Jyotish, and Magic shows. Configurable pricing and daily unit tracking.
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowMasterModal(true)}
            className="gap-1.5 text-stone-700 hover:text-stone-900"
          >
            <Settings2 className="h-4 w-4 text-amber-600" />
            <span>Manage Activities</span>
          </Button>
          <Button variant="outline" size="sm" onClick={loadData} title="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-white border border-stone-200/80 rounded-xl text-xs shadow-2xs">
        <div className="flex items-center gap-2">
          <span className="text-stone-500 font-medium">Reporting Status:</span>
          {allReported ? (
            <Badge variant="success" className="gap-1">
              <CheckCircle className="h-3 w-3" /> REPORTED FOR {businessDate}
            </Badge>
          ) : (
            <Badge variant="danger" className="gap-1">
              <AlertCircle className="h-3 w-3" /> NOT REPORTED
            </Badge>
          )}
        </div>
        <div className="text-stone-500 text-[11px]">
          <strong>Distinction:</strong> Reported ₹0 is treated as zero revenue; unsubmitted is flagged as missing.
        </div>
      </div>

      {message && (
        <div className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 ${message.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
          {message.type === 'success' ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {message.text}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardDescription>Total Activities Revenue Today</CardDescription>
          <div className="text-2xl font-bold text-amber-600 mt-1">
            {formatINR(totalActivityRevenue)}
          </div>
          <div className="text-[11px] text-stone-500 mt-1">Contributes to total daily revenue</div>
        </Card>

        <Card>
          <CardDescription>Total Units / Tickets Sold</CardDescription>
          <div className="text-2xl font-bold text-stone-900 mt-1">{totalRidesSold} Tickets</div>
          <div className="text-[11px] text-stone-500 mt-1">Guest participation volume</div>
        </Card>

        <Card>
          <CardDescription>Configurable Activities</CardDescription>
          <div className="text-2xl font-bold text-stone-900 mt-1">{records.length} Active</div>
          <div className="text-[11px] text-stone-500 mt-1">Managed via master data</div>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daily Activity Sales Register</CardTitle>
          <CardDescription>Enter units sold and total revenue for each activity</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <form onSubmit={handleSave} className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-500 font-semibold">
                    <th className="py-2.5 px-3">Activity Name</th>
                    <th className="py-2.5 px-3 text-center">Default Price</th>
                    <th className="py-2.5 px-3 text-center">Tickets Sold (Units)</th>
                    <th className="py-2.5 px-3 text-right">Total Revenue (₹)</th>
                    <th className="py-2.5 px-3">Notes / Operational Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {records.map((r, idx) => (
                    <tr key={r.activity_id} className="hover:bg-stone-50/80">
                      <td className="py-3 px-3 font-semibold text-stone-900">{r.name}</td>
                      <td className="py-3 px-3 text-center font-medium text-stone-700">
                        {formatINR(r.default_price)}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <input
                          type="number"
                          value={r.units_sold || ''}
                          onChange={(e) => {
                            const val = parseInt(e.target.value) || 0;
                            const next = [...records];
                            next[idx].units_sold = val;
                            next[idx].revenue = val * r.default_price;
                            setRecords(next);
                          }}
                          placeholder="0"
                          className="w-24 rounded border border-stone-300 p-1.5 text-center font-semibold text-stone-900 focus:outline-none focus:border-amber-500"
                        />
                      </td>
                      <td className="py-3 px-3 text-right">
                        <input
                          type="number"
                          step="0.01"
                          value={r.revenue || ''}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            const next = [...records];
                            next[idx].revenue = val;
                            setRecords(next);
                          }}
                          placeholder="0.00"
                          className="w-32 rounded border border-stone-300 p-1.5 text-right font-bold text-amber-700 focus:outline-none focus:border-amber-500"
                        />
                      </td>
                      <td className="py-3 px-3">
                        <input
                          type="text"
                          value={r.notes}
                          onChange={(e) => {
                            const next = [...records];
                            next[idx].notes = e.target.value;
                            setRecords(next);
                          }}
                          placeholder="e.g. Weather good, 4 camels active"
                          className="w-full rounded border border-stone-300 p-1.5 focus:outline-none focus:border-amber-500"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-stone-200">
              <div className="font-bold text-stone-800 text-sm">
                Total Activities Revenue: <span className="text-amber-700 text-base">{formatINR(totalActivityRevenue)}</span>
              </div>
              <Button type="submit" variant="amber" disabled={saving} className="gap-1.5">
                <Save className="h-4 w-4" /> {saving ? 'Saving...' : 'Save Activity Report'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <ActivityMasterModal
        isOpen={showMasterModal}
        onClose={() => setShowMasterModal(false)}
        onUpdated={loadData}
      />
    </div>
  );
}
