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
  Tag
} from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { getLocalizedMasterName, getLocalizedMasterSymbol } from '@/lib/i18n/master-data';
import { SearchableSelect } from '@/components/ui/SearchableSelect';

interface PurchaseLineForm {
  item_id: string;
  quantity: number;
  rate: number;
  use_pack?: boolean;
  pack_quantity?: number;
  pack_rate?: number;
  destination_location_id?: string;
  previous_rate?: number;
  previous_date?: string;
}

function PurchasesContent() {
  const { t, locale } = useI18n();
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Active view tab state (synchronized with URL query param `?view=invoices` / `?view=vendors`)
  const urlView = searchParams.get('view');
  const [activeView, setActiveView] = useState<'invoices' | 'vendors'>(
    urlView === 'vendors' ? 'vendors' : 'invoices'
  );

  useEffect(() => {
    if (urlView === 'vendors') {
      setActiveView('vendors');
    } else if (urlView === 'invoices') {
      setActiveView('invoices');
    }
  }, [urlView]);

  const handleViewChange = (view: 'invoices' | 'vendors') => {
    setActiveView(view);
    const params = new URLSearchParams(window.location.search);
    params.set('view', view);
    router.replace(`/finance/purchases?${params.toString()}`, { scroll: false });
  };

  const [businessDate, setBusinessDate] = useState(getTodayBusinessDate());
  const [vendors, setVendors] = useState<VendorOutstandingSummary[]>([]);
  const [rawVendors, setRawVendors] = useState<Vendor[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [vendorItems, setVendorItems] = useState<any[]>([]);
  const [vendorCategories, setVendorCategories] = useState<{ name: string; name_hi?: string | null }[]>([]);
  const [invoices, setInvoices] = useState<PurchaseInvoiceRecord[]>([]);

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
  const [showQuickVendorModal, setShowQuickVendorModal] = useState(false);
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [lines, setLines] = useState<PurchaseLineForm[]>([{ item_id: '', quantity: 1, rate: 0 }]);
  const [purchaseSaving, setPurchaseSaving] = useState(false);
  const [vendorPriceMemory, setVendorPriceMemory] = useState<Record<string, { rate: number; date: string }>>({});

  // Payment Modal State
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentVendorId, setPaymentVendorId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [paymentRef, setPaymentRef] = useState('');
  const [paymentSaving, setPaymentSaving] = useState(false);

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
        { data: locData },
        { data: pmData },
        { data: viData },
        { data: vcData },
        { data: pHeadersData, error: pErr },
      ] = await Promise.all([
        supabase.from('vendor_outstanding_summary').select('*').order('vendor_name'),
        supabase.from('vendors').select('*').order('name'),
        supabase
          .from('inventory_items')
          .select(`
            id, item_code, name, name_hi, unit_id, secondary_unit_id, conversion_factor, is_active, current_stock, current_weighted_average_cost,
            unit:units!inventory_items_unit_id_fkey(symbol, symbol_hi, name, name_hi),
            sec_unit:units!inventory_items_secondary_unit_id_fkey(symbol, symbol_hi, name, name_hi)
          `)
          .order('name'),
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
      ]);

      if (vErr) throw vErr;
      if (vRawErr) throw vRawErr;
      if (iErr) throw iErr;
      if (pErr) throw pErr;

      setVendors(vData || []);
      setRawVendors(vRaw || []);
      setItems(iData || []);
      setLocations(locData || []);
      setPaymentMethods(pmData || []);
      setVendorItems(viData || []);
      setVendorCategories(vcData || []);

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
        }));

        return {
          id: p.id,
          purchase_number: p.purchase_number,
          invoice_number: p.invoice_number,
          purchase_date: p.purchase_date,
          business_date: p.business_date,
          net_amount: Number(p.net_amount) || 0,
          total_amount: Number(p.total_amount) || 0,
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

  // Purchase Bill line handlers
  const handleAddLine = () => {
    setLines([...lines, { item_id: '', quantity: 1, rate: 0 }]);
  };

  const handleRemoveLine = (idx: number) => {
    if (lines.length > 1) {
      setLines(lines.filter((_, i) => i !== idx));
    }
  };

  const calculatePurchaseTotal = () => {
    return lines.reduce((acc, l) => {
      if (l.use_pack) {
        return acc + ((l.pack_quantity || 0) * (l.pack_rate || 0));
      }
      return acc + (l.quantity * l.rate || 0);
    }, 0);
  };

  const handleCreatePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVendorId) {
      alert(t('purchases.bills.errSelectVendor'));
      return;
    }

    const vSelected = vendors.find((v) => v.vendor_id === selectedVendorId);
    if (vSelected && vSelected.is_active === false) {
      alert(t('purchases.bills.errVendorInactive'));
      return;
    }

    setPurchaseSaving(true);
    setMessage(null);

    try {
      const netTotal = calculatePurchaseTotal();
      const purchaseNumber = `PO-${Date.now().toString().slice(-6)}`;
      const defaultStoreLoc = locations.find((l) => l.code === 'STORE')?.id || 'a89335e9-01b4-4edd-bee5-a894053d798d';

      const { data: header, error: headerErr } = await supabase
        .from('purchase_headers')
        .insert({
          purchase_number: purchaseNumber,
          vendor_id: selectedVendorId,
          purchase_date: businessDate,
          business_date: businessDate,
          invoice_number: invoiceNumber,
          total_amount: netTotal,
          net_amount: netTotal,
        })
        .select()
        .single();

      if (headerErr) throw headerErr;

      for (const line of lines) {
        const currentItem = items.find((i) => i.id === line.item_id);
        const conv = Number(currentItem?.conversion_factor) || 1;

        let baseQty: number;
        let baseRate: number;

        if (line.use_pack && conv > 0) {
          baseQty = (line.pack_quantity || 0) * conv;
          baseRate = (line.pack_rate || 0) / conv;
        } else {
          baseQty = line.quantity;
          baseRate = line.rate;
        }

        if (!line.item_id || baseQty <= 0) continue;
        const lineTotal = baseQty * baseRate;

        // Insert purchase line in base units
        const { error: lineErr } = await supabase.from('purchase_lines').insert({
          purchase_id: header.id,
          item_id: line.item_id,
          quantity: baseQty,
          rate: baseRate,
          total_amount: lineTotal,
        });
        if (lineErr) throw lineErr;

        // Inward stock into target location (Central Store) using atomic procedure
        const targetDestLoc = line.destination_location_id || defaultStoreLoc;

        const { error: txErr } = await supabase.rpc('execute_inventory_transaction', {
          p_item_id: line.item_id,
          p_business_date: businessDate,
          p_movement_type: 'purchase',
          p_quantity: baseQty,
          p_unit_cost: baseRate,
          p_destination_location_id: targetDestLoc,
          p_purpose: 'Vendor Inward Receipt',
          p_reference_id: header.id,
          p_reference_type: 'purchase_header',
          p_notes: `PO ${purchaseNumber} - ${vSelected?.vendor_name || 'Vendor'}`,
        });

        if (txErr) throw txErr;

        // Atomic Upsert vendor-item price memory
        try {
          await supabase
            .from('vendor_items')
            .upsert(
              {
                vendor_id: selectedVendorId,
                inventory_item_id: line.item_id,
                last_purchase_rate: baseRate,
                last_purchase_date: businessDate,
                is_preferred: true,
              },
              { onConflict: 'vendor_id,inventory_item_id' }
            );
        } catch (memErr) {
          console.warn('Could not update vendor price memory:', memErr);
        }
      }

      setMessage({ type: 'success', text: t('purchases.bills.invoiceRecorded', { number: purchaseNumber }) });
      setShowPurchaseModal(false);
      setLines([{ item_id: '', quantity: 1, rate: 0 }]);
      setInvoiceNumber('');
      loadData();
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: err.message || 'Failed to record purchase.' });
    } finally {
      setPurchaseSaving(false);
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
          <p className="text-xs text-stone-500 mt-0.5">
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

      {/* Top 4 KPI Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <Card className="min-w-0 overflow-hidden">
          <CardDescription className="truncate">{t('purchases.bills.outstanding')}</CardDescription>
          <div className="text-xl sm:text-2xl font-bold text-rose-600 mt-1 truncate">
            {formatINR(totalOutstanding)}
          </div>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardDescription className="truncate">{t('purchases.kpi.totalPurchased')}</CardDescription>
          <div className="text-xl sm:text-2xl font-bold text-stone-900 mt-1 truncate">
            {formatINR(totalPurchasesAllTime)}
          </div>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardDescription className="truncate">{t('purchases.kpi.totalPaid')}</CardDescription>
          <div className="text-xl sm:text-2xl font-bold text-emerald-700 mt-1 truncate">
            {formatINR(totalPaidAllTime)}
          </div>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardDescription className="truncate">{t('purchases.bills.activeVendors')}</CardDescription>
          <div className="text-xl sm:text-2xl font-bold text-stone-900 mt-1 truncate">
            {activeVendorsCount}
          </div>
        </Card>
      </div>

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
      </div>

      {/* Primary Views Content */}
      {activeView === 'invoices' ? (
        <PurchaseInvoicesView
          invoices={invoices}
          loading={loading}
          onRefresh={loadData}
          onNewInvoice={() => setShowPurchaseModal(true)}
          onRecordPayment={(vendorId) => {
            if (vendorId) setPaymentVendorId(vendorId);
            setShowPaymentModal(true);
          }}
        />
      ) : (
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

      {/* New Purchase Invoice Modal */}
      {showPurchaseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="flex items-center justify-between border-b pb-3">
              <h2 className="text-lg font-bold text-stone-900">{t('purchases.bills.newPurchaseInvoice')}</h2>
              <button onClick={() => setShowPurchaseModal(false)} className="text-stone-400 hover:text-stone-700 text-lg">✕</button>
            </div>

            <form onSubmit={handleCreatePurchase} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block font-medium text-stone-700">{t('purchases.bills.vendor')}</label>
                    <button
                      type="button"
                      onClick={() => setShowQuickVendorModal(true)}
                      className="text-[11px] text-amber-600 hover:text-amber-800 font-semibold hover:underline flex items-center gap-0.5"
                    >
                      <Plus className="h-3 w-3" /> {t('purchases.bills.quickAddVendor')}
                    </button>
                  </div>
                  <select
                    value={selectedVendorId}
                    onChange={(e) => setSelectedVendorId(e.target.value)}
                    required
                    aria-label={t('purchases.bills.vendor')}
                    className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                  >
                    <option value="">{t('purchases.bills.selectVendor')}</option>
                    {vendors
                      .filter((v) => v.is_active !== false)
                      .map((v) => (
                        <option key={v.vendor_id} value={v.vendor_id}>
                          {v.vendor_name}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-stone-700 mb-1">{t('purchases.bills.invoiceNo')}</label>
                  <input
                    type="text"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder="e.g. INV-2026-88"
                    className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="space-y-2 border-t pt-3">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-stone-800">{t('purchases.bills.items')}</label>
                  <Button type="button" variant="secondary" size="sm" onClick={handleAddLine} className="gap-1 text-xs">
                    <Plus className="h-3 w-3" /> {t('purchases.bills.addItem')}
                  </Button>
                </div>

                {lines.map((line, idx) => {
                  const currentItem = items.find((i) => i.id === line.item_id);
                  const hasPack = Boolean(currentItem?.sec_unit && Number(currentItem.conversion_factor) > 1);
                  const conv = Number(currentItem?.conversion_factor) || 1;

                  const lineBaseQty = line.use_pack && conv > 0 ? (line.pack_quantity || 0) * conv : line.quantity;
                  const lineBaseRate = line.use_pack && conv > 0 ? (line.pack_rate || 0) / conv : line.rate;
                  const lineTotalVal = line.use_pack ? (line.pack_quantity || 0) * (line.pack_rate || 0) : line.quantity * line.rate;

                  const isDeviation =
                    line.previous_rate &&
                    lineBaseRate > 0 &&
                    Math.abs(lineBaseRate - line.previous_rate) / line.previous_rate > 0.2;
                  const deviationPct = line.previous_rate
                    ? Math.round(((lineBaseRate - line.previous_rate) / line.previous_rate) * 100)
                    : 0;

                  const secUnitSymbol = getLocalizedMasterSymbol(currentItem?.sec_unit, locale) || currentItem?.sec_unit?.symbol || (locale === 'hi' ? 'पैक' : 'Packs');
                  const baseUnitSymbol = getLocalizedMasterSymbol(currentItem?.unit, locale) || currentItem?.unit?.symbol || (locale === 'hi' ? 'इकाई' : 'Units');

                  return (
                    <div key={idx} className="p-3 bg-stone-50 rounded-lg border border-stone-200 space-y-2">
                      {/* Top Row: Item Select, Pack Toggle, Qty, Rate, Total, Delete */}
                      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                        <SearchableSelect
                          options={items.filter((i) => i.is_active !== false || i.id === line.item_id)}
                          value={line.item_id}
                          onChange={(selectedId) => {
                            const next = [...lines];
                            next[idx].item_id = selectedId;
                            const selItem = items.find((it) => it.id === selectedId);
                            const mem = vendorPriceMemory[selectedId];
                            if (mem && mem.rate > 0) {
                              next[idx].rate = mem.rate;
                              next[idx].previous_rate = mem.rate;
                              next[idx].previous_date = mem.date;
                              if (selItem?.conversion_factor && Number(selItem.conversion_factor) > 1) {
                                next[idx].pack_rate = mem.rate * Number(selItem.conversion_factor);
                              }
                            } else {
                              next[idx].previous_rate = undefined;
                              next[idx].previous_date = undefined;
                            }
                            setLines(next);
                          }}
                          labelKey={(i) => (i.name_hi && locale === 'hi' ? i.name_hi : i.name)}
                          secondaryLabelKey={(i) => i.item_code}
                          placeholder={t('purchases.bills.selectItem')}
                          required
                          className="flex-1 min-w-[200px]"
                          triggerClassName="bg-white p-2 text-xs"
                          renderOption={(i) => (
                            <div className="flex items-center justify-between w-full">
                              <div className="truncate font-medium">
                                {i.name_hi && locale === 'hi' ? i.name_hi : i.name}
                              </div>
                              <span className="font-mono text-[10px] text-stone-500 bg-stone-100 px-1 py-0.5 rounded ml-2 shrink-0">
                                {i.item_code}
                              </span>
                            </div>
                          )}
                        />

                        {hasPack && (
                          <button
                            type="button"
                            onClick={() => {
                              const next = [...lines];
                              const willUse = !next[idx].use_pack;
                              next[idx].use_pack = willUse;
                              if (willUse) {
                                next[idx].pack_quantity = next[idx].pack_quantity || 1;
                                next[idx].pack_rate = next[idx].pack_rate || (next[idx].rate > 0 ? next[idx].rate * conv : 0);
                              }
                              setLines(next);
                            }}
                            className={`px-2 py-1.5 rounded text-[10px] font-bold border transition-colors shrink-0 ${
                              line.use_pack
                                ? 'bg-amber-100 border-amber-300 text-amber-900 shadow-xs'
                                : 'bg-white border-stone-300 text-stone-600 hover:bg-stone-100'
                            }`}
                            title={`1 ${secUnitSymbol} = ${conv} ${baseUnitSymbol}`}
                          >
                            📦 {line.use_pack ? `${t('purchases.bills.pack')} (${secUnitSymbol} ×${conv})` : `${t('purchases.bills.base')} (${baseUnitSymbol})`}
                          </button>
                        )}

                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="0.001"
                            value={line.use_pack ? (line.pack_quantity || '') : (line.quantity || '')}
                            onChange={(e) => {
                              const next = [...lines];
                              const val = parseFloat(e.target.value) || 0;
                              if (line.use_pack) {
                                next[idx].pack_quantity = val;
                              } else {
                                next[idx].quantity = val;
                              }
                              setLines(next);
                            }}
                            placeholder={t('purchases.bills.qty')}
                            required
                            className="w-16 rounded-md border border-stone-300 bg-white p-2 text-right text-stone-900 text-xs focus:outline-none"
                          />
                          <span className="px-1.5 py-1.5 bg-stone-200/80 border border-stone-300 rounded text-stone-700 font-mono text-[11px] font-bold">
                            {line.use_pack ? secUnitSymbol : baseUnitSymbol}
                          </span>
                        </div>

                        <div className="relative">
                          <input
                            type="number"
                            step="0.01"
                            value={line.use_pack ? (line.pack_rate || '') : (line.rate || '')}
                            onChange={(e) => {
                              const next = [...lines];
                              const val = parseFloat(e.target.value) || 0;
                              if (line.use_pack) {
                                next[idx].pack_rate = val;
                              } else {
                                next[idx].rate = val;
                              }
                              setLines(next);
                            }}
                            placeholder={line.use_pack ? `₹ / ${secUnitSymbol}` : t('purchases.bills.rate')}
                            required
                            className={`w-24 rounded-md border p-2 text-right text-stone-900 text-xs focus:outline-none bg-white ${
                              isDeviation ? 'border-amber-400 bg-amber-50/50' : 'border-stone-300'
                            }`}
                          />
                        </div>

                        <div className="w-24 text-right font-semibold text-stone-800">
                          {formatINR(lineTotalVal)}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveLine(idx)}
                          className="text-stone-400 hover:text-rose-600 p-1"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      {line.use_pack && hasPack && (
                        <div className="text-[11px] text-amber-800 bg-amber-50/70 border border-amber-200 rounded px-2 py-1 font-mono flex items-center justify-between">
                          <span>
                            {t('purchases.bills.conversion')} <strong>{line.pack_quantity || 0} {secUnitSymbol}</strong> × {conv} = <strong>{lineBaseQty.toFixed(2)} {baseUnitSymbol}</strong>
                          </span>
                          <span>
                            {t('purchases.bills.derivedRate')} <strong>{formatINR(lineBaseRate)}</strong> / {baseUnitSymbol}
                          </span>
                        </div>
                      )}

                      <div className="pt-1 border-t border-stone-200/60 text-[11px] max-w-xs">
                        <select
                          value={line.destination_location_id || ''}
                          onChange={(e) => {
                            const next = [...lines];
                            next[idx].destination_location_id = e.target.value;
                            setLines(next);
                          }}
                          aria-label={t('purchases.bills.centralStoreRoom')}
                          className="w-full rounded border border-stone-300 bg-white px-2 py-1 text-stone-800 text-[11px] focus:outline-none"
                        >
                          <option value="">{t('purchases.bills.centralStoreRoom')}</option>
                          {locations.map((loc) => (
                            <option key={loc.id} value={loc.id}>
                              {t('purchases.bills.storeAt', { location: getLocalizedMasterName(loc, locale) || loc.name })} ({loc.code})
                            </option>
                          ))}
                        </select>
                      </div>

                      {line.previous_rate !== undefined && line.previous_rate > 0 && (
                        <div className="flex items-center justify-between text-[11px] px-1 text-stone-500">
                          <span>
                            {t('purchases.bills.prevPurchase')} <strong className="text-stone-700">{formatINR(line.previous_rate)}</strong>
                            {line.previous_date && ` ${t('purchases.bills.onDate', { date: line.previous_date })}`}
                          </span>
                          {isDeviation && (
                            <span className="text-amber-700 font-bold bg-amber-100 px-1.5 py-0.5 rounded border border-amber-200 text-[10px]">
                              ⚠️ {deviationPct > 0 ? t('purchases.bills.higherThanPrev', { pct: deviationPct }) : t('purchases.bills.lowerThanPrev', { pct: Math.abs(deviationPct) })}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between border-t pt-3">
                <span className="font-bold text-stone-700 text-sm">{t('purchases.bills.invoiceTotal')}</span>
                <span className="font-extrabold text-amber-600 text-lg">
                  {formatINR(calculatePurchaseTotal())}
                </span>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setShowPurchaseModal(false)}>{t('purchases.bills.cancel')}</Button>
                <Button type="submit" variant="amber" disabled={purchaseSaving}>
                  {purchaseSaving ? t('purchases.bills.saving') : t('purchases.bills.postPurchase')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

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
          loadData();
          setSelectedVendorId(newVendor.id);
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
