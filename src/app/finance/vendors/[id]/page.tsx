'use client';

import React, { useState, useEffect, useMemo, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR, getTodayBusinessDate } from '@/lib/utils';
import { Vendor, VendorLedgerEntry } from '@/lib/types/database';
import { VendorModal } from '@/components/vendors/VendorModal';
import { PurchaseModal } from '@/components/purchases/PurchaseModal';
import { EditPaymentModal } from '@/components/purchases/EditPaymentModal';
import { useAppRole } from '@/components/layout/AppShell';
import {
  Building2,
  ArrowLeft,
  Edit2,
  Phone,
  MapPin,
  CreditCard,
  Tag,
  Calendar,
  Clock,
  FileText,
  ShoppingBag,
  CheckCircle,
  AlertCircle,
  Package,
  Layers,
  Power,
  RefreshCw,
  Plus,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Trash2
} from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { getLocalizedMasterName, getLocalizedMasterSymbol } from '@/lib/i18n/master-data';

const formatDisplayDate = (dateStr: string, locale: string) => {
  if (!dateStr) return '';
  try {
    const raw = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
    const [y, m, d] = raw.split('-');
    if (!y || !m || !d) return dateStr;
    const monthsEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthsHi = ['जन', 'फ़र', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अग', 'सितं', 'अक्टू', 'नव', 'दिसं'];
    const mIdx = parseInt(m, 10) - 1;
    const month = locale === 'hi' ? monthsHi[mIdx] : monthsEn[mIdx];
    return `${parseInt(d, 10)} ${month} ${y}`;
  } catch {
    return dateStr;
  }
};

interface PurchaseHeaderWithLines {
  id: string;
  purchase_number: string;
  invoice_number?: string;
  purchase_date: string;
  business_date?: string;
  net_amount: number;
  total_amount: number;
  status?: string;
  cancelled_at?: string;
  cancelled_reason?: string;
  vendor_id?: string;
  lines: {
    id: string;
    item_id: string;
    item_name?: string;
    item_code?: string;
    quantity: number;
    rate: number;
    total_amount: number;
    unit_symbol?: string;
    packaging_unit_id?: string | null;
    brand_name_snapshot?: string | null;
    pack_unit_snapshot?: string | null;
    pack_quantity?: number | null;
    pack_rate?: number | null;
    conversion_factor_snapshot?: number | null;
  }[];
  allocated_amount: number;
}

interface VendorPaymentRecord {
  id: string;
  payment_number: string;
  payment_date: string;
  amount: number;
  payment_method_id?: string;
  payment_method_name?: string;
  reference_number?: string;
  notes?: string;
}

interface VendorItemRecord {
  id: string;
  inventory_item_id: string;
  item_code: string;
  item_name: string;
  category_name?: string;
  unit_symbol?: string;
  last_purchase_rate: number;
  last_purchase_date?: string;
  is_preferred?: boolean;
}

export default function VendorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const vendorId = resolvedParams.id;
  const router = useRouter();
  const { t, locale } = useI18n();
  const supabase = createClient();
  const { role, hasPermission } = useAppRole();

  const isAdmin = role === 'Admin';
  const canEditInvoices = isAdmin || hasPermission('finance.purchases.edit');
  const canEditVendors = isAdmin || hasPermission('finance.vendors.edit');
  const canEditPayments = isAdmin || hasPermission('finance.payments.edit');

  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [preferredMethodName, setPreferredMethodName] = useState<string>('');
  const [purchases, setPurchases] = useState<PurchaseHeaderWithLines[]>([]);
  const [payments, setPayments] = useState<VendorPaymentRecord[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [vendorItems, setVendorItems] = useState<VendorItemRecord[]>([]);
  const [allItems, setAllItems] = useState<any[]>([]);
  const [vendorCategories, setVendorCategories] = useState<{ name: string; name_hi?: string | null }[]>([]);

  const [activeTab, setActiveTab] = useState<'overview' | 'purchases' | 'payments' | 'ledger' | 'items'>('overview');
  const [expandedPurchaseId, setExpandedPurchaseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Edit Vendor Modal State
  const [editModalOpen, setEditModalOpen] = useState(false);

  // Delete Vendor Modal State
  const [deleteVendorModalOpen, setDeleteVendorModalOpen] = useState(false);
  const [deleteVendorLoading, setDeleteVendorLoading] = useState(false);

  // Edit / Delete Invoice States
  const [lookups, setLookups] = useState<any>(null);
  const [editingInvoice, setEditingInvoice] = useState<any | null>(null);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [deletingInvoice, setDeletingInvoice] = useState<PurchaseHeaderWithLines | null>(null);
  const [deleteInvoiceModalOpen, setDeleteInvoiceModalOpen] = useState(false);
  const [deleteInvoiceLoading, setDeleteInvoiceLoading] = useState(false);

  // Edit / Delete Payment States
  const [editingPayment, setEditingPayment] = useState<VendorPaymentRecord | null>(null);
  const [editPaymentModalOpen, setEditPaymentModalOpen] = useState(false);
  const [deletingPayment, setDeletingPayment] = useState<VendorPaymentRecord | null>(null);
  const [deletePaymentModalOpen, setDeletePaymentModalOpen] = useState(false);
  const [deletePaymentLoading, setDeletePaymentLoading] = useState(false);

  // Link Item Modal State
  const [showLinkItemModal, setShowLinkItemModal] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [customRate, setCustomRate] = useState<number>(0);
  const [linkingItem, setLinkingItem] = useState(false);

  const loadVendorData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Vendor Details
      const { data: vData, error: vErr } = await supabase
        .from('vendors')
        .select('*')
        .eq('id', vendorId)
        .single();

      if (vErr) throw vErr;
      setVendor(vData);

      // Preferred method name & all payment methods
      const { data: pmList } = await supabase
        .from('payment_methods')
        .select('id, name, name_hi, is_active')
        .order('name');
      setPaymentMethods(pmList || []);

      if (vData.preferred_payment_method_id && pmList) {
        const pm = pmList.find((m) => m.id === vData.preferred_payment_method_id);
        if (pm) setPreferredMethodName(getLocalizedMasterName(pm, locale) || pm.name);
      }

      // 2. Fetch Purchases with Lines
      const { data: pData } = await supabase
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
        .eq('vendor_id', vendorId)
        .order('purchase_date', { ascending: false });

      const parsedPurchases: PurchaseHeaderWithLines[] = (pData || []).map((p: any) => {
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
          allocated_amount: allocated,
          lines,
        };
      });
      setPurchases(parsedPurchases);

      // 3. Fetch Payments
      const { data: payData } = await supabase
        .from('vendor_payments')
        .select(`
          id,
          payment_number,
          payment_date,
          amount,
          payment_method_id,
          reference_number,
          notes,
          payment_methods (
            name,
            name_hi
          )
        `)
        .eq('vendor_id', vendorId)
        .order('payment_date', { ascending: false });

      const parsedPayments: VendorPaymentRecord[] = (payData || []).map((p: any) => ({
        id: p.id,
        payment_number: p.payment_number,
        payment_date: p.payment_date,
        amount: Number(p.amount) || 0,
        payment_method_id: p.payment_method_id,
        reference_number: p.reference_number,
        payment_method_name: p.payment_methods ? (getLocalizedMasterName(p.payment_methods, locale) || p.payment_methods.name) : (locale === 'hi' ? 'नकद / सीधा भुगतान' : 'Cash / Direct'),
        notes: p.notes,
      }));
      setPayments(parsedPayments);

      // 4. Fetch Vendor Items
      const { data: viData, error: viErr } = await supabase
        .from('vendor_items')
        .select(`
          id,
          inventory_item_id,
          last_purchase_rate,
          last_purchase_date,
          is_preferred,
          inventory_items (
            name,
            name_hi,
            item_code,
            inventory_categories (name, name_hi),
            units!inventory_items_unit_id_fkey (symbol, symbol_hi, name, name_hi)
          )
        `)
        .eq('vendor_id', vendorId);

      if (viErr) {
        console.error('Error fetching vendor items:', viErr);
      }

      const parsedVendorItems: VendorItemRecord[] = (viData || []).map((vi: any) => ({
        id: vi.id,
        inventory_item_id: vi.inventory_item_id,
        item_code: vi.inventory_items?.item_code || 'SKU',
        item_name: (locale === 'hi' && vi.inventory_items?.name_hi) ? vi.inventory_items.name_hi : (vi.inventory_items?.name || 'Item'),
        category_name: getLocalizedMasterName(vi.inventory_items?.inventory_categories, locale) || vi.inventory_items?.inventory_categories?.name,
        unit_symbol: getLocalizedMasterSymbol(vi.inventory_items?.units, locale) || vi.inventory_items?.units?.symbol,
        last_purchase_rate: Number(vi.last_purchase_rate) || 0,
        last_purchase_date: vi.last_purchase_date,
        is_preferred: vi.is_preferred,
      }));
      setVendorItems(parsedVendorItems);

      // 5. Fetch all inventory items for linking modal
      const { data: itemCatalog } = await supabase
        .from('inventory_items')
        .select('id, name, name_hi, item_code, current_weighted_average_cost')
        .eq('is_active', true)
        .order('name');
      setAllItems(itemCatalog || []);

      // 6. Fetch vendor categories
      const { data: catData } = await supabase
        .from('vendor_categories')
        .select('name, name_hi');
      setVendorCategories(catData || []);
    } catch (err: any) {
      console.error('Error loading vendor:', err);
      setMessage({ type: 'error', text: t('purchases.bills.errLoad') + ': ' + err.message });
    } finally {
      setLoading(false);
    }
  };

  const vendorCatMap = useMemo(() => {
    const map = new Map<string, string>();
    vendorCategories.forEach((vc) => {
      if (vc.name && vc.name_hi) {
        map.set(vc.name.toLowerCase(), vc.name_hi);
      }
    });
    return map;
  }, [vendorCategories]);

  const getCategoryDisplay = (catName: string) => {
    if (locale === 'hi') {
      return vendorCatMap.get(catName.toLowerCase()) || catName;
    }
    return catName;
  };

  const formatFrequency = (freq?: string | null) => {
    if (!freq) return locale === 'hi' ? 'साप्ताहिक' : 'Weekly';
    if (locale !== 'hi') return freq;
    if (freq === 'Per Delivery') return 'प्रत्येक डिलीवरी';
    if (freq === 'Weekly') return 'साप्ताहिक';
    if (freq === 'Bi-weekly') return 'हर 15 दिन';
    if (freq === 'Monthly') return 'मासिक';
    if (freq === 'As Needed') return 'ज़रूरत के अनुसार';
    return freq;
  };

  useEffect(() => {
    loadVendorData();
  }, [vendorId]);

  // Calculations for Summary Metrics
  const summaryMetrics = useMemo(() => {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth(); // 0-indexed

    // Purchases this month
    const purchasedThisMonth = purchases.reduce((sum, p) => {
      const pDate = new Date(p.purchase_date);
      if (pDate.getFullYear() === currentYear && pDate.getMonth() === currentMonth) {
        return sum + p.net_amount;
      }
      return sum;
    }, 0);

    // Payments this month
    const paidThisMonth = payments.reduce((sum, pay) => {
      const payDate = new Date(pay.payment_date);
      if (payDate.getFullYear() === currentYear && payDate.getMonth() === currentMonth) {
        return sum + pay.amount;
      }
      return sum;
    }, 0);

    // Cumulative totals
    const totalPurchasedAllTime = purchases.reduce((sum, p) => sum + p.net_amount, 0);
    const totalPaidAllTime = payments.reduce((sum, pay) => sum + pay.amount, 0);
    const outstandingBalance = totalPurchasedAllTime - totalPaidAllTime;

    return {
      purchasedThisMonth,
      paidThisMonth,
      totalPurchasedAllTime,
      totalPaidAllTime,
      outstandingBalance,
    };
  }, [purchases, payments]);

  // Compute Chronological Ledger Entries
  const ledgerEntries = useMemo(() => {
    const allEvents: {
      id: string;
      date: string;
      type: 'purchase' | 'payment';
      reference_number: string;
      invoice_number?: string;
      description: string;
      debit: number;
      credit: number;
    }[] = [];

    // Add all purchases as Credits (increase liability to vendor)
    purchases.forEach((p) => {
      allEvents.push({
        id: p.id,
        date: p.purchase_date,
        type: 'purchase',
        reference_number: p.purchase_number,
        invoice_number: p.invoice_number,
        description: `Procurement Invoice ${p.invoice_number ? `(#${p.invoice_number})` : ''} — ${p.lines.length} items`,
        debit: 0,
        credit: p.net_amount,
      });
    });

    // Add all payments as Debits (decrease liability to vendor)
    payments.forEach((pay) => {
      allEvents.push({
        id: pay.id,
        date: pay.payment_date,
        type: 'payment',
        reference_number: pay.payment_number,
        description: `Payment Voucher via ${pay.payment_method_name} ${pay.reference_number ? `(Ref: ${pay.reference_number})` : ''}`,
        debit: pay.amount,
        credit: 0,
      });
    });

    // Sort chronologically ascending
    allEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Calculate Running Balance
    let running = 0;
    const computedLedger: VendorLedgerEntry[] = allEvents.map((item) => {
      running += item.credit - item.debit;
      return {
        ...item,
        running_balance: running,
      };
    });

    return computedLedger;
  }, [purchases, payments]);

  const handleToggleStatus = async () => {
    if (!vendor) return;
    const newStatus = !vendor.is_active;

    try {
      const { error } = await supabase
        .from('vendors')
        .update({ is_active: newStatus, updated_at: new Date().toISOString() })
        .eq('id', vendor.id);

      if (error) throw error;

      setVendor({ ...vendor, is_active: newStatus });
      setMessage({
        type: 'success',
        text: `Vendor status updated to ${newStatus ? 'Active' : 'Inactive'}.`,
      });
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Failed to update status: ' + err.message });
    }
  };

  const handleInitiateDeleteVendor = () => {
    if (!vendor) return;
    setDeleteVendorModalOpen(true);
  };

  const handleConfirmDeleteVendor = async () => {
    if (!vendor) return;
    setDeleteVendorLoading(true);
    try {
      await supabase.from('vendor_items').delete().eq('vendor_id', vendor.id);
      const { error } = await supabase.from('vendors').delete().eq('id', vendor.id);
      if (error) throw error;
      router.push('/finance/purchases?tab=vendors');
    } catch (err: any) {
      console.error('Failed to delete vendor:', err);
      setMessage({ type: 'error', text: err.message || 'Failed to delete vendor.' });
      setDeleteVendorModalOpen(false);
    } finally {
      setDeleteVendorLoading(false);
    }
  };

  const handleEditInvoice = async (invoice: PurchaseHeaderWithLines) => {
    if (!lookups) {
      setLoading(true);
      try {
        const [
          { data: vList },
          { data: iList },
          { data: gList },
          { data: pkgList },
          { data: cList },
          { data: uList },
          { data: locList },
          { data: aList },
          { data: vItems },
        ] = await Promise.all([
          supabase.from('vendors').select('*').order('name'),
          supabase.from('inventory_items').select('*, units!inventory_items_unit_id_fkey(symbol, symbol_hi)').eq('is_active', true).order('name'),
          supabase.from('logical_ingredient_groups').select('*, base_unit:units!logical_ingredient_groups_base_unit_id_fkey(id, symbol, symbol_hi, name, name_hi)').eq('is_active', true).order('name'),
          supabase.from('item_packaging_units').select('*, pack_unit:units!item_packaging_units_pack_unit_id_fkey(symbol, symbol_hi, name, name_hi)').eq('is_active', true),
          supabase.from('inventory_categories').select('id, name, name_hi, inventory_class').order('name'),
          supabase.from('units').select('id, symbol, symbol_hi, name, name_hi').order('symbol'),
          supabase.from('inventory_locations').select('*').eq('is_active', true).order('code'),
          supabase.from('inventory_item_aliases').select('item_id, group_id, alias, alias_type'),
          supabase.from('vendor_items').select('id, vendor_id, inventory_item_id, last_purchase_rate, last_purchase_date'),
        ]);

        const priceMem: Record<string, { rate: number; date: string }> = {};
        (vItems || []).forEach((vi: any) => {
          priceMem[`${vi.vendor_id}_${vi.inventory_item_id}`] = {
            rate: Number(vi.last_purchase_rate),
            date: vi.last_purchase_date,
          };
        });

        const loadedLookups = {
          vendors: vList || [],
          items: iList || [],
          groups: gList || [],
          packagingUnits: pkgList || [],
          categories: cList || [],
          units: uList || [],
          locations: locList || [],
          aliases: aList || [],
          vendorPriceMemory: priceMem,
        };
        setLookups(loadedLookups);
        setEditingInvoice(invoice);
        setShowPurchaseModal(true);
      } catch (err: any) {
        console.error('Failed to load lookups:', err);
        setMessage({ type: 'error', text: 'Failed to load purchase editor data: ' + err.message });
      } finally {
        setLoading(false);
      }
    } else {
      setEditingInvoice(invoice);
      setShowPurchaseModal(true);
    }
  };

  const handleInitiateDeleteInvoice = (inv: PurchaseHeaderWithLines) => {
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
      if (!res.ok) throw new Error(data.error || 'Failed to delete purchase invoice');
      setMessage({
        type: 'success',
        text: t('purchases.bills.invoiceDeleted', { number: deletingInvoice.purchase_number }),
      });
      setDeleteInvoiceModalOpen(false);
      setDeletingInvoice(null);
      loadVendorData();
    } catch (err: any) {
      console.error('Delete invoice failed:', err);
      setMessage({ type: 'error', text: err.message || 'Failed to delete purchase invoice.' });
    } finally {
      setDeleteInvoiceLoading(false);
    }
  };

  const handleEditPayment = (pay: VendorPaymentRecord) => {
    setEditingPayment(pay);
    setEditPaymentModalOpen(true);
  };

  const handleInitiateDeletePayment = (pay: VendorPaymentRecord) => {
    setDeletingPayment(pay);
    setDeletePaymentModalOpen(true);
  };

  const handleConfirmDeletePayment = async () => {
    if (!deletingPayment) return;
    setDeletePaymentLoading(true);
    try {
      const res = await fetch('/api/finance/payments/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_id: deletingPayment.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete payment');
      setMessage({
        type: 'success',
        text: t('purchases.payments.paymentDeleted', { number: deletingPayment.payment_number }),
      });
      setDeletePaymentModalOpen(false);
      setDeletingPayment(null);
      loadVendorData();
    } catch (err: any) {
      console.error('Delete payment failed:', err);
      setMessage({ type: 'error', text: err.message || 'Failed to delete payment.' });
    } finally {
      setDeletePaymentLoading(false);
    }
  };

  const handleLinkItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItemId) return;
    setLinkingItem(true);
    try {
      const { data: existing } = await supabase
        .from('vendor_items')
        .select('id')
        .eq('vendor_id', vendorId)
        .eq('inventory_item_id', selectedItemId)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('vendor_items')
          .update({
            last_purchase_rate: customRate,
            last_purchase_date: getTodayBusinessDate(),
            is_preferred: true,
          })
          .eq('id', existing.id);

        if (error) throw error;
        setMessage({ type: 'success', text: 'Existing catalog link updated with new agreed rate.' });
      } else {
        const { error } = await supabase.from('vendor_items').insert({
          vendor_id: vendorId,
          inventory_item_id: selectedItemId,
          last_purchase_rate: customRate,
          last_purchase_date: getTodayBusinessDate(),
          is_preferred: true,
        });

        if (error) throw error;
        setMessage({ type: 'success', text: 'Item linked to vendor catalog successfully.' });
      }

      await loadVendorData();
      setShowLinkItemModal(false);
      setSelectedItemId('');
      setCustomRate(0);
    } catch (err: any) {
      console.error(err);
      if (err.code === '23505' || err.message?.includes('duplicate key')) {
        setMessage({ type: 'error', text: 'This item is already linked to this vendor.' });
      } else {
        setMessage({ type: 'error', text: 'Failed to link item: ' + (err.message || 'Database error') });
      }
    } finally {
      setLinkingItem(false);
    }
  };

  if (loading && !vendor) {
    return (
      <div className="py-20 text-center text-xs text-stone-500 flex items-center justify-center gap-2">
        <RefreshCw className="h-5 w-5 animate-spin text-amber-600" />
        Loading vendor details...
      </div>
    );
  }

  if (!vendor) {
    return (
      <div className="p-8 text-center space-y-4">
        <div className="text-stone-600 font-semibold text-base">{t('purchases.vendors.noVendors')}</div>
        <Link href="/finance/purchases?view=vendors">
          <Button variant="secondary" size="sm" className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> {t('purchases.vendors.detail.backToVendors')}
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-full overflow-hidden">
      {/* Top Breadcrumb & Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-stone-500 font-medium">
            <Link
              href="/finance/purchases?view=vendors"
              className="hover:text-amber-600 flex items-center gap-1 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>{t('purchases.vendors.detail.breadcrumbPurchases')}</span>
            </Link>
            <span className="text-stone-300">/</span>
            <Link
              href="/finance/purchases?view=vendors"
              className="hover:text-amber-600 transition-colors"
            >
              <span>{t('purchases.vendors.detail.breadcrumbVendors')}</span>
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2 break-words">
              <Building2 className="h-5 w-5 sm:h-6 sm:w-6 text-amber-600 shrink-0" />
              <span>{vendor.name}</span>
            </h1>
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-stone-100 text-stone-700 font-bold shrink-0">
              {vendor.vendor_code || 'VEND'}
            </span>
            <Badge variant={vendor.is_active ? 'success' : 'default'} className="shrink-0">
              {vendor.is_active ? t('purchases.vendors.status.active') : t('purchases.vendors.status.inactive')}
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {canEditVendors && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleToggleStatus}
                className={`gap-1.5 ${
                  vendor.is_active
                    ? 'text-stone-600 hover:text-rose-600'
                    : 'text-stone-600 hover:text-emerald-600'
                }`}
              >
                <Power className="h-4 w-4" />
                {vendor.is_active ? t('purchases.vendors.actions.deactivateVendor') : t('purchases.vendors.actions.activateVendor')}
              </Button>

              <Button
                variant="amber"
                size="sm"
                onClick={() => setEditModalOpen(true)}
                className="gap-1.5 font-bold"
              >
                <Edit2 className="h-4 w-4" />
                {t('purchases.vendors.detail.editVendor')}
              </Button>
            </>
          )}

          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleInitiateDeleteVendor}
              className="gap-1.5 text-stone-500 hover:text-rose-600 hover:border-rose-300"
              title={t('purchases.vendors.detail.deleteVendor')}
            >
              <Trash2 className="h-4 w-4" />
              <span className="hidden sm:inline">{t('purchases.vendors.detail.deleteVendor')}</span>
            </Button>
          )}

          <Button variant="outline" size="sm" onClick={loadVendorData} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Alert Messages */}
      {message && (
        <div
          className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 border ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
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

      {/* Summary Metrics Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3">
        <Card className="min-w-0 overflow-hidden">
          <CardDescription className="truncate">{t('purchases.vendors.detail.kpi.totalPurchased')}</CardDescription>
          <div className="text-lg sm:text-xl font-bold text-stone-900 mt-1 truncate">
            {formatINR(summaryMetrics.totalPurchasedAllTime)}
          </div>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardDescription className="truncate">{t('purchases.vendors.detail.kpi.totalPaid')}</CardDescription>
          <div className="text-lg sm:text-xl font-bold text-emerald-700 mt-1 truncate">
            {formatINR(summaryMetrics.totalPaidAllTime)}
          </div>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardDescription className="truncate">{t('purchases.vendors.detail.kpi.balanceDue')}</CardDescription>
          <div className="text-lg sm:text-xl font-bold text-rose-600 mt-1 truncate">
            {formatINR(summaryMetrics.outstandingBalance)}
          </div>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardDescription className="truncate">{t('purchases.vendors.modal.paymentTerms')}</CardDescription>
          <div className="text-sm sm:text-base font-bold text-stone-800 mt-1 truncate">
            {vendor.payment_terms || 'Net 7 Days'}
          </div>
        </Card>

        <Card className="min-w-0 overflow-hidden col-span-2 sm:col-span-1">
          <CardDescription className="truncate">{t('purchases.bills.table.status')}</CardDescription>
          <div className="mt-1">
            <span
              className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${
                vendor.is_active
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-stone-100 text-stone-600'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${vendor.is_active ? 'bg-emerald-600' : 'bg-stone-400'}`} />
              {vendor.is_active ? t('purchases.vendors.status.active') : t('purchases.vendors.status.inactive')}
            </span>
          </div>
        </Card>
      </div>

      {/* Tabs Navigation */}
      <div className="border-b border-stone-200 overflow-x-auto scrollbar-none -mx-2 px-2 sm:mx-0 sm:px-0">
        <nav className="flex space-x-3 sm:space-x-6 text-xs font-medium min-w-max pb-0.5">
          <button
            onClick={() => setActiveTab('overview')}
            className={`py-3 border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'overview'
                ? 'border-amber-600 text-amber-700 font-bold'
                : 'border-transparent text-stone-500 hover:text-stone-700'
            }`}
          >
            <Building2 className="h-4 w-4" />
            {t('purchases.vendors.detail.tabs.overview')}
          </button>

          <button
            onClick={() => setActiveTab('purchases')}
            className={`py-3 border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'purchases'
                ? 'border-amber-600 text-amber-700 font-bold'
                : 'border-transparent text-stone-500 hover:text-stone-700'
            }`}
          >
            <ShoppingBag className="h-4 w-4" />
            {t('purchases.vendors.detail.tabs.purchases')} ({purchases.length})
          </button>

          <button
            onClick={() => setActiveTab('payments')}
            className={`py-3 border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'payments'
                ? 'border-amber-600 text-amber-700 font-bold'
                : 'border-transparent text-stone-500 hover:text-stone-700'
            }`}
          >
            <CreditCard className="h-4 w-4" />
            {t('purchases.vendors.detail.tabs.payments')} ({payments.length})
          </button>

          <button
            onClick={() => setActiveTab('ledger')}
            className={`py-3 border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'ledger'
                ? 'border-amber-600 text-amber-700 font-bold'
                : 'border-transparent text-stone-500 hover:text-stone-700'
            }`}
          >
            <FileText className="h-4 w-4" />
            {t('purchases.vendors.detail.tabs.ledger')} ({ledgerEntries.length})
          </button>

          <button
            onClick={() => setActiveTab('items')}
            className={`py-3 border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'items'
                ? 'border-amber-600 text-amber-700 font-bold'
                : 'border-transparent text-stone-500 hover:text-stone-700'
            }`}
          >
            <Package className="h-4 w-4" />
            {t('purchases.vendors.detail.tabs.items')} ({vendorItems.length})
          </button>
        </nav>
      </div>

      {/* Tab 1: Overview */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Contact Details Card */}
          <Card>
            <CardHeader className="pb-3 border-b border-stone-100">
              <CardTitle className="text-sm">{t('purchases.vendors.detail.primaryContact')}</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4 text-xs">
              <div className="grid grid-cols-3 gap-2">
                <span className="text-stone-500 font-medium">{t('purchases.vendors.modal.contactPerson')}:</span>
                <span className="col-span-2 text-stone-900 font-semibold">
                  {vendor.contact_person || 'Not specified'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <span className="text-stone-500 font-medium">{t('purchases.vendors.modal.phone')}:</span>
                <span className="col-span-2 text-stone-900 font-mono">
                  {vendor.phone ? (
                    <a href={`tel:${vendor.phone}`} className="hover:text-amber-600 flex items-center gap-1">
                      <Phone className="h-3 w-3 text-stone-400" />
                      {vendor.phone}
                    </a>
                  ) : (
                    'Not specified'
                  )}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <span className="text-stone-500 font-medium">{t('purchases.vendors.modal.altPhone')}:</span>
                <span className="col-span-2 text-stone-900 font-mono">
                  {vendor.alternate_phone ? (
                    <a href={`tel:${vendor.alternate_phone}`} className="hover:text-amber-600 flex items-center gap-1">
                      <Phone className="h-3 w-3 text-stone-400" />
                      {vendor.alternate_phone}
                    </a>
                  ) : (
                    'Not specified'
                  )}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <span className="text-stone-500 font-medium">{t('purchases.vendors.modal.address')}:</span>
                <span className="col-span-2 text-stone-800 leading-relaxed">
                  {vendor.address || 'No physical address recorded.'}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Commercial Terms Card */}
          <Card>
            <CardHeader className="pb-3 border-b border-stone-100">
              <CardTitle className="text-sm">{t('purchases.vendors.detail.paymentPreferences')}</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4 text-xs">
              <div className="grid grid-cols-3 gap-2">
                <span className="text-stone-500 font-medium">{t('purchases.vendors.modal.paymentTerms')}:</span>
                <span className="col-span-2 text-stone-900 font-semibold">
                  {vendor.payment_terms || (locale === 'hi' ? '7 दिन की अवधि' : 'Net 7 Days')}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <span className="text-stone-500 font-medium">{t('purchases.vendors.detail.frequency')}:</span>
                <span className="col-span-2 text-stone-900">
                  {formatFrequency(vendor.payment_frequency)}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <span className="text-stone-500 font-medium">{t('purchases.vendors.detail.preferredMethod')}:</span>
                <span className="col-span-2 text-stone-900">
                  {preferredMethodName || (locale === 'hi' ? 'सीधा बैंक / कोई भी' : 'Direct Bank / Any')}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <span className="text-stone-500 font-medium">{t('purchases.vendors.table.categories')}:</span>
                <div className="col-span-2 flex flex-wrap gap-1">
                  {vendor.supplier_categories && vendor.supplier_categories.length > 0 ? (
                    vendor.supplier_categories.map((c) => (
                      <span
                        key={c}
                        className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-900 border border-amber-200"
                      >
                        {getCategoryDisplay(c)}
                      </span>
                    ))
                  ) : (
                    <span className="text-stone-400 italic">{t('purchases.vendors.general')}</span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Internal Notes Card */}
          <Card className="md:col-span-2">
            <CardHeader className="pb-3 border-b border-stone-100">
              <CardTitle className="text-sm">{t('purchases.vendors.detail.notes')}</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 text-xs text-stone-700">
              {vendor.notes ? (
                <p className="whitespace-pre-wrap leading-relaxed bg-stone-50 p-3 rounded-lg border border-stone-200">
                  {vendor.notes}
                </p>
              ) : (
                <p className="text-stone-400 italic">No notes recorded for this vendor.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tab 2: Purchases */}
      {activeTab === 'purchases' && (
        <Card className="overflow-hidden">
          <CardHeader className="pb-3 border-b border-stone-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-sm">{t('purchases.vendors.detail.tabs.purchases')}</CardTitle>
            </div>
            <Link href="/finance/purchases?view=invoices" className="shrink-0">
              <Button variant="outline" size="sm" className="gap-1 text-xs w-full sm:w-auto">
                <Plus className="h-3.5 w-3.5" /> {t('purchases.bills.newPurchaseInvoice')}
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="p-0 sm:p-6 sm:pt-0 overflow-hidden">
            {purchases.length === 0 ? (
              <div className="py-12 px-4 text-center text-stone-400 text-xs">
                No purchase invoices recorded yet for this vendor.
              </div>
            ) : (
              <div className="overflow-x-auto w-full max-w-full">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                      <th className="py-2.5 px-3"></th>
                      <th className="py-2.5 px-3 whitespace-nowrap">{t('purchases.bills.table.invoice')}</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">{t('purchases.bills.invoiceNo')}</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">{t('purchases.bills.table.date')}</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">{t('purchases.bills.table.items')}</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">{t('purchases.bills.table.total')}</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">{t('purchases.bills.table.paid')}</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">{t('purchases.bills.table.balance')}</th>
                      <th className="py-2.5 px-3 text-center whitespace-nowrap">{t('purchases.bills.table.status')}</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">{t('purchases.vendors.table.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {purchases.map((p) => {
                      const balanceDue = p.net_amount - p.allocated_amount;
                      const isExpanded = expandedPurchaseId === p.id;
                      return (
                        <React.Fragment key={p.id}>
                          <tr
                            className="hover:bg-stone-50/80 transition-colors cursor-pointer"
                            onClick={() => setExpandedPurchaseId(isExpanded ? null : p.id)}
                          >
                            <td className="py-3 px-2 text-stone-400 w-6">
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </td>
                            <td className="py-3 px-3 font-mono font-semibold text-stone-900 whitespace-nowrap">
                              {p.purchase_number}
                            </td>
                            <td className="py-3 px-3 font-mono text-stone-600 whitespace-nowrap">
                              {p.invoice_number || '—'}
                            </td>
                            <td className="py-3 px-3 text-stone-600 whitespace-nowrap">{formatDisplayDate(p.purchase_date, locale)}</td>
                            <td className="py-3 px-3 text-stone-600 whitespace-nowrap">
                              {p.lines.length} {p.lines.length === 1 ? t('purchases.bills.singleItem') : t('purchases.bills.multipleItems')}
                            </td>
                            <td className="py-3 px-3 text-right font-semibold text-stone-900 whitespace-nowrap">
                              {formatINR(p.net_amount)}
                            </td>
                            <td className="py-3 px-3 text-right font-medium text-emerald-700 whitespace-nowrap">
                              {formatINR(p.allocated_amount)}
                            </td>
                            <td className="py-3 px-3 text-right font-bold text-rose-600 whitespace-nowrap">
                              {formatINR(balanceDue)}
                            </td>
                            <td className="py-3 px-3 text-center whitespace-nowrap">
                              {balanceDue <= 0 ? (
                                <Badge variant="success">{t('purchases.bills.settled')}</Badge>
                              ) : p.allocated_amount > 0 ? (
                                <Badge variant="warning">{t('purchases.bills.partial')}</Badge>
                              ) : (
                                <Badge variant="danger">{t('purchases.bills.unpaid')}</Badge>
                              )}
                            </td>
                            <td className="py-3 px-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1">
                                {p.status !== 'cancelled' && canEditInvoices && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleEditInvoice(p)}
                                    className="p-1 h-7 w-7 text-stone-500 hover:text-amber-600"
                                    title={t('purchases.bills.editPurchase')}
                                  >
                                    <Edit2 className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                                {isAdmin && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleInitiateDeleteInvoice(p)}
                                    className="p-1 h-7 w-7 text-stone-400 hover:text-rose-600"
                                    title={t('purchases.bills.delete')}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>

                          {/* Expandable Line Items Details */}
                          {isExpanded && (
                            <tr className="bg-stone-50/60">
                              <td colSpan={10} className="p-2 sm:p-3 sm:pl-10">
                                <div className="p-2.5 sm:p-3 bg-white rounded-lg border border-stone-200 space-y-2 overflow-x-auto">
                                  <div className="font-semibold text-stone-800 text-xs">
                                    {t('purchases.bills.items')}
                                  </div>
                                  <table className="w-full text-left text-xs">
                                    <thead>
                                      <tr className="border-b border-stone-200 text-stone-500">
                                        <th className="py-1 px-2 whitespace-nowrap">{t('purchases.bills.table.code')}</th>
                                        <th className="py-1 px-2 min-w-[120px]">{t('purchases.bills.items')}</th>
                                        <th className="py-1 px-2 text-right whitespace-nowrap">{t('purchases.bills.qty')}</th>
                                        <th className="py-1 px-2 text-right whitespace-nowrap">{t('purchases.bills.rate')}</th>
                                        <th className="py-1 px-2 text-right whitespace-nowrap">{t('purchases.bills.table.total')}</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-stone-100">
                                      {p.lines.map((l) => (
                                        <tr key={l.id}>
                                          <td className="py-1.5 px-2 font-mono text-stone-500 whitespace-nowrap">
                                            {l.item_code}
                                          </td>
                                          <td className="py-1.5 px-2 font-medium text-stone-800 break-words">
                                            {l.item_name}
                                          </td>
                                          <td className="py-1.5 px-2 text-right text-stone-700 whitespace-nowrap">
                                            {l.quantity}
                                          </td>
                                          <td className="py-1.5 px-2 text-right text-stone-700 whitespace-nowrap">
                                            {formatINR(l.rate)}
                                          </td>
                                          <td className="py-1.5 px-2 text-right font-bold text-stone-900 whitespace-nowrap">
                                            {formatINR(l.total_amount)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tab 3: Payments */}
      {activeTab === 'payments' && (
        <Card className="overflow-hidden">
          <CardHeader className="pb-3 border-b border-stone-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-sm">{t('purchases.vendors.detail.tabs.payments')}</CardTitle>
            </div>
            <Link href="/finance/purchases?view=invoices" className="shrink-0">
              <Button variant="outline" size="sm" className="gap-1 text-xs w-full sm:w-auto">
                <CreditCard className="h-3.5 w-3.5" /> {t('purchases.bills.recordPayment')}
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="p-0 sm:p-6 sm:pt-0 overflow-hidden">
            {payments.length === 0 ? (
              <div className="py-12 px-4 text-center text-stone-400 text-xs">
                No payments have been recorded yet for this vendor.
              </div>
            ) : (
              <div className="overflow-x-auto w-full max-w-full">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                      <th className="py-2.5 px-3 whitespace-nowrap">{t('purchases.bills.paymentNo')}</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">{t('purchases.bills.table.date')}</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">{t('purchases.bills.paymentMethod')}</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">{t('purchases.bills.referenceNo')}</th>
                      <th className="py-2.5 px-3 min-w-[120px]">{t('purchases.vendors.modal.notes')}</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">{t('purchases.bills.amount')}</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">{t('purchases.vendors.table.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {payments.map((pay) => (
                      <tr key={pay.id} className="hover:bg-stone-50/80 transition-colors">
                        <td className="py-3 px-3 font-mono font-semibold text-stone-900 whitespace-nowrap">
                          {pay.payment_number}
                        </td>
                        <td className="py-3 px-3 text-stone-600 whitespace-nowrap">{formatDisplayDate(pay.payment_date, locale)}</td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded bg-stone-100 text-stone-800 text-[11px] font-medium">
                            {pay.payment_method_name}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-mono text-stone-600 whitespace-nowrap">
                          {pay.reference_number || '—'}
                        </td>
                        <td className="py-3 px-3 text-stone-500 italic max-w-xs truncate">
                          {pay.notes || '—'}
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-emerald-700 text-sm whitespace-nowrap">
                          {formatINR(pay.amount)}
                        </td>
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            {canEditPayments && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEditPayment(pay)}
                                className="p-1 h-7 w-7 text-stone-500 hover:text-amber-600"
                                title={t('purchases.payments.editPayment')}
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {isAdmin && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleInitiateDeletePayment(pay)}
                                className="p-1 h-7 w-7 text-stone-400 hover:text-rose-600"
                                title={t('purchases.payments.deletePayment')}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tab 4: Ledger */}
      {activeTab === 'ledger' && (
        <Card className="overflow-hidden">
          <CardHeader className="pb-3 border-b border-stone-100 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <CardTitle className="text-sm">{t('purchases.vendors.detail.ledger')}</CardTitle>
            </div>
            <div className="sm:text-right shrink-0">
              <span className="text-[11px] text-stone-500">{t('purchases.bills.outstanding')}: </span>
              <span className="font-bold text-rose-600 text-sm">
                {formatINR(summaryMetrics.outstandingBalance)}
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-0 sm:p-6 sm:pt-0 overflow-hidden">
            {ledgerEntries.length === 0 ? (
              <div className="py-12 px-4 text-center text-stone-400 text-xs">
                No financial transactions have occurred with this vendor.
              </div>
            ) : (
              <div className="overflow-x-auto w-full max-w-full">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                      <th className="py-2.5 px-3 whitespace-nowrap">{t('purchases.vendors.detail.ledgerTable.date')}</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">{t('purchases.vendors.detail.ledgerTable.type')}</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">{t('purchases.vendors.detail.ledgerTable.reference')}</th>
                      <th className="py-2.5 px-3 min-w-[150px]">{t('purchases.vendors.detail.ledgerTable.description')}</th>
                      <th className="py-2.5 px-3 text-right text-emerald-700 whitespace-nowrap">{t('purchases.vendors.detail.ledgerTable.debit')}</th>
                      <th className="py-2.5 px-3 text-right text-stone-900 whitespace-nowrap">{t('purchases.vendors.detail.ledgerTable.credit')}</th>
                      <th className="py-2.5 px-3 text-right font-bold text-stone-800 whitespace-nowrap">
                        {t('purchases.vendors.detail.ledgerTable.balance')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 font-mono">
                    {ledgerEntries.map((entry) => (
                      <tr key={entry.id} className="hover:bg-stone-50/80 transition-colors">
                        <td className="py-3 px-3 text-stone-600 font-sans whitespace-nowrap">{entry.date}</td>
                        <td className="py-3 px-3 font-sans whitespace-nowrap">
                          {entry.type === 'purchase' ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-stone-800 bg-stone-100 px-2 py-0.5 rounded">
                              <ShoppingBag className="h-3 w-3 text-amber-600" /> {t('purchases.vendors.detail.tabs.purchases')}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded">
                              <CreditCard className="h-3 w-3 text-emerald-600" /> {t('purchases.vendors.detail.tabs.payments')}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 font-semibold text-stone-800 whitespace-nowrap">
                          {entry.reference_number}
                        </td>
                        <td className="py-3 px-3 font-sans text-stone-600 max-w-sm break-words">
                          {entry.description}
                        </td>
                        <td className="py-3 px-3 text-right font-medium text-emerald-700 font-mono whitespace-nowrap">
                          {entry.debit > 0 ? formatINR(entry.debit) : '—'}
                        </td>
                        <td className="py-3 px-3 text-right font-medium text-stone-900 font-mono whitespace-nowrap">
                          {entry.credit > 0 ? formatINR(entry.credit) : '—'}
                        </td>
                        <td className="py-3 px-3 text-right font-bold font-mono text-sm whitespace-nowrap">
                          <span className={entry.running_balance > 0 ? 'text-rose-600' : 'text-emerald-700'}>
                            {formatINR(entry.running_balance)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tab 5: Items */}
      {activeTab === 'items' && (
        <Card className="overflow-hidden">
          <CardHeader className="pb-3 border-b border-stone-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-sm">{t('purchases.vendors.detail.tabs.items')}</CardTitle>
            </div>
            <Button
              variant="amber"
              size="sm"
              onClick={() => setShowLinkItemModal(true)}
              className="gap-1 text-xs w-full sm:w-auto shrink-0"
            >
              <Plus className="h-3.5 w-3.5" /> {t('purchases.vendors.detail.linkItem')}
            </Button>
          </CardHeader>
          <CardContent className="p-0 sm:p-6 sm:pt-0 overflow-hidden">
            {vendorItems.length === 0 ? (
              <div className="py-12 px-4 text-center text-stone-400 text-xs">
                No inventory items linked to this vendor.
              </div>
            ) : (
              <div className="overflow-x-auto w-full max-w-full">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                      <th className="py-2.5 px-3 whitespace-nowrap">{t('purchases.bills.table.code')}</th>
                      <th className="py-2.5 px-3 min-w-[140px]">{t('purchases.bills.items')}</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">{t('purchases.vendors.table.categories')}</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">Unit</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">Last Rate</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">{t('purchases.bills.table.date')}</th>
                      <th className="py-2.5 px-3 text-center whitespace-nowrap">{t('purchases.bills.table.status')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {vendorItems.map((vi) => (
                      <tr key={vi.id} className="hover:bg-stone-50/80 transition-colors">
                        <td className="py-3 px-3 font-mono font-medium text-stone-600 whitespace-nowrap">
                          {vi.item_code}
                        </td>
                        <td className="py-3 px-3 font-semibold text-stone-900 break-words max-w-[220px]">
                          {vi.item_name}
                        </td>
                        <td className="py-3 px-3 text-stone-600 whitespace-nowrap">{vi.category_name || '—'}</td>
                        <td className="py-3 px-3 text-stone-600 whitespace-nowrap">{vi.unit_symbol || 'Units'}</td>
                        <td className="py-3 px-3 text-right font-semibold text-stone-900 whitespace-nowrap">
                          {formatINR(vi.last_purchase_rate)}
                        </td>
                        <td className="py-3 px-3 text-stone-500 whitespace-nowrap">
                          {vi.last_purchase_date || '—'}
                        </td>
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          {vi.is_preferred ? (
                            <Badge variant="success">{locale === 'hi' ? 'प्राथमिक' : 'Preferred'}</Badge>
                          ) : (
                            <Badge variant="default">{locale === 'hi' ? 'वैकल्पिक' : 'Alternate'}</Badge>
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
      )}

      {/* Edit Vendor Modal */}
      <VendorModal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        vendor={vendor}
        onSaved={(updated) => {
          setVendor(updated);
          setMessage({ type: 'success', text: 'Vendor details updated successfully.' });
          loadVendorData();
        }}
      />

      {/* Link Item Modal */}
      {showLinkItemModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl border border-stone-200 text-xs">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-base font-bold text-stone-900">{t('purchases.vendors.detail.linkItemTitle')}</h3>
              <button
                onClick={() => setShowLinkItemModal(false)}
                className="text-stone-400 hover:text-stone-700 text-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleLinkItem} className="space-y-4">
              <div>
                <label className="block font-medium text-stone-700 mb-1">
                  {t('purchases.bills.items')} <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={selectedItemId}
                  onChange={(e) => {
                    setSelectedItemId(e.target.value);
                    const selected = allItems.find((i) => i.id === e.target.value);
                    if (selected) {
                      setCustomRate(Number(selected.current_weighted_average_cost) || 0);
                    }
                  }}
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 text-xs focus:outline-none focus:border-amber-500"
                >
                  <option value="">{t('purchases.vendors.detail.selectCatalogItem')}</option>
                  {allItems.map((i) => {
                    const isAlreadyLinked = vendorItems.some((vi) => vi.inventory_item_id === i.id);
                    return (
                      <option key={i.id} value={i.id}>
                        {i.name_hi && locale === 'hi' ? i.name_hi : i.name} ({i.item_code}){isAlreadyLinked ? (locale === 'hi' ? ' — [पहले से लिंक है]' : ' — [Already Linked]') : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">
                  {t('purchases.vendors.detail.agreedRate')}
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={customRate || ''}
                  onChange={(e) => setCustomRate(parseFloat(e.target.value) || 0)}
                  placeholder="0.00"
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500 font-bold"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setShowLinkItemModal(false)}
                >
                  {t('purchases.vendors.detail.cancel')}
                </Button>
                <Button type="submit" variant="amber" disabled={linkingItem}>
                  {linkingItem ? t('purchases.vendors.detail.saving') : t('purchases.vendors.detail.saveLink')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Payment Modal */}
      <EditPaymentModal
        isOpen={editPaymentModalOpen}
        onClose={() => {
          setEditPaymentModalOpen(false);
          setEditingPayment(null);
        }}
        onPaymentUpdated={(num) => {
          setMessage({
            type: 'success',
            text: t('purchases.payments.paymentUpdated', { number: num }),
          });
          loadVendorData();
        }}
        payment={editingPayment}
        paymentMethods={paymentMethods}
        vendorName={vendor?.name}
      />

      {/* Delete Payment Modal */}
      {deletePaymentModalOpen && deletingPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-2xs p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-stone-200">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-base font-bold text-rose-700 flex items-center gap-2">
                <Trash2 className="h-5 w-5" />
                {t('purchases.payments.deletePaymentTitle')}
              </h3>
              <button
                onClick={() => {
                  setDeletePaymentModalOpen(false);
                  setDeletingPayment(null);
                }}
                className="text-stone-400 hover:text-stone-700 text-lg"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-stone-700">
              {t('purchases.payments.deletePaymentConfirm', { number: deletingPayment.payment_number })}
            </p>

            <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 space-y-1 font-mono text-[11px]">
              <div><strong>Voucher:</strong> {deletingPayment.payment_number}</div>
              <div><strong>Date:</strong> {formatDisplayDate(deletingPayment.payment_date, locale)}</div>
              <div><strong>Amount:</strong> {formatINR(deletingPayment.amount)}</div>
              {deletingPayment.reference_number && <div><strong>Ref #:</strong> {deletingPayment.reference_number}</div>}
            </div>

            <p className="text-[11px] text-amber-800 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
              {t('purchases.payments.deletePaymentWarning')}
            </p>

            <div className="flex justify-end gap-2 pt-3 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDeletePaymentModalOpen(false);
                  setDeletingPayment(null);
                }}
                disabled={deletePaymentLoading}
              >
                {t('purchases.bills.cancel')}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleConfirmDeletePayment}
                disabled={deletePaymentLoading}
                className="font-bold gap-1"
              >
                {deletePaymentLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                {t('purchases.payments.confirmDeletePayment')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Purchase Modal for Editing */}
      {showPurchaseModal && lookups && (
        <PurchaseModal
          isOpen={showPurchaseModal}
          invoiceToEdit={editingInvoice}
          onClose={() => {
            setShowPurchaseModal(false);
            setEditingInvoice(null);
          }}
          vendors={lookups.vendors}
          items={lookups.items}
          groups={lookups.groups}
          packagingUnits={lookups.packagingUnits}
          categories={lookups.categories}
          units={lookups.units}
          locations={lookups.locations}
          aliases={lookups.aliases}
          invoices={purchases as any}
          vendorPriceMemory={lookups.vendorPriceMemory}
          businessDate={editingInvoice?.purchase_date || getTodayBusinessDate()}
          selectedVendorId={vendorId}
          setSelectedVendorId={() => {}}
          onOpenQuickVendor={() => {}}
          onPurchaseSaved={(num) => {
            setMessage({
              type: 'success',
              text: t('purchases.bills.invoiceUpdated', { number: num }),
            });
            setShowPurchaseModal(false);
            setEditingInvoice(null);
            loadVendorData();
          }}
        />
      )}

      {/* Delete Invoice Modal */}
      {deleteInvoiceModalOpen && deletingInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-2xs p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-stone-200">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-base font-bold text-rose-700 flex items-center gap-2">
                <Trash2 className="h-5 w-5" />
                {t('purchases.bills.deleteInvoiceTitle')}
              </h3>
              <button
                onClick={() => {
                  setDeleteInvoiceModalOpen(false);
                  setDeletingInvoice(null);
                }}
                className="text-stone-400 hover:text-stone-700 text-lg"
              >
                ✕
              </button>
            </div>

            {deletingInvoice.allocated_amount > 0 ? (
              <div className="space-y-3">
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    {t('purchases.bills.errCannotDeleteAllocated', {
                      number: deletingInvoice.purchase_number,
                      amount: formatINR(deletingInvoice.allocated_amount),
                    })}
                  </span>
                </div>
                <div className="flex justify-end pt-2 border-t">
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
              <div className="space-y-3 text-xs">
                <p className="text-stone-700">
                  {t('purchases.bills.deleteInvoiceConfirm', { number: deletingInvoice.purchase_number })}
                </p>

                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 space-y-1 font-mono text-[11px]">
                  <div><strong>PO #:</strong> {deletingInvoice.purchase_number}</div>
                  {deletingInvoice.invoice_number && <div><strong>Bill #:</strong> {deletingInvoice.invoice_number}</div>}
                  <div><strong>Total:</strong> {formatINR(deletingInvoice.net_amount)}</div>
                  <div><strong>Date:</strong> {formatDisplayDate(deletingInvoice.purchase_date, locale)}</div>
                </div>

                <p className="text-[11px] text-amber-800 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
                  {t('purchases.bills.deleteInvoiceWarning')}
                </p>

                <div className="flex justify-end gap-2 pt-3 border-t">
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
                    className="font-bold gap-1"
                  >
                    {deleteInvoiceLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    {t('purchases.bills.confirmDeleteInvoice')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Vendor Modal */}
      {deleteVendorModalOpen && vendor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-2xs p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-stone-200">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-base font-bold text-rose-700 flex items-center gap-2">
                <Trash2 className="h-5 w-5" />
                {t('purchases.vendors.detail.deleteVendorTitle')}
              </h3>
              <button
                onClick={() => setDeleteVendorModalOpen(false)}
                className="text-stone-400 hover:text-stone-700 text-lg"
              >
                ✕
              </button>
            </div>

            {purchases.length > 0 || payments.length > 0 ? (
              <div className="space-y-3 text-xs">
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 leading-relaxed">
                  {t('purchases.vendors.detail.errCannotDeleteVendorTx', {
                    name: vendor.name,
                    purchases: purchases.length,
                    payments: payments.length,
                  })}
                </div>
                <div className="flex justify-end gap-2 pt-2 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDeleteVendorModalOpen(false)}
                  >
                    {t('purchases.bills.cancel')}
                  </Button>
                  {vendor.is_active && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setDeleteVendorModalOpen(false);
                        handleToggleStatus();
                      }}
                    >
                      {t('purchases.vendors.actions.deactivateVendor')}
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                <p className="text-stone-700 leading-relaxed">
                  {t('purchases.vendors.detail.deleteVendorConfirm', { name: vendor.name })}
                </p>
                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 font-semibold text-stone-900">
                  {vendor.name} ({vendor.vendor_code || 'VEND'})
                </div>
                <div className="flex justify-end gap-2 pt-3 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDeleteVendorModalOpen(false)}
                    disabled={deleteVendorLoading}
                  >
                    {t('purchases.bills.cancel')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={handleConfirmDeleteVendor}
                    disabled={deleteVendorLoading}
                    className="font-bold gap-1"
                  >
                    {deleteVendorLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    {t('purchases.vendors.actions.deleteVendor')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
