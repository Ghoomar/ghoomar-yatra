'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR, getTodayBusinessDate, formatNumber } from '@/lib/utils';
import { useI18n } from '@/lib/i18n/context';
import { getLocalizedMasterName, getLocalizedMasterSymbol } from '@/lib/i18n/master-data';
import {
  Users,
  Receipt,
  AlertTriangle,
  ClipboardList,
  Save,
  RefreshCw,
  CheckCircle2,
  ExternalLink,
  Package,
  Wrench,
  MessageSquareWarning,
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

interface IncidentItem {
  id: string;
  sourceKey: 'assetRegister' | 'stockCountAudit' | 'storeLoss' | 'kitchenWastage';
  name: string;
  quantity: string;
  notes: string;
  value?: number;
}

interface InventoryIncidents {
  missingCount: number;
  missingItems: IncidentItem[];
  breakageCount: number;
  breakageItems: IncidentItem[];
}

export default function DailyOperationsPage() {
  const supabase = createClient();
  const { t, locale } = useI18n();
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
          .select('id, event_type, quantity, notes, item:inventory_items(name, name_hi)')
          .eq('business_date', businessDate),
        supabase
          .from('stock_movements')
          .select(`
            id, movement_type, purpose, quantity, total_value, notes,
            item:inventory_items(name, name_hi, unit:units!inventory_items_unit_id_fkey(symbol, symbol_hi))
          `)
          .eq('business_date', businessDate)
          .in('movement_type', ['breakage', 'loss', 'wastage', 'spoilage', 'count_adjustment']),
      ]);

      const missing: IncidentItem[] = [];
      const breakage: IncidentItem[] = [];

      (assetLossEvents || []).forEach((ev: any) => {
        const localizedName = getLocalizedMasterName(ev.item, locale) || 'Asset Item';
        if (ev.event_type === 'loss') {
          missing.push({
            id: ev.id,
            sourceKey: 'assetRegister',
            name: localizedName,
            quantity: `${ev.quantity} pcs`,
            notes: ev.notes || (locale === 'hi' ? 'एसेट गुम / अनुपलब्ध' : 'Asset missing / lost'),
          });
        } else if (ev.event_type === 'breakage') {
          breakage.push({
            id: ev.id,
            sourceKey: 'assetRegister',
            name: localizedName,
            quantity: `${ev.quantity} pcs`,
            notes: ev.notes || (locale === 'hi' ? 'सेवा के दौरान टूटा' : 'Broken in service'),
          });
        }
      });

      (stockMovs || []).forEach((m: any) => {
        const isLoss = m.movement_type === 'loss' || (m.movement_type === 'count_adjustment' && Number(m.quantity) < 0);
        const isBreak = ['breakage', 'wastage', 'spoilage'].includes(m.movement_type) || m.purpose === 'Breakage';
        const localizedName = getLocalizedMasterName(m.item, locale) || 'Stock Item';
        const unitSymbol = getLocalizedMasterSymbol(m.item?.unit, locale);

        if (isLoss) {
          missing.push({
            id: m.id,
            sourceKey: m.movement_type === 'count_adjustment' ? 'stockCountAudit' : 'storeLoss',
            name: localizedName,
            quantity: `${Math.abs(Number(m.quantity))} ${unitSymbol}`,
            notes: m.notes || m.purpose,
            value: Number(m.total_value) || 0,
          });
        } else if (isBreak) {
          breakage.push({
            id: m.id,
            sourceKey: 'kitchenWastage',
            name: localizedName,
            quantity: `${m.quantity} ${unitSymbol}`,
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
      setMessage({ type: 'error', text: t('operations.daily.loadError') });
    } finally {
      setLoading(false);
    }
  }, [businessDate, locale, supabase, t]);

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
      setMessage({ type: 'success', text: t('operations.daily.saveSuccess') });
    } catch (err: any) {
      console.error('Error saving operational notes:', err);
      setMessage({ type: 'error', text: err.message || t('operations.daily.saveError') });
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
            {t('operations.daily.title')}
          </h1>
          <p className="text-xs sm:text-sm text-stone-500 mt-0.5">
            {t('operations.daily.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-white border border-stone-200 rounded-lg px-3 py-1.5 shadow-2xs text-xs font-medium">
            <span className="text-stone-500">{t('operations.daily.dateLabel')}</span>
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
              <Users className="h-4 w-4 text-amber-600" /> {t('operations.daily.gate.title')}
            </CardTitle>
            <CardDescription className="text-xs text-stone-500">
              {t('operations.daily.gate.subtitle', { date: businessDate })}
            </CardDescription>
          </div>
          <Link href="/operations/gate">
            <Button variant="ghost" size="sm" className="text-xs text-amber-700 hover:text-amber-800 gap-1 h-7">
              <span>{t('operations.daily.gate.viewGate')}</span>
              <ExternalLink className="h-3 w-3" />
            </Button>
          </Link>
        </CardHeader>

        <CardContent className="pt-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-stone-50/80 p-3 rounded-xl border border-stone-200/60">
              <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block">
                {t('operations.daily.gate.entryPax')}
              </span>
              <span className="text-2xl font-black text-stone-900 block mt-1">
                {formatNumber(gateData.entryPax)}
              </span>
              <span className="text-[10px] text-stone-400">{t('operations.daily.gate.entryPaxDesc')}</span>
            </div>

            <div className="bg-stone-50/80 p-3 rounded-xl border border-stone-200/60">
              <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block">
                {t('operations.daily.gate.cars')}
              </span>
              <span className="text-2xl font-black text-sky-700 block mt-1">
                {formatNumber(gateData.cars)}
              </span>
              <span className="text-[10px] text-stone-400">{t('operations.daily.gate.carsDesc')}</span>
            </div>

            <div className="bg-stone-50/80 p-3 rounded-xl border border-stone-200/60">
              <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block">
                {t('operations.daily.gate.bikes')}
              </span>
              <span className="text-2xl font-black text-emerald-700 block mt-1">
                {formatNumber(gateData.bikes)}
              </span>
              <span className="text-[10px] text-stone-400">{t('operations.daily.gate.bikesDesc')}</span>
            </div>

            <div className="bg-stone-50/80 p-3 rounded-xl border border-stone-200/60">
              <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block">
                {t('operations.daily.gate.totalVehicles')}
              </span>
              <span className="text-2xl font-black text-stone-900 block mt-1">
                {formatNumber(gateData.totalVehicles)}
              </span>
              <span className="text-[10px] text-stone-400">{t('operations.daily.gate.totalVehiclesDesc')}</span>
            </div>
          </div>

          {/* Car Registration Prefixes Pills (state codes remain English per Rule 6) */}
          {Object.keys(gateData.prefixes).length > 0 && (
            <div className="mt-3 pt-3 border-t border-stone-100 flex items-center gap-2 flex-wrap text-xs">
              <span className="text-[11px] font-semibold text-stone-400">{t('operations.daily.gate.carOrigins')}</span>
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
              <Receipt className="h-4 w-4 text-emerald-600" /> {t('operations.daily.sales.title')}
            </CardTitle>
            <CardDescription className="text-xs text-stone-500">
              {t('operations.daily.sales.subtitle')}
            </CardDescription>
          </div>
          <Link href="/finance/sales">
            <Button variant="ghost" size="sm" className="text-xs text-amber-700 hover:text-amber-800 gap-1 h-7">
              <span>{t('operations.daily.sales.viewSales')}</span>
              <ExternalLink className="h-3 w-3" />
            </Button>
          </Link>
        </CardHeader>

        <CardContent className="pt-3">
          {!salesData.hasData ? (
            <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200/70 text-xs text-amber-900 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <span>{t('operations.daily.sales.noData', { date: businessDate })}</span>
              </div>
              <Link href="/finance/sales">
                <Button variant="outline" size="sm" className="h-7 text-xs bg-white text-amber-900 border-amber-300">
                  {t('operations.daily.sales.uploadReport')}
                </Button>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-stone-50/80 p-3 rounded-xl border border-stone-200/60">
                <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block">
                  {t('operations.daily.sales.restaurantPax')}
                </span>
                <span className="text-2xl font-black text-amber-600 block mt-1">
                  {formatNumber(salesData.restaurantPax)}
                </span>
                <span className="text-[10px] text-stone-400">
                  {t('operations.daily.sales.restaurantPaxDesc', { count: salesData.billCount, percent: dinerConversionRate })}
                </span>
              </div>

              <div className="bg-stone-50/80 p-3 rounded-xl border border-stone-200/60">
                <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block">
                  {t('operations.daily.sales.netSales')}
                </span>
                <span className="text-2xl font-black text-stone-900 block mt-1">
                  {formatINR(salesData.netSales)}
                </span>
                <span className="text-[10px] text-stone-400">{t('operations.daily.sales.netSalesDesc')}</span>
              </div>

              <div className="bg-stone-50/80 p-3 rounded-xl border border-stone-200/60">
                <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block">
                  {t('operations.daily.sales.discounts')}
                </span>
                <span className="text-2xl font-black text-rose-600 block mt-1">
                  {formatINR(salesData.discounts)}
                </span>
                <span className="text-[10px] text-stone-400">{t('operations.daily.sales.discountsDesc')}</span>
              </div>

              <div className="bg-stone-50/80 p-3 rounded-xl border border-stone-200/60">
                <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block">
                  {t('operations.daily.sales.avgSpend')}
                </span>
                <span className="text-2xl font-black text-stone-900 block mt-1">
                  {formatINR(salesData.avgSpendPerPax)}
                </span>
                <span className="text-[10px] text-stone-400">{t('operations.daily.sales.avgSpendDesc')}</span>
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
              <Package className="h-4 w-4 text-rose-600" /> {t('operations.daily.incidents.title')}
            </CardTitle>
            <CardDescription className="text-xs text-stone-500">
              {t('operations.daily.incidents.subtitle')}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/inventory/assets">
              <Button variant="ghost" size="sm" className="text-xs text-stone-600 hover:text-stone-900 gap-1 h-7">
                <span>{t('operations.daily.incidents.assetRegister')}</span>
                <ExternalLink className="h-3 w-3" />
              </Button>
            </Link>
            <Link href="/inventory/issues">
              <Button variant="ghost" size="sm" className="text-xs text-stone-600 hover:text-stone-900 gap-1 h-7">
                <span>{t('operations.daily.incidents.storeIssues')}</span>
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
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> {t('operations.daily.incidents.missingStock')}
                </span>
                <Badge variant={inventoryIncidents.missingCount > 0 ? 'warning' : 'outline'}>
                  {t('operations.daily.incidents.loggedCount', { count: inventoryIncidents.missingCount })}
                </Badge>
              </div>

              {inventoryIncidents.missingItems.length === 0 ? (
                <div className="text-[11px] text-stone-400 py-3 text-center">
                  {t('operations.daily.incidents.noMissing', { date: businessDate })}
                </div>
              ) : (
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {inventoryIncidents.missingItems.map((item, idx) => (
                    <div key={idx} className="bg-white p-2 rounded-lg border border-stone-200/80 text-xs flex justify-between items-center">
                      <div>
                        <strong className="text-stone-900 block">{item.name}</strong>
                        <span className="text-[10px] text-stone-500">
                          {item.notes} ({t(`operations.daily.incidents.sources.${item.sourceKey}` as any)})
                        </span>
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
                  <Wrench className="h-3.5 w-3.5 text-rose-600" /> {t('operations.daily.incidents.breakageWastage')}
                </span>
                <Badge variant={inventoryIncidents.breakageCount > 0 ? 'danger' : 'outline'}>
                  {t('operations.daily.incidents.loggedCount', { count: inventoryIncidents.breakageCount })}
                </Badge>
              </div>

              {inventoryIncidents.breakageItems.length === 0 ? (
                <div className="text-[11px] text-stone-400 py-3 text-center">
                  {t('operations.daily.incidents.noBreakage', { date: businessDate })}
                </div>
              ) : (
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {inventoryIncidents.breakageItems.map((item, idx) => (
                    <div key={idx} className="bg-white p-2 rounded-lg border border-stone-200/80 text-xs flex justify-between items-center">
                      <div>
                        <strong className="text-stone-900 block">{item.name}</strong>
                        <span className="text-[10px] text-stone-500">
                          {item.notes} ({t(`operations.daily.incidents.sources.${item.sourceKey}` as any)})
                        </span>
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
              <MessageSquareWarning className="h-4 w-4 text-indigo-600" /> {t('operations.daily.shiftLog.title')}
            </CardTitle>
            <CardDescription className="text-xs text-stone-500">
              {t('operations.daily.shiftLog.subtitle')}
            </CardDescription>
          </div>
          {lastSavedAt && (
            <span className="text-[10px] text-stone-400">
              {t('operations.daily.lastSaved', {
                time: new Date(lastSavedAt).toLocaleTimeString(locale === 'hi' ? 'hi-IN' : 'en-IN', { hour: '2-digit', minute: '2-digit' })
              })}
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
                  {t('operations.daily.shiftLog.complaints')}
                </label>
                <textarea
                  rows={3}
                  value={complaints}
                  onChange={(e) => setComplaints(e.target.value)}
                  placeholder={t('operations.daily.shiftLog.complaintsPlaceholder')}
                  className="w-full text-xs p-2.5 rounded-xl border border-stone-200 bg-white focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
                />
              </div>

              {/* Work Orders */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                  {t('operations.daily.shiftLog.workOrders')}
                </label>
                <textarea
                  rows={3}
                  value={workOrders}
                  onChange={(e) => setWorkOrders(e.target.value)}
                  placeholder={t('operations.daily.shiftLog.workOrdersPlaceholder')}
                  className="w-full text-xs p-2.5 rounded-xl border border-stone-200 bg-white focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
                />
              </div>

              {/* Requirements */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-sky-500 inline-block" />
                  {t('operations.daily.shiftLog.requirements')}
                </label>
                <textarea
                  rows={3}
                  value={requirements}
                  onChange={(e) => setRequirements(e.target.value)}
                  placeholder={t('operations.daily.shiftLog.requirementsPlaceholder')}
                  className="w-full text-xs p-2.5 rounded-xl border border-stone-200 bg-white focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
                />
              </div>

              {/* General Operational Notes */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                  {t('operations.daily.shiftLog.operationalNotes')}
                </label>
                <textarea
                  rows={3}
                  value={operationalNotes}
                  onChange={(e) => setOperationalNotes(e.target.value)}
                  placeholder={t('operations.daily.shiftLog.operationalNotesPlaceholder')}
                  className="w-full text-xs p-2.5 rounded-xl border border-stone-200 bg-white focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={savingNotes} className="gap-1.5 text-xs">
                <Save className="h-3.5 w-3.5" />
                {savingNotes ? t('operations.daily.saving') : t('operations.daily.saveAction')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
