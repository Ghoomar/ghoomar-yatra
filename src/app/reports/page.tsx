'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR, getTodayBusinessDate, formatNumber } from '@/lib/utils';
import {
  BarChart3,
  Download,
  RefreshCw,
  Layers,
  ArrowRightLeft,
  TrendingUp,
  Clock,
  Users,
  UtensilsCrossed,
  Receipt,
  Sparkles,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Car,
  Ticket,
  Flame,
  ShieldCheck,
  ShoppingBag,
} from 'lucide-react';
import { DailySalesLineGraph } from '@/components/reports/DailySalesLineGraph';
import { SalesAnalyticsDashboard } from '@/components/sales/SalesAnalyticsDashboard';
import { GateTimeAnalyticsChart } from '@/components/reports/GateTimeAnalyticsChart';

type DrilldownType = 'restaurant' | 'snacks' | 'camel' | 'games' | 'mehendi' | 'champi' | null;

interface HourlyActivityPoint {
  hour: number;
  label: string;
  qty: number;
  amount: number;
  net: number;
}

const DIESEL_ITEM_ID = 'd1e5e100-0001-4000-a000-000000000001';
const LPG_ITEM_ID = '195c1900-0002-4000-a000-000000000002';

export default function ReportsPage() {
  const supabase = createClient();
  const [businessDate, setBusinessDate] = useState(getTodayBusinessDate());
  const [activeTab, setActiveTab] = useState<'sales' | 'inventory' | 'vendors'>('sales');

  // Active drilldown card
  const [activeDrilldown, setActiveDrilldown] = useState<DrilldownType>(null);
  // Expand Gate detailed analytics in Tab 1
  const [showGateDetails, setShowGateDetails] = useState(false);

  // Authoritative datasets
  const [dailyData, setDailyData] = useState<any>(null);
  const [salesSummary, setSalesSummary] = useState<any>(null);
  const [execSummary, setExecSummary] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [hourlyItems, setHourlyItems] = useState<any[]>([]);
  const [gateSummary, setGateSummary] = useState<any>(null);
  const [inventoryMovements, setInventoryMovements] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [directExpenses, setDirectExpenses] = useState<number>(0);
  const [electricityCost, setElectricityCost] = useState<number>(0);

  // Historical comparative data (DoD and WoW)
  const [prevDaySummary, setPrevDaySummary] = useState<any>(null);
  const [prevWeekSummary, setPrevWeekSummary] = useState<any>(null);
  const [prevDayGate, setPrevDayGate] = useState<any>(null);
  const [prevWeekGate, setPrevWeekGate] = useState<any>(null);

  const [loading, setLoading] = useState(true);

  // Helper date calculations for comparisons
  const getRelativeDate = (baseDateStr: string, offsetDays: number): string => {
    const [y, m, d] = baseDateStr.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() + offsetDays);
    const ry = date.getUTCFullYear();
    const rm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const rd = String(date.getUTCDate()).padStart(2, '0');
    return `${ry}-${rm}-${rd}`;
  };

  const prevDayDate = useMemo(() => getRelativeDate(businessDate, -1), [businessDate]);
  const prevWeekDate = useMemo(() => getRelativeDate(businessDate, -7), [businessDate]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [
        dFinRes,
        sSumRes,
        execRes,
        ordersRes,
        hourlyRes,
        vSumRes,
        movsRes,
        gateRes,
        prevDaySumRes,
        prevWeekSumRes,
        prevDayGateRes,
        prevWeekGateRes,
        expRes,
        elecRes,
      ] = await Promise.all([
        supabase.from('daily_financial_summary').select('*').eq('business_date', businessDate).maybeSingle(),
        supabase.from('daily_sales_summary').select('*').eq('business_date', businessDate).maybeSingle(),
        supabase.from('sales_executive_summaries').select('*').eq('business_date', businessDate).maybeSingle(),
        supabase.from('sales_orders').select('*').eq('business_date', businessDate).order('order_timestamp', { ascending: true }),
        supabase.from('sales_hourly_items').select('*').eq('business_date', businessDate),
        supabase.from('vendor_outstanding_summary').select('*').order('vendor_name'),
        supabase
          .from('stock_movements')
          .select(`
            id, item_id, created_at, movement_type, purpose, quantity, unit_cost, total_value,
            item:inventory_items(name, item_code, unit:units!inventory_items_unit_id_fkey(symbol)),
            department:departments(name),
            responsible_person:employees(name)
          `)
          .eq('business_date', businessDate)
          .order('created_at', { ascending: false }),
        fetch(`/api/operations/gate/analytics?date=${businessDate}`),
        supabase.from('daily_sales_summary').select('*').eq('business_date', prevDayDate).maybeSingle(),
        supabase.from('daily_sales_summary').select('*').eq('business_date', prevWeekDate).maybeSingle(),
        fetch(`/api/operations/gate/analytics?date=${prevDayDate}`),
        fetch(`/api/operations/gate/analytics?date=${prevWeekDate}`),
        supabase.from('expenses').select('amount').eq('business_date', businessDate),
        supabase.from('meter_readings_ledger').select('delta_consumption').eq('business_date', businessDate),
      ]);

      setDailyData(dFinRes.data || null);
      setSalesSummary(sSumRes.data || null);
      setExecSummary(execRes.data || null);
      setOrders(ordersRes.data || []);
      setHourlyItems(hourlyRes.data || []);
      setVendors(vSumRes.data || []);
      setInventoryMovements(movsRes.data || []);

      const expTotal = (expRes.data || []).reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);
      setDirectExpenses(expTotal);

      const totalKvah = (elecRes.data || []).reduce((s: number, r: any) => s + (Number(r.delta_consumption) || 0), 0);
      setElectricityCost(totalKvah * 10.00); // authoritative standard ₹10/KVAH rate

      if (gateRes.ok) {
        const gateJson = await gateRes.json();
        setGateSummary(gateJson.summary || null);
      } else {
        setGateSummary(null);
      }

      setPrevDaySummary(prevDaySumRes.data || null);
      setPrevWeekSummary(prevWeekSumRes.data || null);

      if (prevDayGateRes.ok) {
        const pdg = await prevDayGateRes.json();
        setPrevDayGate(pdg.summary || null);
      } else {
        setPrevDayGate(null);
      }

      if (prevWeekGateRes.ok) {
        const pwg = await prevWeekGateRes.json();
        setPrevWeekGate(pwg.summary || null);
      } else {
        setPrevWeekGate(null);
      }
    } catch (err: any) {
      console.error('Error loading reports data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [businessDate]);

  const exportCSV = (data: any[], filename: string) => {
    if (!data || data.length === 0) {
      alert('No data available to export.');
      return;
    }
    const keys = Object.keys(data[0]);
    const csvContent = [
      keys.join(','),
      ...data.map((row) => keys.map((k) => JSON.stringify(row[k] ?? '')).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}-${businessDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ==========================================
  // AUTHORITATIVE BUSINESS CALCULATIONS
  // ==========================================

  // 1. Consolidated Gross Sales (Authoritative standard of truth)
  const consolidatedGross = Number(
    execSummary?.grand_total ?? salesSummary?.gross_sales ?? 0
  );
  const consolidatedNet = Number(
    execSummary?.net_sales ?? salesSummary?.net_sales ?? dailyData?.revenue ?? 0
  );
  const totalBillsCount = Number(
    execSummary?.successful_bills_count ?? orders.filter((o) => o.status === 'Success').length ?? salesSummary?.bill_count ?? 0
  );

  // 2. Restaurant Dine-In (STRICTLY Dine-In, excludes Takeaway and Snacks Stall)
  const dineInOrders = useMemo(() => {
    return orders.filter((o) => o.order_type === 'Dine In' && o.status === 'Success');
  }, [orders]);

  const dineInNet = useMemo(() => {
    return dineInOrders.reduce((sum, o) => sum + (Number(o.net_sales) || 0), 0);
  }, [dineInOrders]);

  const dineInGross = useMemo(() => {
    return dineInOrders.reduce((sum, o) => sum + (Number(o.grand_total) || 0), 0);
  }, [dineInOrders]);

  const dineInTax = useMemo(() => {
    return dineInOrders.reduce((sum, o) => sum + (Number(o.tax_amount) || 0), 0);
  }, [dineInOrders]);

  const dineInPax = useMemo(() => {
    return dineInOrders.reduce((sum, o) => sum + (Number(o.covers_pax) || 0), 0);
  }, [dineInOrders]);

  const dineInBillsCount = dineInOrders.length;
  const spendPerDiner = dineInPax > 0 ? dineInNet / dineInPax : null;
  const paxPerBill = dineInBillsCount > 0 ? dineInPax / dineInBillsCount : null;

  // 3. Gate Footfall & Conversion
  const gateFootfall = gateSummary?.total_visitors || 0;
  const totalVehicles = gateSummary?.total_vehicles || 0;
  const totalCars = gateSummary?.total_cars || 0;
  const totalBikes = gateSummary?.total_bikes || 0;
  const peakVisitorHour = gateSummary?.peak_visitor_hour || null;
  const topVehiclePrefix = gateSummary?.prefixes && gateSummary.prefixes.length > 0 ? gateSummary.prefixes[0] : null;

  const dinerConversionRate = gateFootfall > 0 ? (dineInPax / gateFootfall) * 100 : null;
  const spendPerGateVisitor = gateFootfall > 0 ? dineInNet / gateFootfall : null;

  // 4. Snacks Stall (authoritative order_type = 'Snacks Stall' in Orders Master)
  const snacksOrders = useMemo(() => {
    return orders.filter((o) => o.order_type === 'Snacks Stall' && o.status === 'Success');
  }, [orders]);

  const snacksNet = useMemo(() => {
    return snacksOrders.reduce((sum, o) => sum + (Number(o.net_sales) || 0), 0);
  }, [snacksOrders]);

  const snacksGross = useMemo(() => {
    return snacksOrders.reduce((sum, o) => sum + (Number(o.grand_total) || 0), 0);
  }, [snacksOrders]);

  const snacksBillCount = snacksOrders.length;
  const snacksAbv = snacksBillCount > 0 ? snacksGross / snacksBillCount : null;

  // Snacks Hourly breakdown between 5 PM and 11 PM (hours 17..23)
  const snacksHourly = useMemo(() => {
    const hours = [17, 18, 19, 20, 21, 22, 23];
    return hours.map((h) => {
      const hOrders = snacksOrders.filter((o) => o.hour_of_day === h);
      const displayH = h % 12 === 0 ? 12 : h % 12;
      const label = `${displayH}:00 PM`;
      const net = hOrders.reduce((sum, o) => sum + (Number(o.net_sales) || 0), 0);
      const gross = hOrders.reduce((sum, o) => sum + (Number(o.grand_total) || 0), 0);
      return {
        hour: h,
        label,
        count: hOrders.length,
        net,
        gross,
      };
    });
  }, [snacksOrders]);

  // Top items sold during evening snack service from Hourly Items
  const snacksTopItems = useMemo(() => {
    const snackKeywords = ['pakoda', 'tikki', 'tea', 'jalebi', 'golgappe', 'chaat', 'vada', 'snack', 'samosa'];
    const filtered = hourlyItems.filter((i) => {
      const name = i.item_name?.toLowerCase() || '';
      return snackKeywords.some((kw) => name.includes(kw));
    });

    const map = new Map<string, { name: string; qty: number; net: number; gross: number }>();
    filtered.forEach((i) => {
      const curr = map.get(i.item_name) || { name: i.item_name, qty: 0, net: 0, gross: 0 };
      curr.qty += Number(i.quantity) || 0;
      curr.net += Number(i.net_sales) || 0;
      curr.gross += Number(i.total_sales) || 0;
      map.set(i.item_name, curr);
    });

    return Array.from(map.values())
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
  }, [hourlyItems]);

  // 5. Village Attractions from Petpooja Hourly Items (ONLY authoritative source)
  const parseActivityStream = (itemNamePattern: string) => {
    const matching = hourlyItems.filter((i) => i.item_name?.toLowerCase().includes(itemNamePattern.toLowerCase()));
    const totalQty = matching.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
    const totalGross = matching.reduce((sum, i) => sum + (Number(i.total_sales) || 0), 0);
    const totalNet = matching.reduce((sum, i) => sum + (Number(i.net_sales) || 0), 0);
    const abv = totalQty > 0 ? totalGross / totalQty : null;

    // Hourly map - cover all 24 hours (0..23) so closing/settlement hours (0, 1 AM) and evening hours are fully accounted for
    const hourMap = new Map<number, HourlyActivityPoint>();
    for (let h = 0; h < 24; h++) {
      const displayH = h % 12 === 0 ? 12 : h % 12;
      const meridiem = h >= 12 ? 'PM' : 'AM';
      const label = `${String(displayH).padStart(2, '0')}:00 ${meridiem}`;
      hourMap.set(h, { hour: h, label, qty: 0, amount: 0, net: 0 });
    }

    matching.forEach((i) => {
      const h = Number(i.hour_of_day);
      if (hourMap.has(h)) {
        const pt = hourMap.get(h)!;
        pt.qty += Number(i.quantity) || 0;
        pt.amount += Number(i.total_sales) || 0;
        pt.net += Number(i.net_sales) || 0;
      }
    });

    // Display all hour slots where tickets/activities were transacted
    const hourlyData = Array.from(hourMap.values()).filter((pt) => pt.qty > 0);

    return {
      totalQty,
      totalGross,
      totalNet,
      abv,
      hourlyData,
    };
  };

  const camelData = useMemo(() => parseActivityStream('Camel Ride'), [hourlyItems]);
  const gamesData = useMemo(() => parseActivityStream('Skill Games'), [hourlyItems]);
  const mehendiData = useMemo(() => parseActivityStream('Mehendi'), [hourlyItems]);
  const champiData = useMemo(() => parseActivityStream('Champi'), [hourlyItems]);

  // 6. Authoritative Operating Expenses (from Daily P&L sources: expenses vouchers, stock movements, and utilities)
  const { totalStoreConsumption, totalUtilities } = useMemo(() => {
    let storeSum = 0;
    let dieselCost = 0;
    let lpgCost = 0;

    (inventoryMovements || []).forEach((m: any) => {
      if (['transfer', 'purchase', 'opening', 'return', 'count_adjustment', 'physical_count_adjustment'].includes(m.movement_type)) {
        return;
      }
      const val = Math.abs(Number(m.total_value)) || 0;

      if (m.item_id === DIESEL_ITEM_ID || m.purpose === 'Generator Fuel') {
        dieselCost += val;
      } else if (m.item_id === LPG_ITEM_ID || m.purpose === 'Kitchen Gas') {
        lpgCost += val;
      } else {
        storeSum += val;
      }
    });

    const utilsTotal = dieselCost + lpgCost + electricityCost;
    return {
      totalStoreConsumption: storeSum,
      totalUtilities: utilsTotal,
    };
  }, [inventoryMovements, electricityCost]);

  const totalDirectVouchers = directExpenses;
  const totalOperationalExpenses = totalDirectVouchers + totalStoreConsumption + totalUtilities;
  const hasExpensesLogged = totalOperationalExpenses > 0;

  // 7. Internal Reconciliation Check
  // Compares Consolidated Gross against sum of granular Order Types in Orders Master
  const granularStreamsGrossSum = useMemo(() => {
    return orders
      .filter((o) => o.status === 'Success')
      .reduce((sum, o) => sum + (Number(o.grand_total) || 0), 0);
  }, [orders]);

  const reconciliationDifference = Math.abs(consolidatedGross - granularStreamsGrossSum);
  const isReconciled = orders.length === 0 || reconciliationDifference < 1.0;

  // 8. Factual Dynamic Executive Prose Brief
  const executiveBrief = useMemo(() => {
    const lines: string[] = [];

    // Date formatting
    const [y, m, d] = businessDate.split('-').map(Number);
    const dateObj = new Date(Date.UTC(y, m - 1, d));
    const formattedDate = dateObj.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

    // Zero-data case: neither gate nor sales logged
    if (gateFootfall === 0 && consolidatedGross === 0) {
      return `On ${formattedDate}, no resort gate footfall or Petpooja sales were logged in the system.`;
    }

    // Gate & Traffic sentence
    if (gateFootfall > 0) {
      let vehicleStr = `${totalVehicles} total vehicles (${totalBikes} two-wheelers and ${totalCars} cars)`;
      if (topVehiclePrefix) {
        vehicleStr += `, led by prefix ${topVehiclePrefix.name} (${topVehiclePrefix.count} vehicles)`;
      }
      lines.push(
        `On ${formattedDate}, resort gate arrivals recorded ${formatNumber(gateFootfall)} persons. Peak visitor flow occurred between ${
          peakVisitorHour?.label || 'evening hours'
        } (${peakVisitorHour?.count || 0} entries). Vehicle traffic comprised ${vehicleStr}.`
      );
    } else {
      lines.push(`On ${formattedDate}, no gate footfall was logged.`);
    }

    // Dining Performance & Conversion sentence
    if (dineInOrders.length > 0) {
      const convText =
        dinerConversionRate !== null
          ? `This yielded a ${dinerConversionRate.toFixed(1)}% diner conversion rate from gate footfall`
          : `Diner conversion is unavailable due to unrecorded gate footfall`;
      const apcText = spendPerDiner !== null ? formatINR(spendPerDiner) : '—';
      const partyText = paxPerBill !== null ? `${paxPerBill.toFixed(1)} PAX/bill` : '—';

      lines.push(
        `The main restaurant served ${formatNumber(dineInPax)} Dine-In covers across ${dineInBillsCount} Dine-In bills. ${convText}, with an average spend per diner (APC) of ${apcText} and an average party size of ${partyText}. Total Dine-In sales were ${formatINR(
          dineInNet
        )} Net, ${formatINR(dineInTax)} GST, and ${formatINR(dineInGross)} Gross.`
      );
    } else if (gateFootfall > 0) {
      lines.push(`No Dine-In restaurant covers were recorded for ${formattedDate} (0.0% diner conversion from gate footfall).`);
    } else {
      lines.push(`No Dine-In restaurant covers were recorded for ${formattedDate}.`);
    }

    // Snacks Stall sentence
    if (snacksBillCount > 0) {
      const topItemsStr =
        snacksTopItems.length > 0
          ? `, supported by top items ${snacksTopItems.map((i) => `${i.name} (${i.qty} units)`).join(', ')}`
          : '';
      const abvText = snacksAbv !== null ? formatINR(snacksAbv) : '—';
      lines.push(
        `The Snacks Stall handled ${snacksBillCount} orders, generating ${formatINR(snacksNet)} Net and ${formatINR(
          snacksGross
        )} Gross with an average order value of ${abvText}${topItemsStr}.`
      );
    }

    // Village Attractions sentence
    const actParts: string[] = [];
    if (camelData.totalQty > 0) actParts.push(`Camel Ride: ${camelData.totalQty} rides (${formatINR(camelData.totalGross)})`);
    if (gamesData.totalQty > 0) actParts.push(`Skill Games: ${gamesData.totalQty} tickets (${formatINR(gamesData.totalGross)})`);
    if (mehendiData.totalQty > 0) actParts.push(`Mehendi: ${mehendiData.totalQty} services (${formatINR(mehendiData.totalGross)})`);
    if (champiData.totalQty > 0) actParts.push(`Champi: ${champiData.totalQty} sessions (${formatINR(champiData.totalGross)})`);

    if (actParts.length > 0) {
      lines.push(`Village activity sales logged via Petpooja: ${actParts.join('; ')}.`);
    }

    // Consolidated Total & Pacing sentence
    lines.push(
      `Consolidated estate Gross Sales totaled ${formatINR(consolidatedGross)} across ${totalBillsCount} successful bills.`
    );

    // Factual DoD and WoW comparison
    if (prevDaySummary && Number(prevDaySummary.gross_sales) > 0) {
      const prevGross = Number(prevDaySummary.gross_sales);
      const dodGrossPct = (((consolidatedGross - prevGross) / prevGross) * 100).toFixed(1);
      const dodGrossDir = Number(dodGrossPct) >= 0 ? `+${dodGrossPct}%` : `${dodGrossPct}%`;

      let compStr = `Day-over-day gross sales moved ${dodGrossDir} relative to ${prevDayDate} (${formatINR(prevGross)}).`;
      if (prevDayGate && prevDayGate.total_visitors > 0 && gateFootfall > 0) {
        const pdFootfall = prevDayGate.total_visitors;
        const dodFootPct = (((gateFootfall - pdFootfall) / pdFootfall) * 100).toFixed(1);
        const dodFootDir = Number(dodFootPct) >= 0 ? `+${dodFootPct}%` : `${dodFootPct}%`;
        compStr += ` Gate footfall moved ${dodFootDir} compared to ${prevDayDate} (${formatNumber(pdFootfall)} visitors).`;
      }
      lines.push(compStr);
    }

    if (prevWeekSummary && Number(prevWeekSummary.gross_sales) > 0) {
      const pwGross = Number(prevWeekSummary.gross_sales);
      const wowGrossPct = (((consolidatedGross - pwGross) / pwGross) * 100).toFixed(1);
      const wowGrossDir = Number(wowGrossPct) >= 0 ? `+${wowGrossPct}%` : `${wowGrossPct}%`;
      lines.push(`Week-over-week gross sales moved ${wowGrossDir} compared to same weekday on ${prevWeekDate} (${formatINR(pwGross)}).`);
    }

    return lines.join(' ');
  }, [
    businessDate,
    gateFootfall,
    totalVehicles,
    totalBikes,
    totalCars,
    topVehiclePrefix,
    peakVisitorHour,
    dineInOrders,
    dineInPax,
    dineInBillsCount,
    dinerConversionRate,
    spendPerDiner,
    paxPerBill,
    dineInNet,
    dineInTax,
    dineInGross,
    snacksBillCount,
    snacksNet,
    snacksGross,
    snacksAbv,
    snacksTopItems,
    camelData,
    gamesData,
    mehendiData,
    champiData,
    consolidatedGross,
    totalBillsCount,
    prevDaySummary,
    prevDayGate,
    prevWeekSummary,
    prevDayDate,
    prevWeekDate,
  ]);

  const toggleDrilldown = (type: DrilldownType) => {
    setActiveDrilldown((curr) => (curr === type ? null : type));
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* PAGE HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-amber-600" />
            Management Reports &amp; Intelligence
          </h1>
          <p className="text-xs sm:text-sm text-stone-500">
            Unified executive operational and revenue dashboard backed by single sources of truth.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-white border border-stone-200 rounded-lg px-3 py-1.5 shadow-xs text-xs font-medium">
            <span className="text-stone-500">Business Date:</span>
            <input
              type="date"
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
              className="bg-transparent font-semibold text-stone-900 focus:outline-none cursor-pointer"
            />
          </div>
          <Button variant="outline" size="sm" onClick={loadData} title="Refresh all reports">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-amber-600' : ''}`} />
          </Button>
        </div>
      </div>

      {/* TOP-LEVEL NAVIGATION TABS */}
      <div className="flex border-b border-stone-200 gap-6 text-sm font-semibold overflow-x-auto">
        <button
          onClick={() => setActiveTab('sales')}
          className={`pb-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'sales'
              ? 'border-amber-600 text-amber-600'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          <TrendingUp className="h-4 w-4" />
          Revenue &amp; Operations Intelligence
        </button>
        <button
          onClick={() => setActiveTab('inventory')}
          className={`pb-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'inventory'
              ? 'border-amber-600 text-amber-600'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          <Layers className="h-4 w-4" />
          Store Consumption Ledger
        </button>
        <button
          onClick={() => setActiveTab('vendors')}
          className={`pb-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'vendors'
              ? 'border-amber-600 text-amber-600'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          <ArrowRightLeft className="h-4 w-4" />
          Vendor Outstanding Ledger
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: REVENUE & OPERATIONS INTELLIGENCE                                   */}
      {/* ========================================================================= */}
      {activeTab === 'sales' && (
        <div className="space-y-6">
          {/* Section 1: Consolidated Daily Gross Sales Graph */}
          <DailySalesLineGraph
            selectedDate={businessDate}
            onSelectDate={(date) => setBusinessDate(date)}
          />

          {/* Section 2: Internal Reconciliation Notice Banner */}
          <div>
            {isReconciled ? (
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200/80 rounded-lg p-2.5 text-xs text-emerald-900">
                <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>
                  <strong className="font-semibold">Reconciled:</strong> Consolidated Gross Sales ({formatINR(consolidatedGross)}) matches Orders Master granular revenue streams across all channels for {businessDate}.
                </span>
              </div>
            ) : (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-lg p-3 text-xs text-amber-900">
                <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-amber-900">Petpooja Reconciliation Notice</div>
                  <div className="text-amber-800 mt-0.5">
                    Consolidated Gross ({formatINR(consolidatedGross)}) differs from granular Orders Master total ({formatINR(granularStreamsGrossSum)}) by <strong className="font-mono">{formatINR(reconciliationDifference)}</strong>. Review Petpooja import batches in Daily Sales.
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Section 3: Dynamic Factual Executive Brief */}
          <Card className="border-stone-200/80 shadow-xs bg-linear-to-r from-amber-50/40 to-stone-50/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-stone-900 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-600" />
                Daily Operations &amp; Revenue Executive Brief ({businessDate})
              </CardTitle>
              <CardDescription className="text-xs">
                Authoritative cross-system operational and financial summary
              </CardDescription>
            </CardHeader>
            <CardContent className="text-xs sm:text-sm text-stone-800 leading-relaxed font-normal">
              {loading ? (
                <div className="py-4 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
                  <RefreshCw className="h-4 w-4 animate-spin text-amber-600" /> Generating executive brief...
                </div>
              ) : (
                <p className="whitespace-pre-line">{executiveBrief}</p>
              )}
            </CardContent>
          </Card>

          {/* Section 4: Compact Footfall vs Restaurant Dining Conversion Card Group */}
          <Card className="border-stone-200/80 shadow-xs">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-sm font-bold text-stone-900 flex items-center gap-2">
                  <Users className="h-4 w-4 text-amber-600" />
                  Footfall vs Restaurant Dining Conversion
                </CardTitle>
                <CardDescription className="text-xs">
                  Resort gate entries correlated with POS dining covers for {businessDate}
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowGateDetails(!showGateDetails)}
                className="text-xs gap-1 cursor-pointer"
              >
                <Clock className="h-3.5 w-3.5 text-stone-500" />
                <span>{showGateDetails ? 'Hide Hourly Gate Curve' : 'Show Hourly Gate Curve'}</span>
                {showGateDetails ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </Button>
            </CardHeader>
            <CardContent className="pt-1">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-center">
                <div className="bg-stone-50 p-2.5 rounded-lg border border-stone-200/60">
                  <div className="text-[10px] text-stone-500 font-semibold uppercase tracking-wider">Gate Footfall</div>
                  <div className="text-lg font-bold text-stone-900 mt-0.5">{gateFootfall > 0 ? formatNumber(gateFootfall) : '—'}</div>
                  <div className="text-[10px] text-stone-400">{gateFootfall > 0 ? 'Total persons' : 'No gate data'}</div>
                </div>

                <div className="bg-stone-50 p-2.5 rounded-lg border border-stone-200/60">
                  <div className="text-[10px] text-amber-800 font-semibold uppercase tracking-wider">Restaurant PAX</div>
                  <div className="text-lg font-bold text-amber-700 mt-0.5">{dineInPax > 0 ? formatNumber(dineInPax) : '—'}</div>
                  <div className="text-[10px] text-stone-400">{dineInPax > 0 ? 'Dine-In covers' : 'No covers'}</div>
                </div>

                <div className="bg-stone-50 p-2.5 rounded-lg border border-stone-200/60">
                  <div className="text-[10px] text-emerald-800 font-semibold uppercase tracking-wider">Diner Conversion</div>
                  <div className="text-lg font-bold text-emerald-700 mt-0.5">
                    {dinerConversionRate !== null ? `${dinerConversionRate.toFixed(1)}%` : '—'}
                  </div>
                  <div className="text-[10px] text-stone-400">{dinerConversionRate !== null ? 'PAX ÷ Footfall' : 'No gate data'}</div>
                </div>

                <div className="bg-stone-50 p-2.5 rounded-lg border border-stone-200/60">
                  <div className="text-[10px] text-stone-500 font-semibold uppercase tracking-wider">Spend / Footfall</div>
                  <div className="text-lg font-bold text-stone-900 mt-0.5">
                    {spendPerGateVisitor !== null ? formatINR(spendPerGateVisitor) : '—'}
                  </div>
                  <div className="text-[10px] text-stone-400">{gateFootfall > 0 ? 'Dine-In ÷ Footfall' : 'No gate data'}</div>
                </div>

                <div className="bg-stone-50 p-2.5 rounded-lg border border-stone-200/60">
                  <div className="text-[10px] text-stone-500 font-semibold uppercase tracking-wider">Spend / Diner (APC)</div>
                  <div className="text-lg font-bold text-stone-900 mt-0.5">
                    {spendPerDiner !== null ? formatINR(spendPerDiner) : '—'}
                  </div>
                  <div className="text-[10px] text-stone-400">{dineInPax > 0 ? 'Avg per cover' : 'No covers'}</div>
                </div>

                <div className="bg-stone-50 p-2.5 rounded-lg border border-stone-200/60">
                  <div className="text-[10px] text-stone-500 font-semibold uppercase tracking-wider">Party Size / Bill</div>
                  <div className="text-lg font-bold text-stone-900 mt-0.5">
                    {paxPerBill !== null ? `${paxPerBill.toFixed(1)}` : '—'}
                  </div>
                  <div className="text-[10px] text-stone-400">{dineInBillsCount > 0 ? 'PAX/bill' : 'No bills'}</div>
                </div>
              </div>

              {/* Expandable Gate Counter Time Analytics Chart */}
              {showGateDetails && (
                <div className="mt-4 pt-4 border-t border-stone-200">
                  <GateTimeAnalyticsChart
                    selectedDate={businessDate}
                    onDateChange={(date) => setBusinessDate(date)}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Section 5: Revenue KPI Cards Grid (All 7 Cards Clickable) */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-bold text-stone-900 flex items-center gap-1.5">
                <Receipt className="h-4 w-4 text-amber-600" />
                Revenue Streams &amp; P&amp;L Expenses ({businessDate})
              </h2>
              <span className="text-[11px] text-stone-400">
                Click any card to expand granular Petpooja/hourly drill-downs
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {/* Card 1: Restaurant Net Sales (Strictly Dine-In) */}
              <div
                onClick={() => toggleDrilldown('restaurant')}
                className={`p-3 rounded-lg border transition-all cursor-pointer shadow-2xs ${
                  activeDrilldown === 'restaurant'
                    ? 'border-amber-500 bg-amber-50/60 ring-2 ring-amber-500/20'
                    : 'border-stone-200/80 bg-white hover:border-amber-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">Restaurant Dine-In</span>
                  <Badge variant="outline" className="text-[9px] border-amber-300 bg-amber-50 text-amber-800">
                    {activeDrilldown === 'restaurant' ? 'Open' : 'Drill-Down'}
                  </Badge>
                </div>
                <div className="text-lg font-bold text-amber-800 mt-1">
                  {formatINR(dineInNet)}
                </div>
                <div className="text-[10px] text-stone-500 mt-1 flex justify-between">
                  <span>Gross: {formatINR(dineInGross)}</span>
                  <span>{dineInBillsCount} Dine-In Bills</span>
                </div>
                <div className="text-[10px] text-stone-400 mt-0.5">
                  Covers: {dineInPax} PAX • APC: {spendPerDiner !== null ? formatINR(spendPerDiner) : '—'}
                </div>
              </div>

              {/* Card 2: Snacks Stall */}
              <div
                onClick={() => toggleDrilldown('snacks')}
                className={`p-3 rounded-lg border transition-all cursor-pointer shadow-2xs ${
                  activeDrilldown === 'snacks'
                    ? 'border-amber-500 bg-amber-50/60 ring-2 ring-amber-500/20'
                    : 'border-stone-200/80 bg-white hover:border-amber-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">Snacks Stall</span>
                  <Badge variant="outline" className="text-[9px] border-amber-300 bg-amber-50 text-amber-800">
                    {activeDrilldown === 'snacks' ? 'Open' : 'Drill-Down'}
                  </Badge>
                </div>
                <div className="text-lg font-bold text-stone-900 mt-1">
                  {formatINR(snacksGross)}
                </div>
                <div className="text-[10px] text-stone-500 mt-1 flex justify-between">
                  <span>Net: {formatINR(snacksNet)}</span>
                  <span>Orders: {snacksBillCount}</span>
                </div>
                <div className="text-[10px] text-stone-400 mt-0.5">
                  ABV: {snacksAbv !== null ? formatINR(snacksAbv) : '—'} • Peak 8–10 PM
                </div>
              </div>

              {/* Card 3: Camel Ride */}
              <div
                onClick={() => toggleDrilldown('camel')}
                className={`p-3 rounded-lg border transition-all cursor-pointer shadow-2xs ${
                  activeDrilldown === 'camel'
                    ? 'border-amber-500 bg-amber-50/60 ring-2 ring-amber-500/20'
                    : 'border-stone-200/80 bg-white hover:border-amber-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">Camel Ride</span>
                  <Badge variant="outline" className="text-[9px] border-stone-200 bg-stone-50 text-stone-700">
                    {activeDrilldown === 'camel' ? 'Open' : 'Hourly'}
                  </Badge>
                </div>
                <div className="text-lg font-bold text-stone-900 mt-1">
                  {formatINR(camelData.totalGross)}
                </div>
                <div className="text-[10px] text-stone-500 mt-1 flex justify-between">
                  <span>Rides: {camelData.totalQty}</span>
                  <span>Price: {camelData.abv !== null ? formatINR(camelData.abv) : '—'}</span>
                </div>
                <div className="text-[10px] text-stone-400 mt-0.5">
                  Petpooja POS activity sales
                </div>
              </div>

              {/* Card 4: Skill Games */}
              <div
                onClick={() => toggleDrilldown('games')}
                className={`p-3 rounded-lg border transition-all cursor-pointer shadow-2xs ${
                  activeDrilldown === 'games'
                    ? 'border-amber-500 bg-amber-50/60 ring-2 ring-amber-500/20'
                    : 'border-stone-200/80 bg-white hover:border-amber-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">Skill Games</span>
                  <Badge variant="outline" className="text-[9px] border-stone-200 bg-stone-50 text-stone-700">
                    {activeDrilldown === 'games' ? 'Open' : 'Hourly'}
                  </Badge>
                </div>
                <div className="text-lg font-bold text-stone-900 mt-1">
                  {formatINR(gamesData.totalGross)}
                </div>
                <div className="text-[10px] text-stone-500 mt-1 flex justify-between">
                  <span>Tickets: {gamesData.totalQty}</span>
                  <span>Price: {gamesData.abv !== null ? formatINR(gamesData.abv) : '—'}</span>
                </div>
                <div className="text-[10px] text-stone-400 mt-0.5">
                  Petpooja POS activity sales
                </div>
              </div>

              {/* Card 5: Mehendi */}
              <div
                onClick={() => toggleDrilldown('mehendi')}
                className={`p-3 rounded-lg border transition-all cursor-pointer shadow-2xs ${
                  activeDrilldown === 'mehendi'
                    ? 'border-amber-500 bg-amber-50/60 ring-2 ring-amber-500/20'
                    : 'border-stone-200/80 bg-white hover:border-amber-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">Mehendi</span>
                  <Badge variant="outline" className="text-[9px] border-stone-200 bg-stone-50 text-stone-700">
                    {activeDrilldown === 'mehendi' ? 'Open' : 'Hourly'}
                  </Badge>
                </div>
                <div className="text-lg font-bold text-stone-900 mt-1">
                  {formatINR(mehendiData.totalGross)}
                </div>
                <div className="text-[10px] text-stone-500 mt-1 flex justify-between">
                  <span>Clients: {mehendiData.totalQty}</span>
                  <span>Price: {mehendiData.abv !== null ? formatINR(mehendiData.abv) : '—'}</span>
                </div>
                <div className="text-[10px] text-stone-400 mt-0.5">
                  Petpooja POS activity sales
                </div>
              </div>

              {/* Card 6: Champi Maalish */}
              <div
                onClick={() => toggleDrilldown('champi')}
                className={`p-3 rounded-lg border transition-all cursor-pointer shadow-2xs ${
                  activeDrilldown === 'champi'
                    ? 'border-amber-500 bg-amber-50/60 ring-2 ring-amber-500/20'
                    : 'border-stone-200/80 bg-white hover:border-amber-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">Champi Maalish</span>
                  <Badge variant="outline" className="text-[9px] border-stone-200 bg-stone-50 text-stone-700">
                    {activeDrilldown === 'champi' ? 'Open' : 'Hourly'}
                  </Badge>
                </div>
                <div className="text-lg font-bold text-stone-900 mt-1">
                  {formatINR(champiData.totalGross)}
                </div>
                <div className="text-[10px] text-stone-500 mt-1 flex justify-between">
                  <span>Sessions: {champiData.totalQty}</span>
                  <span>Price: {champiData.abv !== null ? formatINR(champiData.abv) : '—'}</span>
                </div>
                <div className="text-[10px] text-stone-400 mt-0.5">
                  Petpooja POS activity sales
                </div>
              </div>

              {/* Card 7: Total Expenses (Daily P&L) */}
              <Link
                href={`/finance/profitability?date=${businessDate}`}
                className="p-3 rounded-lg border border-stone-200/80 bg-white hover:border-amber-300 hover:bg-stone-50/60 transition-all cursor-pointer shadow-2xs block"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">Daily Expenses</span>
                  <span className="text-[9px] font-semibold text-amber-700 flex items-center gap-0.5">
                    Daily P&amp;L <ExternalLink className="h-2.5 w-2.5" />
                  </span>
                </div>
                <div className={`text-lg font-bold mt-1 ${hasExpensesLogged ? 'text-rose-700' : 'text-stone-400'}`}>
                  {hasExpensesLogged ? formatINR(totalOperationalExpenses) : '—'}
                </div>
                <div className="text-[10px] text-stone-500 mt-1 flex justify-between">
                  {hasExpensesLogged ? (
                    <>
                      <span>Direct: {formatINR(totalDirectVouchers)}</span>
                      <span>Store: {formatINR(totalStoreConsumption)}</span>
                    </>
                  ) : (
                    <span>No logged expenses</span>
                  )}
                </div>
                <div className="text-[10px] text-amber-700 font-medium mt-0.5 flex items-center gap-1">
                  {hasExpensesLogged
                    ? `Utilities: ${formatINR(totalUtilities)} • View P&L →`
                    : 'Click to view full P&L Ledger →'}
                </div>
              </Link>
            </div>
          </div>

          {/* Section 6: Granular Drill-Down Views (Expandable per Clicked Card) */}
          {activeDrilldown && (
            <div className="border border-stone-200 rounded-xl p-4 bg-stone-50/50 shadow-sm space-y-4 animate-in fade-in duration-200">
              <div className="flex items-center justify-between pb-2 border-b border-stone-200">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-stone-900 text-sm">
                    {activeDrilldown === 'restaurant' && 'Restaurant Dine-In POS Analytics & All Bills'}
                    {activeDrilldown === 'snacks' && 'Snacks Stall 5 PM–11 PM Breakdown & Top Items'}
                    {activeDrilldown === 'camel' && 'Camel Ride Activity Hourly Breakdown'}
                    {activeDrilldown === 'games' && 'Skill Games Stall Activity Hourly Breakdown'}
                    {activeDrilldown === 'mehendi' && 'Mehendi Activity Hourly Breakdown'}
                    {activeDrilldown === 'champi' && 'Champi Maalish Activity Hourly Breakdown'}
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {businessDate}
                  </Badge>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setActiveDrilldown(null)} className="h-7 text-xs">
                  Close Drill-Down
                </Button>
              </div>

              {/* 1. RESTAURANT DRILL-DOWN: SalesAnalyticsDashboard with ALL BILLS */}
              {activeDrilldown === 'restaurant' && (
                <div>
                  <SalesAnalyticsDashboard
                    initialDate={businessDate}
                    onDateChange={(d) => setBusinessDate(d)}
                    hideDatePicker={true}
                  />
                </div>
              )}

              {/* 2. SNACKS STALL DRILL-DOWN */}
              {activeDrilldown === 'snacks' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Hourly timeline 5 PM - 11 PM */}
                    <div className="bg-white p-3 rounded-lg border border-stone-200">
                      <h4 className="text-xs font-bold text-stone-900 mb-2 flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-amber-600" />
                        Hourly Sales Breakdown (5 PM – 11 PM)
                      </h4>
                      <div className="space-y-2">
                        {snacksHourly.map((h) => {
                          const maxHourlyGross = Math.max(...snacksHourly.map((x) => x.gross), 100);
                          const pct = (h.gross / maxHourlyGross) * 100;
                          return (
                            <div key={h.hour} className="space-y-0.5">
                              <div className="flex justify-between text-xs font-mono">
                                <span className="text-stone-600 font-sans">{h.label}</span>
                                <span className="font-bold text-stone-900">
                                  {formatINR(h.gross)}{' '}
                                  <span className="text-stone-400 font-normal">({h.count} orders)</span>
                                </span>
                              </div>
                              <div className="w-full bg-stone-100 h-1.5 rounded-full overflow-hidden">
                                <div className="bg-amber-600 h-full rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Top Snacks Items */}
                    <div className="bg-white p-3 rounded-lg border border-stone-200">
                      <h4 className="text-xs font-bold text-stone-900 mb-2 flex items-center gap-1.5">
                        <UtensilsCrossed className="h-3.5 w-3.5 text-amber-600" />
                        Top Street Food &amp; Snack Items
                      </h4>
                      {snacksTopItems.length === 0 ? (
                        <div className="py-6 text-center text-stone-400 text-xs">No snack items logged for this date.</div>
                      ) : (
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-stone-200 text-stone-500 text-[10px]">
                              <th className="pb-1.5">Item Name</th>
                              <th className="pb-1.5 text-center">Units Sold</th>
                              <th className="pb-1.5 text-right">Net Sales</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-stone-100">
                            {snacksTopItems.map((item, idx) => (
                              <tr key={item.name} className="hover:bg-stone-50/60">
                                <td className="py-1.5 font-medium text-stone-900 flex items-center gap-1.5">
                                  <span className="w-4 h-4 rounded-full bg-stone-100 text-stone-600 flex items-center justify-center text-[9px] font-bold">
                                    {idx + 1}
                                  </span>
                                  {item.name}
                                </td>
                                <td className="py-1.5 text-center font-bold text-stone-700">{item.qty}</td>
                                <td className="py-1.5 text-right font-mono font-bold text-amber-800">{formatINR(item.net)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* 3, 4, 5, 6. ATTRACTION HOURLY DRILL-DOWNS */}
              {['camel', 'games', 'mehendi', 'champi'].includes(activeDrilldown) && (() => {
                const act =
                  activeDrilldown === 'camel'
                    ? camelData
                    : activeDrilldown === 'games'
                    ? gamesData
                    : activeDrilldown === 'mehendi'
                    ? mehendiData
                    : champiData;

                return (
                  <div className="bg-white p-4 rounded-lg border border-stone-200 space-y-3">
                    <div className="flex flex-wrap items-center justify-between text-xs pb-2 border-b border-stone-100 gap-3">
                      <div>
                        <span className="text-stone-500">Total Units / Tickets:</span>{' '}
                        <strong className="text-stone-900 font-bold">{act.totalQty}</strong>
                      </div>
                      <div>
                        <span className="text-stone-500">Average Price / Ticket:</span>{' '}
                        <strong className="text-stone-900 font-bold">{act.abv !== null ? formatINR(act.abv) : '—'}</strong>
                      </div>
                      <div>
                        <span className="text-stone-500">Total Gross Revenue:</span>{' '}
                        <strong className="text-amber-800 font-bold text-sm">{formatINR(act.totalGross)}</strong>
                      </div>
                    </div>

                    {act.hourlyData.length === 0 || act.totalQty === 0 ? (
                      <div className="py-8 text-center text-stone-400 text-xs">
                        No activity transactions logged in Petpooja for this date.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <h5 className="text-xs font-semibold text-stone-700">Hourly Distribution (Petpooja Hourly Items)</h5>
                        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                          {act.hourlyData.map((pt) => (
                            <div key={pt.hour} className="p-2 bg-stone-50 rounded border border-stone-200 text-center">
                              <div className="text-[10px] text-stone-500 font-medium">{pt.label}</div>
                              <div className="text-sm font-bold text-stone-900 mt-0.5">{pt.qty} sold</div>
                              <div className="text-[10px] text-amber-800 font-mono font-semibold">{formatINR(pt.amount)}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {/* Section 7: Daily Operating Surplus Flash Report */}
          <Card className="border-stone-200/80 shadow-xs">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-sm font-bold text-stone-900">
                  Daily Operating Surplus Flash Report
                </CardTitle>
                <CardDescription className="text-xs">
                  Financial reconciliation of revenue against store consumption and operating expenses for {businessDate}
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportCSV([dailyData || {}], 'daily-operations-report')}
                className="gap-1.5 text-xs"
              >
                <Download className="h-3.5 w-3.5" /> Export CSV
              </Button>
            </CardHeader>
            <CardContent className="pt-0 text-xs sm:text-sm space-y-3">
              {loading ? (
                <div className="py-10 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
                  <RefreshCw className="h-4 w-4 animate-spin text-amber-600" /> Loading financial surplus...
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                  <div className="p-3 bg-stone-50 rounded-lg border border-stone-200/60">
                    <div className="text-[11px] text-stone-500 font-medium">Net Sales (POS)</div>
                    <div className="text-lg font-bold text-stone-900 mt-0.5">
                      {formatINR(consolidatedNet)}
                    </div>
                  </div>
                  <div className="p-3 bg-stone-50 rounded-lg border border-stone-200/60">
                    <div className="text-[11px] text-stone-500 font-medium">Store Consumption</div>
                    <div className="text-lg font-bold text-stone-900 mt-0.5">
                      {totalStoreConsumption > 0 ? formatINR(totalStoreConsumption) : '—'}
                    </div>
                  </div>
                  <div className="p-3 bg-stone-50 rounded-lg border border-stone-200/60">
                    <div className="text-[11px] text-stone-500 font-medium">Direct &amp; Utilities</div>
                    <div className="text-lg font-bold text-stone-900 mt-0.5">
                      {(totalDirectVouchers + totalUtilities) > 0 ? formatINR(totalDirectVouchers + totalUtilities) : '—'}
                    </div>
                  </div>
                  <div className="p-3 bg-amber-50/60 rounded-lg border border-amber-200/80">
                    <div className="text-[11px] text-amber-800 font-bold">Gross Operating Surplus</div>
                    <div className="text-lg font-bold text-amber-900 mt-0.5">
                      {hasExpensesLogged || consolidatedNet > 0
                        ? formatINR(consolidatedNet - totalOperationalExpenses)
                        : '—'}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: STORE CONSUMPTION LEDGER                                           */}
      {/* ========================================================================= */}
      {activeTab === 'inventory' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Kitchen Store Issue Movements ({businessDate})</CardTitle>
              <CardDescription>Line-by-line consumption attributed to kitchen &amp; chef</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportCSV(inventoryMovements, 'store-consumption')}
              className="gap-1.5 text-xs"
            >
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="py-12 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-amber-600" /> Loading store consumption...
              </div>
            ) : inventoryMovements.length === 0 ? (
              <div className="py-12 text-center text-stone-400 text-xs">No inventory movements logged for {businessDate}.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                      <th className="py-2.5 px-3">Time</th>
                      <th className="py-2.5 px-3">Item SKU</th>
                      <th className="py-2.5 px-3">Kitchen / Section</th>
                      <th className="py-2.5 px-3">Chef</th>
                      <th className="py-2.5 px-3">Purpose</th>
                      <th className="py-2.5 px-3 text-right">Quantity</th>
                      <th className="py-2.5 px-3 text-right">WAC Rate</th>
                      <th className="py-2.5 px-3 text-right">Valuation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {inventoryMovements.map((m) => (
                      <tr key={m.id} className="hover:bg-stone-50/80">
                        <td className="py-2 px-3 text-stone-500 font-mono">
                          {new Date(m.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })}
                        </td>
                        <td className="py-2 px-3 font-semibold text-stone-900">{m.item?.name}</td>
                        <td className="py-2 px-3 text-stone-600">{m.department?.name || 'Central Store'}</td>
                        <td className="py-2 px-3 text-stone-600">{m.responsible_person?.name || '—'}</td>
                        <td className="py-2 px-3">
                          <Badge variant={m.purpose === 'Customer Food' ? 'success' : m.purpose === 'Staff Food' ? 'info' : 'warning'}>
                            {m.purpose}
                          </Badge>
                        </td>
                        <td className="py-2 px-3 text-right font-bold text-stone-900">
                          {m.quantity} {m.item?.unit?.symbol}
                        </td>
                        <td className="py-2 px-3 text-right text-stone-700">{formatINR(Number(m.unit_cost || 0))}</td>
                        <td className="py-2 px-3 text-right font-bold text-stone-900">{formatINR(Number(m.total_value || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: VENDOR OUTSTANDING LEDGER                                          */}
      {/* ========================================================================= */}
      {activeTab === 'vendors' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Vendor Accounts Summary</CardTitle>
              <CardDescription>Authoritative balances derived from invoices and payment allocations</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportCSV(vendors, 'vendor-ledger')}
              className="gap-1.5 text-xs"
            >
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="py-12 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-amber-600" /> Loading vendor accounts...
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                      <th className="py-2.5 px-3">Supplier</th>
                      <th className="py-2.5 px-3">Contact</th>
                      <th className="py-2.5 px-3 text-right">Total Invoiced</th>
                      <th className="py-2.5 px-3 text-right">Total Settled</th>
                      <th className="py-2.5 px-3 text-right">Net Due</th>
                      <th className="py-2.5 px-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {vendors.map((v) => {
                      const out = Number(v.outstanding_balance) || 0;
                      return (
                        <tr key={v.vendor_id} className="hover:bg-stone-50/80">
                          <td className="py-3 px-3 font-semibold text-stone-900">{v.vendor_name}</td>
                          <td className="py-3 px-3 text-stone-600">
                            {v.contact_person} {v.phone && `(${v.phone})`}
                          </td>
                          <td className="py-3 px-3 text-right font-medium text-stone-800">{formatINR(Number(v.total_purchased || 0))}</td>
                          <td className="py-3 px-3 text-right font-medium text-emerald-700">{formatINR(Number(v.total_paid || 0))}</td>
                          <td className="py-3 px-3 text-right font-bold text-rose-600">{formatINR(out)}</td>
                          <td className="py-3 px-3 text-center">
                            {out <= 0 ? <Badge variant="success">Settled</Badge> : <Badge variant="danger">Due</Badge>}
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
      )}
    </div>
  );
}
