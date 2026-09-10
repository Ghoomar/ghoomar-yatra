'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { getTodayBusinessDate } from '@/lib/utils';
import { Shirt, Plus, RefreshCw, CheckCircle, AlertCircle, ArrowDownLeft, ArrowUpRight, ShieldCheck } from 'lucide-react';

export default function UniformsPage() {
  const supabase = createClient();
  const [businessDate, setBusinessDate] = useState(getTodayBusinessDate());
  const [uniforms, setUniforms] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [issues, setIssues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Issue Form State
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [selectedUniformId, setSelectedUniformId] = useState('');
  const [issueQty, setIssueQty] = useState<number>(1);
  const [issueNotes, setIssueNotes] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const { data: uData, error: uError } = await supabase.from('uniform_items').select('*').order('name');
      const { data: empData, error: eError } = await supabase
        .from('employees')
        .select('id, name, employee_code')
        .eq('employment_status', 'Active')
        .order('name');
      const { data: issData, error: issError } = await supabase
        .from('employee_uniform_issues')
        .select(`
          id, business_date, created_at, notes,
          employee:employees(name, employee_code),
          items:employee_uniform_issue_items(
            id, quantity, status,
            uniform:uniform_items(name, size)
          )
        `)
        .order('created_at', { ascending: false });

      if (uError) throw uError;
      if (eError) throw eError;
      if (issError) throw issError;

      setUniforms(uData || []);
      setEmployees(empData || []);
      setIssues(issData || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleIssueUniform = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmpId || !selectedUniformId || issueQty <= 0) return;
    setSaving(true);
    setMessage(null);

    try {
      // 1. Create issue header
      const { data: header, error: hErr } = await supabase
        .from('employee_uniform_issues')
        .insert({
          employee_id: selectedEmpId,
          business_date: businessDate,
          notes: issueNotes,
        })
        .select()
        .single();

      if (hErr) throw hErr;

      // 2. Create issue item
      await supabase.from('employee_uniform_issue_items').insert({
        issue_id: header.id,
        uniform_item_id: selectedUniformId,
        quantity: issueQty,
        status: 'Issued',
      });

      // 3. Update uniform item counts
      const targetUni = uniforms.find((u) => u.id === selectedUniformId);
      if (targetUni) {
        await supabase
          .from('uniform_items')
          .update({
            available_quantity: Math.max(0, targetUni.available_quantity - issueQty),
            issued_quantity: targetUni.issued_quantity + issueQty,
            updated_at: new Date().toISOString(),
          })
          .eq('id', selectedUniformId);
      }

      setMessage({ type: 'success', text: `Uniform issued successfully (${issueQty} pcs).` });
      setShowIssueModal(false);
      setIssueQty(1);
      setIssueNotes('');
      loadData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Error issuing uniform.' });
    } finally {
      setSaving(false);
    }
  };

  const totalAvailable = uniforms.reduce((s, u) => s + (u.available_quantity || 0), 0);
  const totalIssued = uniforms.reduce((s, u) => s + (u.issued_quantity || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <Shirt className="h-6 w-6 text-amber-600" />
            Uniform Inventory & Staff Issues
          </h1>
          <p className="text-sm text-stone-500">
            Dedicated issueable inventory ledger with employee tracking and exit clearance verification.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => setShowIssueModal(true)} className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white">
            <Plus className="h-4 w-4" /> Issue Uniform to Staff
          </Button>
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

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Available in Central Store</CardDescription>
            <div className="text-2xl font-bold text-stone-900 mt-1">{totalAvailable} Pieces</div>
          </CardHeader>
          <CardContent className="pt-0 text-[11px] text-stone-500">
            Shirts, Chef Coats, Aprons, Caps ready for issue
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Currently Issued to Staff</CardDescription>
            <div className="text-2xl font-bold text-amber-600 mt-1">{totalIssued} Pieces</div>
          </CardHeader>
          <CardContent className="pt-0 text-[11px] text-stone-500">
            Active staff uniforms under individual custody
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Exit Clearance Policy</CardDescription>
            <div className="text-base font-semibold text-stone-800 mt-1 flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-emerald-600" /> Clearance Mandatory
            </div>
          </CardHeader>
          <CardContent className="pt-0 text-[11px] text-stone-500">
            Returned or deducted before final salary settlement
          </CardContent>
        </Card>
      </div>

      {/* Uniform Stock Table */}
      <Card>
        <CardHeader>
          <CardTitle>Uniform Stock by Size</CardTitle>
          <CardDescription>Stock breakdown across store and issued active sets</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="py-12 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin text-amber-600" /> Loading uniform stock...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                    <th className="py-2.5 px-3">Uniform Item</th>
                    <th className="py-2.5 px-3 text-center">Size</th>
                    <th className="py-2.5 px-3 text-right">Purchased</th>
                    <th className="py-2.5 px-3 text-right">Available (Store)</th>
                    <th className="py-2.5 px-3 text-right">Issued (Staff)</th>
                    <th className="py-2.5 px-3 text-right">Lost / Damaged</th>
                    <th className="py-2.5 px-3 text-center">Stock Health</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {uniforms.map((u) => (
                    <tr key={u.id} className="hover:bg-stone-50/80">
                      <td className="py-3 px-3 font-semibold text-stone-900">{u.name}</td>
                      <td className="py-3 px-3 text-center">
                        <span className="px-2 py-0.5 rounded bg-stone-100 border border-stone-200 font-mono font-bold text-stone-700">
                          {u.size}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right text-stone-600">{u.total_purchased}</td>
                      <td className="py-3 px-3 text-right font-bold text-emerald-700 text-sm">
                        {u.available_quantity}
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-amber-700 text-sm">
                        {u.issued_quantity}
                      </td>
                      <td className="py-3 px-3 text-right text-rose-600 font-medium">
                        {(u.lost_quantity || 0) + (u.damaged_quantity || 0)}
                      </td>
                      <td className="py-3 px-3 text-center">
                        {u.available_quantity <= 5 ? (
                          <Badge variant="warning">Low Store</Badge>
                        ) : (
                          <Badge variant="success">Adequate</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal */}
      {showIssueModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl text-xs">
            <div className="flex items-center justify-between border-b pb-3">
              <h2 className="text-base font-bold text-stone-900">Issue Uniform to Staff</h2>
              <button onClick={() => setShowIssueModal(false)} className="text-stone-400 hover:text-stone-700 text-lg">✕</button>
            </div>

            <form onSubmit={handleIssueUniform} className="space-y-3">
              <div>
                <label className="block font-medium text-stone-700 mb-1">Employee</label>
                <select
                  value={selectedEmpId}
                  onChange={(e) => setSelectedEmpId(e.target.value)}
                  required
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                >
                  <option value="">Select Staff...</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>{e.name} ({e.employee_code})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Uniform Item & Size</label>
                <select
                  value={selectedUniformId}
                  onChange={(e) => setSelectedUniformId(e.target.value)}
                  required
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                >
                  <option value="">Select Item...</option>
                  {uniforms
                    .filter((u) => u.is_active !== false && Number(u.available_quantity) > 0)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} (Size: {u.size}) — {u.available_quantity} Available
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Quantity (Pieces)</label>
                <input
                  type="number"
                  value={issueQty || ''}
                  onChange={(e) => setIssueQty(parseInt(e.target.value) || 0)}
                  placeholder="1"
                  required
                  className="w-full rounded-md border border-stone-300 p-2 font-bold text-stone-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Notes / Remarks</label>
                <input
                  type="text"
                  value={issueNotes}
                  onChange={(e) => setIssueNotes(e.target.value)}
                  placeholder="e.g. Joining kit issue, security deposit logged"
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button type="button" variant="outline" onClick={() => setShowIssueModal(false)}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={saving} className="bg-amber-600 hover:bg-amber-700 text-white">
                  {saving ? 'Recording...' : 'Confirm Issue'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

