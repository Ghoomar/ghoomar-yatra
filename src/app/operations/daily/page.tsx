'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR, getTodayBusinessDate, formatNumber } from '@/lib/utils';
import {
  Users,
  Car,
  Bike,
  Receipt,
  AlertTriangle,
  ClipboardList,
  Save,
  RefreshCw,
  CheckCircle2,
  ExternalLink,
  ShieldCheck,
  Package,
  Wrench,
  MessageSquareWarning,
  Flame,
  ArrowRight,
} from 'lucide-react';

interface GateData {
  entryPax: number;
  cars: number;
  bikes: number;
  totalVehicles: number;
  prefixes: Record<string, number>;
}

interface SalesData {
  hasData: boolean;
  restaurantPax: number;
  netSales: number;
  grossSales: number;
  discounts: number;
  billCount: number;
  avgSpendPerPax: number;
}

interface InventoryIncidents {
  missingCount: number;
  missingItems: any[];
  breakageCount: number;
  breakageItems: any[];
}

export default function DailyOperationsPage() {
  const supabase = createClient();
  const [businessDate, setBusinessDate] = useState(getTodayBusinessDate());
  const [loading, setLoading] = useState(true);
  const [savingNotes, setSavingNotes] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Auto-pulled data states
  const [gateData, setGateData] = useState<GateData>({
    entryPax: 0,
    cars: 0,
    bikes: 0,
    totalVehicles: 0,
    prefixes: {},
  });

  const [salesData, setSalesData] = useState<SalesData>({
    hasData: false,
    restaurantPax: 0,
    netSales: 0,
    grossSales: 0,
    discounts: 0,
    billCount: 0,
    avgSpendPerPax: 0,
  });

  const [inventoryIncidents, setInventoryIncidents] = useState<InventoryIncidents>({
    missingCount: 0,
    missingItems: [],
    breakageCount: 0,
    breakageItems: [],
  });

  // Manual Operational Notes States (Saved to daily_operational_notes)
  const [complaints, setComplaints] = useState('');
  const [workOrders, setWorkOrders] = useState('');
  const [requirements, setRequirements] = useState('');
  const [operationalNotes, setOperationalNotes] = useState('');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const loadAllOperationalData = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    try {
      // 1. Fetch Gate Counter Events for date
      const [{ data: vEvents }, { data: cEvents }] = await Promise.all([
        supabase
          .from('visitor_counter_events')
          .select('increment')
          .eq('business_date', businessDate),
        supabase
          .from('vehicle_counter_events')
          .select('increment, location:vehicle_origin_locations(id, name)')
          .eq('business_date', businessDate),
      ]);

      const entryPax = (vEvents || []).reduce((acc: number, e: any) => acc + (Number(e.increment) || 0), 0);
      let cars = 0;
      let bikes = 0;
      const prefMap: Record<string, number> = {};

      (cEvents || []).forEach((e: any) => {
        const inc = Number(e.increment) || 1;
        const name = e.location?.name || 'Others';
        if (name.toLowerCase() === 'bike') {
          bikes += inc;
        } else {
          cars += inc;
          prefMap[name] = (prefMap[name] || 0) + inc;
        }
      });

      setGateData({
        entryPax,
        cars,
        bikes,
        totalVehicles: cars + bikes,
        prefixes: prefMap,
      });

      // 2. Fetch Petpooja Sales & Restaurant PAX (from sales_orders and sales_executive_summaries)
      const [{ data: orders }, { data: execSummary }] = await Promise.all([
        supabase
          .from('sales_orders')
          .select('covers_pax, net_sales, grand_total, discount_amount, status')
          .eq('business_date', businessDate),
        supabase
          .from('sales_executive_summaries')
          .select('*')
          .eq('business_date', businessDate)
          .maybeSingle(),
      ]);

      const successOrders = (orders || []).filter((o: any) => o.status === 'Success');
      const restaurantPax = successOrders.reduce((acc: number, o: any) => acc + (Number(o.covers_pax) || 0), 0);
      const ordersNet = successOrders.reduce((acc: number, o: any) => acc + (Number(o.net_sales) || 0), 0);
      const ordersGross = successOrders.reduce((acc: number, o: any) => acc + (Number(o.grand_total) || 0), 0);
      const ordersDisc = successOrders.reduce((acc: number, o: any) => acc + (Number(o.discount_amount) || 0), 0);

      const net = execSummary?.net_sales ? Number(execSummary.net_sales) : ordersNet;
      const gross = execSummary?.grand_total ? Number(execSummary.grand_total) : ordersGross;
      const disc = execSummary?.discount ? Number(execSummary.discount) : ordersDisc;
      const bills = execSummary?.successful_bills_count ? Number(execSummary.successful_bills_count) : successOrders.length;
      const hasSales = Boolean(execSummary || successOrders.length > 0);

      setSalesData({
        hasData: hasSales,
        restaurantPax,
        netSales: net,
        grossSales: gross,
        discounts: disc,
        billCount: bills,
        avgSpendPerPax: restaurantPax > 0 ? Math.round((net / restaurantPax) * 100) / 100 : 0,
      });

      // 3. Fetch Existing Inventory Incidents (Loss & Breakage)
      const [{ data: assetLossEvents }, { data: stockMovs }] = await Promise.all([
        supabase
          .from('physical_asset_status_ledger')
          .select('id, event_type, quantity, notes, item:inventory_items(name)')
          .eq('business_date', businessDate),
        supabase
          .from('stock_movements')
          .select(`
            id, movement_type, purpose, quantity, total_value, notes,
            item:inventory_items(name, unit:units!inventory_items_unit_id_fkey(symbol))
          `)
          .eq('business_date', businessDate)
          .in('movement_type', ['breakage', 'loss', 'wastage', 'spoilage', 'count_adjustment']),
      ]);

      const missing: any[] = [];
      const breakage: any[] = [];

      (assetLossEvents || []).forEach((ev: any) => {
        if (ev.event_type === 'loss') {
          missing.push({
            id: ev.id,
            source: 'Asset Register',
            name: ev.item?.name || 'Asset Item',
            quantity: `${ev.quantity} pcs`,
            notes: ev.notes || 'Asset missing / lost',
          });
        } else if (ev.event_type === 'breakage') {
          breakage.push({
            id: ev.id,
            source: 'Asset Register',
            name: ev.item?.name || 'Asset Item',
            quantity: `${ev.quantity} pcs`,
            notes: ev.notes || 'Broken in service',
          });
        }
      });

      (stockMovs || []).forEach((m: any) => {
        const isLoss = m.movement_type === 'loss' || (m.movement_type === 'count_adjustment' && Number(m.quantity) < 0);
        const isBreak = ['breakage', 'wastage', 'spoilage'].includes(m.movement_type) || m.purpose === 'Breakage';

        if (isLoss) {
          missing.push({
            id: m.id,
            source: m.movement_type === 'count_adjustment' ? 'Stock Count Audit' : 'Store Loss',
            name: m.item?.name || 'Stock Item',
            quantity: `${Math.abs(Number(m.quantity))} ${m.item?.unit?.symbol || ''}`,
            notes: m.notes || m.purpose,
            value: Number(m.total_value) || 0,
          });
        } else if (isBreak) {
          breakage.push({
            id: m.id,
            source: 'Kitchen / Store Wastage',
            name: m.item?.name || 'Stock Item',
            quantity: `${m.quantity} ${m.item?.unit?.symbol || ''}`,
            notes: m.notes || m.purpose,
            value: Number(m.total_value) || 0,
          });
        }
      });

      setInventoryIncidents({
        missingCount: missing.length,
        missingItems: missing,
        breakageCount: breakage.length,
        breakageItems: breakage,
      });

      // 4. Fetch Manual Daily Operational Notes
      const { data: opNotes } = await supabase
        .from('daily_operational_notes')
        .select('*')
        .eq('business_date', businessDate)
        .maybeSingle();

      if (opNotes) {
        setComplaints(opNotes.complaints || '');
        setWorkOrders(opNotes.work_orders || '');
        setRequirements(opNotes.requirements || '');
        setOperationalNotes(opNotes.operational_notes || '');
        setLastSavedAt(opNotes.updated_at);
      } else {
        setComplaints('');
        setWorkOrders('');
        setRequirements('');
        setOperationalNotes('');
        setLastSavedAt(null);
      }
    } catch (err: any) {
      console.error('Error loading daily operations data:', err);
      setMessage({ type: 'error', text: 'Failed to load operational snapshot.' });
    } finally {
      setLoading(false);
    }
  }, [businessDate, supabase]);

  useEffect(() => {
    loadAllOperationalData();
  }, [loadAllOperationalData]);

  // Save manual notes to daily_operational_notes
  const handleSaveOperationalNotes = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingNotes(true);
    setMessage(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase
        .from('daily_operational_notes')
        .upsert(
          {
            business_date: businessDate,
            complaints,
            work_orders: workOrders,
            requirements,
            operational_notes: operationalNotes,
            entered_by: user?.id || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'business_date' }
        );

      if (error) throw error;

      setLastSavedAt(new Date().toISOString());
      setMessage({ type: 'success', text: 'Daily operational notes saved successfully.' });
    } catch (err: any) {
      console.error('Error saving operational notes:', err);
      setMessage({ type: 'error', text: err.message || 'Error saving notes.' });
    } finally {
      setSavingNotes(false);
    }
  };

  const dinerConversionRate =
    gateData.entryPax > 0 ? Math.round((salesData.restaurantPax / gateData.entryPax) * 100) : 0;

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-amber-600" />
            Daily Operations Report
          </h1>
          <p className="text-xs sm:text-sm text-stone-500 mt-0.5">
            Single operational pane-of-glass pulling authoritative Gate, Petpooja, and Inventory records with shift handover logs.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-white border border-stone-200 rounded-lg px-3 py-1.5 shadow-2xs text-xs font-medium">
            <span className="text-stone-500">Date:</span>
            <input
              type="date"
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
              className="bg-transparent font-semibold text-stone-900 focus:outline-none cursor-pointer"
            />
          </div>
          <Button variant="outline" size="sm" onClick={loadAllOperationalData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {message && (
        <div
          className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          {message.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {message.text}
        </div>
      )}

      {/* SECTION 1: AUTO-PULLED GATE COUNTER SNAPSHOT */}
      <Card className="border-stone-200/80 shadow-xs">
        <CardHeader className="pb-3 border-b border-stone-100 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-bold flex items-center gap-2 text-stone-900">
              <Users className="h-4 w-4 text-amber-600" /> Gate Footfall &amp; Vehicle Inward
            </CardTitle>
            <CardDescription className="text-xs text-stone-500">
              Auto-aggregated from raw Gate Counter entry taps for {businessDate}
            </CardDescription>
          </div>
          <Link href="/operations/gate">
            <Button variant="ghost" size="sm" className="text-xs text-amber-700 hover:text-amber-800 gap-1 h-7">
              <span>View Gate Counter</span>
              <ExternalLink className="h-3 w-3" />
            </Button>
          </Link>
        </CardHeader>

        <CardContent className="pt-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-stone-50/80 p-3 rounded-xl border border-stone-200/60">
              <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block">
                Total Entry PAX
              </span>
              <span className="text-2xl font-black text-stone-900 block mt-1">
                {formatNumber(gateData.entryPax)}
              </span>
              <span className="text-[10px] text-stone-400">Visitors logged at gate</span>
            </div>

            <div className="bg-stone-50/80 p-3 rounded-xl border border-stone-200/60">
              <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block">
                Cars Inward
              </span>
              <span className="text-2xl font-black text-sky-700 block mt-1">
                {formatNumber(gateData.cars)}
              </span>
              <span className="text-[10px] text-stone-400">Car registrations</span>
            </div>

            <div className="bg-stone-50/80 p-3 rounded-xl border border-stone-200/60">
              <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block">
                Bikes Inward
              </span>
              <span className="text-2xl font-black text-emerald-700 block mt-1">
                {formatNumber(gateData.bikes)}
              </span>
              <span className="text-[10px] text-stone-400">Two-wheelers</span>
            </div>

            <div className="bg-stone-50/80 p-3 rounded-xl border border-stone-200/60">
              <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block">
                Total Vehicles
              </span>
              <span className="text-2xl font-black text-stone-900 block mt-1">
                {formatNumber(gateData.totalVehicles)}
              </span>
              <span className="text-[10px] text-stone-400">Combined traffic</span>
            </div>
          </div>

          {/* Car Registration Prefixes Pills */}
          {Object.keys(gateData.prefixes).length > 0 && (
            <div className="mt-3 pt-3 border-t border-stone-100 flex items-center gap-2 flex-wrap text-xs">
              <span className="text-[11px] font-semibold text-stone-400">Car Origins:</span>
              {Object.entries(gateData.prefixes).map(([pref, cnt]) => (
                <span
                  key={pref}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white border border-stone-200 text-stone-800 text-[11px] font-medium"
                >
                  <strong className="text-stone-950">{pref}</strong>
                  <span className="text-stone-500 font-mono">{cnt}</span>
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* SECTION 2: AUTO-PULLED PETPOOJA SALES & RESTAURANT PAX SNAPSHOT */}
      <Card className="border-stone-200/80 shadow-xs">
        <CardHeader className="pb-3 border-b border-stone-100 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-bold flex items-center gap-2 text-stone-900">
              <Receipt className="h-4 w-4 text-emerald-600" /> Petpooja Restaurant Sales &amp; Dining PAX
            </CardTitle>
            <CardDescription className="text-xs text-stone-500">
              Authoritative POS data pulled from Orders Master covers and Executive Summary
            </CardDescription>
          </div>
          <Link href="/finance/sales">
            <Button variant="ghost" size="sm" className="text-xs text-amber-700 hover:text-amber-800 gap-1 h-7">
              <span>View Sales Ingestion</span>
              <ExternalLink className="h-3 w-3" />
            </Button>
          </Link>
        </CardHeader>

        <CardContent className="pt-3">
          {!salesData.hasData ? (
            <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200/70 text-xs text-amber-900 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <span>No Petpooja reports imported yet for {businessDate}.</span>
              </div>
              <Link href="/finance/sales">
                <Button variant="outline" size="sm" className="h-7 text-xs bg-white text-amber-900 border-amber-300">
                  Upload Petpooja Report
                </Button>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-stone-50/80 p-3 rounded-xl border border-stone-200/60">
                <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block">
                  Restaurant PAX (Covers)
                </span>
                <span className="text-2xl font-black text-amber-600 block mt-1">
                  {formatNumber(salesData.restaurantPax)}
                </span>
                <span className="text-[10px] text-stone-400">
                  Across {salesData.billCount} bills ({dinerConversionRate}% of Gate Footfall)
                </span>
              </div>

              <div className="bg-stone-50/80 p-3 rounded-xl border border-stone-200/60">
                <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block">
                  Net Sales
                </span>
                <span className="text-2xl font-black text-stone-900 block mt-1">
                  {formatINR(salesData.netSales)}
                </span>
                <span className="text-[10px] text-stone-400">Settled food &amp; beverage</span>
              </div>

              <div className="bg-stone-50/80 p-3 rounded-xl border border-stone-200/60">
                <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block">
                  Discounts Given
                </span>
                <span className="text-2xl font-black text-rose-600 block mt-1">
                  {formatINR(salesData.discounts)}
                </span>
                <span className="text-[10px] text-stone-400">Bill &amp; item discounts</span>
              </div>

              <div className="bg-stone-50/80 p-3 rounded-xl border border-stone-200/60">
                <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block">
                  Avg Spend / PAX
                </span>
                <span className="text-2xl font-black text-stone-900 block mt-1">
                  {formatINR(salesData.avgSpendPerPax)}
                </span>
                <span className="text-[10px] text-stone-400">Revenue per dining guest</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* SECTION 3: AUTO-PULLED INVENTORY LOSS & BREAKAGE SNAPSHOT */}
      <Card className="border-stone-200/80 shadow-xs">
        <CardHeader className="pb-3 border-b border-stone-100 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-bold flex items-center gap-2 text-stone-900">
              <Package className="h-4 w-4 text-rose-600" /> Inventory Missing &amp; Breakage Incidents
            </CardTitle>
            <CardDescription className="text-xs text-stone-500">
              Read automatically from Asset Status Ledger and Kitchen Stock Dispatches
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/inventory/assets">
              <Button variant="ghost" size="sm" className="text-xs text-stone-600 hover:text-stone-900 gap-1 h-7">
                <span>Asset Register</span>
                <ExternalLink className="h-3 w-3" />
              </Button>
            </Link>
            <Link href="/inventory/issues">
              <Button variant="ghost" size="sm" className="text-xs text-stone-600 hover:text-stone-900 gap-1 h-7">
                <span>Store Issues</span>
                <ExternalLink className="h-3 w-3" />
              </Button>
            </Link>
          </div>
        </CardHeader>

        <CardContent className="pt-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Missing Stock Box */}
            <div className="p-3.5 rounded-xl border border-stone-200 bg-stone-50/50 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> Missing Stock Incidents
                </span>
                <Badge variant={inventoryIncidents.missingCount > 0 ? 'warning' : 'outline'}>
                  {inventoryIncidents.missingCount} logged
                </Badge>
              </div>

              {inventoryIncidents.missingItems.length === 0 ? (
                <div className="text-[11px] text-stone-400 py-3 text-center">
                  No missing stock or inventory audit variances logged for {businessDate}.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {inventoryIncidents.missingItems.map((item, idx) => (
                    <div key={idx} className="bg-white p-2 rounded-lg border border-stone-200/80 text-xs flex justify-between items-center">
                      <div>
                        <strong className="text-stone-900 block">{item.name}</strong>
                        <span className="text-[10px] text-stone-500">{item.notes} ({item.source})</span>
                      </div>
                      <span className="font-bold text-rose-600 text-xs shrink-0 ml-2">{item.quantity}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Breakage / Loss Box */}
            <div className="p-3.5 rounded-xl border border-stone-200 bg-stone-50/50 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                  <Wrench className="h-3.5 w-3.5 text-rose-600" /> Breakage &amp; Spoilage Incidents
                </span>
                <Badge variant={inventoryIncidents.breakageCount > 0 ? 'danger' : 'outline'}>
                  {inventoryIncidents.breakageCount} logged
                </Badge>
              </div>

              {inventoryIncidents.breakageItems.length === 0 ? (
                <div className="text-[11px] text-stone-400 py-3 text-center">
                  No asset breakage or kitchen spoilage incidents logged for {businessDate}.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {inventoryIncidents.breakageItems.map((item, idx) => (
                    <div key={idx} className="bg-white p-2 rounded-lg border border-stone-200/80 text-xs flex justify-between items-center">
                      <div>
                        <strong className="text-stone-900 block">{item.name}</strong>
                        <span className="text-[10px] text-stone-500">{item.notes} ({item.source})</span>
                      </div>
                      <span className="font-bold text-stone-900 text-xs shrink-0 ml-2">{item.quantity}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SECTION 4: GENUINE MANUAL OPERATIONAL FIELDS */}
      <Card className="border-stone-200/80 shadow-xs">
        <CardHeader className="pb-3 border-b border-stone-100 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-bold flex items-center gap-2 text-stone-900">
              <MessageSquareWarning className="h-4 w-4 text-indigo-600" /> Shift Operational Log &amp; Incidents
            </CardTitle>
            <CardDescription className="text-xs text-stone-500">
              Manual entries for operational items that have no existing automated source of truth
            </CardDescription>
          </div>
          {lastSavedAt && (
            <span className="text-[10px] text-stone-400">
              Last saved: {new Date(lastSavedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </CardHeader>

        <CardContent className="pt-4">
          <form onSubmit={handleSaveOperationalNotes} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Complaints */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />
                  Guest Complaints
                </label>
                <textarea
                  rows={3}
                  value={complaints}
                  onChange={(e) => setComplaints(e.target.value)}
                  placeholder="e.g. Table 14 food delay complaint resolved with dessert; air conditioning in banquet hall 2 reported low."
                  className="w-full text-xs p-2.5 rounded-xl border border-stone-200 bg-white focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
                />
              </div>

              {/* Work Orders */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                  Work Orders &amp; Maintenance
                </label>
                <textarea
                  rows={3}
                  value={workOrders}
                  onChange={(e) => setWorkOrders(e.target.value)}
                  placeholder="e.g. Dishwasher motor inspection requested; generator fuel filter service scheduled for tomorrow morning."
                  className="w-full text-xs p-2.5 rounded-xl border border-stone-200 bg-white focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
                />
              </div>

              {/* Requirements */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-sky-500 inline-block" />
                  Store / Kitchen Requirements
                </label>
                <textarea
                  rows={3}
                  value={requirements}
                  onChange={(e) => setRequirements(e.target.value)}
                  placeholder="e.g. Urgent mustard oil and dairy delivery required before lunch shift; 50 additional takeaway boxes needed."
                  className="w-full text-xs p-2.5 rounded-xl border border-stone-200 bg-white focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
                />
              </div>

              {/* General Operational Notes */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                  General Handover &amp; Incident Notes
                </label>
                <textarea
                  rows={3}
                  value={operationalNotes}
                  onChange={(e) => setOperationalNotes(e.target.value)}
                  placeholder="e.g. VIP party of 25 hosted at 8 PM smoothly; cash deposit handed over to night vault supervisor."
                  className="w-full text-xs p-2.5 rounded-xl border border-stone-200 bg-white focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={savingNotes} className="gap-1.5 text-xs">
                <Save className="h-3.5 w-3.5" />
                {savingNotes ? 'Saving Notes...' : 'Save Shift Operational Log'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
