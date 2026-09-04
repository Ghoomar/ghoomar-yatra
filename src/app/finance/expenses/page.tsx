'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR, getTodayBusinessDate } from '@/lib/utils';
import { IndianRupee, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';

interface ExpenseItem {
  id: string;
  business_date: string;
  expense_date: string;
  category_id: string;
  category_name?: string;
  description: string;
  amount: number;
  payment_method_name?: string;
  paid_to?: string;
  approved_by?: string;
  notes?: string;
  created_at: string;
}

export default function ExpensesPage() {
  const supabase = createClient();
  const [businessDate, setBusinessDate] = useState(getTodayBusinessDate());
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [paidTo, setPaidTo] = useState('');
  const [approvedBy, setApprovedBy] = useState('');
  const [notes, setNotes] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const { data: catData } = await supabase.from('expense_categories').select('*').order('display_order');
      const { data: pmData } = await supabase.from('payment_methods').select('*').order('name');

      const { data: expData } = await supabase
        .from('expenses')
        .select(`
          *,
          category:expense_categories(name),
          payment_method:payment_methods(name)
        `)
        .eq('business_date', businessDate)
        .order('created_at', { ascending: false });

      setCategories(catData || []);
      setPaymentMethods(pmData || []);
      setExpenses(
        (expData || []).map((e: any) => ({
          ...e,
          category_name: e.category?.name,
          payment_method_name: e.payment_method?.name,
        }))
      );
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: 'Failed to load expenses.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [businessDate]);

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryId || amount <= 0 || !description) {
      alert('Please select category, description, and valid amount.');
      return;
    }
    setSaving(true);
    setMessage(null);

    try {
      const { error } = await supabase.from('expenses').insert({
        business_date: businessDate,
        expense_date: businessDate,
        category_id: categoryId,
        description,
        amount,
        payment_method_id: paymentMethodId || null,
        paid_to: paidTo,
        approved_by: approvedBy,
        notes,
      });

      if (error) throw error;

      setMessage({ type: 'success', text: `Expense of ${formatINR(amount)} logged successfully.` });
      setDescription('');
      setAmount(0);
      setPaidTo('');
      setApprovedBy('');
      setNotes('');
      loadData();
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: err.message || 'Failed to record expense.' });
    } finally {
      setSaving(false);
    }
  };

  const totalDayExpenses = expenses.reduce((acc, e) => acc + (Number(e.amount) || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <IndianRupee className="h-6 w-6 text-amber-600" />
            Operational Expenses
          </h1>
          <p className="text-sm text-stone-500">
            Record approved operational expenditures for day-to-day highway facility management.
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
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {message && (
        <div className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 ${
          message.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
        }`}>
          {message.type === 'success' ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardDescription>Today's Total Logged Expenses</CardDescription>
          <div className="text-2xl font-bold text-rose-600 mt-1">
            {formatINR(totalDayExpenses)}
          </div>
          <div className="text-[11px] text-stone-500 mt-1">Deducted directly in daily P&L</div>
        </Card>

        <Card>
          <CardDescription>Voucher Count</CardDescription>
          <div className="text-2xl font-bold text-stone-900 mt-1">{expenses.length}</div>
          <div className="text-[11px] text-stone-500 mt-1">Logged expenditures for {businessDate}</div>
        </Card>

        <Card>
          <CardDescription>Approval Rule</CardDescription>
          <div className="text-base font-semibold text-stone-800 mt-1">Pre-Approved Vouchers Only</div>
          <div className="text-[11px] text-stone-500 mt-1">Operational policy: Spend approved before payment</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Log Approved Expense</CardTitle>
            <CardDescription>Enter approved cash/bank expenditure</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <form onSubmit={handleAddExpense} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-stone-700 mb-1">Category</label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  required
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                >
                  <option value="">Select Category...</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Description / Purpose</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Highway Banner Printing, Floor Cleaner"
                  required
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Amount (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={amount || ''}
                  onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                  placeholder="0.00"
                  required
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 font-bold text-sm focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-medium text-stone-700 mb-1">Paid Via</label>
                  <select
                    value={paymentMethodId}
                    onChange={(e) => setPaymentMethodId(e.target.value)}
                    className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                  >
                    <option value="">Select...</option>
                    {paymentMethods.map((pm) => (
                      <option key={pm.id} value={pm.id}>{pm.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-stone-700 mb-1">Paid To</label>
                  <input
                    type="text"
                    value={paidTo}
                    onChange={(e) => setPaidTo(e.target.value)}
                    placeholder="Recipient / Vendor"
                    className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Approved By</label>
                <input
                  type="text"
                  value={approvedBy}
                  onChange={(e) => setApprovedBy(e.target.value)}
                  placeholder="e.g. GM / Owner"
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                />
              </div>

              <Button type="submit" variant="amber" disabled={saving} className="w-full mt-2">
                {saving ? 'Recording...' : 'Record Approved Expense'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Expense Register for {businessDate}</CardTitle>
            <CardDescription>Itemized breakdown with audit timestamps</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {expenses.length === 0 ? (
              <div className="py-12 text-center text-stone-400 text-xs">
                No expenses logged for {businessDate}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 font-semibold">
                      <th className="py-2 px-2">Category</th>
                      <th className="py-2 px-2">Description</th>
                      <th className="py-2 px-2">Paid To</th>
                      <th className="py-2 px-2">Approved</th>
                      <th className="py-2 px-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {expenses.map((e) => (
                      <tr key={e.id} className="hover:bg-stone-50/80 transition-colors">
                        <td className="py-2.5 px-2 font-medium text-stone-800">
                          <Badge variant="outline">{e.category_name || 'General'}</Badge>
                        </td>
                        <td className="py-2.5 px-2 text-stone-900 font-medium">{e.description}</td>
                        <td className="py-2.5 px-2 text-stone-600">{e.paid_to || '—'}</td>
                        <td className="py-2.5 px-2 text-stone-600">{e.approved_by || '—'}</td>
                        <td className="py-2.5 px-2 text-right font-bold text-rose-600">
                          {formatINR(Number(e.amount))}
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
