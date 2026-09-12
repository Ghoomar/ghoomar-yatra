'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR, getTodayBusinessDate } from '@/lib/utils';
import { logAuditAction } from '@/lib/audit-logger';
import {
  ArrowRightLeft,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  MapPin,
  Users,
  Package,
} from 'lucide-react';

interface IssueLine {
  item_id: string;
  quantity: number;
  use_pack_unit?: boolean;
}

export default function StoreIssuesPage() {
  const supabase = createClient();
  const [businessDate, setBusinessDate] = useState(getTodayBusinessDate());
  const [activeTab, setActiveTab] = useState<'issue' | 'transfer'>('issue');

  // Master Data
  const [items, setItems] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [deptCategories, setDeptCategories] = useState<any[]>([]);
  const [recentMovements, setRecentMovements] = useState<any[]>([]);

  // Issue Form State
  const [sourceLocationId, setSourceLocationId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [purpose, setPurpose] = useState<string>('Customer Food');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<IssueLine[]>([{ item_id: '', quantity: 1, use_pack_unit: false }]);

  // Transfer Form State
  const [transferItemId, setTransferItemId] = useState('');
  const [transferSrcLoc, setTransferSrcLoc] = useState('');
  const [transferDestLoc, setTransferDestLoc] = useState('');
  const [transferQty, setTransferQty] = useState<number>(1);
  const [transferUsePack, setTransferUsePack] = useState(false);
  const [transferNotes, setTransferNotes] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [
        { data: iData },
        { data: locData },
        { data: dData },
        { data: tData },
        { data: eData },
        { data: dcData },
      ] = await Promise.all([
        supabase
          .from('inventory_items')
          .select(`
            *,
            unit:units!inventory_items_unit_id_fkey(symbol, name),
            sec_unit:units!inventory_items_secondary_unit_id_fkey(symbol, name),
            category:inventory_categories(id, name, inventory_class),
            location_stocks:item_location_stocks(location_id, quantity)
          `)
          .eq('is_active', true)
          .order('name'),
        supabase.from('inventory_locations').select('*').eq('is_active', true).order('name'),
        supabase.from('departments').select('*').eq('is_active', true).order('name'),
        supabase.from('teams').select('*, department:departments(id, name)').eq('is_active', true).order('name'),
        supabase.from('employees').select('id, name, employment_status, department_id, team_id, role:employee_roles(id, name, is_active, can_receive_store_issues)').eq('employment_status', 'Active').order('name'),
        supabase.from('department_inventory_categories').select('*'),
      ]);

      setItems(iData || []);
      setLocations(locData || []);
      setDepartments(dData || []);
      setTeams(tData || []);
      setEmployees(eData || []);
      setDeptCategories(dcData || []);

      // Default source location to Central Store
      const storeLoc = (locData || []).find((l: any) => l.code === 'STORE');
      if (storeLoc) {
        if (!sourceLocationId) setSourceLocationId(storeLoc.id);
        if (!transferSrcLoc) setTransferSrcLoc(storeLoc.id);
      }

      // Default destination for transfer to customer fridge
      const fridgeLoc = (locData || []).find((l: any) => l.code === 'FRIDGE-COKE');
      if (fridgeLoc && !transferDestLoc) {
        setTransferDestLoc(fridgeLoc.id);
      }

      // Load recent ledger movements
      const { data: mData } = await supabase
        .from('stock_movements')
        .select(`
          id, business_date, movement_type, quantity, purpose, notes, created_at,
          item:inventory_items(name, item_code, unit:units!inventory_items_unit_id_fkey(symbol)),
          department:departments(name),
          team:teams(name),
          responsible_person:employees(name),
          source_loc:inventory_locations!stock_movements_source_location_id_fkey(name),
          dest_loc:inventory_locations!stock_movements_destination_location_id_fkey(name)
        `)
        .order('created_at', { ascending: false })
        .limit(15);

      setRecentMovements(mData || []);
    } catch (err: any) {
      console.error('Error loading store issues data:', err);
      setMessage({ type: 'error', text: 'Error loading inventory master data.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [businessDate]);

  // Smart Item Filtering based on selected department's mapped categories
  const selectableItems = useMemo(() => {
    if (!departmentId) return items;

    const allowedCatIds = deptCategories
      .filter((dc) => dc.department_id === departmentId)
      .map((dc) => dc.category_id);

    // If department has configured categories, filter items
    if (allowedCatIds.length > 0) {
      return items.filter((it) => it.category_id && allowedCatIds.includes(it.category_id));
    }

    return items;
  }, [items, departmentId, deptCategories]);

  // Smart Staff Filtering: Department -> Team -> Eligible Role (can_receive_store_issues) -> Eligible Staff
  const filteredEmployees = useMemo(() => {
    // Only active employees whose active role permits receiving store issues
    const eligiblePool = employees.filter(
      (e) => e.role?.can_receive_store_issues && e.role?.is_active !== false
    );

    if (teamId) {
      return eligiblePool.filter((e) => e.team_id === teamId);
    }
    if (departmentId) {
      return eligiblePool.filter((e) => e.department_id === departmentId);
    }
    return eligiblePool;
  }, [employees, departmentId, teamId]);

  // Filter available teams based on selected department
  const availableTeams = useMemo(() => {
    if (!departmentId) return teams;
    return teams.filter((t) => t.department_id === departmentId);
  }, [teams, departmentId]);

  const handleDepartmentChange = (deptId: string) => {
    setDepartmentId(deptId);
    setTeamId('');
    setEmployeeId('');

    // Set default purpose based on department
    const deptObj = departments.find((d) => d.id === deptId);
    const dName = deptObj?.name?.toLowerCase() || '';
    if (dName.includes('kitchen') || dName.includes('food')) {
      setPurpose('Customer Food');
    } else if (dName.includes('service') || dName.includes('beverage')) {
      setPurpose('Service Issue');
    } else if (dName.includes('admin') || dName.includes('account')) {
      setPurpose('Admin & Stationery');
    } else {
      setPurpose('Operational Consumption');
    }
  };

  const handleTeamChange = (tId: string) => {
    setTeamId(tId);
    if (tId) {
      const tObj = teams.find((t) => t.id === tId);
      if (tObj?.department_id && tObj.department_id !== departmentId) {
        setDepartmentId(tObj.department_id);
      }
    }
  };

  const handleAddLine = () => {
    setLines([...lines, { item_id: '', quantity: 1, use_pack_unit: false }]);
  };

  const handleRemoveLine = (idx: number) => {
    if (lines.length > 1) {
      setLines(lines.filter((_, i) => i !== idx));
    }
  };

  const calculateIssueTotal = () => {
    return lines.reduce((sum, l) => {
      const it = items.find((i) => i.id === l.item_id);
      const wac = Number(it?.current_weighted_average_cost || 0);
      const factor = l.use_pack_unit ? Number(it?.conversion_factor || 1) : 1;
      return sum + l.quantity * factor * wac;
    }, 0);
  };

  // 1. Submit Department Issue
  const handleIssueSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!departmentId) {
      setMessage({ type: 'error', text: 'Receiving Department is required.' });
      return;
    }
    if (!sourceLocationId) {
      setMessage({ type: 'error', text: 'Source Store Location is required.' });
      return;
    }
    if (lines.length === 0 || lines.some((l) => !l.item_id || l.quantity <= 0)) {
      setMessage({ type: 'error', text: 'Please specify all item SKUs and valid quantities greater than 0.' });
      return;
    }

    // Check available stock in source location
    for (const line of lines) {
      const it = items.find((i) => i.id === line.item_id);
      if (!it) continue;
      const factor = line.use_pack_unit ? Number(it.conversion_factor || 1) : 1;
      const requestedBaseQty = line.quantity * factor;
      const locStock = it.location_stocks?.find((ls: any) => ls.location_id === sourceLocationId)?.quantity || 0;

      if (requestedBaseQty > Number(locStock)) {
        setMessage({
          type: 'error',
          text: `Insufficient stock for "${it.name}". Requested: ${requestedBaseQty} ${it.unit?.symbol || 'units'}, Available in selected store: ${Number(locStock).toFixed(1)} ${it.unit?.symbol || 'units'}.`,
        });
        return;
      }
    }

    setSaving(true);
    setMessage(null);

    try {
      // 1. Create consumption_issues header
      const { data: issueHeader, error: hErr } = await supabase
        .from('consumption_issues')
        .insert({
          business_date: businessDate,
          department_id: departmentId,
          team_id: teamId || null,
          responsible_chef_id: employeeId || null,
          purpose,
          notes,
        })
        .select()
        .single();

      if (hErr) throw hErr;

      // Map purpose to movement_type
      let movType = 'issue';
      if (purpose === 'Staff Food') movType = 'staff_food';
      else if (purpose === 'Wastage') movType = 'wastage';
      else if (purpose === 'Spoilage') movType = 'spoilage';

      // 2. Execute atomic stock transactions
      for (const line of lines) {
        const it = items.find((i) => i.id === line.item_id);
        if (!it) continue;
        const factor = line.use_pack_unit ? Number(it.conversion_factor || 1) : 1;
        const baseQty = line.quantity * factor;
        const unitCost = Number(it.current_weighted_average_cost || 0);

        // Line record
        await supabase.from('consumption_issue_items').insert({
          issue_id: issueHeader.id,
          item_id: line.item_id,
          quantity: baseQty,
          unit_cost: unitCost,
          total_value: baseQty * unitCost,
        });

        // Atomic PostgreSQL stored procedure call
        const { error: txErr } = await supabase.rpc('execute_inventory_transaction', {
          p_item_id: line.item_id,
          p_business_date: businessDate,
          p_movement_type: movType,
          p_quantity: baseQty,
          p_unit_cost: unitCost,
          p_source_location_id: sourceLocationId,
          p_department_id: departmentId,
          p_responsible_person_id: employeeId || null,
          p_purpose: purpose,
          p_reference_id: issueHeader.id,
          p_reference_type: 'consumption_issues',
          p_notes: notes || `Issued to ${departments.find((d) => d.id === departmentId)?.name}`,
        });

        if (txErr) throw txErr;
      }

      await logAuditAction({
        action: 'CREATE',
        entity: 'Store Issue',
        entityId: issueHeader.id,
        details: {
          business_date: businessDate,
          department_id: departmentId,
          lines_count: lines.length,
          total_value: calculateIssueTotal(),
        },
      });

      setMessage({ type: 'success', text: 'Store issue recorded and stock deducted successfully.' });
      setLines([{ item_id: '', quantity: 1, use_pack_unit: false }]);
      setNotes('');
      loadData();
    } catch (err: any) {
      console.error('Error executing store issue:', err);
      setMessage({ type: 'error', text: err.message || 'Error recording store issue.' });
    } finally {
      setSaving(false);
    }
  };

  // 2. Submit Inter-Location Transfer
  const handleTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferItemId || !transferSrcLoc || !transferDestLoc || transferQty <= 0) return;
    if (transferSrcLoc === transferDestLoc) {
      setMessage({ type: 'error', text: 'Source and destination locations cannot be the same.' });
      return;
    }

    const it = items.find((i) => i.id === transferItemId);
    if (!it) return;

    const factor = transferUsePack ? Number(it.conversion_factor || 1) : 1;
    const baseQty = transferQty * factor;
    const srcStock = it.location_stocks?.find((ls: any) => ls.location_id === transferSrcLoc)?.quantity || 0;

    if (baseQty > Number(srcStock)) {
      setMessage({
        type: 'error',
        text: `Insufficient stock in source location! Requested: ${baseQty} ${it.unit?.symbol || 'units'}, Available: ${srcStock} ${it.unit?.symbol || 'units'}.`,
      });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const unitCost = Number(it.current_weighted_average_cost || 0);
      const srcName = locations.find((l) => l.id === transferSrcLoc)?.name || 'Store';
      const destName = locations.find((l) => l.id === transferDestLoc)?.name || 'Fridge';

      const { error: txErr } = await supabase.rpc('execute_inventory_transaction', {
        p_item_id: transferItemId,
        p_business_date: businessDate,
        p_movement_type: 'transfer',
        p_quantity: baseQty,
        p_unit_cost: unitCost,
        p_source_location_id: transferSrcLoc,
        p_destination_location_id: transferDestLoc,
        p_purpose: 'Inter-Location Stock Transfer',
        p_notes: transferNotes || `Transferred from ${srcName} to ${destName} (${transferQty} ${transferUsePack ? it.sec_unit?.symbol || 'packs' : it.unit?.symbol || 'units'})`,
      });

      if (txErr) throw txErr;

      setMessage({
        type: 'success',
        text: `Successfully transferred ${baseQty} ${it.unit?.symbol || 'units'} from ${srcName} to ${destName}.`,
      });
      setTransferQty(1);
      setTransferNotes('');
      loadData();
    } catch (err: any) {
      console.error('Error executing location transfer:', err);
      setMessage({ type: 'error', text: err.message || 'Error executing location transfer.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <ArrowRightLeft className="h-6 w-6 text-amber-600" />
            Store Issues & Internal Transfers
          </h1>
          <p className="text-sm text-stone-500">
            Issue goods to operational sections or transfer pre-packaged stock to customer-facing fridges and counters.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="date"
            value={businessDate}
            onChange={(e) => setBusinessDate(e.target.value)}
            className="px-3 py-1.5 border border-stone-300 rounded-lg text-xs font-mono bg-white text-stone-900"
          />
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading} className="gap-1.5">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-amber-600' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {message && (
        <div
          className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
          )}
          {message.text}
        </div>
      )}

      {/* Tab Switcher */}
      <div className="flex border-b border-stone-200 gap-4 text-xs font-semibold">
        <button
          onClick={() => setActiveTab('issue')}
          className={`pb-2 transition-colors flex items-center gap-1.5 ${
            activeTab === 'issue'
              ? 'border-b-2 border-amber-600 text-amber-700'
              : 'text-stone-500 hover:text-stone-800'
          }`}
        >
          <Users className="h-4 w-4" /> Issue to Department / Staff
        </button>
        <button
          onClick={() => setActiveTab('transfer')}
          className={`pb-2 transition-colors flex items-center gap-1.5 ${
            activeTab === 'transfer'
              ? 'border-b-2 border-amber-600 text-amber-700'
              : 'text-stone-500 hover:text-stone-800'
          }`}
        >
          <MapPin className="h-4 w-4" /> Inter-Location Transfer (Fridge / Counters)
        </button>
      </div>

      {/* TAB 1: Department Issue */}
      {activeTab === 'issue' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Issue Goods to Department</CardTitle>
                <CardDescription>
                  Deducts inventory atomically from store location and records operational material consumption.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleIssueSubmit} className="space-y-4 text-xs">
                  {/* Source Store Location */}
                  <div className="bg-amber-50/50 p-3 rounded-lg border border-amber-200">
                    <label className="block font-semibold text-amber-900 mb-1 flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-amber-600" /> Source Store Location{' '}
                      <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={sourceLocationId}
                      onChange={(e) => setSourceLocationId(e.target.value)}
                      required
                      className="w-full rounded-md border border-amber-300 p-2 text-stone-900 bg-white focus:outline-none"
                    >
                      <option value="">Select Store Location...</option>
                      {locations.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.name} ({loc.location_type})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Destination Department & Staff (Smart Filtered) */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block font-medium text-stone-700 mb-1">
                        Receiving Department <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={departmentId}
                        onChange={(e) => handleDepartmentChange(e.target.value)}
                        required
                        className="w-full rounded-md border border-stone-300 p-2 text-stone-900 bg-white focus:outline-none"
                      >
                        <option value="">Select Department...</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block font-medium text-stone-700 mb-1">Section / Team</label>
                      <select
                        value={teamId}
                        onChange={(e) => handleTeamChange(e.target.value)}
                        className="w-full rounded-md border border-stone-300 p-2 text-stone-900 bg-white focus:outline-none"
                      >
                        <option value="">All / General</option>
                        {availableTeams.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block font-medium text-stone-700">
                          Receiving Staff In-Charge <span className="text-rose-500">*</span>
                        </label>
                        {filteredEmployees.length === 0 && (departmentId || teamId) && (
                          <span className="text-[10px] text-amber-600 font-semibold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                            No eligible receivers
                          </span>
                        )}
                      </div>
                      <select
                        value={employeeId}
                        onChange={(e) => setEmployeeId(e.target.value)}
                        required
                        className="w-full rounded-md border border-stone-300 p-2 text-stone-900 bg-white focus:outline-none"
                      >
                        <option value="">
                          {filteredEmployees.length === 0
                            ? 'No staff with issue receiving permission'
                            : 'Select Eligible Staff...'}
                        </option>
                        {filteredEmployees.map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {emp.name} ({emp.role?.name || 'Staff'})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Purpose & Notes */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-medium text-stone-700 mb-1">Purpose / Classification</label>
                      <select
                        value={purpose}
                        onChange={(e) => setPurpose(e.target.value)}
                        className="w-full rounded-md border border-stone-300 p-2 text-stone-900 bg-white focus:outline-none font-medium"
                      >
                        <option value="Customer Food">Customer Food Preparation</option>
                        <option value="Staff Food">Staff Meal Preparation</option>
                        <option value="Service Issue">Dining & Service Requirement</option>
                        <option value="Admin & Stationery">Office & Admin Use</option>
                        <option value="Housekeeping Supply">Housekeeping & Cleaning</option>
                        <option value="Wastage">Spoilage / Kitchen Wastage</option>
                        <option value="Operational Consumption">General Operations</option>
                      </select>
                    </div>

                    <div>
                      <label className="block font-medium text-stone-700 mb-1">Requisition Notes</label>
                      <input
                        type="text"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="e.g. Dinner buffet replenishment, morning prep"
                        className="w-full rounded-md border border-stone-300 p-2 text-stone-900 bg-white focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Line Items */}
                  <div className="border-t pt-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-stone-900">Issue Line Items</span>
                      <Button type="button" variant="outline" size="sm" onClick={handleAddLine} className="gap-1 text-xs">
                        <Plus className="h-3.5 w-3.5" /> Add Item Line
                      </Button>
                    </div>

                    <div className="space-y-2">
                      {lines.map((line, idx) => {
                        const selectedItem = items.find((i) => i.id === line.item_id);
                        const storeStock =
                          selectedItem?.location_stocks?.find((ls: any) => ls.location_id === sourceLocationId)?.quantity || 0;
                        const factor = Number(selectedItem?.conversion_factor || 1);
                        const hasPack = selectedItem?.secondary_unit_id && factor > 1;

                        return (
                          <div
                            key={idx}
                            className="flex flex-col sm:flex-row items-start sm:items-center gap-2 p-2 bg-stone-50 rounded-lg border border-stone-200"
                          >
                            {/* Item Selector */}
                            <div className="flex-1 w-full">
                              <select
                                value={line.item_id}
                                onChange={(e) => {
                                  const updated = [...lines];
                                  updated[idx].item_id = e.target.value;
                                  setLines(updated);
                                }}
                                required
                                className="w-full rounded-md border border-stone-300 p-1.5 text-stone-900 bg-white focus:outline-none"
                              >
                                <option value="">Select Item SKU...</option>
                                {selectableItems.map((it) => {
                                  const locQty =
                                    it.location_stocks?.find((ls: any) => ls.location_id === sourceLocationId)?.quantity || 0;
                                  return (
                                    <option key={it.id} value={it.id}>
                                      [{it.item_code}] {it.name} — ({locQty} {it.unit?.symbol || 'units'} in store)
                                    </option>
                                  );
                                })}
                              </select>
                            </div>

                            {/* Quantity Input */}
                            <div className="w-28">
                              <input
                                type="number"
                                step="any"
                                min="0.001"
                                value={line.quantity || ''}
                                onChange={(e) => {
                                  const updated = [...lines];
                                  updated[idx].quantity = parseFloat(e.target.value) || 0;
                                  setLines(updated);
                                }}
                                placeholder="Qty"
                                required
                                className="w-full rounded-md border border-stone-300 p-1.5 font-bold text-stone-900 bg-white text-right"
                              />
                            </div>

                            {/* Pack Unit Toggle */}
                            <div className="w-28 text-[11px]">
                              {hasPack ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updated = [...lines];
                                    updated[idx].use_pack_unit = !updated[idx].use_pack_unit;
                                    setLines(updated);
                                  }}
                                  className={`w-full py-1.5 px-2 rounded border font-semibold transition-colors ${
                                    line.use_pack_unit
                                      ? 'bg-amber-100 text-amber-900 border-amber-300'
                                      : 'bg-white text-stone-700 border-stone-300'
                                  }`}
                                >
                                  {line.use_pack_unit
                                    ? `${selectedItem?.sec_unit?.symbol} (×${factor})`
                                    : selectedItem?.unit?.symbol || 'units'}
                                </button>
                              ) : (
                                <span className="text-stone-500 font-mono py-1.5 px-2 block">
                                  {selectedItem?.unit?.symbol || 'units'}
                                </span>
                              )}
                            </div>

                            {/* Line Total & Remove */}
                            <div className="w-24 text-right font-mono text-stone-700 font-semibold">
                              {selectedItem
                                ? formatINR(
                                    line.quantity *
                                      (line.use_pack_unit ? factor : 1) *
                                      Number(selectedItem.current_weighted_average_cost || 0)
                                  )
                                : '—'}
                            </div>

                            {lines.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveLine(idx)}
                                className="text-stone-400 hover:text-red-600 p-1"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Submit Button */}
                  <div className="flex items-center justify-between pt-3 border-t">
                    <div className="text-xs">
                      <span className="text-stone-500">Estimated Requisition Value: </span>
                      <span className="font-bold text-base text-stone-900 font-mono">
                        {formatINR(calculateIssueTotal())}
                      </span>
                    </div>

                    <Button type="submit" variant="primary" disabled={saving} className="bg-amber-600 hover:bg-amber-700 text-white">
                      {saving ? 'Processing Requisition...' : 'Approve & Issue Requisition'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>

          {/* Recent Movement History */}
          <div>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Recent Store Dispatches</CardTitle>
                <CardDescription className="text-xs">Audit ledger of dispatches and transfers</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2 text-xs">
                  {recentMovements.map((m) => (
                    <div key={m.id} className="p-2.5 rounded-lg border border-stone-200 bg-stone-50/50 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-stone-900">{m.item?.name}</span>
                        <Badge
                          variant={m.movement_type === 'transfer' ? 'info' : 'warning'}
                          className="capitalize text-[10px] py-0"
                        >
                          {m.movement_type}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-stone-500">
                        <span>
                          {m.quantity} {m.item?.unit?.symbol || 'units'}
                        </span>
                        <span className="font-mono">{m.business_date}</span>
                      </div>
                      <div className="text-[10px] text-stone-400 truncate">
                        {m.movement_type === 'transfer'
                          ? `${m.source_loc?.name} → ${m.dest_loc?.name}`
                          : `To: ${m.department?.name || 'Operations'} • By: ${m.responsible_person?.name || 'Staff'}`}
                      </div>
                    </div>
                  ))}
                  {recentMovements.length === 0 && (
                    <div className="py-8 text-center text-stone-400">No recent store issues logged.</div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* TAB 2: Inter-Location Stock Transfer (Fridge / Counters) */}
      {activeTab === 'transfer' && (
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-amber-600" />
                Inter-Location Transfer (Pre-Packaged / Room Transfer)
              </CardTitle>
              <CardDescription>
                Transfers packaged items (e.g. Water Bottles, Coke Cans, Juices, Glasses) between Store and Service Fridges / Counters. Total business stock remains unchanged.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleTransferSubmit} className="space-y-4 text-xs">
                {/* Item Selection */}
                <div>
                  <label className="block font-medium text-stone-700 mb-1">
                    Select Inventory Item <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={transferItemId}
                    onChange={(e) => setTransferItemId(e.target.value)}
                    required
                    className="w-full rounded-md border border-stone-300 p-2 text-stone-900 bg-white focus:outline-none"
                  >
                    <option value="">Select Item SKU...</option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>
                        [{it.item_code}] {it.name} ({it.inventory_class})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Source & Destination Locations */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-stone-700 mb-1">
                      From Location (Source) <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={transferSrcLoc}
                      onChange={(e) => setTransferSrcLoc(e.target.value)}
                      required
                      className="w-full rounded-md border border-stone-300 p-2 text-stone-900 bg-white focus:outline-none"
                    >
                      <option value="">Select Source Location...</option>
                      {locations.map((loc) => {
                        const it = items.find((i) => i.id === transferItemId);
                        const avail = it?.location_stocks?.find((ls: any) => ls.location_id === loc.id)?.quantity || 0;
                        return (
                          <option key={loc.id} value={loc.id} disabled={transferItemId ? Number(avail) <= 0 : false}>
                            {loc.name} {transferItemId ? `(${avail} available)` : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div>
                    <label className="block font-medium text-stone-700 mb-1">
                      To Location (Destination) <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={transferDestLoc}
                      onChange={(e) => setTransferDestLoc(e.target.value)}
                      required
                      className="w-full rounded-md border border-stone-300 p-2 text-stone-900 bg-white focus:outline-none"
                    >
                      <option value="">Select Destination Location...</option>
                      {locations
                        .filter((l) => l.id !== transferSrcLoc)
                        .map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name} ({loc.location_type})
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                {/* Quantity & Unit */}
                {(() => {
                  const it = items.find((i) => i.id === transferItemId);
                  const factor = Number(it?.conversion_factor || 1);
                  const hasPack = it?.secondary_unit_id && factor > 1;

                  return (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block font-medium text-stone-700 mb-1">
                          Transfer Quantity <span className="text-red-500">*</span>
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            min="0.001"
                            step="any"
                            value={transferQty || ''}
                            onChange={(e) => setTransferQty(parseFloat(e.target.value) || 0)}
                            placeholder="1"
                            required
                            className="flex-1 rounded-md border border-stone-300 p-2 font-bold text-stone-900 bg-white"
                          />
                          {hasPack && (
                            <button
                              type="button"
                              onClick={() => setTransferUsePack(!transferUsePack)}
                              className={`px-3 py-2 rounded border font-semibold text-xs transition-colors ${
                                transferUsePack
                                  ? 'bg-amber-100 text-amber-900 border-amber-300'
                                  : 'bg-white text-stone-700 border-stone-300'
                              }`}
                            >
                              {transferUsePack
                                ? `${it.sec_unit?.symbol} (×${factor})`
                                : it.unit?.symbol || 'units'}
                            </button>
                          )}
                        </div>
                      </div>

                      <div>
                        <label className="block font-medium text-stone-700 mb-1">Calculated Base Units</label>
                        <div className="p-2 bg-stone-50 rounded-md border border-stone-200 text-stone-800 font-mono font-bold flex items-center justify-between">
                          <span>
                            {transferQty * (transferUsePack ? factor : 1)} {it?.unit?.symbol || 'units'}
                          </span>
                          {transferUsePack && (
                            <span className="text-[10px] text-amber-700 font-normal">
                              ({transferQty} {it?.sec_unit?.symbol} × {factor})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Transfer Remarks */}
                <div>
                  <label className="block font-medium text-stone-700 mb-1">Transfer Remarks</label>
                  <input
                    type="text"
                    value={transferNotes}
                    onChange={(e) => setTransferNotes(e.target.value)}
                    placeholder="e.g. Replenishing front fridge for banquet dinner"
                    className="w-full rounded-md border border-stone-300 p-2 text-stone-900 bg-white focus:outline-none"
                  />
                </div>

                <div className="flex justify-end pt-3 border-t">
                  <Button type="submit" variant="primary" disabled={saving} className="bg-amber-600 hover:bg-amber-700 text-white">
                    {saving ? 'Executing Transfer...' : 'Confirm Location Transfer'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
