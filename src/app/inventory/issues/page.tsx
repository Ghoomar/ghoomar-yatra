'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR, getTodayBusinessDate } from '@/lib/utils';
import { ArrowRightLeft, Plus, Trash2, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';

interface IssueLine {
  item_id: string;
  quantity: number;
}

export default function StoreIssuesPage() {
  const supabase = createClient();
  const [businessDate, setBusinessDate] = useState(getTodayBusinessDate());
  const [items, setItems] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [chefs, setChefs] = useState<any[]>([]);
  const [recentIssues, setRecentIssues] = useState<any[]>([]);

  // Form State
  const [departmentId, setDepartmentId] = useState('');
  const [chefId, setChefId] = useState('');
  const [purpose, setPurpose] = useState<'Customer Food' | 'Staff Food' | 'Complimentary Food' | 'Sampling' | 'Wastage' | 'Spoilage' | 'Other'>('Customer Food');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<IssueLine[]>([{ item_id: '', quantity: 1 }]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const { data: iData } = await supabase.from('inventory_current_position').select('*').order('name');
      const { data: dData } = await supabase.from('departments').select('*').order('name');
      const { data: cData } = await supabase.from('employees').select('id, name').order('name');

      const { data: issData, error: issError } = await supabase
        .from('consumption_issues')
        .select(`
          id, business_date, purpose, notes, created_at,
          department:departments(name),
          chef:employees(name),
          items:consumption_issue_items(
            quantity, unit_cost, total_value,
            item:inventory_items(name, unit:units(symbol))
          )
        `)
        .eq('business_date', businessDate)
        .order('created_at', { ascending: false });

      if (issError) throw issError;

      setItems(iData || []);
      setDepartments(dData || []);
      setChefs(cData || []);
      setRecentIssues(issData || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [businessDate]);

  const handleAddLine = () => {
    setLines([...lines, { item_id: '', quantity: 1 }]);
  };

  const handleRemoveLine = (idx: number) => {
    if (lines.length > 1) {
      setLines(lines.filter((_, i) => i !== idx));
    }
  };

  const calculateIssueTotal = () => {
    return lines.reduce((sum, l) => {
      const it = items.find((i) => i.item_id === l.item_id);
      const rate = it ? Number(it.wac_cost) : 0;
      return sum + l.quantity * rate;
    }, 0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lines.some((l) => !l.item_id || l.quantity <= 0)) {
      alert('Please fill out all line items with valid quantities.');
      return;
    }
    setSaving(true);
    setMessage(null);

    try {
      // 1. Create consumption issue header
      const { data: issueHeader, error: hErr } = await supabase
        .from('consumption_issues')
        .insert({
          business_date: businessDate,
          department_id: departmentId || null,
          responsible_chef_id: chefId || null,
          purpose,
          notes,
        })
        .select()
        .single();

      if (hErr) throw hErr;

      // 2. Map purpose to stock movement type
      let movType = 'issue';
      if (purpose === 'Staff Food') movType = 'staff_food';
      else if (purpose === 'Wastage') movType = 'wastage';
      else if (purpose === 'Spoilage') movType = 'spoilage';

      // 3. Insert line items and atomic stock_movements
      for (const line of lines) {
        const it = items.find((i) => i.item_id === line.item_id);
        const unitCost = it ? Number(it.wac_cost) : 0;
        const totalVal = line.quantity * unitCost;

        // Line item
        await supabase.from('consumption_issue_items').insert({
          issue_id: issueHeader.id,
          item_id: line.item_id,
          quantity: line.quantity,
          unit_cost: unitCost,
          total_value: totalVal,
        });

        // Stock movement ledger entry
        await supabase.from('stock_movements').insert({
          business_date: businessDate,
          item_id: line.item_id,
          movement_type: movType,
          quantity: line.quantity,
          unit_cost: unitCost,
          total_value: totalVal,
          department_id: departmentId || null,
          responsible_person_id: chefId || null,
          purpose: purpose,
          reference_id: issueHeader.id,
          reference_type: 'consumption_issues',
          notes,
        });

        // Update cached item stock
        if (it) {
          await supabase
            .from('inventory_items')
            .update({
              current_stock: Math.max(0, Number(it.current_quantity) - line.quantity),
              updated_at: new Date().toISOString(),
            })
            .eq('id', line.item_id);
        }
      }

      setMessage({ type: 'success', text: `Store issue of ${lines.length} items logged successfully.` });
      setLines([{ item_id: '', quantity: 1 }]);
      setNotes('');
      loadData();
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: err.message || 'Error logging store issue.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <ArrowRightLeft className="h-6 w-6 text-amber-600" />
            Kitchen Store Issues & Consumption
          </h1>
          <p className="text-sm text-stone-500">
            Raw material issues to production sections. Single action generates multiple atomic ledger movements.
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Issue Form */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>New Store Requisition Issue</CardTitle>
            <CardDescription>Issue raw materials to section</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <form onSubmit={handleSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-stone-700 mb-1">Receiving Department / Kitchen</label>
                <select
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                >
                  <option value="">Select Kitchen Section...</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Responsible Chef / Staff</label>
                <select
                  value={chefId}
                  onChange={(e) => setChefId(e.target.value)}
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                >
                  <option value="">Select Chef...</option>
                  {chefs.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Purpose</label>
                <select
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value as any)}
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 font-semibold focus:outline-none"
                >
                  <option value="Customer Food">Customer Food (Regular Menu Production)</option>
                  <option value="Staff Food">Staff Food (Duty Meal Consumption)</option>
                  <option value="Complimentary Food">Complimentary Food</option>
                  <option value="Sampling">Sampling / Recipe Testing</option>
                  <option value="Wastage">Known Kitchen Wastage</option>
                  <option value="Spoilage">Storage Spoilage</option>
                  <option value="Other">Other Operational Purpose</option>
                </select>
              </div>

              {/* Items List */}
              <div className="space-y-2 border-t pt-3">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-stone-800">Issued Material Items</label>
                  <button
                    type="button"
                    onClick={handleAddLine}
                    className="text-amber-700 hover:text-amber-800 font-semibold text-xs flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="h-3 w-3" /> Add Item
                  </button>
                </div>

                {lines.map((line, idx) => {
                  const it = items.find((i) => i.item_id === line.item_id);
                  return (
                    <div key={idx} className="flex items-center gap-2 p-2 bg-stone-50 rounded-lg border border-stone-200">
                      <select
                        value={line.item_id}
                        onChange={(e) => {
                          const next = [...lines];
                          next[idx].item_id = e.target.value;
                          setLines(next);
                        }}
                        required
                        className="flex-1 rounded border border-stone-300 bg-white p-1.5 text-stone-900 text-xs focus:outline-none"
                      >
                        <option value="">Select Item SKU...</option>
                        {items.map((i) => (
                          <option key={i.item_id} value={i.item_id}>
                            {i.name} (Stock: {Number(i.current_quantity).toFixed(1)} {i.unit_symbol})
                          </option>
                        ))}
                      </select>

                      <input
                        type="number"
                        step="0.1"
                        value={line.quantity || ''}
                        onChange={(e) => {
                          const next = [...lines];
                          next[idx].quantity = parseFloat(e.target.value) || 0;
                          setLines(next);
                        }}
                        placeholder="Qty"
                        required
                        className="w-18 rounded border border-stone-300 bg-white p-1.5 text-center text-xs font-bold text-stone-900 focus:outline-none"
                      />

                      <div className="w-16 text-right text-[11px] font-semibold text-stone-700">
                        {it ? formatINR(line.quantity * Number(it.wac_cost)) : '—'}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveLine(idx)}
                        className="text-stone-400 hover:text-rose-600 p-1"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between border-t pt-2">
                <span className="font-bold text-stone-600 text-xs">Issue Valuation:</span>
                <span className="font-extrabold text-amber-700 text-base">
                  {formatINR(calculateIssueTotal())}
                </span>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Notes / Requisition Slip #</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Lunch buffet prep requirement"
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                />
              </div>

              <Button type="submit" variant="primary" disabled={saving} className="w-full mt-2 bg-amber-600 hover:bg-amber-700 text-white">
                {saving ? 'Recording...' : 'Post Consumption Issue'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Issue History */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent Store Issues ({businessDate})</CardTitle>
            <CardDescription>Departmental consumption entries valued at weighted average cost</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="py-12 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-amber-600" /> Loading store issues...
              </div>
            ) : recentIssues.length === 0 ? (
              <div className="py-12 text-center text-stone-400 text-xs">No store issues logged for {businessDate}.</div>
            ) : (
              <div className="space-y-3">
                {recentIssues.map((iss) => (
                  <div key={iss.id} className="p-3 bg-stone-50 rounded-xl border border-stone-200/80 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant={iss.purpose === 'Customer Food' ? 'success' : iss.purpose === 'Staff Food' ? 'info' : 'warning'}>
                          {iss.purpose}
                        </Badge>
                        <span className="font-bold text-stone-900">
                          {iss.department?.name || 'General Kitchen'}
                        </span>
                        {iss.chef?.name && <span className="text-stone-500">• Chef {iss.chef.name}</span>}
                      </div>
                      <span className="text-stone-400 text-[11px]">
                        {new Date(iss.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2 pt-1 border-t border-stone-200/60">
                      {iss.items?.map((item: any, i: number) => (
                        <div key={i} className="bg-white px-2 py-1 rounded border border-stone-200 text-stone-800 font-medium">
                          {item.item?.name}: <strong>{item.quantity} {item.item?.unit?.symbol}</strong> ({formatINR(Number(item.total_value))})
                        </div>
                      ))}
                    </div>

                    {iss.notes && <div className="text-[11px] text-stone-500 italic">Note: {iss.notes}</div>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

