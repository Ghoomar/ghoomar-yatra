'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { createClient } from '@/lib/supabase/client';
import { formatINR, getTodayBusinessDate } from '@/lib/utils';
import { logAuditAction } from '@/lib/audit-logger';
import { useI18n } from '@/lib/i18n/context';
import { getLocalizedMasterName, getLocalizedMasterSymbol } from '@/lib/i18n/master-data';
import {
  ArrowRightLeft,
  Users,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  MapPin,
  Clock,
  ArrowRight,
  ShieldCheck,
  Utensils,
  AlertTriangle,
  FileText,
  Filter,
  Package,
} from 'lucide-react';

interface IssueLine {
  item_id: string;
  quantity: number;
  use_pack_unit?: boolean;
}

interface TransferLine {
  item_id: string;
  quantity: number;
  use_pack_unit?: boolean;
}

export default function StoreIssuesPage() {
  const { t, locale } = useI18n();
  const supabase = createClient();
  const [businessDate, setBusinessDate] = useState(getTodayBusinessDate());
  const [activeTab, setActiveTab] = useState<'issue' | 'transfer' | 'wastage'>('issue');

  // Master Data
  const [items, setItems] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [recentMovements, setRecentMovements] = useState<any[]>([]);
  const [dispatchFilter, setDispatchFilter] = useState<'all' | 'issue' | 'transfer' | 'waste'>('all');

  // Issue Form State
  const [sourceLocationId, setSourceLocationId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [deptFilterId, setDeptFilterId] = useState('');
  const [teamFilterId, setTeamFilterId] = useState('');
  const [isStaffKhana, setIsStaffKhana] = useState(false);
  const [issueNotes, setIssueNotes] = useState('');
  const [issueLines, setIssueLines] = useState<IssueLine[]>([{ item_id: '', quantity: 1, use_pack_unit: false }]);

  // Transfer Form State
  const [transferSrcLoc, setTransferSrcLoc] = useState('');
  const [transferDestLoc, setTransferDestLoc] = useState('');
  const [transferNotes, setTransferNotes] = useState('');
  const [transferLines, setTransferLines] = useState<TransferLine[]>([{ item_id: '', quantity: 1, use_pack_unit: false }]);

  // Wastage / Spoilage Form State
  const [wasteType, setWasteType] = useState<'Wastage' | 'Spoilage'>('Wastage');
  const [wasteLocId, setWasteLocId] = useState('');
  const [wasteItemId, setWasteItemId] = useState('');
  const [wasteQty, setWasteQty] = useState<number>(1);
  const [wasteNotes, setWasteNotes] = useState('');

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
        { data: profData },
      ] = await Promise.all([
        supabase
          .from('inventory_items')
          .select(`
            *,
            unit:units!inventory_items_unit_id_fkey(symbol, symbol_hi, name, name_hi),
            sec_unit:units!inventory_items_secondary_unit_id_fkey(symbol, symbol_hi, name, name_hi),
            category:inventory_categories(id, name, name_hi, inventory_class),
            location_stocks:item_location_stocks(location_id, quantity)
          `)
          .eq('is_active', true)
          .order('name'),
        supabase.from('inventory_locations').select('*').eq('is_active', true).order('name'),
        supabase.from('departments').select('*').eq('is_active', true).order('name'),
        supabase.from('teams').select('*, department:departments(id, name, name_hi)').eq('is_active', true).order('name'),
        supabase.from('employees')
          .select('id, name, employee_code, employment_status, department_id, team_id, department:departments(id, name, name_hi), team:teams(id, name, name_hi), role:employee_roles(id, name, name_hi)')
          .eq('employment_status', 'Active')
          .order('name'),
        supabase.from('profiles').select('id, full_name, email'),
      ]);

      setItems(iData || []);
      setLocations(locData || []);
      setDepartments(dData || []);
      setTeams(tData || []);
      setEmployees(eData || []);
      setProfiles(profData || []);

      // Default source locations to Central Store
      const storeLoc = (locData || []).find((l: any) => l.code === 'STORE');
      if (storeLoc) {
        if (!sourceLocationId) setSourceLocationId(storeLoc.id);
        if (!transferSrcLoc) setTransferSrcLoc(storeLoc.id);
        if (!wasteLocId) setWasteLocId(storeLoc.id);
      }

      // Default destination for transfer to customer fridge or beverage counter
      const fridgeLoc = (locData || []).find((l: any) => l.code === 'FRIDGE-COKE' || l.code === 'BEV-CTR');
      if (fridgeLoc && !transferDestLoc) {
        setTransferDestLoc(fridgeLoc.id);
      }

      // Load recent ledger movements (issues, transfers, staff food, wastage, spoilage)
      const { data: mData, error: mErr } = await supabase
        .from('stock_movements')
        .select(`
          id, business_date, movement_type, quantity, unit_cost, total_value, purpose, notes, created_at, created_by,
          item:inventory_items(name, name_hi, item_code, unit:units!inventory_items_unit_id_fkey(symbol, symbol_hi, name, name_hi)),
          department:departments(name, name_hi),
          responsible_person:employees!stock_movements_responsible_person_id_fkey(
            name,
            team:teams(name, name_hi),
            role:employee_roles(name, name_hi)
          ),
          source_loc:inventory_locations!stock_movements_source_location_id_fkey(name, name_hi),
          dest_loc:inventory_locations!stock_movements_destination_location_id_fkey(name, name_hi)
        `)
        .in('movement_type', ['issue', 'consumption_issue', 'staff_food', 'wastage', 'spoilage', 'transfer'])
        .order('created_at', { ascending: false })
        .limit(35);

      if (mErr) {
        console.error('Error loading recent store movements:', mErr);
      }
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

  // Profile lookup map for auditability (Issued By)
  const profileMap = useMemo(() => {
    const map = new Map<string, string>();
    profiles.forEach((p) => {
      map.set(p.id, p.full_name || p.email);
    });
    return map;
  }, [profiles]);

  // Selected Employee Details & Derived Context
  const selectedStaff = useMemo(() => {
    return employees.find((e) => e.id === employeeId) || null;
  }, [employees, employeeId]);

  // When staff is selected directly, auto-derive Department & Team
  const handleStaffSelect = (empId: string) => {
    setEmployeeId(empId);
    if (!empId) return;

    const emp = employees.find((e) => e.id === empId);
    if (emp) {
      if (emp.department_id) setDeptFilterId(emp.department_id);
      if (emp.team_id) setTeamFilterId(emp.team_id);
    }
  };

  // Staff filtering: optional cascade if storekeeper wants to filter staff dropdown
  const filteredEmployees = useMemo(() => {
    let pool = employees;
    if (deptFilterId) {
      pool = pool.filter((e) => e.department_id === deptFilterId);
    }
    if (teamFilterId) {
      pool = pool.filter((e) => e.team_id === teamFilterId);
    }
    return pool;
  }, [employees, deptFilterId, teamFilterId]);

  // Available teams for selected department filter
  const availableTeams = useMemo(() => {
    if (!deptFilterId) return teams;
    return teams.filter((t) => t.department_id === deptFilterId);
  }, [teams, deptFilterId]);

  // Eligible items for Issue: Food Raw Material & Non-Food Consumables ONLY
  // (Excludes Physical Assets, Uniforms, and dedicated Utility fuels)
  const eligibleIssueItems = useMemo(() => {
    return items.filter((it) => {
      if (it.inventory_class !== 'Food Raw Material' && it.inventory_class !== 'Non-Food Consumable') {
        return false;
      }
      const catName = it.category?.name || '';
      if (catName.toLowerCase().includes('fuel') || catName.toLowerCase().includes('generator') || catName.toLowerCase().includes('lpg') || catName.toLowerCase().includes('diesel')) {
        return false;
      }
      if (it.id === 'd1e5e100-0001-4000-a000-000000000001' || it.id === '195c1900-0002-4000-a000-000000000002') {
        return false;
      }
      return true;
    });
  }, [items]);

  // Eligible items for Transfer (Food Raw Material, Non-Food Consumable with location stocks)
  const eligibleTransferItems = useMemo(() => {
    return items.filter((it) => {
      if (it.inventory_class === 'Physical Asset' || it.inventory_class === 'Uniform') {
        return false;
      }
      const catName = it.category?.name || '';
      if (catName.toLowerCase().includes('fuel') || catName.toLowerCase().includes('generator') || catName.toLowerCase().includes('lpg') || catName.toLowerCase().includes('diesel')) {
        return false;
      }
      return true;
    });
  }, [items]);

  // Helper to get available stock of an item in a specific location
  const getItemStockAtLocation = (it: any, locId: string): number => {
    if (!it || !locId) return 0;
    const ls = it.location_stocks?.find((s: any) => s.location_id === locId);
    return Number(ls?.quantity || 0);
  };

  // Issue Line Operations
  const handleAddIssueLine = () => {
    setIssueLines([...issueLines, { item_id: '', quantity: 1, use_pack_unit: false }]);
  };

  const handleRemoveIssueLine = (idx: number) => {
    if (issueLines.length > 1) {
      setIssueLines(issueLines.filter((_, i) => i !== idx));
    }
  };

  const calculateIssueTotal = () => {
    return issueLines.reduce((sum, l) => {
      const it = items.find((i) => i.id === l.item_id);
      const wac = Number(it?.current_weighted_average_cost || 0);
      const factor = l.use_pack_unit ? Number(it?.conversion_factor || 1) : 1;
      return sum + (l.quantity || 0) * factor * wac;
    }, 0);
  };

  // Transfer Line Operations
  const handleAddTransferLine = () => {
    setTransferLines([...transferLines, { item_id: '', quantity: 1, use_pack_unit: false }]);
  };

  const handleRemoveTransferLine = (idx: number) => {
    if (transferLines.length > 1) {
      setTransferLines(transferLines.filter((_, i) => i !== idx));
    }
  };

  const calculateTransferTotal = () => {
    return transferLines.reduce((sum, l) => {
      const it = items.find((i) => i.id === l.item_id);
      const wac = Number(it?.current_weighted_average_cost || 0);
      const factor = l.use_pack_unit ? Number(it?.conversion_factor || 1) : 1;
      return sum + (l.quantity || 0) * factor * wac;
    }, 0);
  };

  // ==========================================
  // 1. SUBMIT NORMAL STORE ISSUE
  // ==========================================
  const handleIssueSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!sourceLocationId) {
      setMessage({ type: 'error', text: locale === 'hi' ? 'स्टोर लोकेशन चुनना अनिवार्य है।' : 'Source Store Location is required.' });
      return;
    }

    if (!employeeId) {
      setMessage({
        type: 'error',
        text: locale === 'hi'
          ? 'सामान लेने वाला स्टाफ चुनना अनिवार्य है। (Auditability requirement)'
          : 'Receiving staff member is strictly required for store issues.',
      });
      return;
    }

    if (issueLines.length === 0 || issueLines.some((l) => !l.item_id || l.quantity <= 0)) {
      setMessage({
        type: 'error',
        text: locale === 'hi' ? 'कृपया सभी सामान और सही मात्रा दर्ज करें।' : 'Please specify valid items and quantities greater than 0.',
      });
      return;
    }

    // Zero-stock and quantity validation against selected source location
    for (const line of issueLines) {
      const it = items.find((i) => i.id === line.item_id);
      if (!it) continue;
      const factor = line.use_pack_unit ? Number(it.conversion_factor || 1) : 1;
      const requestedBaseQty = line.quantity * factor;
      const locStock = getItemStockAtLocation(it, sourceLocationId);

      if (locStock <= 0) {
        const itName = getLocalizedMasterName(it, locale) || it.name;
        setMessage({
          type: 'error',
          text: locale === 'hi'
            ? `"${itName}" स्टोर में उपलब्ध नहीं है (स्टॉक समाप्त)।`
            : `"${itName}" is out of stock in the selected location.`,
        });
        return;
      }

      if (requestedBaseQty > locStock) {
        const itUnitSym = getLocalizedMasterSymbol(it.unit, locale) || it.unit?.symbol || 'units';
        const itName = getLocalizedMasterName(it, locale) || it.name;
        setMessage({
          type: 'error',
          text: locale === 'hi'
            ? `"${itName}" के लिए स्टोर में पर्याप्त स्टॉक नहीं है। अनुरोधित: ${requestedBaseQty} ${itUnitSym}, उपलब्ध: ${locStock} ${itUnitSym}।`
            : `Insufficient stock for "${itName}". Requested: ${requestedBaseQty} ${itUnitSym}, Available in store: ${locStock} ${itUnitSym}.`,
        });
        return;
      }
    }

    setSaving(true);
    setMessage(null);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const staff = selectedStaff;
      const derivedDeptId = staff?.department_id || null;
      const derivedTeamId = staff?.team_id || null;

      // Determine Header Purpose:
      // If Staff Khana is checked -> 'Staff Food'
      // Otherwise check if any line is Food Raw Material -> 'Customer Food', else 'Operational Consumption'
      const hasFoodItem = issueLines.some((l) => {
        const it = items.find((i) => i.id === l.item_id);
        return it?.inventory_class === 'Food Raw Material';
      });

      const headerPurpose = isStaffKhana
        ? 'Staff Food'
        : hasFoodItem
        ? 'Customer Food'
        : 'Operational Consumption';

      // 1. Create consumption_issues header (auditable voucher)
      const { data: issueHeader, error: hErr } = await supabase
        .from('consumption_issues')
        .insert({
          business_date: businessDate,
          source_location_id: sourceLocationId,
          department_id: derivedDeptId,
          team_id: derivedTeamId,
          received_by_staff_id: employeeId,
          responsible_chef_id: employeeId,
          purpose: headerPurpose,
          notes: issueNotes || null,
          created_by: user?.id || null,
        })
        .select()
        .single();

      if (hErr) throw hErr;

      // 2. Process each line: insert into consumption_issue_items + execute stored procedure
      for (const line of issueLines) {
        const it = items.find((i) => i.id === line.item_id);
        if (!it) continue;
        const factor = line.use_pack_unit ? Number(it.conversion_factor || 1) : 1;
        const baseQty = line.quantity * factor;
        const unitCost = Number(it.current_weighted_average_cost || 0);

        // Derive line purpose & movement_type
        let lineMovType = 'issue';
        let linePurpose = 'Operational Consumption';

        if (isStaffKhana) {
          lineMovType = 'staff_food';
          linePurpose = 'Staff Food';
        } else if (it.inventory_class === 'Food Raw Material') {
          lineMovType = 'issue';
          linePurpose = 'Customer Food';
        } else {
          lineMovType = 'issue';
          linePurpose = 'Operational Consumption';
        }

        // Insert line item
        await supabase.from('consumption_issue_items').insert({
          issue_id: issueHeader.id,
          item_id: line.item_id,
          quantity: baseQty,
          unit_cost: unitCost,
          total_value: baseQty * unitCost,
        });

        // Execute atomic stock transaction
        const { error: txErr } = await supabase.rpc('execute_inventory_transaction', {
          p_item_id: line.item_id,
          p_business_date: businessDate,
          p_movement_type: lineMovType,
          p_quantity: baseQty,
          p_unit_cost: unitCost,
          p_source_location_id: sourceLocationId,
          p_department_id: derivedDeptId,
          p_responsible_person_id: employeeId,
          p_purpose: linePurpose,
          p_reference_id: issueHeader.id,
          p_reference_type: 'consumption_issues',
          p_notes: issueNotes || `Issued to ${staff?.name || 'Staff'}${staff?.department?.name ? ` (${staff.department.name})` : ''}`,
          p_created_by: user?.id || null,
        });

        if (txErr) throw txErr;
      }

      await logAuditAction({
        action: 'CREATE',
        entity: 'Store Issue',
        entityId: issueHeader.id,
        details: {
          business_date: businessDate,
          received_by: staff?.name,
          department_id: derivedDeptId,
          items_count: issueLines.length,
          total_value: calculateIssueTotal(),
          is_staff_khana: isStaffKhana,
        },
      });

      setMessage({
        type: 'success',
        text: locale === 'hi'
          ? `स्टॉक सफलतापूर्वक दिया गया। प्राप्तकर्ता: ${staff?.name}।`
          : `Stock issued successfully. Received by: ${staff?.name}.`,
      });

      // Reset form
      setIssueLines([{ item_id: '', quantity: 1, use_pack_unit: false }]);
      setIssueNotes('');
      setIsStaffKhana(false);
      await loadData();
    } catch (err: any) {
      console.error('Error executing store issue:', err);
      setMessage({ type: 'error', text: err.message || 'Error recording store issue.' });
    } finally {
      setSaving(false);
    }
  };

  // ==========================================
  // 2. SUBMIT INTER-LOCATION TRANSFER
  // ==========================================
  const handleTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!transferSrcLoc || !transferDestLoc) {
      setMessage({ type: 'error', text: locale === 'hi' ? 'दोनों लोकेशन चुनना आवश्यक है।' : 'Source and destination locations are required.' });
      return;
    }

    if (transferSrcLoc === transferDestLoc) {
      setMessage({ type: 'error', text: locale === 'hi' ? 'कहाँ से और कहाँ तक दोनों एक ही जगह नहीं हो सकते।' : 'Source and destination locations cannot be the same.' });
      return;
    }

    if (transferLines.length === 0 || transferLines.some((l) => !l.item_id || l.quantity <= 0)) {
      setMessage({ type: 'error', text: locale === 'hi' ? 'कृपया सभी ट्रांसफर सामान और सही मात्रा दर्ज करें।' : 'Please specify valid items and quantities for transfer.' });
      return;
    }

    // Validate quantities against source location stock
    for (const line of transferLines) {
      const it = items.find((i) => i.id === line.item_id);
      if (!it) continue;
      const factor = line.use_pack_unit ? Number(it.conversion_factor || 1) : 1;
      const baseQty = line.quantity * factor;
      const srcStock = getItemStockAtLocation(it, transferSrcLoc);

      if (baseQty > srcStock) {
        const itUnitSym = getLocalizedMasterSymbol(it.unit, locale) || it.unit?.symbol || 'units';
        const itName = getLocalizedMasterName(it, locale) || it.name;
        setMessage({
          type: 'error',
          text: locale === 'hi'
            ? `"${itName}" के लिए स्रोत में पर्याप्त स्टॉक नहीं है। अनुरोधित: ${baseQty} ${itUnitSym}, उपलब्ध: ${srcStock} ${itUnitSym}।`
            : `Insufficient stock for "${itName}" at source location. Requested: ${baseQty} ${itUnitSym}, Available: ${srcStock} ${itUnitSym}.`,
        });
        return;
      }
    }

    setSaving(true);
    setMessage(null);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const srcName = locations.find((l) => l.id === transferSrcLoc)?.name || 'Source';
      const destName = locations.find((l) => l.id === transferDestLoc)?.name || 'Destination';

      for (const line of transferLines) {
        const it = items.find((i) => i.id === line.item_id);
        if (!it) continue;
        const factor = line.use_pack_unit ? Number(it.conversion_factor || 1) : 1;
        const baseQty = line.quantity * factor;
        const unitCost = Number(it.current_weighted_average_cost || 0);

        const { error: txErr } = await supabase.rpc('execute_inventory_transaction', {
          p_item_id: line.item_id,
          p_business_date: businessDate,
          p_movement_type: 'transfer',
          p_quantity: baseQty,
          p_unit_cost: unitCost,
          p_source_location_id: transferSrcLoc,
          p_destination_location_id: transferDestLoc,
          p_purpose: 'Inter-Location Stock Transfer',
          p_notes: transferNotes || `Transferred from ${srcName} to ${destName}`,
          p_created_by: user?.id || null,
        });

        if (txErr) throw txErr;
      }

      await logAuditAction({
        action: 'CREATE',
        entity: 'Location Transfer',
        details: {
          business_date: businessDate,
          source_loc: srcName,
          dest_loc: destName,
          items_count: transferLines.length,
          total_value: calculateTransferTotal(),
        },
      });

      setMessage({
        type: 'success',
        text: locale === 'hi'
          ? `स्टॉक सफलता पूर्वक ${srcName} से ${destName} ट्रांसफर किया गया।`
          : `Successfully transferred items from ${srcName} to ${destName}.`,
      });

      setTransferLines([{ item_id: '', quantity: 1, use_pack_unit: false }]);
      setTransferNotes('');
      await loadData();
    } catch (err: any) {
      console.error('Error executing location transfer:', err);
      setMessage({ type: 'error', text: err.message || 'Error executing location transfer.' });
    } finally {
      setSaving(false);
    }
  };

  // ==========================================
  // 3. SUBMIT WASTAGE / SPOILAGE WRITE-OFF
  // ==========================================
  const handleWastageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!wasteLocId) {
      setMessage({ type: 'error', text: locale === 'hi' ? 'लोकेशन चुनना अनिवार्य है।' : 'Location is required.' });
      return;
    }

    if (!wasteItemId || wasteQty <= 0) {
      setMessage({ type: 'error', text: locale === 'hi' ? 'सामान और मात्रा दर्ज करें।' : 'Please select an item and valid quantity.' });
      return;
    }

    const it = items.find((i) => i.id === wasteItemId);
    if (!it) return;

    const locStock = getItemStockAtLocation(it, wasteLocId);
    if (wasteQty > locStock) {
      const itUnitSym = getLocalizedMasterSymbol(it.unit, locale) || it.unit?.symbol || 'units';
      const itName = getLocalizedMasterName(it, locale) || it.name;
      setMessage({
        type: 'error',
        text: locale === 'hi'
          ? `"${itName}" के लिए लोकेशन में पर्याप्त स्टॉक नहीं है। अनुरोधित: ${wasteQty} ${itUnitSym}, उपलब्ध: ${locStock} ${itUnitSym}।`
          : `Cannot write off more than available stock (${locStock} ${itUnitSym}).`,
      });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const unitCost = Number(it.current_weighted_average_cost || 0);
      const locName = locations.find((l) => l.id === wasteLocId)?.name || 'Store';
      const movType = wasteType === 'Spoilage' ? 'spoilage' : 'wastage';

      const { error: txErr } = await supabase.rpc('execute_inventory_transaction', {
        p_item_id: wasteItemId,
        p_business_date: businessDate,
        p_movement_type: movType,
        p_quantity: wasteQty,
        p_unit_cost: unitCost,
        p_source_location_id: wasteLocId,
        p_purpose: wasteType,
        p_notes: wasteNotes || `${wasteType} at ${locName}`,
        p_created_by: user?.id || null,
        p_department_id: null,
        p_responsible_person_id: null,
      });

      if (txErr) throw txErr;

      await logAuditAction({
        action: 'CREATE',
        entity: `Stock Write-off (${wasteType})`,
        details: {
          business_date: businessDate,
          item_id: wasteItemId,
          quantity: wasteQty,
          total_value: wasteQty * unitCost,
          location: locName,
          reason: wasteNotes,
        },
      });

      setMessage({
        type: 'success',
        text: locale === 'hi'
          ? `${wasteType === 'Spoilage' ? 'खराबी' : 'वेस्टेज'} सफलतापूर्वक दर्ज की गई।`
          : `Successfully recorded ${wasteType} write-off.`,
      });

      setWasteItemId('');
      setWasteQty(1);
      setWasteNotes('');
      await loadData();
    } catch (err: any) {
      console.error('Error recording wastage:', err);
      setMessage({ type: 'error', text: err.message || 'Error recording wastage write-off.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Bar / Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <ArrowRightLeft className="h-6 w-6 text-amber-600" />
            {t('inventory.issues.title')}
          </h1>
          <p className="text-xs text-stone-500 mt-1">
            {t('inventory.issues.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-white border border-stone-200 rounded-lg px-2.5 py-1 shadow-xs">
            <Clock className="h-4 w-4 text-stone-400" />
            <span className="text-xs text-stone-500">{t('inventory.issues.issueDate')}</span>
            <input
              type="date"
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
              className="text-xs font-mono font-semibold bg-transparent text-stone-800 focus:outline-none"
            />
          </div>
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading} className="gap-1.5 shadow-xs">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      {/* Message Banner */}
      {message && (
        <div
          className={`p-3.5 rounded-xl text-xs flex items-center gap-2 font-medium border shadow-xs ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
          )}
          {message.text}
        </div>
      )}

      {/* Main Mode Tabs */}
      <div className="flex border-b border-stone-200 gap-4 text-xs font-semibold">
        <button
          onClick={() => setActiveTab('issue')}
          className={`pb-2.5 transition-colors flex items-center gap-1.5 ${
            activeTab === 'issue'
              ? 'border-b-2 border-amber-600 text-amber-700 font-bold'
              : 'text-stone-500 hover:text-stone-800'
          }`}
        >
          <Users className="h-4 w-4" /> {t('inventory.issues.tabIssue')}
        </button>
        <button
          onClick={() => setActiveTab('transfer')}
          className={`pb-2.5 transition-colors flex items-center gap-1.5 ${
            activeTab === 'transfer'
              ? 'border-b-2 border-amber-600 text-amber-700 font-bold'
              : 'text-stone-500 hover:text-stone-800'
          }`}
        >
          <MapPin className="h-4 w-4" /> {t('inventory.issues.tabTransfer')}
        </button>
        <button
          onClick={() => setActiveTab('wastage')}
          className={`pb-2.5 transition-colors flex items-center gap-1.5 ${
            activeTab === 'wastage'
              ? 'border-b-2 border-rose-600 text-rose-700 font-bold'
              : 'text-stone-500 hover:text-stone-800'
          }`}
        >
          <Trash2 className="h-4 w-4" /> {t('inventory.issues.tabWastage')}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Active Form */}
        <div className="lg:col-span-2 space-y-6">
          {/* TAB 1: ISSUE STOCK TO STAFF */}
          {activeTab === 'issue' && (
            <Card className="border-stone-200 shadow-sm">
              <CardHeader className="pb-3 border-b border-stone-100">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-5 w-5 text-amber-600" />
                  {t('inventory.issues.recordIssue')}
                </CardTitle>
                <CardDescription className="text-xs">
                  {locale === 'hi'
                    ? 'स्टोर से स्टाफ को सामान देने की रसीद दर्ज करें। सामान लेने वाला स्टाफ अनिवार्य है।'
                    : 'Physical handover voucher from store to accountable staff recipient.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                <form onSubmit={handleIssueSubmit} className="space-y-4 text-xs">
                  {/* Row 1: Source Store Location */}
                  <div className="bg-amber-50/60 p-3 rounded-xl border border-amber-200">
                    <label className="block font-semibold text-amber-950 mb-1 flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-amber-600" />
                      {t('inventory.issues.sourceLocation')} <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={sourceLocationId}
                      onChange={(e) => setSourceLocationId(e.target.value)}
                      required
                      className="w-full rounded-lg border border-amber-300 p-2 text-stone-900 bg-white font-medium focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    >
                      <option value="">{t('inventory.issues.selectSourceLocation')}</option>
                      {locations.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {getLocalizedMasterName(loc, locale)} ({loc.code || loc.location_type})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Row 2: Accountable Receiving Staff (Required) with Auto-Inferred Department & Team */}
                  <div className="p-3.5 rounded-xl border border-stone-200 bg-stone-50/60 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <label className="font-bold text-stone-900 flex items-center gap-1.5">
                        <ShieldCheck className="h-4 w-4 text-emerald-600" />
                        {t('inventory.issues.handoverTo')} <span className="text-rose-500">*</span>
                        <span className="text-[10px] text-stone-400 font-normal">
                          ({locale === 'hi' ? 'जवाबदेह स्टाफ' : 'Accountable Recipient'})
                        </span>
                      </label>

                      {/* Optional Department Cascade Filter */}
                      <div className="flex items-center gap-1.5">
                        <Filter className="h-3 w-3 text-stone-400" />
                        <select
                          value={deptFilterId}
                          onChange={(e) => {
                            setDeptFilterId(e.target.value);
                            setTeamFilterId('');
                          }}
                          className="text-[11px] rounded border border-stone-200 bg-white px-2 py-1 text-stone-700 focus:outline-none"
                        >
                          <option value="">{t('inventory.issues.allStaff')}</option>
                          {departments.map((d) => (
                            <option key={d.id} value={d.id}>
                              {getLocalizedMasterName(d, locale)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Primary Staff Selector */}
                    <div>
                      <SearchableSelect
                        options={filteredEmployees}
                        value={employeeId}
                        onChange={(val) => handleStaffSelect(val)}
                        labelKey={(emp) => emp.name}
                        secondaryLabelKey={(emp) => {
                          const roleStr = getLocalizedMasterName(emp.role, locale) || emp.role?.name || '';
                          const deptStr = getLocalizedMasterName(emp.department, locale) || emp.department?.name || '';
                          return roleStr ? `${roleStr} • ${deptStr}` : deptStr;
                        }}
                        placeholder={t('inventory.issues.selectEligibleStaff')}
                        required
                        className="w-full"
                        triggerClassName="p-2.5 font-semibold text-xs shadow-xs"
                        renderOption={(emp) => {
                          const roleStr = getLocalizedMasterName(emp.role, locale) || emp.role?.name || '';
                          const deptStr = getLocalizedMasterName(emp.department, locale) || emp.department?.name || '';
                          return (
                            <div className="w-full">
                              <div className="font-semibold text-stone-900">{emp.name}</div>
                              <div className="text-[11px] text-stone-500">
                                {roleStr} {deptStr ? `• ${deptStr}` : ''}
                              </div>
                            </div>
                          );
                        }}
                      />
                    </div>

                    {/* Auto-inferred Contextual Banner */}
                    {selectedStaff && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-2.5 bg-white rounded-lg border border-emerald-200 text-[11px]">
                        <div>
                          <span className="text-stone-400 block">{t('inventory.issues.department')} ({t('inventory.issues.autoDerived')})</span>
                          <span className="font-bold text-stone-800">
                            {getLocalizedMasterName(selectedStaff.department, locale) || selectedStaff.department?.name || '—'}
                          </span>
                        </div>
                        <div>
                          <span className="text-stone-400 block">{t('inventory.issues.team')} ({t('inventory.issues.autoDerived')})</span>
                          <span className="font-semibold text-stone-700">
                            {getLocalizedMasterName(selectedStaff.team, locale) || selectedStaff.team?.name || (locale === 'hi' ? 'सामान्य' : 'General')}
                          </span>
                        </div>
                        <div className="col-span-2 sm:col-span-1">
                          <span className="text-stone-400 block">{locale === 'hi' ? 'स्टाफ कोड' : 'Employee ID'}</span>
                          <span className="font-mono text-stone-600">{selectedStaff.employee_code}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Row 3: Items to Issue (Multi-line) */}
                  <div className="space-y-2 border-t pt-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-stone-900 text-xs flex items-center gap-1.5">
                        <Package className="h-4 w-4 text-stone-500" />
                        {t('inventory.issues.itemLines')}
                      </span>
                      <Button type="button" variant="outline" size="sm" onClick={handleAddIssueLine} className="gap-1 text-xs shadow-xs">
                        <Plus className="h-3.5 w-3.5" /> {t('inventory.issues.addLine')}
                      </Button>
                    </div>

                    <div className="space-y-2">
                      {issueLines.map((line, idx) => {
                        const selectedItem = items.find((i) => i.id === line.item_id);
                        const storeStock = getItemStockAtLocation(selectedItem, sourceLocationId);
                        const factor = Number(selectedItem?.conversion_factor || 1);
                        const hasPack = selectedItem?.secondary_unit_id && factor > 1;
                        const baseUnitSym = getLocalizedMasterSymbol(selectedItem?.unit, locale) || selectedItem?.unit?.symbol || 'units';
                        const secUnitSym = getLocalizedMasterSymbol(selectedItem?.sec_unit, locale) || selectedItem?.sec_unit?.symbol || 'pack';
                        const lineBaseQty = (line.quantity || 0) * (line.use_pack_unit ? factor : 1);
                        const isOverStock = selectedItem && lineBaseQty > storeStock;
                        const isZeroStock = selectedItem && storeStock <= 0;

                        return (
                          <div
                            key={idx}
                            className={`flex flex-col sm:flex-row items-start sm:items-center gap-2 p-2.5 rounded-xl border transition-colors ${
                              isOverStock || isZeroStock ? 'bg-rose-50/70 border-rose-200' : 'bg-stone-50/70 border-stone-200'
                            }`}
                          >
                            {/* Item Selector */}
                            <div className="flex-1 w-full">
                              <SearchableSelect
                                options={eligibleIssueItems}
                                value={line.item_id}
                                onChange={(val) => {
                                  const updated = [...issueLines];
                                  updated[idx].item_id = val;
                                  setIssueLines(updated);
                                }}
                                isOptionDisabled={(it) => getItemStockAtLocation(it, sourceLocationId) <= 0}
                                labelKey={(it) => getLocalizedMasterName(it, locale) || it.name}
                                secondaryLabelKey={(it) => {
                                  const locQty = getItemStockAtLocation(it, sourceLocationId);
                                  const itUnitSym = getLocalizedMasterSymbol(it.unit, locale) || it.unit?.symbol || 'units';
                                  return locQty <= 0 ? t('inventory.issues.outOfStock') : `${locQty} ${itUnitSym}`;
                                }}
                                placeholder={t('inventory.issues.selectItem')}
                                required
                                className="w-full"
                                triggerClassName="p-2 font-medium bg-white text-xs rounded-lg"
                                renderOption={(it) => {
                                  const locQty = getItemStockAtLocation(it, sourceLocationId);
                                  const itUnitSym = getLocalizedMasterSymbol(it.unit, locale) || it.unit?.symbol || 'units';
                                  const out = locQty <= 0;
                                  return (
                                    <div className="flex items-center justify-between w-full">
                                      <div className="truncate font-medium text-stone-900">
                                        {getLocalizedMasterName(it, locale) || it.name}
                                      </div>
                                      <span
                                        className={`text-[10px] px-1.5 py-0.5 rounded font-mono ml-2 shrink-0 ${
                                          out ? 'bg-rose-100 text-rose-700 font-bold' : 'bg-emerald-50 text-emerald-800'
                                        }`}
                                      >
                                        {out ? `[${t('inventory.issues.outOfStock')}]` : `${locQty} ${itUnitSym}`}
                                      </span>
                                    </div>
                                  );
                                }}
                              />
                              {selectedItem && (
                                <div className="mt-1 flex items-center gap-2 text-[10px]">
                                  <span className={storeStock > 0 ? 'text-stone-500' : 'text-rose-600 font-bold'}>
                                    {t('inventory.issues.available')}: {storeStock} {baseUnitSym}
                                  </span>
                                  {isOverStock && (
                                    <span className="text-rose-600 font-bold flex items-center gap-0.5">
                                      <AlertTriangle className="h-3 w-3" />
                                      {t('inventory.issues.insufficientStock')}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Quantity Input */}
                            <div className="w-28">
                              <input
                                type="number"
                                step="any"
                                min="0.001"
                                max={hasPack && line.use_pack_unit ? storeStock / factor : storeStock}
                                value={line.quantity || ''}
                                onChange={(e) => {
                                  const updated = [...issueLines];
                                  updated[idx].quantity = parseFloat(e.target.value) || 0;
                                  setIssueLines(updated);
                                }}
                                placeholder={t('inventory.issues.qtyPlaceholder')}
                                required
                                className="w-full rounded-lg border border-stone-300 p-2 font-bold text-stone-900 bg-white text-right focus:outline-none"
                              />
                            </div>

                            {/* Pack Unit Toggle if applicable */}
                            <div className="w-28 text-[11px]">
                              {hasPack ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updated = [...issueLines];
                                    updated[idx].use_pack_unit = !updated[idx].use_pack_unit;
                                    setIssueLines(updated);
                                  }}
                                  className={`w-full py-2 px-2 rounded-lg border font-semibold transition-colors ${
                                    line.use_pack_unit
                                      ? 'bg-amber-100 text-amber-900 border-amber-300'
                                      : 'bg-white text-stone-700 border-stone-300'
                                  }`}
                                >
                                  {line.use_pack_unit ? `${secUnitSym} (×${factor})` : baseUnitSym}
                                </button>
                              ) : (
                                <span className="text-stone-500 font-mono py-2 px-2 block text-center bg-stone-100/50 rounded-lg">
                                  {baseUnitSym}
                                </span>
                              )}
                            </div>

                            {/* Line Total Valuation */}
                            <div className="w-24 text-right font-mono text-stone-700 font-semibold">
                              {selectedItem
                                ? formatINR(
                                    (line.quantity || 0) *
                                      (line.use_pack_unit ? factor : 1) *
                                      Number(selectedItem.current_weighted_average_cost || 0)
                                  )
                                : '—'}
                            </div>

                            {/* Delete Line */}
                            {issueLines.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveIssueLine(idx)}
                                className="text-stone-400 hover:text-rose-600 p-1.5 rounded-md hover:bg-rose-50 transition-colors"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Row 4: Usage Classification & Staff Khana Toggle */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                      <label className="flex items-center gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isStaffKhana}
                          onChange={(e) => setIsStaffKhana(e.target.checked)}
                          className="h-4 w-4 text-amber-600 rounded border-stone-300 focus:ring-amber-500"
                        />
                        <div>
                          <span className="font-bold text-stone-900 block flex items-center gap-1.5">
                            <Utensils className="h-3.5 w-3.5 text-amber-600" />
                            {t('inventory.issues.staffKhana')}
                          </span>
                          <span className="text-[10px] text-stone-500 block">
                            {t('inventory.issues.staffKhanaHelp')}
                          </span>
                        </div>
                      </label>
                    </div>

                    <div>
                      <label className="block font-semibold text-stone-700 mb-1">{t('common.notes')}</label>
                      <input
                        type="text"
                        value={issueNotes}
                        onChange={(e) => setIssueNotes(e.target.value)}
                        placeholder={t('inventory.issues.notesPlaceholder')}
                        className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 bg-white focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Bottom Action Bar */}
                  <div className="flex items-center justify-between pt-4 border-t">
                    <div className="text-xs">
                      <span className="text-stone-500">{t('inventory.issues.estimatedValue')}{' '}</span>
                      <span className="font-bold text-base text-stone-900 font-mono">
                        {formatINR(calculateIssueTotal())}
                      </span>
                    </div>

                    <Button
                      type="submit"
                      variant="primary"
                      disabled={saving || !employeeId || issueLines.some(l => !l.item_id || l.quantity <= 0)}
                      className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-5 shadow-xs"
                    >
                      {saving ? t('inventory.issues.processing') : t('inventory.issues.approveIssue')}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {/* TAB 2: INTER-LOCATION TRANSFERS */}
          {activeTab === 'transfer' && (
            <Card className="border-stone-200 shadow-sm">
              <CardHeader className="pb-3 border-b border-stone-100">
                <CardTitle className="text-base flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-amber-600" />
                  {t('inventory.issues.transferTitle')}
                </CardTitle>
                <CardDescription className="text-xs">
                  {locale === 'hi'
                    ? 'एक लोकेशन से दूसरी लोकेशन में स्टॉक ट्रांसफर। (पी एंड एल पर कोई असर नहीं)'
                    : 'Physical stock movement between storage locations with zero P&L impact.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                <form onSubmit={handleTransferSubmit} className="space-y-4 text-xs">
                  {/* Locations Row */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="bg-stone-50 p-3 rounded-xl border border-stone-200">
                      <label className="block font-semibold text-stone-800 mb-1">
                        {t('inventory.issues.fromLocation')} <span className="text-rose-500">*</span>
                      </label>
                      <select
                        value={transferSrcLoc}
                        onChange={(e) => setTransferSrcLoc(e.target.value)}
                        required
                        className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 bg-white font-medium focus:outline-none"
                      >
                        <option value="">{t('inventory.issues.selectSourceLocation')}</option>
                        {locations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {getLocalizedMasterName(loc, locale)} ({loc.code || loc.location_type})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="bg-stone-50 p-3 rounded-xl border border-stone-200">
                      <label className="block font-semibold text-stone-800 mb-1">
                        {t('inventory.issues.toLocation')} <span className="text-rose-500">*</span>
                      </label>
                      <select
                        value={transferDestLoc}
                        onChange={(e) => setTransferDestLoc(e.target.value)}
                        required
                        className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 bg-white font-medium focus:outline-none"
                      >
                        <option value="">{t('inventory.issues.selectDestLocation')}</option>
                        {locations
                          .filter((loc) => loc.id !== transferSrcLoc)
                          .map((loc) => (
                            <option key={loc.id} value={loc.id}>
                              {getLocalizedMasterName(loc, locale)} ({loc.code || loc.location_type})
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>

                  {/* Transfer Items Multi-line */}
                  <div className="space-y-2 border-t pt-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-stone-900 text-xs">
                        {t('inventory.issues.itemLines')}
                      </span>
                      <Button type="button" variant="outline" size="sm" onClick={handleAddTransferLine} className="gap-1 text-xs shadow-xs">
                        <Plus className="h-3.5 w-3.5" /> {t('inventory.issues.addTransferLine')}
                      </Button>
                    </div>

                    <div className="space-y-2">
                      {transferLines.map((line, idx) => {
                        const selectedItem = items.find((i) => i.id === line.item_id);
                        const storeStock = getItemStockAtLocation(selectedItem, transferSrcLoc);
                        const factor = Number(selectedItem?.conversion_factor || 1);
                        const hasPack = selectedItem?.secondary_unit_id && factor > 1;
                        const baseUnitSym = getLocalizedMasterSymbol(selectedItem?.unit, locale) || selectedItem?.unit?.symbol || 'units';
                        const secUnitSym = getLocalizedMasterSymbol(selectedItem?.sec_unit, locale) || selectedItem?.sec_unit?.symbol || 'pack';
                        const lineBaseQty = (line.quantity || 0) * (line.use_pack_unit ? factor : 1);
                        const isOverStock = selectedItem && lineBaseQty > storeStock;

                        return (
                          <div
                            key={idx}
                            className={`flex flex-col sm:flex-row items-start sm:items-center gap-2 p-2.5 rounded-xl border ${
                              isOverStock ? 'bg-rose-50/70 border-rose-200' : 'bg-stone-50/70 border-stone-200'
                            }`}
                          >
                            <div className="flex-1 w-full">
                              <SearchableSelect
                                options={eligibleTransferItems}
                                value={line.item_id}
                                onChange={(val) => {
                                  const updated = [...transferLines];
                                  updated[idx].item_id = val;
                                  setTransferLines(updated);
                                }}
                                isOptionDisabled={(it) => getItemStockAtLocation(it, transferSrcLoc) <= 0}
                                labelKey={(it) => getLocalizedMasterName(it, locale) || it.name}
                                secondaryLabelKey={(it) => {
                                  const locQty = getItemStockAtLocation(it, transferSrcLoc);
                                  const itUnitSym = getLocalizedMasterSymbol(it.unit, locale) || it.unit?.symbol || 'units';
                                  return locQty <= 0 ? t('inventory.issues.outOfStock') : `${locQty} ${itUnitSym}`;
                                }}
                                placeholder={t('inventory.issues.selectItem')}
                                required
                                className="w-full"
                                triggerClassName="p-2 font-medium bg-white text-xs rounded-lg"
                                renderOption={(it) => {
                                  const locQty = getItemStockAtLocation(it, transferSrcLoc);
                                  const itUnitSym = getLocalizedMasterSymbol(it.unit, locale) || it.unit?.symbol || 'units';
                                  const out = locQty <= 0;
                                  return (
                                    <div className="flex items-center justify-between w-full">
                                      <div className="truncate font-medium text-stone-900">
                                        {getLocalizedMasterName(it, locale) || it.name}
                                      </div>
                                      <span
                                        className={`text-[10px] px-1.5 py-0.5 rounded font-mono ml-2 shrink-0 ${
                                          out ? 'bg-rose-100 text-rose-700 font-bold' : 'bg-emerald-50 text-emerald-800'
                                        }`}
                                      >
                                        {out ? `[${t('inventory.issues.outOfStock')}]` : `${locQty} ${itUnitSym}`}
                                      </span>
                                    </div>
                                  );
                                }}
                              />
                              {selectedItem && (
                                <div className="mt-1 text-[10px] text-stone-500">
                                  {t('inventory.issues.available')}: {storeStock} {baseUnitSym}
                                </div>
                              )}
                            </div>

                            <div className="w-28">
                              <input
                                type="number"
                                step="any"
                                min="0.001"
                                max={hasPack && line.use_pack_unit ? storeStock / factor : storeStock}
                                value={line.quantity || ''}
                                onChange={(e) => {
                                  const updated = [...transferLines];
                                  updated[idx].quantity = parseFloat(e.target.value) || 0;
                                  setTransferLines(updated);
                                }}
                                placeholder={t('inventory.issues.qtyPlaceholder')}
                                required
                                className="w-full rounded-lg border border-stone-300 p-2 font-bold text-stone-900 bg-white text-right focus:outline-none"
                              />
                            </div>

                            <div className="w-28 text-[11px]">
                              {hasPack ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updated = [...transferLines];
                                    updated[idx].use_pack_unit = !updated[idx].use_pack_unit;
                                    setTransferLines(updated);
                                  }}
                                  className={`w-full py-2 px-2 rounded-lg border font-semibold transition-colors ${
                                    line.use_pack_unit
                                      ? 'bg-amber-100 text-amber-900 border-amber-300'
                                      : 'bg-white text-stone-700 border-stone-300'
                                  }`}
                                >
                                  {line.use_pack_unit ? `${secUnitSym} (×${factor})` : baseUnitSym}
                                </button>
                              ) : (
                                <span className="text-stone-500 font-mono py-2 px-2 block text-center bg-stone-100/50 rounded-lg">
                                  {baseUnitSym}
                                </span>
                              )}
                            </div>

                            <div className="w-24 text-right font-mono text-stone-700 font-semibold">
                              {selectedItem
                                ? formatINR(
                                    (line.quantity || 0) *
                                      (line.use_pack_unit ? factor : 1) *
                                      Number(selectedItem.current_weighted_average_cost || 0)
                                  )
                                : '—'}
                            </div>

                            {transferLines.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveTransferLine(idx)}
                                className="text-stone-400 hover:text-rose-600 p-1.5 rounded-md hover:bg-rose-50 transition-colors"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">{t('common.notes')}</label>
                    <input
                      type="text"
                      value={transferNotes}
                      onChange={(e) => setTransferNotes(e.target.value)}
                      placeholder={t('inventory.issues.transferNotesPlaceholder')}
                      className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 bg-white focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t">
                    <div className="text-xs">
                      <span className="text-stone-500">{t('inventory.issues.estimatedValue')}{' '}</span>
                      <span className="font-bold text-base text-stone-900 font-mono">
                        {formatINR(calculateTransferTotal())}
                      </span>
                    </div>

                    <Button
                      type="submit"
                      variant="primary"
                      disabled={saving || !transferSrcLoc || !transferDestLoc || transferLines.some(l => !l.item_id || l.quantity <= 0)}
                      className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-5 shadow-xs"
                    >
                      {saving ? t('inventory.issues.executingTransfer') : t('inventory.issues.confirmTransfer')}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {/* TAB 3: WASTAGE & SPOILAGE */}
          {activeTab === 'wastage' && (
            <Card className="border-stone-200 shadow-sm">
              <CardHeader className="pb-3 border-b border-stone-100">
                <CardTitle className="text-base flex items-center gap-2">
                  <Trash2 className="h-5 w-5 text-rose-600" />
                  {t('inventory.issues.recordWastage')}
                </CardTitle>
                <CardDescription className="text-xs">
                  {locale === 'hi'
                    ? 'खराब या नष्ट हुए सामान को सीधे स्टॉक से घटाएं। (कोई प्राप्तकर्ता या विभाग आवश्यक नहीं)'
                    : 'Fast inventory write-off event without recipient staff or department.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                <form onSubmit={handleWastageSubmit} className="space-y-4 text-xs">
                  {/* Event Type Toggle: Wastage vs Spoilage */}
                  <div className="space-y-1.5">
                    <label className="block font-semibold text-stone-800">
                      {t('inventory.issues.wastageType')} <span className="text-rose-500">*</span>
                    </label>
                    <div className="grid grid-cols-2 gap-3 max-w-xs">
                      <button
                        type="button"
                        onClick={() => setWasteType('Wastage')}
                        className={`py-2 px-3 rounded-lg border font-bold text-xs flex items-center justify-center gap-1.5 transition-colors ${
                          wasteType === 'Wastage'
                            ? 'bg-rose-50 border-rose-500 text-rose-700 shadow-xs'
                            : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50'
                        }`}
                      >
                        <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />
                        {t('inventory.issues.typeWastage')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setWasteType('Spoilage')}
                        className={`py-2 px-3 rounded-lg border font-bold text-xs flex items-center justify-center gap-1.5 transition-colors ${
                          wasteType === 'Spoilage'
                            ? 'bg-purple-50 border-purple-500 text-purple-700 shadow-xs'
                            : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50'
                        }`}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-purple-600" />
                        {t('inventory.issues.typeSpoilage')}
                      </button>
                    </div>
                  </div>

                  {/* Location Selector */}
                  <div className="bg-stone-50 p-3 rounded-xl border border-stone-200">
                    <label className="block font-semibold text-stone-800 mb-1">
                      {t('inventory.issues.sourceLocation')} <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={wasteLocId}
                      onChange={(e) => setWasteLocId(e.target.value)}
                      required
                      className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 bg-white font-medium focus:outline-none"
                    >
                      <option value="">{t('inventory.issues.selectSourceLocation')}</option>
                      {locations.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {getLocalizedMasterName(loc, locale)} ({loc.code || loc.location_type})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Item & Quantity */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block font-semibold text-stone-800 mb-1">
                        {t('inventory.issues.item')} <span className="text-rose-500">*</span>
                      </label>
                      <select
                        value={wasteItemId}
                        onChange={(e) => setWasteItemId(e.target.value)}
                        required
                        className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 bg-white font-medium focus:outline-none"
                      >
                        <option value="">{t('inventory.issues.selectItem')}</option>
                        {eligibleIssueItems.map((it) => {
                          const locQty = getItemStockAtLocation(it, wasteLocId);
                          const itUnitSym = getLocalizedMasterSymbol(it.unit, locale) || it.unit?.symbol || 'units';
                          const out = locQty <= 0;
                          return (
                            <option key={it.id} value={it.id} disabled={out}>
                              {getLocalizedMasterName(it, locale)} • {out ? `[${t('inventory.issues.outOfStock')}]` : `${locQty} ${itUnitSym}`}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    <div>
                      {(() => {
                        const it = items.find((i) => i.id === wasteItemId);
                        const storeStock = getItemStockAtLocation(it, wasteLocId);
                        const itUnitSym = getLocalizedMasterSymbol(it?.unit, locale) || it?.unit?.symbol || 'units';
                        return (
                          <>
                            <label className="block font-semibold text-stone-800 mb-1">
                              {t('inventory.issues.quantity')} {it ? `(${itUnitSym})` : ''} <span className="text-rose-500">*</span>
                            </label>
                            <input
                              type="number"
                              step="any"
                              min="0.001"
                              max={storeStock}
                              value={wasteQty || ''}
                              onChange={(e) => setWasteQty(parseFloat(e.target.value) || 0)}
                              required
                              className="w-full rounded-lg border border-stone-300 p-2 font-bold text-stone-900 bg-white text-right focus:outline-none"
                            />
                            {it && (
                              <span className="text-[10px] text-stone-500 block text-right mt-1">
                                {t('inventory.issues.available')}: {storeStock} {itUnitSym}
                              </span>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Reason / Notes */}
                  <div>
                    <label className="block font-semibold text-stone-800 mb-1">
                      {locale === 'hi' ? 'कारण / विवरण (वैकल्पिक)' : 'Reason / Note (optional)'}
                    </label>
                    <input
                      type="text"
                      value={wasteNotes}
                      onChange={(e) => setWasteNotes(e.target.value)}
                      placeholder={locale === 'hi' ? 'उदा. फफूंद लगना, रास्ते में टूटना, एक्सपायर होना' : 'e.g. Mold/fungus, spilled, transit damage'}
                      className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 bg-white focus:outline-none"
                    />
                  </div>

                  {/* Submit Button */}
                  <div className="flex items-center justify-between pt-4 border-t">
                    <div className="text-xs">
                      {(() => {
                        const it = items.find((i) => i.id === wasteItemId);
                        const cost = Number(it?.current_weighted_average_cost || 0);
                        const val = (wasteQty || 0) * cost;
                        return (
                          <>
                            <span className="text-stone-500">{t('inventory.issues.estimatedValue')}{' '}</span>
                            <span className="font-bold text-base text-rose-600 font-mono">
                              {formatINR(val)}
                            </span>
                          </>
                        );
                      })()}
                    </div>

                    <Button
                      type="submit"
                      variant="primary"
                      disabled={saving || !wasteItemId || wasteQty <= 0}
                      className="bg-rose-600 hover:bg-rose-700 text-white font-bold px-5 shadow-xs"
                    >
                      {saving ? t('inventory.issues.recordingWastage') : t('inventory.issues.recordWastageBtn')}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column: Live Audit Trail & Recent Dispatches */}
        <div>
          <Card className="border-stone-200 shadow-sm">
            <CardHeader className="pb-3 border-b border-stone-100">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <Clock className="h-4 w-4 text-amber-600" />
                    {t('inventory.issues.recentDispatches')}
                  </CardTitle>
                  <span className="text-[10px] text-stone-400 font-mono">
                    {recentMovements.length} {locale === 'hi' ? 'रिकॉर्ड' : 'logged'}
                  </span>
                </div>

                {/* Filter Pills */}
                <div className="flex flex-wrap gap-1 bg-stone-100 p-1 rounded-lg text-[10px] font-semibold">
                  <button
                    type="button"
                    onClick={() => setDispatchFilter('all')}
                    className={`px-2 py-0.5 rounded-md transition-colors ${
                      dispatchFilter === 'all'
                        ? 'bg-white text-stone-900 shadow-xs'
                        : 'text-stone-500 hover:text-stone-800'
                    }`}
                  >
                    {t('inventory.issues.filterAll')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDispatchFilter('issue')}
                    className={`px-2 py-0.5 rounded-md transition-colors ${
                      dispatchFilter === 'issue'
                        ? 'bg-white text-stone-900 shadow-xs'
                        : 'text-stone-500 hover:text-stone-800'
                    }`}
                  >
                    {t('inventory.issues.filterIssues')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDispatchFilter('transfer')}
                    className={`px-2 py-0.5 rounded-md transition-colors ${
                      dispatchFilter === 'transfer'
                        ? 'bg-white text-stone-900 shadow-xs'
                        : 'text-stone-500 hover:text-stone-800'
                    }`}
                  >
                    {t('inventory.issues.filterTransfers')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDispatchFilter('waste')}
                    className={`px-2 py-0.5 rounded-md transition-colors ${
                      dispatchFilter === 'waste'
                        ? 'bg-white text-stone-900 shadow-xs'
                        : 'text-stone-500 hover:text-stone-800'
                    }`}
                  >
                    {t('inventory.issues.filterWastage')}
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-3">
              <div className="space-y-2.5 text-xs max-h-[650px] overflow-y-auto pr-1">
                {recentMovements
                  .filter((m) => {
                    if (dispatchFilter === 'issue') return ['issue', 'consumption_issue', 'staff_food'].includes(m.movement_type);
                    if (dispatchFilter === 'transfer') return m.movement_type === 'transfer';
                    if (dispatchFilter === 'waste') return ['wastage', 'spoilage'].includes(m.movement_type);
                    return true;
                  })
                  .map((m) => {
                    const isTransfer = m.movement_type === 'transfer';
                    const isStaffFood = m.movement_type === 'staff_food' || m.purpose === 'Staff Food';
                    const isWaste = ['wastage', 'spoilage'].includes(m.movement_type);
                    const unitSym = getLocalizedMasterSymbol(m.item?.unit, locale) || m.item?.unit?.symbol || 'units';
                    const creatorName = profileMap.get(m.created_by) || (locale === 'hi' ? 'स्टोरकीपर' : 'Storekeeper');

                    // Exact server timestamp for CCTV auditability
                    const fullTimeStr = m.created_at
                      ? new Date(m.created_at).toLocaleString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                          hour12: false,
                        })
                      : '';

                    return (
                      <div
                        key={m.id}
                        className="p-3 rounded-xl border border-stone-200 bg-white hover:border-amber-300 transition-colors shadow-xs space-y-2"
                      >
                        {/* Header: Item & Badge */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-stone-900 text-xs truncate">
                              {getLocalizedMasterName(m.item, locale)}
                            </div>
                            {m.item?.item_code && (
                              <span className="text-[10px] font-mono text-stone-400">
                                [{m.item.item_code}]
                              </span>
                            )}
                          </div>
                          <Badge
                            variant={
                              isTransfer
                                ? 'info'
                                : isStaffFood
                                ? 'warning'
                                : isWaste
                                ? 'danger'
                                : 'success'
                            }
                          >
                            {isTransfer
                              ? t('inventory.issues.purposeOptions.Inter-Location Stock Transfer')
                              : isStaffFood
                              ? t('inventory.issues.staffKhana')
                              : isWaste
                              ? (m.movement_type === 'spoilage' ? t('inventory.issues.typeSpoilage') : t('inventory.issues.typeWastage'))
                              : t('inventory.stock.movementBadges.issue')}
                          </Badge>
                        </div>

                        {/* Quantity & Valuation */}
                        <div className="flex items-center justify-between text-[11px] bg-stone-50 p-1.5 rounded-lg font-mono">
                          <span className="font-bold text-stone-800">
                            {Number(m.quantity).toFixed(2)} {unitSym}
                          </span>
                          <span className="font-bold text-stone-900">
                            {formatINR(Number(m.total_value) || 0)}
                          </span>
                        </div>

                        {/* Handover & Location Audit */}
                        <div className="text-[10px] space-y-1 text-stone-600">
                          {/* Source */}
                          <div className="flex items-center gap-1">
                            <MapPin className="h-3 w-3 text-stone-400 shrink-0" />
                            <span className="text-stone-500">{t('inventory.issues.fromLocation')}:</span>
                            <span className="font-medium text-stone-800 truncate">
                              {getLocalizedMasterName(m.source_loc, locale) || m.source_loc?.name || '—'}
                            </span>
                          </div>

                          {/* Destination / Recipient */}
                          {isTransfer ? (
                            <div className="flex items-center gap-1 text-blue-700">
                              <ArrowRight className="h-3 w-3 shrink-0" />
                              <span className="text-stone-500">{t('inventory.issues.toLocation')}:</span>
                              <span className="font-semibold truncate">
                                {getLocalizedMasterName(m.dest_loc, locale) || m.dest_loc?.name || '—'}
                              </span>
                            </div>
                          ) : isWaste ? (
                            <div className="flex items-center gap-1 text-rose-700">
                              <Trash2 className="h-3 w-3 shrink-0" />
                              <span className="font-medium truncate">
                                {locale === 'hi' ? 'राइट-ऑफ (नुकसान)' : 'Write-off (Written down)'}
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 text-emerald-800">
                              <Users className="h-3 w-3 shrink-0 text-emerald-600" />
                              <span className="text-stone-500">{t('inventory.issues.receivedBy')}:</span>
                              <span className="font-bold truncate">
                                {m.responsible_person?.name || (locale === 'hi' ? 'स्टाफ' : 'Staff')}
                              </span>
                              {m.department?.name && (
                                <span className="text-stone-400">
                                  ({getLocalizedMasterName(m.department, locale)})
                                </span>
                              )}
                            </div>
                          )}

                          {/* Issued By & CCTV Server Timestamp */}
                          <div className="flex items-center justify-between text-[9px] text-stone-400 pt-1 border-t border-stone-100 font-mono">
                            <span className="truncate">
                              {t('inventory.issues.issuedBy')}: <span className="text-stone-600 font-semibold">{creatorName}</span>
                            </span>
                            <span className="shrink-0">{fullTimeStr}</span>
                          </div>

                          {/* Remarks / Notes */}
                          {m.notes && (
                            <div className="text-[10px] text-stone-500 italic truncate pt-0.5">
                              "{m.notes}"
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                {recentMovements.length === 0 && (
                  <div className="text-center py-8 text-stone-400">
                    <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>{t('inventory.issues.noRecentIssues')}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
