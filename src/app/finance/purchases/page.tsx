'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { createClient } from '@/lib/supabase/client';
import { formatINR, getTodayBusinessDate } from '@/lib/utils';
import { Vendor, VendorOutstandingSummary } from '@/lib/types/database';
import { VendorModal } from '@/components/vendors/VendorModal';
import { VendorCategoryModal } from '@/components/vendors/VendorCategoryModal';
import { VendorsView } from '@/components/purchases/VendorsView';
import { PurchaseInvoicesView, PurchaseInvoiceRecord } from '@/components/purchases/PurchaseInvoicesView';
import { PurchaseModal, PurchaseLineForm } from '@/components/purchases/PurchaseModal';
import { PurchaseRequestsView } from '@/components/purchases/PurchaseRequestsView';
import { CreatePurchaseRequestModal } from '@/components/purchases/CreatePurchaseRequestModal';
import { PolicySettingsModal } from '@/components/purchases/PolicySettingsModal';
import { getSearchableItemText } from '@/lib/inventory/search';
import {
  ShoppingBag,
  Building2,
  FileText,
  Plus,
  CreditCard,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Trash2,
  Tag,
  ChevronDown,
  Layers,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { useAppRole } from '@/components/layout/AppShell';
import { getLocalizedMasterName, getLocalizedMasterSymbol } from '@/lib/i18n/master-data';

function PurchasesContent() {
  const { t, locale } = useI18n();
  const { role, hasPermission } = useAppRole();
  const isAdmin = role === 'Admin';
  const canEditInvoices = isAdmin || hasPermission('finance.purchases.edit');
  const canEditVendors = isAdmin || hasPermission('finance.vendors.edit');
  const canEditPayments = isAdmin || hasPermission('finance.payments.edit');
  const canApprove = isAdmin || role === 'Owner' || role === 'General Manager' || hasPermission('finance.purchases.approve');
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Mobile KPI expansion toggle
  const [isMobileKpiExpanded, setIsMobileKpiExpanded] = useState(false);

  // Active view tab state (synchronized with URL query param `?view=invoices` / `?view=vendors` / `?view=requests`)
  const urlView = searchParams.get('view');
  const [activeView, setActiveView] = useState<'invoices' | 'vendors' | 'requests'>(
    urlView === 'vendors' ? 'vendors' : urlView === 'requests' ? 'requests' : 'invoices'
  );

  useEffect(() => {
    if (urlView === 'vendors') {
      setActiveView('vendors');
    } else if (urlView === 'requests') {
      setActiveView('requests');
    } else if (urlView === 'invoices') {
      setActiveView('invoices');
    }
  }, [urlView]);

  const handleViewChange = (view: 'invoices' | 'vendors' | 'requests') => {
    setActiveView(view);
    const params = new URLSearchParams(window.location.search);
    params.set('view', view);
    router.replace(`/finance/purchases?${params.toString()}`, { scroll: false });
  };

  const [businessDate, setBusinessDate] = useState(getTodayBusinessDate());
  const [vendors, setVendors] = useState<VendorOutstandingSummary[]>([]);
  const [rawVendors, setRawVendors] = useState<Vendor[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [packagingUnits, setPackagingUnits] = useState<any[]>([]);
  const [aliases, setAliases] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [vendorItems, setVendorItems] = useState<any[]>([]);
  const [vendorCategories, setVendorCategories] = useState<{ name: string; name_hi?: string | null }[]>([]);
  const [invoices, setInvoices] = useState<PurchaseInvoiceRecord[]>([]);
  const [usage30dMap, setUsage30dMap] = useState<Record<string, number>>({});

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);

  // Vendor Modals
  const [vendorModalOpen, setVendorModalOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);

  // Delete Safeguard State
  const [deleteModalVendor, setDeleteModalVendor] = useState<VendorOutstandingSummary | null>(null);
  const [deleteChecking, setDeleteChecking] = useState(false);
  const [cannotDeleteReason, setCannotDeleteReason] = useState<string | null>(null);

  // Purchase Bill Modal State
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<PurchaseInvoiceRecord | null>(null);
  const [showQuickVendorModal, setShowQuickVendorModal] = useState(false);
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [vendorPriceMemory, setVendorPriceMemory] = useState<Record<string, { rate: number; date: string }>>({});

  // Payment Modal State
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentVendorId, setPaymentVendorId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [paymentRef, setPaymentRef] = useState('');
  const [paymentSaving, setPaymentSaving] = useState(false);

  // Invoice Cancellation Modal State
  const [cancelInvoiceModalOpen, setCancelInvoiceModalOpen] = useState(false);
  const [cancellingInvoice, setCancellingInvoice] = useState<PurchaseInvoiceRecord | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancellingLoading, setCancellingLoading] = useState(false);

  // Invoice Deletion Safeguard Modal State
  const [deleteInvoiceModalOpen, setDeleteInvoiceModalOpen] = useState(false);
  const [deletingInvoice, setDeletingInvoice] = useState<PurchaseInvoiceRecord | null>(null);
  const [deleteInvoiceLoading, setDeleteInvoiceLoading] = useState(false);

  // Purchase Requests & Approval State
  const [purchaseRequests, setPurchaseRequests] = useState<any[]>([]);
  const [policySettings, setPolicySettings] = useState<any | null>(null);
  const [showCreateRequestModal, setShowCreateRequestModal] = useState(false);
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [convertedVendorId, setConvertedVendorId] = useState<string | null>(null);
  const [convertedLines, setConvertedLines] = useState<PurchaseLineForm[]>([]);

  const pendingRequestsCount = useMemo(() => {
    let count = 0;
    (purchaseRequests || []).forEach((r: any) => {
      (r.lines || []).forEach((l: any) => {
        if (l.approval_status === 'pending_approval') count++;
      });
    });
    return count;
  }, [purchaseRequests]);

  // Fetch vendor price memory whenever selectedVendorId changes
  useEffect(() => {
    async function fetchVendorPrices() {
      if (!selectedVendorId) {
        setVendorPriceMemory({});
        return;
      }
      try {
        const { data } = await supabase
          .from('vendor_items')
          .select('inventory_item_id, last_purchase_rate, last_purchase_date')
          .eq('vendor_id', selectedVendorId);

        if (data) {
          const map: Record<string, { rate: number; date: string }> = {};
          data.forEach((row: any) => {
            map[row.inventory_item_id] = {
              rate: Number(row.last_purchase_rate) || 0,
              date: row.last_purchase_date || '',
            };
          });
          setVendorPriceMemory(map);
        }
      } catch (err) {
        console.error('Error fetching vendor price memory:', err);
      }
    }
    fetchVendorPrices();
  }, [selectedVendorId, supabase]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [
        { data: vData, error: vErr },
        { data: vRaw, error: vRawErr },
        { data: iData, error: iErr },
        { data: pkgData },
        { data: aliasData },
        { data: locData },
        { data: pmData },
        { data: viData },
        { data: vcData },
        { data: pHeadersData, error: pErr },
        { data: grpData },
        { data: catData },
        { data: unitData },
        { data: posData },
      ] = await Promise.all([
        supabase.from('vendor_outstanding_summary').select('*').order('vendor_name'),
        supabase.from('vendors').select('*').order('name'),
        supabase
          .from('inventory_items')
          .select(`
            id, item_code, name, name_hi, group_id, brand_name, variant_name, category_id, inventory_class, unit_id, secondary_unit_id, conversion_factor, is_active, current_stock, current_weighted_average_cost, abc_class, abc_risk, minimum_stock, max_stock_level, shelf_life_days, last_counted_at,
            unit:units!inventory_items_unit_id_fkey(id, symbol, symbol_hi, name, name_hi),
            sec_unit:units!inventory_items_secondary_unit_id_fkey(id, symbol, symbol_hi, name, name_hi),
            category:inventory_categories(id, name, name_hi)
          `)
          .order('name'),
        supabase.from('item_packaging_units').select('*, pack_unit:units!item_packaging_units_pack_unit_id_fkey(symbol, symbol_hi, name, name_hi)').eq('is_active', true),
        supabase.from('inventory_item_aliases').select('item_id, group_id, alias, alias_type'),
        supabase.from('inventory_locations').select('*').eq('is_active', true).order('code'),
        supabase.from('payment_methods').select('*').order('name'),
        supabase.from('vendor_items').select('id, vendor_id, inventory_item_id, last_purchase_rate, last_purchase_date'),
        supabase.from('vendor_categories').select('name, name_hi'),
        supabase
          .from('purchase_headers')
          .select(`
            id,
            purchase_number,
            invoice_number,
            purchase_date,
            business_date,
            net_amount,
            total_amount,
            status,
            cancelled_at,
            cancelled_reason,
            vendor_id,
            vendors (
              id,
              name,
              vendor_code
            ),
            purchase_lines (
              id,
              item_id,
              quantity,
              rate,
              total_amount,
              packaging_unit_id,
              brand_name_snapshot,
              pack_unit_snapshot,
              pack_quantity,
              pack_rate,
              conversion_factor_snapshot,
              inventory_items (
                name,
                name_hi,
                item_code,
                units!inventory_items_unit_id_fkey (symbol, symbol_hi)
              )
            ),
            vendor_payment_allocations (
              amount_allocated
            )
          `)
          .order('purchase_date', { ascending: false }),
        supabase
          .from('logical_ingredient_groups')
          .select(`
            id,
            group_code,
            name,
            name_hi,
            category_id,
            inventory_class,
            base_unit_id,
            search_family,
            base_unit:units!logical_ingredient_groups_base_unit_id_fkey(id, symbol, symbol_hi, name, name_hi)
          `)
          .eq('is_active', true)
          .order('name'),
        supabase.from('inventory_categories').select('id, name, name_hi, inventory_class').order('name'),
        supabase.from('units').select('id, symbol, symbol_hi, name, name_hi').order('symbol'),
        supabase.from('inventory_current_position').select('item_id, current_quantity'),
      ]);

      if (vErr) throw vErr;
      if (vRawErr) throw vRawErr;
      if (iErr) throw iErr;
      if (pErr) throw pErr;

      const stockMap: Record<string, number> = {};
      (posData || []).forEach((p: any) => {
        stockMap[p.item_id] = Number(p.current_quantity) || 0;
      });

      const enrichedItems = (iData || []).map((it: any) => ({
        ...it,
        current_quantity: stockMap[it.id] ?? (Number(it.current_stock) || 0),
        unit_symbol: (locale === 'hi' && it.unit?.symbol_hi) ? it.unit.symbol_hi : (it.unit?.symbol || ''),
      }));

      setVendors(vData || []);
      setRawVendors(vRaw || []);
      setItems(enrichedItems);
      setPackagingUnits(pkgData || []);
      setAliases(aliasData || []);
      setLocations(locData || []);
      setPaymentMethods(pmData || []);
      setVendorItems(viData || []);
      setVendorCategories(vcData || []);
      setGroups(grpData || []);
      setCategories(catData || []);
      setUnits(unitData || []);

      // Fetch purchase requests and approval settings
      try {
        const [reqRes, setRes] = await Promise.all([
          fetch('/api/finance/purchase-requests'),
          fetch('/api/finance/purchase-approval-settings'),
        ]);
        if (reqRes.ok) {
          const reqJson = await reqRes.json();
          setPurchaseRequests(reqJson.requests || []);
          if (reqJson.usage30dMap) {
            setUsage30dMap(reqJson.usage30dMap);
          }
        }
        if (setRes.ok) {
          const setJson = await setRes.json();
          setPolicySettings(setJson.settings || null);
        }
      } catch (reqErr) {
        console.warn('Could not load purchase requests:', reqErr);
      }

      // Parse invoices
      const parsedInvoices: PurchaseInvoiceRecord[] = (pHeadersData || []).map((p: any) => {
        const allocated = (p.vendor_payment_allocations || []).reduce(
          (sum: number, a: any) => sum + (Number(a.amount_allocated) || 0),
          0
        );
        const lines = (p.purchase_lines || []).map((l: any) => ({
          id: l.id,
          item_id: l.item_id,
          item_name: (locale === 'hi' && l.inventory_items?.name_hi) ? l.inventory_items.name_hi : (l.inventory_items?.name || 'Unknown Item'),
          item_code: l.inventory_items?.item_code || '',
          quantity: Number(l.quantity) || 0,
          rate: Number(l.rate) || 0,
          total_amount: Number(l.total_amount) || 0,
          unit_symbol: (locale === 'hi' && l.inventory_items?.units?.symbol_hi) ? l.inventory_items.units.symbol_hi : (l.inventory_items?.units?.symbol || ''),
          packaging_unit_id: l.packaging_unit_id,
          brand_name_snapshot: l.brand_name_snapshot,
          pack_unit_snapshot: l.pack_unit_snapshot,
          pack_quantity: l.pack_quantity ? Number(l.pack_quantity) : null,
          pack_rate: l.pack_rate ? Number(l.pack_rate) : null,
          conversion_factor_snapshot: l.conversion_factor_snapshot ? Number(l.conversion_factor_snapshot) : null,
        }));

        return {
          id: p.id,
          purchase_number: p.purchase_number,
          invoice_number: p.invoice_number,
          purchase_date: p.purchase_date,
          business_date: p.business_date,
          net_amount: Number(p.net_amount) || 0,
          total_amount: Number(p.total_amount) || 0,
          status: p.status || 'completed',
          cancelled_at: p.cancelled_at,
          cancelled_reason: p.cancelled_reason,
          vendor_id: p.vendor_id,
          vendor_name: p.vendors?.name || 'Unknown Vendor',
          vendor_code: p.vendors?.vendor_code || '',
          allocated_amount: allocated,
          lines,
        };
      });

      setInvoices(parsedInvoices);
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: t('purchases.bills.errLoad') + ' ' + (err.message || '') });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Map of item_id / group_id -> string[] aliases for multi-lingual and alias search
  const itemAliasesMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    aliases.forEach((a) => {
      if (a.item_id) {
        if (!map[a.item_id]) map[a.item_id] = [];
        if (a.alias && !map[a.item_id].includes(a.alias)) map[a.item_id].push(a.alias);
      }
      if (a.group_id) {
        if (!map[a.group_id]) map[a.group_id] = [];
        if (a.alias && !map[a.group_id].includes(a.alias)) map[a.group_id].push(a.alias);
      }
    });
    return map;
  }, [aliases]);

  const handleCancelInvoiceConfirm = async () => {
    if (!cancellingInvoice) return;
    if (!cancelReason.trim()) {
      alert(t('purchases.bills.reasonRequired'));
      return;
    }
    setCancellingLoading(true);
    try {
      const { error } = await supabase.rpc('cancel_purchase_invoice', {
        p_purchase_id: cancellingInvoice.id,
        p_reason: cancelReason.trim(),
      });
      if (error) throw error;
      setMessage({
        type: 'success',
        text: t('purchases.bills.invoiceCancelledSuccess', { number: cancellingInvoice.purchase_number }),
      });
      setCancelInvoiceModalOpen(false);
      setCancellingInvoice(null);
      setCancelReason('');
      loadData();
    } catch (err: any) {
      console.error('Error cancelling invoice:', err);
      alert('Failed to cancel invoice: ' + err.message);
    } finally {
      setCancellingLoading(false);
    }
  };

  const handleInitiateDeleteInvoice = (inv: PurchaseInvoiceRecord) => {
    setDeletingInvoice(inv);
    setDeleteInvoiceModalOpen(true);
  };

  const handleConfirmDeleteInvoice = async () => {
    if (!deletingInvoice) return;
    setDeleteInvoiceLoading(true);
    try {
      const res = await fetch('/api/finance/purchases/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purchase_id: deletingInvoice.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete purchase invoice');
      }
      setMessage({
        type: 'success',
        text: t('purchases.bills.invoiceDeleted', { number: deletingInvoice.purchase_number }),
      });
      setDeleteInvoiceModalOpen(false);
      setDeletingInvoice(null);
      loadData();
    } catch (err: any) {
      console.error('Error deleting purchase invoice:', err);
      alert(err.message || 'Failed to delete purchase invoice');
    } finally {
      setDeleteInvoiceLoading(false);
    }
  };

  // Aggregate high-level summary KPIs
  const totalOutstanding = useMemo(() => {
    return vendors.reduce((acc, v) => acc + (Number(v.outstanding_balance) || 0), 0);
  }, [vendors]);

  const totalPurchasesAllTime = useMemo(() => {
    return vendors.reduce((acc, v) => acc + (Number(v.total_purchased) || 0), 0);
  }, [vendors]);

  const totalPaidAllTime = useMemo(() => {
    return vendors.reduce((acc, v) => acc + (Number(v.total_paid) || 0), 0);
  }, [vendors]);

  const activeVendorsCount = useMemo(() => {
    return vendors.filter((v) => v.is_active !== false).length;
  }, [vendors]);

  // Vendor actions
  const handleOpenEditModal = (vendorSummary: VendorOutstandingSummary) => {
    const raw = rawVendors.find((v) => v.id === vendorSummary.vendor_id);
    if (raw) {
      setEditingVendor(raw);
    } else {
      setEditingVendor({
        id: vendorSummary.vendor_id,
        vendor_code: vendorSummary.vendor_code,
        name: vendorSummary.vendor_name,
        contact_person: vendorSummary.contact_person,
        phone: vendorSummary.phone,
        alternate_phone: vendorSummary.alternate_phone,
        payment_terms: vendorSummary.payment_terms,
        payment_frequency: vendorSummary.payment_frequency,
        supplier_categories: vendorSummary.supplier_categories,
        is_active: vendorSummary.is_active !== false,
      });
    }
    setVendorModalOpen(true);
  };

  const handleToggleStatus = async (vendorSummary: VendorOutstandingSummary) => {
    const currentStatus = vendorSummary.is_active !== false;
    const newStatus = !currentStatus;

    try {
      const { error } = await supabase
        .from('vendors')
        .update({ is_active: newStatus, updated_at: new Date().toISOString() })
        .eq('id', vendorSummary.vendor_id);

      if (error) throw error;

      setMessage({
        type: 'success',
        text: `Vendor "${vendorSummary.vendor_name}" has been marked as ${newStatus ? 'Active' : 'Inactive'}.`,
      });
      loadData();
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Failed to update status: ' + err.message });
    }
  };

  const handleConvertBasket = (vendorId: string | null, lines: PurchaseLineForm[]) => {
    setConvertedVendorId(vendorId || '');
    setConvertedLines(lines);
    setSelectedVendorId(vendorId || '');
    setEditingInvoice(null);
    setShowPurchaseModal(true);
  };

  const handleInitiateDelete = async (vendorSummary: VendorOutstandingSummary) => {
    setDeleteChecking(true);
    setCannotDeleteReason(null);
    setDeleteModalVendor(vendorSummary);

    try {
      const { count: purchaseCount } = await supabase
        .from('purchase_headers')
        .select('*', { count: 'exact', head: true })
        .eq('vendor_id', vendorSummary.vendor_id);

      const { count: paymentCount } = await supabase
        .from('vendor_payments')
        .select('*', { count: 'exact', head: true })
        .eq('vendor_id', vendorSummary.vendor_id);

      if ((purchaseCount && purchaseCount > 0) || (paymentCount && paymentCount > 0)) {
        setCannotDeleteReason(
          t('purchases.vendors.deleteModal.hasTransactions', {
            purchases: purchaseCount || 0,
            payments: paymentCount || 0,
          })
        );
      }
    } catch (err: any) {
      console.error(err);
      setCannotDeleteReason('Unable to verify transaction history: ' + err.message);
    } finally {
      setDeleteChecking(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteModalVendor) return;

    try {
      await supabase.from('vendor_items').delete().eq('vendor_id', deleteModalVendor.vendor_id);

      const { error } = await supabase
        .from('vendors')
        .delete()
        .eq('id', deleteModalVendor.vendor_id);

      if (error) throw error;

      setMessage({
        type: 'success',
        text: `Vendor "${deleteModalVendor.vendor_name}" was permanently removed.`,
      });
      setDeleteModalVendor(null);
      loadData();
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Failed to delete vendor: ' + err.message });
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentVendorId || paymentAmount <= 0) {
      alert(t('purchases.bills.errSelectVendorAmount'));
      return;
    }

    const vPayment = vendors.find((v) => v.vendor_id === paymentVendorId);
    if (vPayment && vPayment.is_active === false) {
      alert(t('purchases.bills.errPaymentInactive'));
      return;
    }

    setPaymentSaving(true);
    setMessage(null);

    try {
      const paymentNumber = `PAY-${Date.now().toString().slice(-6)}`;

      const { data: pmt, error: pmtErr } = await supabase
        .from('vendor_payments')
        .insert({
          payment_number: paymentNumber,
          vendor_id: paymentVendorId,
          payment_date: businessDate,
          business_date: businessDate,
          amount: paymentAmount,
          payment_method_id: paymentMethodId || null,
          reference_number: paymentRef,
        })
        .select()
        .single();

      if (pmtErr) throw pmtErr;

      // FIFO Allocation against open purchase headers
      const { data: openPurchases } = await supabase
        .from('purchase_headers')
        .select('id, net_amount, purchase_date')
        .eq('vendor_id', paymentVendorId)
        .order('purchase_date', { ascending: true });

      let remainingToAllocate = paymentAmount;
      if (openPurchases && openPurchases.length > 0) {
        for (const p of openPurchases) {
          if (remainingToAllocate <= 0) break;
          const { data: prevAllocs } = await supabase
            .from('vendor_payment_allocations')
            .select('amount_allocated')
            .eq('purchase_id', p.id);

          const alreadyAllocated = (prevAllocs || []).reduce(
            (sum, a) => sum + Number(a.amount_allocated),
            0
          );
          const balanceOnPurchase = Number(p.net_amount) - alreadyAllocated;

          if (balanceOnPurchase > 0) {
            const allocNow = Math.min(remainingToAllocate, balanceOnPurchase);
            await supabase.from('vendor_payment_allocations').insert({
              payment_id: pmt.id,
              purchase_id: p.id,
              amount_allocated: allocNow,
            });
            remainingToAllocate -= allocNow;
          }
        }
      }

      setMessage({ type: 'success', text: t('purchases.bills.paymentRecorded', { amount: formatINR(paymentAmount) }) });
      setShowPaymentModal(false);
      setPaymentAmount(0);
      setPaymentRef('');
      loadData();
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: err.message || 'Failed to record payment.' });
    } finally {
      setPaymentSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-full overflow-hidden">
      {/* Top Header & Contextual Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <ShoppingBag className="h-6 w-6 text-amber-600 shrink-0" />
            <span>{t('purchases.bills.title')}</span>
          </h1>
          <p className="hidden sm:block text-xs text-stone-500 mt-0.5">
            {t('purchases.bills.subtitle')}
          </p>
        </div>

        {/* Dynamic Contextual Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {activeView === 'invoices' ? (
            <>
              <Button
                variant="amber"
                size="sm"
                onClick={() => setShowPurchaseModal(true)}
                className="gap-1.5 text-xs shadow-xs"
              >
                <Plus className="h-4 w-4" />
                <span>{t('purchases.bills.newPurchaseInvoice')}</span>
              </Button>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setPaymentVendorId('');
                  setShowPaymentModal(true);
                }}
                className="gap-1.5 text-xs"
              >
                <CreditCard className="h-4 w-4" />
                <span>{t('purchases.bills.recordPayment')}</span>
              </Button>

              <Button variant="outline" size="sm" onClick={loadData} title="Refresh" className="bg-white">
                <RefreshCw className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="amber"
                size="sm"
                onClick={() => {
                  setEditingVendor(null);
                  setVendorModalOpen(true);
                }}
                className="gap-1.5 text-xs shadow-xs"
              >
                <Plus className="h-4 w-4" />
                <span>{t('purchases.vendors.addVendor')}</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setCategoryModalOpen(true)}
                className="gap-1.5 text-xs text-stone-700 bg-white"
              >
                <Tag className="h-4 w-4 text-amber-600" />
                <span>{t('purchases.vendors.categories')}</span>
              </Button>

              <Button variant="outline" size="sm" onClick={loadData} title="Refresh" className="bg-white">
                <RefreshCw className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* KPI Summary Cards: Mobile Collapsible Slim Bar (< md) & Desktop 4-Card Grid (md+) */}
      {(() => {
        const paidPercentage = totalPurchasesAllTime > 0
          ? Math.min(100, Math.round((totalPaidAllTime / totalPurchasesAllTime) * 100))
          : 0;
        return (
          <>
            {/* Mobile Collapsible Slim Balance Card (< md) */}
            <Card
              onClick={() => setIsMobileKpiExpanded(!isMobileKpiExpanded)}
              className="md:hidden p-3.5 cursor-pointer bg-white border border-stone-200/80 shadow-xs hover:border-amber-300 transition-all select-none"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-medium text-stone-500 uppercase tracking-wider block">
                    {t('purchases.bills.outstanding')}
                  </span>
                  <span className="text-xl font-bold text-rose-600">
                    {formatINR(totalOutstanding)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-stone-500 font-medium">
                    {paidPercentage}% {t('purchases.bills.settled')}
                  </span>
                  <div className={`text-stone-400 transform transition-transform duration-200 ${isMobileKpiExpanded ? 'rotate-180' : ''}`}>
                    <ChevronDown className="h-4 w-4" />
                  </div>
                </div>
              </div>

              {/* Thin Paid Progress Bar */}
              <div className="w-full bg-stone-100 rounded-full h-1.5 mt-2.5 overflow-hidden">
                <div
                  className="bg-emerald-500 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${paidPercentage}%` }}
                />
              </div>

              {/* Expanded Details */}
              {isMobileKpiExpanded && (
                <div className="grid grid-cols-2 gap-3 pt-3 mt-3 border-t border-stone-100">
                  <div>
                    <span className="text-[11px] text-stone-500 block truncate">
                      {t('purchases.kpi.totalPurchased')}
                    </span>
                    <span className="text-sm font-bold text-stone-900 truncate block mt-0.5">
                      {formatINR(totalPurchasesAllTime)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] text-stone-500 block truncate">
                      {t('purchases.kpi.totalPaid')}
                    </span>
                    <span className="text-sm font-bold text-emerald-700 truncate block mt-0.5">
                      {formatINR(totalPaidAllTime)}
                    </span>
                  </div>
                </div>
              )}
            </Card>

            {/* Desktop 4 KPI Summary Cards (md+) */}
            <div className="hidden md:grid md:grid-cols-4 gap-4">
              <Card className="p-4 sm:p-5 min-w-0 overflow-hidden">
                <CardDescription className="truncate">{t('purchases.bills.outstanding')}</CardDescription>
                <div className="text-xl sm:text-2xl font-bold text-rose-600 mt-1 truncate">
                  {formatINR(totalOutstanding)}
                </div>
              </Card>

              <Card className="p-4 sm:p-5 min-w-0 overflow-hidden">
                <CardDescription className="truncate">{t('purchases.kpi.totalPurchased')}</CardDescription>
                <div className="text-xl sm:text-2xl font-bold text-stone-900 mt-1 truncate">
                  {formatINR(totalPurchasesAllTime)}
                </div>
              </Card>

              <Card className="p-4 sm:p-5 min-w-0 overflow-hidden">
                <CardDescription className="truncate">{t('purchases.kpi.totalPaid')}</CardDescription>
                <div className="text-xl sm:text-2xl font-bold text-emerald-700 mt-1 truncate">
                  {formatINR(totalPaidAllTime)}
                </div>
              </Card>

              <Card className="p-4 sm:p-5 min-w-0 overflow-hidden">
                <CardDescription className="truncate">{t('purchases.bills.activeVendors')}</CardDescription>
                <div className="text-xl sm:text-2xl font-bold text-stone-900 mt-1 truncate">
                  {activeVendorsCount}
                </div>
              </Card>
            </div>
          </>
        );
      })()}

      {/* Alert Messages */}
      {message && (
        <div
          className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 border ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : message.type === 'warning'
              ? 'bg-amber-50 text-amber-800 border-amber-200'
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle className="h-4 w-4 shrink-0 text-emerald-600" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* View Switcher Tabs: [Purchase Invoices] [Vendors] */}
      <div className="flex items-center gap-2 border-b border-stone-200 pb-1">
        <button
          type="button"
          onClick={() => handleViewChange('invoices')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-t-lg transition-all border-b-2 -mb-[5px] ${
            activeView === 'invoices'
              ? 'border-amber-600 text-amber-900 bg-amber-50/60 shadow-xs'
              : 'border-transparent text-stone-500 hover:text-stone-800 hover:bg-stone-50'
          }`}
        >
          <FileText className="h-4 w-4" />
          <span>{t('purchases.tabs.invoices')}</span>
          <span className="text-[11px] px-1.5 py-0.2 rounded-full bg-stone-200/70 text-stone-700 font-normal">
            {invoices.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => handleViewChange('vendors')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-t-lg transition-all border-b-2 -mb-[5px] ${
            activeView === 'vendors'
              ? 'border-amber-600 text-amber-900 bg-amber-50/60 shadow-xs'
              : 'border-transparent text-stone-500 hover:text-stone-800 hover:bg-stone-50'
          }`}
        >
          <Building2 className="h-4 w-4" />
          <span>{t('purchases.tabs.vendors')}</span>
          <span className="text-[11px] px-1.5 py-0.2 rounded-full bg-stone-200/70 text-stone-700 font-normal">
            {vendors.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => handleViewChange('requests')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-t-lg transition-all border-b-2 -mb-[5px] ${
            activeView === 'requests'
              ? 'border-amber-600 text-amber-900 bg-amber-50/60 shadow-xs'
              : 'border-transparent text-stone-500 hover:text-stone-800 hover:bg-stone-50'
          }`}
        >
          <Layers className="h-4 w-4" />
          <span>{t('purchases.requests.tabTitle')}</span>
          {pendingRequestsCount > 0 ? (
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-rose-500 text-white font-bold animate-pulse">
              {pendingRequestsCount}
            </span>
          ) : (
            <span className="text-[11px] px-1.5 py-0.2 rounded-full bg-stone-200/70 text-stone-700 font-normal">
              {purchaseRequests.length}
            </span>
          )}
        </button>
      </div>

      {/* Primary Views Content */}
      {activeView === 'invoices' ? (
        <PurchaseInvoicesView
          invoices={invoices}
          loading={loading}
          onRefresh={loadData}
          onNewInvoice={() => {
            setEditingInvoice(null);
            setShowPurchaseModal(true);
          }}
          onRecordPayment={(vendorId) => {
            if (vendorId) setPaymentVendorId(vendorId);
            setShowPaymentModal(true);
          }}
          onCancelInvoice={(inv) => {
            setCancellingInvoice(inv);
            setCancelReason('');
            setCancelInvoiceModalOpen(true);
          }}
          onEditInvoice={(inv) => {
            setEditingInvoice(inv);
            setSelectedVendorId(inv.vendor_id);
            setShowPurchaseModal(true);
          }}
          onDeleteInvoice={handleInitiateDeleteInvoice}
        />
      ) : activeView === 'vendors' ? (
        <VendorsView
          vendors={vendors}
          vendorItems={vendorItems}
          catalogItems={items}
          vendorCategories={vendorCategories}
          loading={loading}
          onRefresh={loadData}
          onOpenAddVendor={() => {
            setEditingVendor(null);
            setVendorModalOpen(true);
          }}
          onOpenCategories={() => setCategoryModalOpen(true)}
          onEditVendor={handleOpenEditModal}
          onToggleStatus={handleToggleStatus}
          onInitiateDelete={handleInitiateDelete}
        />
      ) : (
        <PurchaseRequestsView
          requests={purchaseRequests}
          vendors={vendors}
          items={items}
          groups={groups}
          packagingUnits={packagingUnits}
          canApprove={canApprove}
          isAdmin={isAdmin}
          onOpenCreateModal={() => setShowCreateRequestModal(true)}
          onOpenPolicyModal={() => setShowPolicyModal(true)}
          onConvertBasket={handleConvertBasket}
          onRefresh={loadData}
        />
      )}

      {/* Delete Vendor Confirmation Safeguard Modal */}
      {deleteModalVendor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl text-xs">
            <div className="flex items-center justify-between border-b pb-3">
              <h2 className="text-base font-bold text-stone-900 flex items-center gap-2">
                <Trash2 className="h-4 w-4 text-rose-600" />
                {cannotDeleteReason
                  ? t('purchases.vendors.deleteModal.titleCannot')
                  : t('purchases.vendors.deleteModal.titleConfirm')}
              </h2>
              <button
                onClick={() => setDeleteModalVendor(null)}
                className="text-stone-400 hover:text-stone-700 text-lg"
              >
                ✕
              </button>
            </div>

            {deleteChecking ? (
              <div className="py-6 text-center text-stone-500">
                {t('purchases.vendors.deleteModal.checking')}
              </div>
            ) : cannotDeleteReason ? (
              <div className="space-y-3">
                <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-amber-900 leading-relaxed">
                  {cannotDeleteReason}
                </div>
                <p className="text-stone-600">
                  {t('purchases.vendors.deleteModal.deactivateNotice')}
                </p>
                <div className="flex justify-end gap-2 pt-2 border-t">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setDeleteModalVendor(null)}
                  >
                    {t('purchases.vendors.deleteModal.close')}
                  </Button>
                  <Button
                    type="button"
                    variant="amber"
                    onClick={() => {
                      const v = deleteModalVendor;
                      setDeleteModalVendor(null);
                      if (v) handleToggleStatus(v);
                    }}
                  >
                    {t('purchases.vendors.deleteModal.deactivateAction')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-stone-700 leading-relaxed">
                  {t('purchases.vendors.deleteModal.zeroTxNotice')}
                </p>
                <div className="font-semibold text-stone-900 bg-stone-50 p-2.5 rounded border border-stone-200">
                  {deleteModalVendor.vendor_name} ({deleteModalVendor.vendor_code || 'VEND'})
                </div>
                <div className="flex justify-end gap-2 pt-2 border-t">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setDeleteModalVendor(null)}
                  >
                    {t('purchases.vendors.deleteModal.cancel')}
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    onClick={handleConfirmDelete}
                  >
                    {t('purchases.vendors.deleteModal.deleteAction')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cancel Invoice Confirmation Modal */}
      {cancelInvoiceModalOpen && cancellingInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b pb-3">
              <h2 className="text-base font-bold text-rose-700 flex items-center gap-2">
                <Trash2 className="h-5 w-5" />
                {t('purchases.bills.cancelInvoiceTitle')}
              </h2>
              <button
                onClick={() => {
                  setCancelInvoiceModalOpen(false);
                  setCancellingInvoice(null);
                }}
                className="text-stone-400 hover:text-stone-700 text-lg"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs text-stone-700">
              <p className="font-medium text-stone-900">
                {t('purchases.bills.cancelInvoiceConfirm')}
              </p>

              <div className="p-3 bg-stone-50 rounded-lg border border-stone-200 space-y-1 font-mono text-[11px]">
                <div><strong>PO:</strong> {cancellingInvoice.purchase_number}</div>
                {cancellingInvoice.invoice_number && <div><strong>Bill #:</strong> {cancellingInvoice.invoice_number}</div>}
                <div><strong>Vendor:</strong> {cancellingInvoice.vendor_name}</div>
                <div><strong>Total:</strong> {formatINR(cancellingInvoice.net_amount)}</div>
                <div><strong>Date:</strong> {cancellingInvoice.purchase_date}</div>
              </div>

              <div>
                <label className="block font-bold text-stone-900 mb-1">
                  {t('purchases.bills.cancelReason')} <span className="text-rose-500">*</span>
                </label>
                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  rows={3}
                  placeholder={t('purchases.bills.cancelReason')}
                  required
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-rose-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setCancelInvoiceModalOpen(false);
                    setCancellingInvoice(null);
                  }}
                  disabled={cancellingLoading}
                >
                  {t('purchases.bills.cancel')}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={handleCancelInvoiceConfirm}
                  disabled={cancellingLoading || !cancelReason.trim()}
                  className="gap-1.5"
                >
                  {cancellingLoading ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      <span>{t('purchases.bills.saving')}</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>{t('purchases.bills.cancelInvoice')}</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Redesigned Simplified Purchase Invoice Modal */}
      <PurchaseModal
        isOpen={showPurchaseModal}
        invoiceToEdit={editingInvoice}
        initialVendorId={convertedVendorId}
        initialLines={convertedLines}
        onClose={() => {
          setShowPurchaseModal(false);
          setEditingInvoice(null);
          setConvertedVendorId(null);
          setConvertedLines([]);
        }}
        vendors={vendors}
        items={items}
        groups={groups}
        packagingUnits={packagingUnits}
        categories={categories}
        units={units}
        locations={locations}
        aliases={aliases}
        invoices={invoices}
        vendorPriceMemory={vendorPriceMemory}
        businessDate={businessDate}
        selectedVendorId={selectedVendorId}
        setSelectedVendorId={setSelectedVendorId}
        onOpenQuickVendor={() => setShowQuickVendorModal(true)}
        onPurchaseSaved={(num) => {
          setMessage({
            type: 'success',
            text: editingInvoice
              ? t('purchases.bills.invoiceUpdated', { number: num })
              : t('purchases.bills.invoiceRecorded', { number: num }),
          });
          setEditingInvoice(null);
          loadData();
        }}
        onNewItemCreated={(newItem, newGroup) => {
          setItems((prev) => {
            if (prev.some((it) => it.id === newItem.id)) return prev;
            return [...prev, newItem];
          });
          if (newGroup) {
            setGroups((prev) => {
              if (prev.some((grp) => grp.id === newGroup.id)) return prev;
              return [...prev, newGroup];
            });
          }
        }}
      />

      {/* Record Payment Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl text-xs">
            <div className="flex items-center justify-between border-b pb-3">
              <h2 className="text-base font-bold text-stone-900">{t('purchases.bills.recordPayment')}</h2>
              <button onClick={() => setShowPaymentModal(false)} className="text-stone-400 hover:text-stone-700 text-lg">✕</button>
            </div>

            <form onSubmit={handleRecordPayment} className="space-y-3">
              <div>
                <label className="block font-medium text-stone-700 mb-1">{t('purchases.bills.vendor')}</label>
                <select
                  value={paymentVendorId}
                  onChange={(e) => setPaymentVendorId(e.target.value)}
                  required
                  aria-label={t('purchases.bills.vendor')}
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                >
                  <option value="">{t('purchases.bills.selectVendor')}</option>
                  {vendors
                    .filter((v) => v.is_active !== false)
                    .map((v) => (
                      <option key={v.vendor_id} value={v.vendor_id}>
                        {v.vendor_name} ({t('purchases.bills.due')}: {formatINR(Number(v.outstanding_balance))})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">{t('purchases.bills.amount')}</label>
                <input
                  type="number"
                  step="0.01"
                  value={paymentAmount || ''}
                  onChange={(e) => setPaymentAmount(parseFloat(e.target.value) || 0)}
                  required
                  placeholder="0.00"
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 font-bold text-sm focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">{t('purchases.bills.paymentMethod')}</label>
                <select
                  value={paymentMethodId}
                  onChange={(e) => setPaymentMethodId(e.target.value)}
                  aria-label={t('purchases.bills.paymentMethod')}
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                >
                  <option value="">{t('purchases.bills.selectMethod')}</option>
                  {paymentMethods.map((pm) => (
                    <option key={pm.id} value={pm.id}>
                      {getLocalizedMasterName(pm, locale) || pm.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">{t('purchases.bills.referenceNo')}</label>
                <input
                  type="text"
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  placeholder="e.g. UTR-998271"
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button type="button" variant="secondary" onClick={() => setShowPaymentModal(false)}>{t('purchases.bills.cancel')}</Button>
                <Button type="submit" variant="amber" disabled={paymentSaving}>
                  {paymentSaving ? t('purchases.bills.saving') : t('purchases.bills.recordPayment')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Vendor Add / Edit Modal */}
      <VendorModal
        isOpen={vendorModalOpen}
        onClose={() => {
          setVendorModalOpen(false);
          setEditingVendor(null);
        }}
        vendor={editingVendor}
        onSaved={(savedVendor) => {
          loadData();
          setMessage({
            type: 'success',
            text: editingVendor
              ? `Vendor "${savedVendor.name}" updated successfully.`
              : `Vendor "${savedVendor.name}" created successfully.`,
          });
        }}
      />

      {/* Quick Add Vendor Modal (inside purchase bill modal) */}
      <VendorModal
        isOpen={showQuickVendorModal}
        onClose={() => setShowQuickVendorModal(false)}
        onSaved={(newVendor) => {
          const newSummary: VendorOutstandingSummary = {
            vendor_id: newVendor.id,
            vendor_code: newVendor.vendor_code || '',
            vendor_name: newVendor.name,
            contact_person: newVendor.contact_person || undefined,
            phone: newVendor.phone || undefined,
            alternate_phone: newVendor.alternate_phone || undefined,
            total_purchased: 0,
            total_paid: 0,
            outstanding_balance: 0,
            last_purchase_date: undefined,
            is_active: newVendor.is_active !== false,
            payment_terms: newVendor.payment_terms || 'Net 7 Days',
            payment_frequency: newVendor.payment_frequency || 'Weekly',
            supplier_categories: newVendor.supplier_categories || [],
          };
          setVendors((prev) => {
            if (prev.some((v) => v.vendor_id === newVendor.id)) return prev;
            return [...prev, newSummary];
          });
          setSelectedVendorId(newVendor.id);
          loadData();
          setMessage({
            type: 'success',
            text: `Vendor "${newVendor.name}" (${newVendor.vendor_code}) created and selected!`,
          });
        }}
      />

      {/* Vendor Category Management Modal */}
      <VendorCategoryModal
        isOpen={categoryModalOpen}
        onClose={() => setCategoryModalOpen(false)}
        onUpdated={loadData}
      />

      {/* Delete Purchase Invoice Safeguard Modal */}
      {deleteInvoiceModalOpen && deletingInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl border border-stone-200">
            <div className="flex items-center gap-3 text-rose-600 mb-4">
              <div className="rounded-full bg-rose-100 p-2">
                <AlertCircle className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold text-stone-900">
                {t('purchases.bills.deleteInvoiceTitle')}
              </h3>
            </div>

            {deletingInvoice.allocated_amount > 0.01 ? (
              <div className="space-y-4">
                <p className="text-sm text-stone-600">
                  {t('purchases.bills.errCannotDeleteAllocated', {
                    number: deletingInvoice.purchase_number,
                    amount: formatINR(deletingInvoice.allocated_amount),
                  })}
                </p>
                <div className="flex justify-end pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDeleteInvoiceModalOpen(false);
                      setDeletingInvoice(null);
                    }}
                  >
                    {t('purchases.bills.cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-stone-700">
                  {t('purchases.bills.deleteInvoiceConfirm', {
                    number: deletingInvoice.purchase_number,
                  })}
                </p>
                <p className="text-xs text-rose-600 font-medium bg-rose-50 p-2.5 rounded-lg border border-rose-100">
                  {t('purchases.bills.deleteInvoiceWarning')}
                </p>
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDeleteInvoiceModalOpen(false);
                      setDeletingInvoice(null);
                    }}
                    disabled={deleteInvoiceLoading}
                  >
                    {t('purchases.bills.cancel')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={handleConfirmDeleteInvoice}
                    disabled={deleteInvoiceLoading}
                    className="gap-1.5"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span>
                      {deleteInvoiceLoading
                        ? t('purchases.bills.saving')
                        : t('purchases.bills.confirmDeleteInvoice')}
                    </span>
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Purchase Request Modal */}
      <CreatePurchaseRequestModal
        isOpen={showCreateRequestModal}
        onClose={() => setShowCreateRequestModal(false)}
        items={items}
        groups={groups}
        packagingUnits={packagingUnits}
        vendors={vendors}
        aliases={aliases}
        policySettings={policySettings}
        usage30dMap={usage30dMap}
        onSubmitted={() => {
          setMessage({
            type: 'success',
            text: 'Purchase requisition submitted successfully!',
          });
          loadData();
        }}
      />

      {/* Policy Settings Modal */}
      <PolicySettingsModal
        isOpen={showPolicyModal}
        onClose={() => setShowPolicyModal(false)}
        onUpdated={loadData}
      />
    </div>
  );
}

export default function PurchasesPage() {
  return (
    <Suspense
      fallback={
        <div className="py-20 text-center text-xs text-stone-500 flex items-center justify-center gap-2">
          <RefreshCw className="h-5 w-5 animate-spin text-amber-600" />
          Loading Purchases & Vendors...
        </div>
      }
    >
      <PurchasesContent />
    </Suspense>
  );
}
