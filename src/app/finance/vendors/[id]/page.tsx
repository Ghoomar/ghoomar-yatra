'use client';

import React, { useState, useEffect, useMemo, use } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR } from '@/lib/utils';
import { Vendor, VendorLedgerEntry } from '@/lib/types/database';
import { VendorModal } from '@/components/vendors/VendorModal';
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
  ChevronRight
} from 'lucide-react';

interface PurchaseHeaderWithLines {
  id: string;
  purchase_number: string;
  invoice_number?: string;
  purchase_date: string;
  net_amount: number;
  total_amount: number;
  lines: {
    id: string;
    item_id: string;
    item_name?: string;
    item_code?: string;
    quantity: number;
    rate: number;
    total_amount: number;
  }[];
  allocated_amount: number;
}

interface VendorPaymentRecord {
  id: string;
  payment_number: string;
  payment_date: string;
  amount: number;
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
  const supabase = createClient();

  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [preferredMethodName, setPreferredMethodName] = useState<string>('');
  const [purchases, setPurchases] = useState<PurchaseHeaderWithLines[]>([]);
  const [payments, setPayments] = useState<VendorPaymentRecord[]>([]);
  const [vendorItems, setVendorItems] = useState<VendorItemRecord[]>([]);
  const [allItems, setAllItems] = useState<any[]>([]);

  const [activeTab, setActiveTab] = useState<'overview' | 'purchases' | 'payments' | 'ledger' | 'items'>('overview');
  const [expandedPurchaseId, setExpandedPurchaseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Edit Modal State
  const [editModalOpen, setEditModalOpen] = useState(false);

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

      // Preferred method name
      if (vData.preferred_payment_method_id) {
        const { data: pm } = await supabase
          .from('payment_methods')
          .select('name')
          .eq('id', vData.preferred_payment_method_id)
          .single();
        if (pm) setPreferredMethodName(pm.name);
      }

      // 2. Fetch Purchases with Lines
      const { data: pData } = await supabase
        .from('purchase_headers')
        .select(`
          id,
          purchase_number,
          invoice_number,
          purchase_date,
          net_amount,
          total_amount,
          purchase_lines (
            id,
            item_id,
            quantity,
            rate,
            total_amount,
            inventory_items (
              name,
              item_code
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
          item_name: l.inventory_items?.name || 'Unknown Item',
          item_code: l.inventory_items?.item_code || '',
          quantity: Number(l.quantity) || 0,
          rate: Number(l.rate) || 0,
          total_amount: Number(l.total_amount) || 0,
        }));

        return {
          id: p.id,
          purchase_number: p.purchase_number,
          invoice_number: p.invoice_number,
          purchase_date: p.purchase_date,
          net_amount: Number(p.net_amount) || 0,
          total_amount: Number(p.total_amount) || 0,
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
          reference_number,
          notes,
          payment_methods (
            name
          )
        `)
        .eq('vendor_id', vendorId)
        .order('payment_date', { ascending: false });

      const parsedPayments: VendorPaymentRecord[] = (payData || []).map((p: any) => ({
        id: p.id,
        payment_number: p.payment_number,
        payment_date: p.payment_date,
        amount: Number(p.amount) || 0,
        reference_number: p.reference_number,
        payment_method_name: p.payment_methods?.name || 'Cash / Direct',
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
            item_code,
            inventory_categories (name),
            units!inventory_items_unit_id_fkey (symbol)
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
        item_name: vi.inventory_items?.name || 'Item',
        category_name: vi.inventory_items?.inventory_categories?.name,
        unit_symbol: vi.inventory_items?.units?.symbol,
        last_purchase_rate: Number(vi.last_purchase_rate) || 0,
        last_purchase_date: vi.last_purchase_date,
        is_preferred: vi.is_preferred,
      }));
      setVendorItems(parsedVendorItems);

      // 5. Fetch all inventory items for linking modal
      const { data: itemCatalog } = await supabase
        .from('inventory_items')
        .select('id, name, item_code, current_weighted_average_cost')
        .eq('is_active', true)
        .order('name');
      setAllItems(itemCatalog || []);
    } catch (err: any) {
      console.error('Error loading vendor:', err);
      setMessage({ type: 'error', text: 'Failed to load vendor details: ' + err.message });
    } finally {
      setLoading(false);
    }
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
            last_purchase_date: new Date().toISOString().split('T')[0],
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
          last_purchase_date: new Date().toISOString().split('T')[0],
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
        <div className="text-stone-600 font-semibold text-base">Vendor record not found.</div>
        <Link href="/finance/vendors">
          <Button variant="secondary" size="sm" className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Back to Vendor Master
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
          <Link
            href="/finance/vendors"
            className="text-xs text-stone-500 hover:text-amber-600 flex items-center gap-1 font-medium transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Vendor Master
          </Link>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2 break-words">
              <Building2 className="h-5 w-5 sm:h-6 sm:w-6 text-amber-600 shrink-0" />
              <span>{vendor.name}</span>
            </h1>
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-stone-100 text-stone-700 font-bold shrink-0">
              {vendor.vendor_code || 'VEND'}
            </span>
            <Badge variant={vendor.is_active ? 'success' : 'default'} className="shrink-0">
              {vendor.is_active ? 'Active Supplier' : 'Inactive'}
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
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
            {vendor.is_active ? 'Deactivate' : 'Activate'}
          </Button>

          <Button
            variant="amber"
            size="sm"
            onClick={() => setEditModalOpen(true)}
            className="gap-1.5"
          >
            <Edit2 className="h-4 w-4" />
            Edit Vendor
          </Button>

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

      {/* Summary Metrics Strip (Required) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3">
        <Card className="min-w-0 overflow-hidden">
          <CardDescription className="truncate">Purchased (Month)</CardDescription>
          <div className="text-lg sm:text-xl font-bold text-stone-900 mt-1 truncate">
            {formatINR(summaryMetrics.purchasedThisMonth)}
          </div>
          <div className="text-[10px] text-stone-400 mt-0.5 truncate">Current month inward bills</div>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardDescription className="truncate">Paid (Month)</CardDescription>
          <div className="text-lg sm:text-xl font-bold text-emerald-700 mt-1 truncate">
            {formatINR(summaryMetrics.paidThisMonth)}
          </div>
          <div className="text-[10px] text-stone-400 mt-0.5 truncate">Disbursed settlements</div>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardDescription className="truncate">Current Outstanding</CardDescription>
          <div className="text-lg sm:text-xl font-bold text-rose-600 mt-1 truncate">
            {formatINR(summaryMetrics.outstandingBalance)}
          </div>
          <div className="text-[10px] text-stone-400 mt-0.5 truncate">Net derived payable</div>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardDescription className="truncate">Payment Terms</CardDescription>
          <div className="text-sm sm:text-base font-bold text-stone-800 mt-1 truncate">
            {vendor.payment_terms || 'Net 7 Days'}
          </div>
          <div className="text-[10px] text-stone-400 mt-0.5 truncate">
            {vendor.payment_frequency || 'Weekly schedule'}
          </div>
        </Card>

        <Card className="min-w-0 overflow-hidden col-span-2 sm:col-span-1">
          <CardDescription className="truncate">Account Status</CardDescription>
          <div className="mt-1">
            <span
              className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${
                vendor.is_active
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-stone-100 text-stone-600'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${vendor.is_active ? 'bg-emerald-600' : 'bg-stone-400'}`} />
              {vendor.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
          <div className="text-[10px] text-stone-400 mt-0.5 truncate">
            {vendor.is_active ? 'Authorized for POs' : 'Purchases suspended'}
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
            Overview
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
            Purchases ({purchases.length})
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
            Payments ({payments.length})
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
            Ledger ({ledgerEntries.length})
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
            Items Supplied ({vendorItems.length})
          </button>
        </nav>
      </div>

      {/* Tab 1: Overview */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Contact Details Card */}
          <Card>
            <CardHeader className="pb-3 border-b border-stone-100">
              <CardTitle className="text-sm">Contact Directory</CardTitle>
              <CardDescription>Primary point of contact & communication details</CardDescription>
            </CardHeader>
            <CardContent className="pt-4 space-y-4 text-xs">
              <div className="grid grid-cols-3 gap-2">
                <span className="text-stone-500 font-medium">Contact Person:</span>
                <span className="col-span-2 text-stone-900 font-semibold">
                  {vendor.contact_person || 'Not specified'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <span className="text-stone-500 font-medium">Primary Phone:</span>
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
                <span className="text-stone-500 font-medium">Alternate Phone:</span>
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
                <span className="text-stone-500 font-medium">Billing / Physical Address:</span>
                <span className="col-span-2 text-stone-800 leading-relaxed">
                  {vendor.address || 'No physical address recorded.'}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Commercial Terms Card */}
          <Card>
            <CardHeader className="pb-3 border-b border-stone-100">
              <CardTitle className="text-sm">Commercial Profile & Terms</CardTitle>
              <CardDescription>Settlement agreements and supplier categories</CardDescription>
            </CardHeader>
            <CardContent className="pt-4 space-y-4 text-xs">
              <div className="grid grid-cols-3 gap-2">
                <span className="text-stone-500 font-medium">Payment Terms:</span>
                <span className="col-span-2 text-stone-900 font-semibold">
                  {vendor.payment_terms || 'Net 7 Days'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <span className="text-stone-500 font-medium">Payment Frequency:</span>
                <span className="col-span-2 text-stone-900">
                  {vendor.payment_frequency || 'Weekly'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <span className="text-stone-500 font-medium">Preferred Payment Mode:</span>
                <span className="col-span-2 text-stone-900">
                  {preferredMethodName || 'Direct Bank / Any'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <span className="text-stone-500 font-medium">Supply Categories:</span>
                <div className="col-span-2 flex flex-wrap gap-1">
                  {vendor.supplier_categories && vendor.supplier_categories.length > 0 ? (
                    vendor.supplier_categories.map((c) => (
                      <span
                        key={c}
                        className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-900 border border-amber-200"
                      >
                        {c}
                      </span>
                    ))
                  ) : (
                    <span className="text-stone-400 italic">General Supply</span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Internal Notes Card */}
          <Card className="md:col-span-2">
            <CardHeader className="pb-3 border-b border-stone-100">
              <CardTitle className="text-sm">Operational Notes & Banking Instructions</CardTitle>
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
              <CardTitle className="text-sm">Procurement Invoices</CardTitle>
              <CardDescription>
                Historical bills and material receipts received from {vendor.name}
              </CardDescription>
            </div>
            <Link href="/finance/purchases" className="shrink-0">
              <Button variant="outline" size="sm" className="gap-1 text-xs w-full sm:w-auto">
                <Plus className="h-3.5 w-3.5" /> Record Purchase Invoice
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
                      <th className="py-2.5 px-3 whitespace-nowrap">Purchase #</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">Invoice Ref</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">Date</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">Item Count</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">Invoice Value</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">Allocated Paid</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">Balance Due</th>
                      <th className="py-2.5 px-3 text-center whitespace-nowrap">Status</th>
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
                            <td className="py-3 px-3 text-stone-600 whitespace-nowrap">{p.purchase_date}</td>
                            <td className="py-3 px-3 text-stone-600 whitespace-nowrap">{p.lines.length} items</td>
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
                                <Badge variant="success">Settled</Badge>
                              ) : p.allocated_amount > 0 ? (
                                <Badge variant="warning">Partial</Badge>
                              ) : (
                                <Badge variant="danger">Unpaid</Badge>
                              )}
                            </td>
                          </tr>

                          {/* Expandable Line Items Details */}
                          {isExpanded && (
                            <tr className="bg-stone-50/60">
                              <td colSpan={9} className="p-2 sm:p-3 sm:pl-10">
                                <div className="p-2.5 sm:p-3 bg-white rounded-lg border border-stone-200 space-y-2 overflow-x-auto">
                                  <div className="font-semibold text-stone-800 text-xs">
                                    Invoice Line Items
                                  </div>
                                  <table className="w-full text-left text-xs">
                                    <thead>
                                      <tr className="border-b border-stone-200 text-stone-500">
                                        <th className="py-1 px-2 whitespace-nowrap">Item Code</th>
                                        <th className="py-1 px-2 min-w-[120px]">Item Description</th>
                                        <th className="py-1 px-2 text-right whitespace-nowrap">Quantity</th>
                                        <th className="py-1 px-2 text-right whitespace-nowrap">Rate</th>
                                        <th className="py-1 px-2 text-right whitespace-nowrap">Line Total</th>
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
              <CardTitle className="text-sm">Disbursed Payments & Settlements</CardTitle>
              <CardDescription>
                Direct disbursements, cheques, and bank transfers released to {vendor.name}
              </CardDescription>
            </div>
            <Link href="/finance/purchases" className="shrink-0">
              <Button variant="outline" size="sm" className="gap-1 text-xs w-full sm:w-auto">
                <CreditCard className="h-3.5 w-3.5" /> Record Payment
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
                      <th className="py-2.5 px-3 whitespace-nowrap">Voucher #</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">Payment Date</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">Payment Mode</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">Reference / UTR</th>
                      <th className="py-2.5 px-3 min-w-[120px]">Notes</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">Amount Paid</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {payments.map((pay) => (
                      <tr key={pay.id} className="hover:bg-stone-50/80 transition-colors">
                        <td className="py-3 px-3 font-mono font-semibold text-stone-900 whitespace-nowrap">
                          {pay.payment_number}
                        </td>
                        <td className="py-3 px-3 text-stone-600 whitespace-nowrap">{pay.payment_date}</td>
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
              <CardTitle className="text-sm">Vendor Account Statement & Running Ledger</CardTitle>
              <CardDescription>
                Chronological statement of invoices (Credits) and payments (Debits) with running payable balance
              </CardDescription>
            </div>
            <div className="sm:text-right shrink-0">
              <span className="text-[11px] text-stone-500">Current Outstanding: </span>
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
                      <th className="py-2.5 px-3 whitespace-nowrap">Date</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">Transaction</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">Voucher / Ref #</th>
                      <th className="py-2.5 px-3 min-w-[150px]">Description</th>
                      <th className="py-2.5 px-3 text-right text-emerald-700 whitespace-nowrap">Debit (Paid)</th>
                      <th className="py-2.5 px-3 text-right text-stone-900 whitespace-nowrap">Credit (Invoiced)</th>
                      <th className="py-2.5 px-3 text-right font-bold text-stone-800 whitespace-nowrap">
                        Running Balance
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
                              <ShoppingBag className="h-3 w-3 text-amber-600" /> Purchase
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded">
                              <CreditCard className="h-3 w-3 text-emerald-600" /> Payment
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

      {/* Tab 5: Items Supplied */}
      {activeTab === 'items' && (
        <Card className="overflow-hidden">
          <CardHeader className="pb-3 border-b border-stone-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-sm">Supplied Inventory Catalog</CardTitle>
              <CardDescription>
                Raw materials, consumables, and goods procured from {vendor.name}
              </CardDescription>
            </div>
            <Button
              variant="amber"
              size="sm"
              onClick={() => setShowLinkItemModal(true)}
              className="gap-1 text-xs w-full sm:w-auto shrink-0"
            >
              <Plus className="h-3.5 w-3.5" /> Link Item to Vendor
            </Button>
          </CardHeader>
          <CardContent className="p-0 sm:p-6 sm:pt-0 overflow-hidden">
            {vendorItems.length === 0 ? (
              <div className="py-12 px-4 text-center text-stone-400 text-xs">
                No inventory items currently linked to this vendor. Click &quot;Link Item to Vendor&quot; to associate SKUs.
              </div>
            ) : (
              <div className="overflow-x-auto w-full max-w-full">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                      <th className="py-2.5 px-3 whitespace-nowrap">SKU Code</th>
                      <th className="py-2.5 px-3 min-w-[140px]">Item Name</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">Category</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">Unit</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">Last Purchase Rate</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">Last Purchase Date</th>
                      <th className="py-2.5 px-3 text-center whitespace-nowrap">Preferred</th>
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
                            <Badge variant="success">Preferred</Badge>
                          ) : (
                            <Badge variant="default">Alternate</Badge>
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
              <h3 className="text-base font-bold text-stone-900">Link Inventory Item to Vendor</h3>
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
                  Select Catalog Item <span className="text-rose-500">*</span>
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
                  <option value="">Select Item SKU...</option>
                  {allItems.map((i) => {
                    const isAlreadyLinked = vendorItems.some((vi) => vi.inventory_item_id === i.id);
                    return (
                      <option key={i.id} value={i.id}>
                        {i.name} ({i.item_code}){isAlreadyLinked ? ' — [Already Linked]' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">
                  Default Agreed Rate (₹)
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
                  Cancel
                </Button>
                <Button type="submit" variant="amber" disabled={linkingItem}>
                  {linkingItem ? 'Linking...' : 'Confirm Link'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
