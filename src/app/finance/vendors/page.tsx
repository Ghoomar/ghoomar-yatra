'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR } from '@/lib/utils';
import { Vendor, VendorOutstandingSummary } from '@/lib/types/database';
import { VendorModal } from '@/components/vendors/VendorModal';
import { VendorCategoryModal } from '@/components/vendors/VendorCategoryModal';
import {
  Building2,
  Plus,
  Search,
  RefreshCw,
  ShoppingBag,
  ExternalLink,
  Edit2,
  Trash2,
  CheckCircle,
  AlertCircle,
  Phone,
  Filter,
  Power,
  Info,
  Tag
} from 'lucide-react';

export default function VendorsPage() {
  const supabase = createClient();

  const [vendors, setVendors] = useState<VendorOutstandingSummary[]>([]);
  const [rawVendors, setRawVendors] = useState<Vendor[]>([]);
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [vendorItems, setVendorItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [itemFilter, setItemFilter] = useState<string>('all');
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);

  // Delete Safeguard State
  const [deleteModalVendor, setDeleteModalVendor] = useState<VendorOutstandingSummary | null>(null);
  const [deleteChecking, setDeleteChecking] = useState(false);
  const [cannotDeleteReason, setCannotDeleteReason] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [
        { data: vSummary, error: summaryErr },
        { data: vFull, error: fullErr },
        { data: itemsData },
        { data: viData }
      ] = await Promise.all([
        supabase.from('vendor_outstanding_summary').select('*').order('vendor_name'),
        supabase.from('vendors').select('*').order('name'),
        supabase.from('inventory_items').select('id, name, item_code, unit:units!inventory_items_unit_id_fkey(symbol)').eq('is_active', true).order('name'),
        supabase.from('vendor_items').select('id, vendor_id, inventory_item_id, last_purchase_rate, last_purchase_date'),
      ]);

      if (summaryErr) throw summaryErr;
      if (fullErr) throw fullErr;

      setVendors(vSummary || []);
      setRawVendors(vFull || []);
      setCatalogItems(itemsData || []);
      setVendorItems(viData || []);
    } catch (err: any) {
      console.error('Failed to load vendors:', err);
      setMessage({ type: 'error', text: 'Failed to load vendor registry. ' + (err.message || '') });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Compute distinct categories
  const allCategories = useMemo(() => {
    const set = new Set<string>();
    vendors.forEach((v) => {
      if (Array.isArray(v.supplier_categories)) {
        v.supplier_categories.forEach((c) => set.add(c));
      }
    });
    return Array.from(set).sort();
  }, [vendors]);

  // Filtered vendors
  const filteredVendors = useMemo(() => {
    return vendors.filter((v) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = v.vendor_name?.toLowerCase().includes(q);
        const matchCode = v.vendor_code?.toLowerCase().includes(q);
        const matchContact = v.contact_person?.toLowerCase().includes(q);
        const matchPhone = v.phone?.toLowerCase().includes(q);
        const matchCat = v.supplier_categories?.some((c) => c.toLowerCase().includes(q));
        if (!matchName && !matchCode && !matchContact && !matchPhone && !matchCat) {
          return false;
        }
      }

      // Status
      if (statusFilter === 'active' && v.is_active === false) return false;
      if (statusFilter === 'inactive' && v.is_active !== false) return false;

      // Category
      if (categoryFilter !== 'all') {
        if (!v.supplier_categories || !v.supplier_categories.includes(categoryFilter)) {
          return false;
        }
      }

      // Item Supplied
      if (itemFilter !== 'all') {
        const suppliesItem = vendorItems.some(
          (vi) => vi.vendor_id === v.vendor_id && vi.inventory_item_id === itemFilter
        );
        if (!suppliesItem) return false;
      }

      return true;
    });
  }, [vendors, searchQuery, statusFilter, categoryFilter, itemFilter, vendorItems]);

  // Aggregate KPIs
  const totalVendors = vendors.length;
  const activeVendorsCount = vendors.filter((v) => v.is_active !== false).length;
  const totalOutstanding = vendors.reduce((acc, v) => acc + (Number(v.outstanding_balance) || 0), 0);
  const totalPurchasesAllTime = vendors.reduce((acc, v) => acc + (Number(v.total_purchased) || 0), 0);

  const handleOpenAddModal = () => {
    setEditingVendor(null);
    setModalOpen(true);
  };

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
    setModalOpen(true);
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

  // Safety check before initiating deletion
  const handleInitiateDelete = async (vendorSummary: VendorOutstandingSummary) => {
    setDeleteChecking(true);
    setCannotDeleteReason(null);
    setDeleteModalVendor(vendorSummary);

    try {
      // 1. Check if vendor has purchase headers
      const { count: purchaseCount } = await supabase
        .from('purchase_headers')
        .select('*', { count: 'exact', head: true })
        .eq('vendor_id', vendorSummary.vendor_id);

      // 2. Check if vendor has payments
      const { count: paymentCount } = await supabase
        .from('vendor_payments')
        .select('*', { count: 'exact', head: true })
        .eq('vendor_id', vendorSummary.vendor_id);

      if ((purchaseCount && purchaseCount > 0) || (paymentCount && paymentCount > 0)) {
        setCannotDeleteReason(
          `This vendor has ${purchaseCount || 0} purchase invoice(s) and ${paymentCount || 0} payment voucher(s). Under accounting safety rules, vendors with historical transactions cannot be deleted. You can mark this vendor as Inactive instead.`
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
      // Remove any vendor_items links first
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2.5">
            <Building2 className="h-6 w-6 text-amber-600" />
            Vendor Master Directory
          </h1>
          <p className="text-sm text-stone-500">
            Authoritative master catalog for raw material suppliers, payment terms, and vendor ledgers.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Link href="/finance/purchases">
            <Button variant="outline" size="sm" className="gap-1.5 text-stone-700">
              <ShoppingBag className="h-4 w-4 text-stone-500" />
              Purchases & Bills
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={() => setCategoryModalOpen(true)} className="gap-1.5 text-stone-700">
            <Tag className="h-4 w-4 text-amber-600" />
            Categories
          </Button>
          <Button variant="amber" size="sm" onClick={handleOpenAddModal} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Add Vendor
          </Button>
          <Button variant="outline" size="sm" onClick={loadData} title="Refresh data">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardDescription>Total Registered Vendors</CardDescription>
          <div className="text-2xl font-bold text-stone-900 mt-1">{totalVendors}</div>
          <div className="text-[11px] text-stone-500 mt-1">Across all supply categories</div>
        </Card>

        <Card>
          <CardDescription>Active Suppliers</CardDescription>
          <div className="text-2xl font-bold text-emerald-700 mt-1">{activeVendorsCount}</div>
          <div className="text-[11px] text-stone-500 mt-1">Eligible for purchase inward receipts</div>
        </Card>

        <Card>
          <CardDescription>Total Outstanding Payables</CardDescription>
          <div className="text-2xl font-bold text-rose-600 mt-1">{formatINR(totalOutstanding)}</div>
          <div className="text-[11px] text-stone-500 mt-1">Purchases minus allocated payments</div>
        </Card>

        <Card>
          <CardDescription>Cumulative Procurements</CardDescription>
          <div className="text-2xl font-bold text-stone-900 mt-1">{formatINR(totalPurchasesAllTime)}</div>
          <div className="text-[11px] text-stone-500 mt-1">Total inward procurement invoices</div>
        </Card>
      </div>

      {/* Alerts / Message */}
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

      {/* Filter and Search Bar */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col md:flex-row items-center gap-3">
            {/* Search Input */}
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search vendor name, code, contact person, or phone..."
                className="w-full pl-9 pr-4 py-2 rounded-lg border border-stone-200 text-xs text-stone-900 placeholder-stone-400 focus:outline-none focus:border-amber-500"
              />
            </div>

            {/* Status Filter */}
            <div className="flex items-center gap-1.5 w-full md:w-auto">
              <span className="text-xs text-stone-500 font-medium">Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="rounded-lg border border-stone-200 py-2 px-2.5 text-xs text-stone-900 focus:outline-none focus:border-amber-500 bg-white"
              >
                <option value="all">All Vendors</option>
                <option value="active">Active Only</option>
                <option value="inactive">Inactive Only</option>
              </select>
            </div>

            {/* Category Filter */}
            {allCategories.length > 0 && (
              <div className="flex items-center gap-1.5 w-full md:w-auto">
                <span className="text-xs text-stone-500 font-medium">Category:</span>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="rounded-lg border border-stone-200 py-2 px-2.5 text-xs text-stone-900 focus:outline-none focus:border-amber-500 bg-white"
                >
                  <option value="all">All Categories</option>
                  {allCategories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Item Supplied Filter */}
            {catalogItems.length > 0 && (
              <div className="flex items-center gap-1.5 w-full md:w-auto">
                <span className="text-xs text-stone-500 font-medium">Item Supplied:</span>
                <select
                  value={itemFilter}
                  onChange={(e) => setItemFilter(e.target.value)}
                  className="rounded-lg border border-stone-200 py-2 px-2.5 text-xs text-stone-900 focus:outline-none focus:border-amber-500 bg-white max-w-[220px] truncate"
                >
                  <option value="all">All Items</option>
                  {catalogItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.item_code})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {(categoryFilter !== 'all' || itemFilter !== 'all' || statusFilter !== 'all' || searchQuery.trim()) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCategoryFilter('all');
                  setItemFilter('all');
                  setStatusFilter('all');
                  setSearchQuery('');
                }}
                className="text-xs text-stone-500 hover:text-stone-800"
              >
                Reset
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Vendors Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-stone-100">
          <div>
            <CardTitle>Registered Suppliers</CardTitle>
            <CardDescription>
              Showing {filteredVendors.length} of {totalVendors} suppliers
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          {loading ? (
            <div className="py-12 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin text-amber-600" />
              Loading vendor catalog...
            </div>
          ) : filteredVendors.length === 0 ? (
            <div className="py-12 text-center text-stone-500 text-xs">
              No vendors found matching your criteria.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                    <th className="py-3 px-3">Code</th>
                    <th className="py-3 px-3">Supplier Name</th>
                    <th className="py-3 px-3">Categories</th>
                    <th className="py-3 px-3">Contact & Phone</th>
                    <th className="py-3 px-3">Payment Terms</th>
                    <th className="py-3 px-3 text-right">Total Purchased</th>
                    <th className="py-3 px-3 text-right">Total Paid</th>
                    <th className="py-3 px-3 text-right">Outstanding</th>
                    <th className="py-3 px-3 text-center">Status</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {filteredVendors.map((v) => {
                    const out = Number(v.outstanding_balance) || 0;
                    const isActive = v.is_active !== false;

                    return (
                      <tr
                        key={v.vendor_id}
                        className={`hover:bg-stone-50/80 transition-colors ${
                          !isActive ? 'opacity-65 bg-stone-50/30' : ''
                        }`}
                      >
                        {/* Code */}
                        <td className="py-3 px-3 font-mono text-stone-600 font-medium whitespace-nowrap">
                          {v.vendor_code || 'VEND'}
                        </td>

                        {/* Name */}
                        <td className="py-3 px-3 font-semibold text-stone-900 whitespace-nowrap">
                          <Link
                            href={`/finance/vendors/${v.vendor_id}`}
                            className="hover:text-amber-600 hover:underline flex items-center gap-1.5"
                          >
                            {v.vendor_name}
                            <ExternalLink className="h-3 w-3 text-stone-400 opacity-60" />
                          </Link>
                          {(() => {
                            if (itemFilter === 'all') return null;
                            const vi = vendorItems.find(
                              (item) => item.vendor_id === v.vendor_id && item.inventory_item_id === itemFilter
                            );
                            if (!vi) return null;
                            const rate = vi.agreed_rate ?? vi.last_purchase_rate;
                            return (
                              <div className="mt-1 flex items-center gap-1.5 text-[11px] font-normal text-amber-900 bg-amber-50 px-2 py-0.5 rounded border border-amber-200/70 w-fit">
                                <span className="font-semibold">Agreed / Last Purchase Rate:</span>
                                <span>{rate != null ? `₹${rate}` : 'N/A'}</span>
                                {vi.last_purchase_date && (
                                  <span className="text-stone-500">(Date: {vi.last_purchase_date})</span>
                                )}
                              </div>
                            );
                          })()}
                        </td>

                        {/* Categories */}
                        <td className="py-3 px-3">
                          <div className="flex flex-wrap gap-1 max-w-[180px]">
                            {v.supplier_categories && v.supplier_categories.length > 0 ? (
                              v.supplier_categories.map((c) => (
                                <span
                                  key={c}
                                  className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-800 border border-amber-200 whitespace-nowrap"
                                >
                                  {c}
                                </span>
                              ))
                            ) : (
                              <span className="text-[11px] text-stone-400 italic">General</span>
                            )}
                          </div>
                        </td>

                        {/* Contact */}
                        <td className="py-3 px-3 text-stone-600">
                          <div className="font-medium text-stone-800">{v.contact_person || '—'}</div>
                          {v.phone && (
                            <div className="text-[11px] text-stone-500 flex items-center gap-1 mt-0.5">
                              <Phone className="h-3 w-3 text-stone-400" />
                              {v.phone}
                            </div>
                          )}
                        </td>

                        {/* Payment Terms */}
                        <td className="py-3 px-3 text-stone-600 whitespace-nowrap">
                          <div>{v.payment_terms || 'Net 7 Days'}</div>
                          {v.payment_frequency && (
                            <div className="text-[10px] text-stone-400 mt-0.5">
                              {v.payment_frequency}
                            </div>
                          )}
                        </td>

                        {/* Total Purchased */}
                        <td className="py-3 px-3 text-right font-medium text-stone-800 whitespace-nowrap">
                          {formatINR(Number(v.total_purchased))}
                        </td>

                        {/* Total Paid */}
                        <td className="py-3 px-3 text-right font-medium text-emerald-700 whitespace-nowrap">
                          {formatINR(Number(v.total_paid))}
                        </td>

                        {/* Outstanding Balance */}
                        <td className="py-3 px-3 text-right font-bold text-rose-600 text-sm whitespace-nowrap">
                          {formatINR(out)}
                        </td>

                        {/* Status */}
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          <Badge variant={isActive ? 'success' : 'default'}>
                            {isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            <Link href={`/finance/vendors/${v.vendor_id}`} title="View Details & Ledger">
                              <button className="p-1.5 rounded text-stone-500 hover:text-amber-600 hover:bg-stone-100 transition-colors">
                                <ExternalLink className="h-3.5 w-3.5" />
                              </button>
                            </Link>

                            <button
                              onClick={() => handleOpenEditModal(v)}
                              title="Edit Vendor"
                              className="p-1.5 rounded text-stone-500 hover:text-amber-600 hover:bg-stone-100 transition-colors"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>

                            <button
                              onClick={() => handleToggleStatus(v)}
                              title={isActive ? 'Deactivate Vendor' : 'Activate Vendor'}
                              className={`p-1.5 rounded transition-colors ${
                                isActive
                                  ? 'text-stone-400 hover:text-amber-700 hover:bg-amber-50'
                                  : 'text-stone-400 hover:text-emerald-700 hover:bg-emerald-50'
                              }`}
                            >
                              <Power className="h-3.5 w-3.5" />
                            </button>

                            <button
                              onClick={() => handleInitiateDelete(v)}
                              title="Delete Vendor (Zero-Transaction Only)"
                              className="p-1.5 rounded text-stone-300 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit Vendor Modal */}
      <VendorModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingVendor(null);
        }}
        vendor={editingVendor}
        onSaved={(saved) => {
          setMessage({
            type: 'success',
            text: `Vendor "${saved.name}" (${saved.vendor_code}) saved successfully.`,
          });
          loadData();
        }}
      />

      {/* Vendor Category Master Modal */}
      <VendorCategoryModal
        isOpen={categoryModalOpen}
        onClose={() => setCategoryModalOpen(false)}
        onUpdated={loadData}
      />

      {/* Delete Safeguard Confirmation Modal */}
      {deleteModalVendor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl border border-stone-200 text-xs">
            <div className="flex items-center gap-3">
              <div
                className={`p-2 rounded-lg ${
                  cannotDeleteReason ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'
                }`}
              >
                {cannotDeleteReason ? (
                  <AlertCircle className="h-5 w-5" />
                ) : (
                  <Trash2 className="h-5 w-5" />
                )}
              </div>
              <div>
                <h3 className="text-base font-bold text-stone-900">
                  {cannotDeleteReason ? 'Cannot Delete Vendor' : 'Confirm Permanent Deletion'}
                </h3>
                <div className="text-stone-500 font-mono mt-0.5">
                  {deleteModalVendor.vendor_code} — {deleteModalVendor.vendor_name}
                </div>
              </div>
            </div>

            {deleteChecking ? (
              <div className="py-4 text-center text-stone-500 flex items-center justify-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-amber-600" />
                Verifying transaction history...
              </div>
            ) : cannotDeleteReason ? (
              <div className="space-y-3">
                <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg leading-relaxed">
                  {cannotDeleteReason}
                </div>
                <div className="p-3 bg-stone-50 border border-stone-200 text-stone-600 rounded-lg flex items-center gap-2">
                  <Info className="h-4 w-4 text-stone-400 shrink-0" />
                  <span>
                    Deactivating keeps your accounts balanced while stopping any new purchases from this vendor.
                  </span>
                </div>
                <div className="flex justify-end gap-2 pt-2 border-t">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setDeleteModalVendor(null)}
                  >
                    Close
                  </Button>
                  <Button
                    type="button"
                    variant="amber"
                    onClick={() => {
                      handleToggleStatus(deleteModalVendor);
                      setDeleteModalVendor(null);
                    }}
                  >
                    Deactivate Vendor
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-stone-700 leading-relaxed">
                  This vendor has <strong>zero historical transactions</strong>. Are you sure you want to permanently remove it? This action cannot be undone.
                </p>
                <div className="flex justify-end gap-2 pt-2 border-t">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setDeleteModalVendor(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    onClick={handleConfirmDelete}
                  >
                    Delete Vendor
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
