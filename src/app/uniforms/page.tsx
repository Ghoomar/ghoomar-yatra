'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { getTodayBusinessDate } from '@/lib/utils';
import { logAuditAction } from '@/lib/audit-logger';
import { Shirt, Plus, RefreshCw, CheckCircle, AlertCircle, ShieldCheck, RotateCcw } from 'lucide-react';

function getEmployeeRoleName(emp: any): string {
  if (!emp) return 'Staff';
  if (Array.isArray(emp.role)) return emp.role[0]?.name || 'Staff';
  return emp.role?.name || emp.designation || 'Staff';
}

export default function UniformsPage() {
  const supabase = createClient();
  const [businessDate] = useState(getTodayBusinessDate());
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
      // 1. Authoritative Uniform Items from inventory_items
      const { data: uData, error: uError } = await supabase
        .from('inventory_items')
        .select('*, unit:units!inventory_items_unit_id_fkey(symbol), category:inventory_categories(name)')
        .eq('inventory_class', 'Uniform')
        .order('name');

      // 2. Active Employees
      const { data: empData, error: eError } = await supabase
        .from('employees')
        .select('id, name, employee_code, role:employee_roles(name)')
        .eq('employment_status', 'Active')
        .order('name');

      // 3. Uniform Issues
      const { data: issData, error: issError } = await supabase
        .from('employee_uniform_issues')
        .select(`
          id, business_date, created_at, notes,
          employee:employees(name, employee_code, role:employee_roles(name)),
          items:employee_uniform_issue_items(
            id, quantity, status, item_id, uniform_item_id, returned_at,
            item:inventory_items!employee_uniform_issue_items_item_id_fkey(name, item_code),
            legacy_uniform:uniform_items(name, size)
          )
        `)
        .order('created_at', { ascending: false });

      if (uError) throw uError;
      if (eError) throw eError;
      if (issError) throw issError;

      // Calculate issued quantities per inventory item
      const issuedCounts: Record<string, number> = {};
      (issData || []).forEach((issue: any) => {
        (issue.items || []).forEach((item: any) => {
          if (item.status === 'Issued') {
            const targetId = item.item_id || item.uniform_item_id;
            if (targetId) {
              issuedCounts[targetId] = (issuedCounts[targetId] || 0) + Number(item.quantity || 0);
            }
          }
        });
      });

      const processedUniforms = (uData || []).map((u) => ({
        ...u,
        issued_count: issuedCounts[u.id] || 0,
      }));

      setUniforms(processedUniforms);
      setEmployees(empData || []);
      setIssues(issData || []);
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: err.message || 'Error loading uniform records.' });
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

    const targetUni = uniforms.find((u) => u.id === selectedUniformId);
    if (!targetUni || Number(targetUni.current_stock) < issueQty) {
      setMessage({ type: 'error', text: `Insufficient stock! Only ${targetUni?.current_stock || 0} available in store.` });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      // 1. Create issue header
      const { data: header, error: hErr } = await supabase
        .from('employee_uniform_issues')
        .insert({
          employee_id: selectedEmpId,
          business_date: businessDate,
          notes: issueNotes || 'Uniform kit issue',
        })
        .select()
        .single();

      if (hErr) throw hErr;

      // 2. Create issue item linked to authoritative inventory_items
      const { error: itemErr } = await supabase.from('employee_uniform_issue_items').insert({
        issue_id: header.id,
        item_id: selectedUniformId,
        quantity: issueQty,
        status: 'Issued',
      });
      if (itemErr) throw itemErr;

      // 3. Record authoritative stock movement
      const unitCost = Number(targetUni.current_weighted_average_cost || 0);
      const { error: smErr } = await supabase.from('stock_movements').insert({
        item_id: selectedUniformId,
        business_date: businessDate,
        movement_type: 'issue',
        purpose: 'Uniform Issue to Staff',
        quantity: -issueQty,
        unit_cost: unitCost,
        total_value: -issueQty * unitCost,
        notes: `Issued to staff member: ${selectedEmpId}`,
      });
      if (smErr) throw smErr;

      // 4. Update authoritative inventory_items current_stock
      const nextStock = Math.max(0, Number(targetUni.current_stock || 0) - issueQty);
      await supabase
        .from('inventory_items')
        .update({
          current_stock: nextStock,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedUniformId);

      // 5. Central Audit Log
      await logAuditAction({
        action: 'CREATE',
        entity: 'Uniform Issue',
        entityId: header.id,
        details: {
          employee_id: selectedEmpId,
          item_id: selectedUniformId,
          quantity: issueQty,
          remaining_stock: nextStock,
        },
      });

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

  const handleReturnUniform = async (issueItemId: string, uniformItemId: string, qty: number) => {
    if (!confirm(`Confirm return of ${qty} uniform pcs back to central inventory?`)) return;
    setSaving(true);
    try {
      // 1. Update issue item status
      const { error: updErr } = await supabase
        .from('employee_uniform_issue_items')
        .update({
          status: 'Returned',
          returned_at: new Date().toISOString(),
        })
        .eq('id', issueItemId);
      if (updErr) throw updErr;

      // 2. Add back stock movement
      const targetUni = uniforms.find((u) => u.id === uniformItemId);
      const unitCost = Number(targetUni?.current_weighted_average_cost || 0);
      await supabase.from('stock_movements').insert({
        item_id: uniformItemId,
        business_date: businessDate,
        movement_type: 'return',
        purpose: 'Uniform Return by Staff',
        quantity: qty,
        unit_cost: unitCost,
        total_value: qty * unitCost,
        notes: `Returned item from issue item ${issueItemId}`,
      });

      // 3. Update inventory_items stock
      if (targetUni) {
        await supabase
          .from('inventory_items')
          .update({
            current_stock: Number(targetUni.current_stock || 0) + qty,
            updated_at: new Date().toISOString(),
          })
          .eq('id', uniformItemId);
      }

      await logAuditAction({
        action: 'UPDATE',
        entity: 'Uniform Return',
        entityId: issueItemId,
        details: { uniform_item_id: uniformItemId, returned_qty: qty },
      });

      setMessage({ type: 'success', text: `Uniform return recorded (${qty} pcs back to store).` });
      loadData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Error returning uniform.' });
    } finally {
      setSaving(false);
    }
  };

  const totalAvailable = uniforms.reduce((s, u) => s + (Number(u.current_stock) || 0), 0);
  const totalIssued = uniforms.reduce((s, u) => s + (Number(u.issued_count) || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <Shirt className="h-6 w-6 text-amber-600" />
            Uniform Inventory & Staff Issues
          </h1>
          <p className="text-sm text-stone-500">
            Authoritative SKU-linked uniform inventory with employee custody tracking and return clearances.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => setShowIssueModal(true)} className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white">
            <Plus className="h-4 w-4" /> Issue Uniform to Staff
          </Button>
          <Button variant="outline" size="sm" onClick={loadData}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
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
            Authoritative inventory items ready for issue
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Currently Issued to Staff</CardDescription>
            <div className="text-2xl font-bold text-amber-600 mt-1">{totalIssued} Pieces</div>
          </CardHeader>
          <CardContent className="pt-0 text-[11px] text-stone-500">
            Active staff uniforms currently under individual custody
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
          <CardTitle>Uniform Stock Master</CardTitle>
          <CardDescription>Live authoritative inventory stock by SKU and item size</CardDescription>
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
                    <th className="py-2.5 px-3">SKU</th>
                    <th className="py-2.5 px-3">Uniform Item</th>
                    <th className="py-2.5 px-3">Category</th>
                    <th className="py-2.5 px-3 text-right">Available in Store</th>
                    <th className="py-2.5 px-3 text-right">Active with Staff</th>
                    <th className="py-2.5 px-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {uniforms.map((u) => (
                    <tr key={u.id} className="hover:bg-stone-50/80">
                      <td className="py-3 px-3 font-mono font-bold text-amber-700">{u.item_code}</td>
                      <td className="py-3 px-3 font-semibold text-stone-900">{u.name}</td>
                      <td className="py-3 px-3 text-stone-500">{u.category?.name || 'Uniform'}</td>
                      <td className="py-3 px-3 text-right font-bold text-emerald-700 text-sm">
                        {Number(u.current_stock || 0)} {u.unit?.symbol || 'pcs'}
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-amber-700 text-sm">
                        {u.issued_count} pcs
                      </td>
                      <td className="py-3 px-3 text-center">
                        {Number(u.current_stock || 0) <= 5 ? (
                          <Badge variant="warning">Low Store</Badge>
                        ) : (
                          <Badge variant="success">Adequate</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                  {uniforms.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-stone-400">
                        No uniform items found in inventory.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Uniform Issues History */}
      <Card>
        <CardHeader>
          <CardTitle>Staff Uniform Issues & Custody Ledger</CardTitle>
          <CardDescription>Track items issued to staff with return and clearance capability</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Employee</th>
                  <th className="py-2.5 px-3">Items Issued</th>
                  <th className="py-2.5 px-3">Notes</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {issues.map((iss) => (
                  <tr key={iss.id} className="hover:bg-stone-50/80">
                    <td className="py-3 px-3 font-mono text-stone-600 whitespace-nowrap">{iss.business_date}</td>
                    <td className="py-3 px-3">
                      <div className="font-semibold text-stone-900">{iss.employee?.name || 'Unknown Staff'}</div>
                      <div className="text-[11px] text-stone-400 font-mono">
                        {iss.employee?.employee_code} • {getEmployeeRoleName(iss.employee)}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="space-y-1">
                        {(iss.items || []).map((item: any) => {
                          const itemName = item.item?.name || item.legacy_uniform?.name || 'Uniform Item';
                          const itemCode = item.item?.item_code || '';
                          const isIssued = item.status === 'Issued';
                          const targetUniformId = item.item_id || item.uniform_item_id;

                          return (
                            <div key={item.id} className="flex items-center gap-2">
                              <span className="font-medium text-stone-800">
                                {item.quantity}× {itemName} {itemCode && `(${itemCode})`}
                              </span>
                              <Badge variant={isIssued ? 'warning' : 'outline'} className="text-[10px] py-0">
                                {item.status}
                              </Badge>
                              {isIssued && targetUniformId && (
                                <button
                                  onClick={() => handleReturnUniform(item.id, targetUniformId, item.quantity)}
                                  disabled={saving}
                                  className="text-[10px] text-amber-700 hover:text-amber-900 flex items-center gap-0.5 underline ml-1"
                                >
                                  <RotateCcw className="h-3 w-3" /> Mark Returned
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-stone-500 max-w-xs truncate">{iss.notes || '—'}</td>
                    <td className="py-3 px-3 text-right text-stone-400 font-mono text-[11px]">
                      {new Date(iss.created_at).toLocaleDateString('en-GB')}
                    </td>
                  </tr>
                ))}
                {issues.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-stone-400">
                      No uniform issue records logged yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
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
                <label className="block font-medium text-stone-700 mb-1">Employee <span className="text-red-500">*</span></label>
                <select
                  value={selectedEmpId}
                  onChange={(e) => setSelectedEmpId(e.target.value)}
                  required
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                >
                  <option value="">Select Staff...</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>{e.name} ({e.employee_code}) - {getEmployeeRoleName(e)}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Uniform Item & Size <span className="text-red-500">*</span></label>
                <select
                  value={selectedUniformId}
                  onChange={(e) => setSelectedUniformId(e.target.value)}
                  required
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                >
                  <option value="">Select Uniform SKU...</option>
                  {uniforms
                    .filter((u) => u.is_active !== false && Number(u.current_stock) > 0)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        [{u.item_code}] {u.name} — {u.current_stock} {u.unit?.symbol || 'pcs'} available
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Quantity (Pieces) <span className="text-red-500">*</span></label>
                <input
                  type="number"
                  min="1"
                  max={uniforms.find((u) => u.id === selectedUniformId)?.current_stock || 100}
                  value={issueQty || ''}
                  onChange={(e) => setIssueQty(parseInt(e.target.value) || 0)}
                  placeholder="1"
                  required
                  className="w-full rounded-md border border-stone-300 p-2 font-bold text-stone-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Notes / Purpose</label>
                <input
                  type="text"
                  value={issueNotes}
                  onChange={(e) => setIssueNotes(e.target.value)}
                  placeholder="e.g. Joining kit issue, replacement shirt"
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

