'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { createClient } from '@/lib/supabase/client';
import { formatINR, getTodayBusinessDate } from '@/lib/utils';
import { Sparkles, RefreshCw, CheckCircle, AlertCircle, HeartHandshake } from 'lucide-react';

export default function TipsPage() {
  const supabase = createClient();
  const [businessDate, setBusinessDate] = useState(getTodayBusinessDate());
  const [tips, setTips] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form
  const [employeeId, setEmployeeId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [source, setSource] = useState('Dining Guest Tip');
  const [notes, setNotes] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const { data: tipData } = await supabase
        .from('tips')
        .select('*, employee:employees(name), department:departments(name)')
        .eq('business_date', businessDate)
        .order('created_at', { ascending: false });

      const { data: empData } = await supabase.from('employees').select('id, name').order('name');
      const { data: deptData } = await supabase.from('departments').select('id, name').order('name');

      setTips(tipData || []);
      setEmployees(empData || []);
      setDepartments(deptData || []);
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: 'Failed to load tips.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [businessDate]);

  const handleAddTip = async (e: React.FormEvent) => {
    e.preventDefault();
    if (amount <= 0) {
      alert('Please enter a valid tip amount.');
      return;
    }
    setSaving(true);
    setMessage(null);

    try {
      const { error } = await supabase.from('tips').insert({
        business_date: businessDate,
        employee_id: employeeId || null,
        department_id: departmentId || null,
        amount,
        source,
        notes,
      });

      if (error) throw error;

      setMessage({ type: 'success', text: `Tip of ${formatINR(amount)} logged.` });
      setAmount(0);
      setNotes('');
      loadData();
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: err.message || 'Failed to record tip.' });
    } finally {
      setSaving(false);
    }
  };

  const totalDayTips = tips.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-amber-600" />
            Staff Tips Tracker
          </h1>
          <p className="text-sm text-stone-500">
            Guest gratuities and pool distribution tracking. Tips belong to staff and are never treated as company revenue.
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
          <Button variant="outline" size="sm" onClick={loadData}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Accounting Notice Badge */}
      <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl flex items-center gap-2.5 text-xs text-amber-900">
        <HeartHandshake className="h-4 w-4 text-amber-700 shrink-0" />
        <span>
          <strong>Accounting Principle:</strong> Tips are collected on behalf of staff and distributed directly. They are kept entirely separate from Ghoomar Yatra revenue and P&L.
        </span>
      </div>

      {message && (
        <div className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 ${message.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
          {message.type === 'success' ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {message.text}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardDescription>Today's Total Tips Collected</CardDescription>
          <div className="text-2xl font-bold text-emerald-600 mt-1">
            {formatINR(totalDayTips)}
          </div>
          <div className="text-[11px] text-stone-500 mt-1">To be distributed among service & kitchen staff</div>
        </Card>

        <Card>
          <CardDescription>Total Tip Transactions</CardDescription>
          <div className="text-2xl font-bold text-stone-900 mt-1">{tips.length}</div>
          <div className="text-[11px] text-stone-500 mt-1">Recorded for {businessDate}</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Log Tip Receipt</CardTitle>
            <CardDescription>Record individual or pool tips</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <form onSubmit={handleAddTip} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-stone-700 mb-1">Individual Staff (Optional)</label>
                <select
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                >
                  <option value="">Shared Pool / Department</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Department Pool</label>
                <select
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                >
                  <option value="">Select Department...</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Tip Amount (₹)</label>
                <input
                  type="number"
                  step="10"
                  value={amount || ''}
                  onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                  placeholder="0.00"
                  required
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 font-bold text-sm focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Source / Table</label>
                <input
                  type="text"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="e.g. Table 14, Front Lawn Party"
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                />
              </div>

              <Button type="submit" variant="amber" disabled={saving} className="w-full mt-2">
                {saving ? 'Recording...' : 'Record Tip'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Tips Register for {businessDate}</CardTitle>
            <CardDescription>Itemized gratuities</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {tips.length === 0 ? (
              <div className="py-12 text-center text-stone-400 text-xs">
                No tips recorded for {businessDate}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 font-semibold">
                      <th className="py-2 px-3">Recipient / Dept</th>
                      <th className="py-2 px-3">Source</th>
                      <th className="py-2 px-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {tips.map((t) => (
                      <tr key={t.id} className="hover:bg-stone-50/80 transition-colors">
                        <td className="py-2.5 px-3 font-semibold text-stone-900">
                          {t.employee?.name || t.department?.name || 'General Staff Pool'}
                        </td>
                        <td className="py-2.5 px-3 text-stone-600">{t.source || 'Dining'}</td>
                        <td className="py-2.5 px-3 text-right font-bold text-emerald-700">
                          {formatINR(Number(t.amount))}
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
    </div>
  );
}
