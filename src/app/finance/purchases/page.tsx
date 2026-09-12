'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR, getTodayBusinessDate } from '@/lib/utils';
import { calculateNewWAC } from '@/lib/inventory-engine';
import { VendorModal } from '@/components/vendors/VendorModal';
import { ShoppingBag, Plus, CreditCard, RefreshCw, CheckCircle, AlertCircle, Trash2, Building2, ExternalLink } from 'lucide-react';

interface VendorSummary {
  vendor_id: string;
  vendor_code: string;
  vendor_name: string;
  contact_person?: string;
  phone?: string;
  total_purchased: number;
  total_paid: number;
  outstanding_balance: number;
  is_active?: boolean;
}

interface PurchaseLineForm {
  item_id: string;
  quantity: number;
  rate: number;
  use_pack?: boolean;
  pack_quantity?: number;
  pack_rate?: number;
  destination_location_id?: string;
  batch_number?: string;
  expiry_date?: string;
  previous_rate?: number;
  previous_date?: string;
}

export default function PurchasesPage() {
  const supabase = createClient();
  const [businessDate, setBusinessDate] = useState(getTodayBusinessDate());
  const [vendors, setVendors] = useState<VendorSummary[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [showQuickVendorModal, setShowQuickVendorModal] = useState(false);
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [lines, setLines] = useState<PurchaseLineForm[]>([{ item_id: '', quantity: 1, rate: 0 }]);
  const [purchaseSaving, setPurchaseSaving] = useState(false);
  const [vendorPriceMemory, setVendorPriceMemory] = useState<Record<string, { rate: number; date: string }>>({});

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
      const { data: vData } = await supabase
        .from('vendor_outstanding_summary')
        .select('*')
        .order('vendor_name');

      const { data: iData } = await supabase
        .from('inventory_items')
        .select(`
          id, item_code, name, unit_id, secondary_unit_id, conversion_factor, shelf_life_days, is_active, current_stock, current_weighted_average_cost,
          unit:units!inventory_items_unit_id_fkey(symbol, name),
          sec_unit:units!inventory_items_secondary_unit_id_fkey(symbol, name)
        `)
        .order('name');

      const { data: locData } = await supabase
        .from('inventory_locations')
        .select('*')
        .eq('is_active', true)
        .order('code');

      const { data: pmData } = await supabase
        .from('payment_methods')
        .select('*')
        .order('name');

      setVendors(vData || []);
      setItems(iData || []);
      setLocations(locData || []);
      setPaymentMethods(pmData || []);
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: 'Failed to load purchase & vendor ledger.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const totalOutstandingAllVendors = vendors.reduce(
    (acc, v) => acc + (Number(v.outstanding_balance) || 0),
    0
  );

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
      alert('Please select a vendor.');
      return;
    }

    const vSelected = vendors.find((v) => v.vendor_id === selectedVendorId);
    if (vSelected && vSelected.is_active === false) {
      alert('Selected vendor is inactive. Inactive vendors cannot receive new purchase invoices.');
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
          p_notes: `PO ${purchaseNumber} - ${vSelected?.vendor_name || 'Vendor'}${line.batch_number ? ` (Batch: ${line.batch_number})` : ''}`,
          p_batch_number: line.batch_number || null,
          p_expiry_date: line.expiry_date || null,
        });

        if (txErr) throw txErr;

        // Upsert vendor-item price memory
        try {
          const { data: existingLink } = await supabase
            .from('vendor_items')
            .select('id')
            .eq('vendor_id', selectedVendorId)
            .eq('inventory_item_id', line.item_id)
            .maybeSingle();

          if (existingLink) {
            await supabase
              .from('vendor_items')
              .update({
                last_purchase_rate: baseRate,
                last_purchase_date: businessDate,
                is_preferred: true,
              })
              .eq('id', existingLink.id);
          } else {
            await supabase
              .from('vendor_items')
              .insert({
                vendor_id: selectedVendorId,
                inventory_item_id: line.item_id,
                last_purchase_rate: baseRate,
                last_purchase_date: businessDate,
                is_preferred: true,
              });
          }
        } catch (memErr) {
          console.warn('Could not update vendor price memory:', memErr);
        }
      }

      setMessage({ type: 'success', text: `Purchase invoice ${purchaseNumber} recorded and stock inwarded to Central Store!` });
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
      alert('Please select a vendor and enter a valid payment amount.');
      return;
    }

    const vPayment = vendors.find((v) => v.vendor_id === paymentVendorId);
    if (vPayment && vPayment.is_active === false) {
      alert('Selected vendor is inactive. Payments cannot be disbursed to inactive vendor accounts.');
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

      setMessage({ type: 'success', text: `Vendor payment of ${formatINR(paymentAmount)} recorded!` });
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <ShoppingBag className="h-6 w-6 text-amber-600" />
            Purchases & Vendor Financial Ledger
          </h1>
          <p className="text-sm text-stone-500">
            Raw material procurements, stock receipts, and dynamic vendor settlement tracking.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link href="/finance/vendors">
            <Button variant="outline" size="sm" className="gap-1.5 text-stone-700">
              <Building2 className="h-4 w-4 text-amber-600" /> Manage Vendors
            </Button>
          </Link>
          <Button variant="amber" size="sm" onClick={() => setShowPurchaseModal(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> New Purchase Invoice
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setShowPaymentModal(true)} className="gap-1.5">
            <CreditCard className="h-4 w-4" /> Record Vendor Payment
          </Button>
          <Button variant="outline" size="sm" onClick={loadData}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardDescription>Total Outstanding to All Vendors</CardDescription>
          <div className="text-2xl font-bold text-rose-600 mt-1">
            {formatINR(totalOutstandingAllVendors)}
          </div>
          <div className="text-[11px] text-stone-500 mt-1">Authoritative derived payable balance</div>
        </Card>

        <Card>
          <CardDescription>Active Registered Suppliers</CardDescription>
          <div className="text-2xl font-bold text-stone-900 mt-1">{vendors.length}</div>
          <div className="text-[11px] text-stone-500 mt-1">Vegetables, Dairy, Grains, Utilities</div>
        </Card>

        <Card>
          <CardDescription>Settlement Model</CardDescription>
          <div className="text-lg font-bold text-stone-800 mt-1">Automated FIFO Allocation</div>
          <div className="text-[11px] text-stone-500 mt-1">Weekly payments auto-settle oldest invoices</div>
        </Card>
      </div>

      {message && (
        <div className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 ${
          message.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
        }`}>
          {message.type === 'success' ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {message.text}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Vendor Accounts & Balances</CardTitle>
          <CardDescription>Source of truth: Purchases − Allocated Payments = Current Outstanding</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-stone-200 text-stone-500 font-semibold">
                  <th className="py-2.5 px-3">Vendor Code</th>
                  <th className="py-2.5 px-3">Supplier Name</th>
                  <th className="py-2.5 px-3">Contact</th>
                  <th className="py-2.5 px-3 text-right">Total Purchased</th>
                  <th className="py-2.5 px-3 text-right">Total Paid</th>
                  <th className="py-2.5 px-3 text-right">Outstanding Balance</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {vendors.map((v) => {
                  const out = Number(v.outstanding_balance) || 0;
                  return (
                    <tr key={v.vendor_id} className="hover:bg-stone-50/80 transition-colors">
                      <td className="py-3 px-3 font-mono text-stone-500">{v.vendor_code || 'VEND'}</td>
                      <td className="py-3 px-3 font-semibold text-stone-900">
                        <Link
                          href={`/finance/vendors/${v.vendor_id}`}
                          className="hover:text-amber-600 hover:underline flex items-center gap-1.5"
                        >
                          {v.vendor_name}
                          <ExternalLink className="h-3 w-3 text-stone-400 opacity-60" />
                        </Link>
                      </td>
                      <td className="py-3 px-3 text-stone-600">
                        {v.contact_person} {v.phone && `(${v.phone})`}
                      </td>
                      <td className="py-3 px-3 text-right font-medium text-stone-800">
                        {formatINR(Number(v.total_purchased))}
                      </td>
                      <td className="py-3 px-3 text-right font-medium text-emerald-700">
                        {formatINR(Number(v.total_paid))}
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-rose-600 text-sm">
                        {formatINR(out)}
                      </td>
                      <td className="py-3 px-3 text-center">
                        {out <= 0 ? (
                          <Badge variant="success">Settled</Badge>
                        ) : Number(v.total_paid) > 0 ? (
                          <Badge variant="warning">Partial</Badge>
                        ) : (
                          <Badge variant="danger">Unpaid</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {showPurchaseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="flex items-center justify-between border-b pb-3">
              <h2 className="text-lg font-bold text-stone-900">Record New Purchase Invoice</h2>
              <button onClick={() => setShowPurchaseModal(false)} className="text-stone-400 hover:text-stone-700 text-lg">✕</button>
            </div>

            <form onSubmit={handleCreatePurchase} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block font-medium text-stone-700">Supplier / Vendor</label>
                    <button
                      type="button"
                      onClick={() => setShowQuickVendorModal(true)}
                      className="text-[11px] text-amber-600 hover:text-amber-800 font-semibold hover:underline flex items-center gap-0.5"
                    >
                      <Plus className="h-3 w-3" /> Quick Add Vendor
                    </button>
                  </div>
                  <select
                    value={selectedVendorId}
                    onChange={(e) => setSelectedVendorId(e.target.value)}
                    required
                    className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                  >
                    <option value="">Select Supplier...</option>
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
                  <label className="block font-medium text-stone-700 mb-1">Invoice / Bill Ref #</label>
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
                  <label className="font-bold text-stone-800">Procured Items</label>
                  <Button type="button" variant="secondary" size="sm" onClick={handleAddLine} className="gap-1 text-xs">
                    <Plus className="h-3 w-3" /> Add Item
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

                  return (
                    <div key={idx} className="p-3 bg-stone-50 rounded-lg border border-stone-200 space-y-2">
                      {/* Top Row: Item Select, Pack Toggle, Qty, Rate, Total, Delete */}
                      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                        <select
                          value={line.item_id}
                          onChange={(e) => {
                            const next = [...lines];
                            const selectedId = e.target.value;
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
                            // Auto-set suggested expiry if shelf life exists
                            if (selItem?.shelf_life_days) {
                              const d = new Date();
                              d.setDate(d.getDate() + Number(selItem.shelf_life_days));
                              next[idx].expiry_date = d.toISOString().split('T')[0];
                            }
                            setLines(next);
                          }}
                          required
                          className="flex-1 min-w-[200px] rounded-md border border-stone-300 bg-white p-2 text-stone-900 text-xs focus:outline-none"
                        >
                          <option value="">Select Item SKU...</option>
                          {items
                            .filter((i) => i.is_active !== false || i.id === line.item_id)
                            .map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.name} ({i.item_code})
                              </option>
                            ))}
                        </select>

                        {/* Pack Toggle Button */}
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
                            title={`1 ${currentItem?.sec_unit?.symbol} = ${conv} ${currentItem?.unit?.symbol}`}
                          >
                            📦 {line.use_pack ? `Pack (${currentItem?.sec_unit?.symbol} ×${conv})` : `Base (${currentItem?.unit?.symbol})`}
                          </button>
                        )}

                        {/* Quantity Input */}
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
                            placeholder="Qty"
                            required
                            className="w-16 rounded-md border border-stone-300 bg-white p-2 text-right text-stone-900 text-xs focus:outline-none"
                          />
                          <span className="px-1.5 py-1.5 bg-stone-200/80 border border-stone-300 rounded text-stone-700 font-mono text-[11px] font-bold">
                            {line.use_pack ? currentItem?.sec_unit?.symbol || 'Packs' : currentItem?.unit?.symbol || 'Units'}
                          </span>
                        </div>

                        {/* Rate Input */}
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
                            placeholder={line.use_pack ? `₹ / ${currentItem?.sec_unit?.symbol}` : "Rate (₹)"}
                            required
                            className={`w-24 rounded-md border p-2 text-right text-stone-900 text-xs focus:outline-none bg-white ${
                              isDeviation ? 'border-amber-400 bg-amber-50/50' : 'border-stone-300'
                            }`}
                          />
                        </div>

                        {/* Line Total */}
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

                      {/* Pack Conversion Explanation Helper */}
                      {line.use_pack && hasPack && (
                        <div className="text-[11px] text-amber-800 bg-amber-50/70 border border-amber-200 rounded px-2 py-1 font-mono flex items-center justify-between">
                          <span>
                            Conversion: <strong>{line.pack_quantity || 0} {currentItem?.sec_unit?.symbol}</strong> × {conv} = <strong>{lineBaseQty.toFixed(2)} {currentItem?.unit?.symbol}</strong>
                          </span>
                          <span>
                            Derived Rate: <strong>{formatINR(lineBaseRate)}</strong> / {currentItem?.unit?.symbol}
                          </span>
                        </div>
                      )}

                      {/* Sub-row: Batch #, Expiry Date & Destination Location */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 border-t border-stone-200/60 text-[11px]">
                        <div>
                          <input
                            type="text"
                            placeholder="Batch / Lot # (optional)"
                            value={line.batch_number || ''}
                            onChange={(e) => {
                              const next = [...lines];
                              next[idx].batch_number = e.target.value;
                              setLines(next);
                            }}
                            className="w-full rounded border border-stone-300 bg-white px-2 py-1 text-stone-800 text-[11px] focus:outline-none"
                          />
                        </div>

                        <div className="flex items-center gap-1">
                          <input
                            type="date"
                            value={line.expiry_date || ''}
                            onChange={(e) => {
                              const next = [...lines];
                              next[idx].expiry_date = e.target.value;
                              setLines(next);
                            }}
                            className="w-full rounded border border-stone-300 bg-white px-2 py-1 text-stone-800 text-[11px] focus:outline-none"
                            title="Expiry Date"
                          />
                          {currentItem?.shelf_life_days && (
                            <button
                              type="button"
                              onClick={() => {
                                const d = new Date();
                                d.setDate(d.getDate() + Number(currentItem.shelf_life_days));
                                const next = [...lines];
                                next[idx].expiry_date = d.toISOString().split('T')[0];
                                setLines(next);
                              }}
                              className="px-1.5 py-1 rounded bg-stone-100 border border-stone-200 text-[10px] text-stone-600 hover:bg-stone-200 whitespace-nowrap"
                              title={`Auto-fill +${currentItem.shelf_life_days} days shelf life`}
                            >
                              +{currentItem.shelf_life_days}d
                            </button>
                          )}
                        </div>

                        <div>
                          <select
                            value={line.destination_location_id || ''}
                            onChange={(e) => {
                              const next = [...lines];
                              next[idx].destination_location_id = e.target.value;
                              setLines(next);
                            }}
                            className="w-full rounded border border-stone-300 bg-white px-2 py-1 text-stone-800 text-[11px] focus:outline-none"
                          >
                            <option value="">Store: Central Store Room</option>
                            {locations.map((loc) => (
                              <option key={loc.id} value={loc.id}>
                                Store at {loc.name} ({loc.code})
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Price Memory Helper & Deviation Badge */}
                      {line.previous_rate !== undefined && line.previous_rate > 0 && (
                        <div className="flex items-center justify-between text-[11px] px-1 text-stone-500">
                          <span>
                            Previous Base Purchase: <strong className="text-stone-700">{formatINR(line.previous_rate)}</strong>
                            {line.previous_date && ` on ${line.previous_date}`}
                          </span>
                          {isDeviation && (
                            <span className="text-amber-700 font-bold bg-amber-100 px-1.5 py-0.5 rounded border border-amber-200 text-[10px]">
                              ⚠️ {deviationPct > 0 ? `+${deviationPct}% higher` : `${deviationPct}% lower`} than previous rate
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between border-t pt-3">
                <span className="font-bold text-stone-700 text-sm">Total Invoice Value:</span>
                <span className="font-extrabold text-amber-600 text-lg">
                  {formatINR(calculatePurchaseTotal())}
                </span>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setShowPurchaseModal(false)}>Cancel</Button>
                <Button type="submit" variant="amber" disabled={purchaseSaving}>
                  {purchaseSaving ? 'Saving...' : 'Post Purchase & Update Stock'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl text-xs">
            <div className="flex items-center justify-between border-b pb-3">
              <h2 className="text-base font-bold text-stone-900">Record Payment to Vendor</h2>
              <button onClick={() => setShowPaymentModal(false)} className="text-stone-400 hover:text-stone-700 text-lg">✕</button>
            </div>

            <form onSubmit={handleRecordPayment} className="space-y-3">
              <div>
                <label className="block font-medium text-stone-700 mb-1">Vendor / Supplier</label>
                <select
                  value={paymentVendorId}
                  onChange={(e) => setPaymentVendorId(e.target.value)}
                  required
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                >
                  <option value="">Select Supplier...</option>
                  {vendors
                    .filter((v) => v.is_active !== false)
                    .map((v) => (
                      <option key={v.vendor_id} value={v.vendor_id}>
                        {v.vendor_name} (Due: {formatINR(Number(v.outstanding_balance))})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Payment Amount (₹)</label>
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
                <label className="block font-medium text-stone-700 mb-1">Payment Method</label>
                <select
                  value={paymentMethodId}
                  onChange={(e) => setPaymentMethodId(e.target.value)}
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                >
                  <option value="">Select Method...</option>
                  {paymentMethods.map((pm) => (
                    <option key={pm.id} value={pm.id}>
                      {pm.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">UTR / Cheque / Ref #</label>
                <input
                  type="text"
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  placeholder="e.g. UTR-998271"
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button type="button" variant="secondary" onClick={() => setShowPaymentModal(false)}>Cancel</Button>
                <Button type="submit" variant="amber" disabled={paymentSaving}>
                  {paymentSaving ? 'Saving...' : 'Confirm & Allocate Payment'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Add Vendor Modal */}
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
    </div>
  );
}
