'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR, getTodayBusinessDate, formatNumber, formatDisplayDate } from '@/lib/utils';
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
  // Expand full executive narrative in Daily Operations Summary
  const [showFullExecutiveSummary, setShowFullExecutiveSummary] = useState(false);

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
    execSummary?.net_sales ?? salesSummary?.net_sales ?? 0
  );
  const totalBillsCount = Number(
    execSummary?.successful_bills_count ?? salesSummary?.bill_count ?? orders.filter((o) => o.status === 'Success').length ?? 0
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

    // Date formatting (prominent long format: e.g. 20 September 2026)
    const formattedDate = formatDisplayDate(businessDate, 'long');

    // Zero-data case: neither gate nor sales logged
    if (gateFootfall === 0 && consolidatedGross === 0) {
      return `On ${formattedDate}, no resort gate footfall or restaurant sales were logged in the system.`;
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
    if (mehendiData.totalQty > 0) actParts.push(`Mehendi: ${mehendiData.totalQty} clients (${formatINR(mehendiData.totalGross)})`);
    if (champiData.totalQty > 0) actParts.push(`Champi: ${champiData.totalQty} sessions (${formatINR(champiData.totalGross)})`);

    if (actParts.length > 0) {
      lines.push(`Village activity sales: ${actParts.join('; ')}.`);
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

      let compStr = `Day-over-day gross sales moved ${dodGrossDir} relative to ${formatDisplayDate(prevDayDate, 'short')} (${formatINR(prevGross)}).`;
      if (prevDayGate && prevDayGate.total_visitors > 0 && gateFootfall > 0) {
        const pdFootfall = prevDayGate.total_visitors;
        const dodFootPct = (((gateFootfall - pdFootfall) / pdFootfall) * 100).toFixed(1);
        const dodFootDir = Number(dodFootPct) >= 0 ? `+${dodFootPct}%` : `${dodFootPct}%`;
        compStr += ` Gate footfall moved ${dodFootDir} compared to ${formatDisplayDate(prevDayDate, 'short')} (${formatNumber(pdFootfall)} visitors).`;
      }
      lines.push(compStr);
    }

    if (prevWeekSummary && Number(prevWeekSummary.gross_sales) > 0) {
      const pwGross = Number(prevWeekSummary.gross_sales);
      const wowGrossPct = (((consolidatedGross - pwGross) / pwGross) * 100).toFixed(1);
      const wowGrossDir = Number(wowGrossPct) >= 0 ? `+${wowGrossPct}%` : `${wowGrossPct}%`;
      lines.push(`Week-over-week gross sales moved ${wowGrossDir} compared to same weekday on ${formatDisplayDate(prevWeekDate, 'short')} (${formatINR(pwGross)}).`);
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

  // Dynamic compact highlight metrics for Daily Operations Summary
  const executiveHighlights = useMemo(() => {
    const items: { label: string; value: string; sub?: string }[] = [];
    if (gateFootfall > 0) {
      items.push({ label: 'Visitors', value: formatNumber(gateFootfall), sub: 'Gate footfall' });
    }
    if (dineInPax > 0) {
      items.push({ label: 'Restaurant', value: `${formatNumber(dineInPax)} Covers`, sub: `${dineInBillsCount} bills` });
    }
    if (dinerConversionRate !== null && dinerConversionRate > 0) {
      items.push({ label: 'Conversion', value: `${dinerConversionRate.toFixed(1)}%`, sub: 'PAX ÷ footfall' });
    }
    if (spendPerDiner !== null && spendPerDiner > 0) {
      items.push({ label: 'APC', value: formatINR(spendPerDiner), sub: 'Spend / cover' });
    }
    if (peakVisitorHour?.label) {
      items.push({ label: 'Peak Period', value: peakVisitorHour.label, sub: `${peakVisitorHour.count || 0} entries` });
    }
    if (dineInNet > 0) {
      items.push({ label: 'Restaurant Net', value: formatINR(dineInNet, true), sub: 'Net Sales' });
    }
    if (snacksGross > 0) {
      items.push({ label: 'Snacks Stall', value: formatINR(snacksGross, true), sub: `${snacksBillCount} orders` });
    }
    const actTotal = camelData.totalGross + gamesData.totalGross + mehendiData.totalGross + champiData.totalGross;
    if (actTotal > 0) {
      items.push({ label: 'Attractions', value: formatINR(actTotal, true), sub: 'Gross Sales' });
    }
    return items;
  }, [
    gateFootfall,
    dineInPax,
    dineInBillsCount,
    dinerConversionRate,
    spendPerDiner,
    peakVisitorHour,
    dineInNet,
    snacksGross,
    snacksBillCount,
    camelData,
    gamesData,
    mehendiData,
    champiData,
  ]);

  const toggleDrilldown = (type: DrilldownType) => {
    setActiveDrilldown((curr) => (curr === type ? null : type));
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* PAGE HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#6B162E] flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-[#6B162E]" />
            Management Reports &amp; Intelligence
          </h1>
          <p className="text-xs sm:text-sm text-stone-500 mt-0.5">
            Unified operational and revenue performance dashboard across all estate channels.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-2 bg-white border border-[#E7E2D8] rounded-xl px-3 py-1.5 shadow-xs text-xs font-medium">
            <span className="text-stone-500">Business Date:</span>
            <input
              type="date"
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
              className="bg-transparent font-semibold text-stone-900 focus:outline-none cursor-pointer"
            />
          </div>
          <Button variant="outline" size="sm" onClick={loadData} title="Refresh all reports" className="rounded-xl border-[#E7E2D8]">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-[#6B162E]' : 'text-stone-600'}`} />
          </Button>
        </div>
      </div>

      {/* TOP-LEVEL NAVIGATION TABS */}
      <div className="flex border-b border-[#E7E2D8] gap-6 text-sm font-semibold overflow-x-auto">
        <button
          onClick={() => setActiveTab('sales')}
          className={`pb-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'sales'
              ? 'border-[#6B162E] text-[#6B162E]'
              : 'border-transparent text-stone-500 hover:text-stone-800'
          }`}
        >
          <TrendingUp className="h-4 w-4" />
          Revenue &amp; Operations Intelligence
        </button>
        <button
          onClick={() => setActiveTab('inventory')}
          className={`pb-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'inventory'
              ? 'border-[#6B162E] text-[#6B162E]'
              : 'border-transparent text-stone-500 hover:text-stone-800'
          }`}
        >
          <Layers className="h-4 w-4" />
          Store Consumption Ledger
        </button>
        <button
          onClick={() => setActiveTab('vendors')}
          className={`pb-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'vendors'
              ? 'border-[#6B162E] text-[#6B162E]'
              : 'border-transparent text-stone-500 hover:text-stone-800'
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
              <div className="flex items-center gap-2 bg-emerald-50/80 border border-emerald-200/80 rounded-xl p-3 text-xs text-emerald-900">
                <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>
                  <strong className="font-semibold">Reconciled:</strong> Consolidated Gross Sales ({formatINR(consolidatedGross)}) matches all granular sales channels for {formatDisplayDate(businessDate, 'short')}.
                </span>
              </div>
            ) : (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-xl p-3 text-xs text-amber-900">
                <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-amber-900">Sales Reconciliation Notice</div>
                  <div className="text-amber-800 mt-0.5">
                    Consolidated Gross ({formatINR(consolidatedGross)}) differs from granular channel bills total ({formatINR(granularStreamsGrossSum)}) by <strong className="font-mono">{formatINR(reconciliationDifference)}</strong>. Review Daily Sales batches.
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Section 3: Dynamic Management Operations Summary */}
          <Card className="border-[#E7E2D8] shadow-xs bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-bold text-stone-900 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-[#6B162E]" />
                  Daily Operations Summary
                </CardTitle>
                <Badge variant="outline" className="text-[10px] font-medium border-[#E7E2D8]">
                  {formatDisplayDate(businessDate, 'short')}
                </Badge>
              </div>
              <CardDescription className="text-xs text-stone-500">
                Unified operational and financial performance overview
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-1">
              {loading ? (
                <div className="py-4 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
                  <RefreshCw className="h-4 w-4 animate-spin text-[#6B162E]" /> Loading operational summary...
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Dynamic compact highlight metrics row */}
                  {executiveHighlights.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                      {executiveHighlights.map((item, idx) => (
                        <div key={idx} className="p-2.5 rounded-xl bg-[#FAF8F5] border border-[#E7E2D8]">
                          <div className="text-[10px] text-stone-500 font-semibold uppercase tracking-wider">{item.label}</div>
                          <div className="text-sm sm:text-base font-bold text-stone-900 tabular-nums mt-0.5">{item.value}</div>
                          {item.sub && <div className="text-[10px] text-stone-400 mt-0.5 truncate">{item.sub}</div>}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Expandable narrative toggle */}
                  <div className="flex items-center justify-between pt-2 border-t border-[#F0ECE3]">
                    <button
                      type="button"
                      onClick={() => setShowFullExecutiveSummary(!showFullExecutiveSummary)}
                      className="text-xs font-semibold text-[#6B162E] hover:text-[#521123] flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <span>{showFullExecutiveSummary ? 'Hide summary' : 'View full summary'}</span>
                      {showFullExecutiveSummary ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                    <span className="text-[11px] text-stone-400 hidden sm:inline">
                      Factual cross-system daily analysis
                    </span>
                  </div>

                  {showFullExecutiveSummary && (
                    <div className="text-xs sm:text-sm text-stone-700 leading-relaxed font-normal bg-[#FAF8F5] p-3.5 rounded-xl border border-[#E7E2D8] animate-in fade-in duration-200">
                      <p className="whitespace-pre-line">{executiveBrief}</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Section 4: Compact Footfall vs Restaurant Dining Conversion Card Group */}
          <Card className="border-[#E7E2D8] shadow-xs bg-white">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-sm font-bold text-stone-900 flex items-center gap-2">
                  <Users className="h-4 w-4 text-[#6B162E]" />
                  Footfall vs Restaurant Dining Conversion
                </CardTitle>
                <CardDescription className="text-xs text-stone-500">
                  Resort gate entries correlated with POS dining covers for {formatDisplayDate(businessDate, 'short')}
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowGateDetails(!showGateDetails)}
                className="text-xs gap-1 cursor-pointer rounded-xl border-[#E7E2D8]"
              >
                <Clock className="h-3.5 w-3.5 text-stone-500" />
                <span>{showGateDetails ? 'Hide Hourly Gate Curve' : 'Show Hourly Gate Curve'}</span>
                {showGateDetails ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </Button>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-center">
                <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#E7E2D8]">
                  <div className="text-[10px] text-stone-500 font-semibold uppercase tracking-wider">Gate Footfall</div>
                  <div className="text-xl font-bold text-stone-900 tabular-nums mt-0.5">{gateFootfall > 0 ? formatNumber(gateFootfall) : '—'}</div>
                  <div className="text-[10px] text-stone-400 mt-0.5">{gateFootfall > 0 ? 'Total persons entered' : 'No gate data'}</div>
                </div>

                <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#E7E2D8]">
                  <div className="text-[10px] text-[#6B162E] font-semibold uppercase tracking-wider">Restaurant PAX</div>
                  <div className="text-xl font-bold text-[#6B162E] tabular-nums mt-0.5">{dineInPax > 0 ? formatNumber(dineInPax) : '—'}</div>
                  <div className="text-[10px] text-stone-500 mt-0.5">{dineInPax > 0 ? 'Dine-in covers' : 'No covers'}</div>
                </div>

                <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#E7E2D8]">
                  <div className="text-[10px] text-emerald-800 font-semibold uppercase tracking-wider">Diner Conversion</div>
                  <div className="text-xl font-bold text-emerald-700 tabular-nums mt-0.5">
                    {dinerConversionRate !== null ? `${dinerConversionRate.toFixed(1)}%` : '—'}
                  </div>
                  <div className="text-[10px] text-stone-500 mt-0.5">{dinerConversionRate !== null ? 'PAX ÷ footfall' : 'No gate data'}</div>
                </div>

                <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#E7E2D8]">
                  <div className="text-[10px] text-stone-500 font-semibold uppercase tracking-wider">Spend / Footfall</div>
                  <div className="text-xl font-bold text-stone-900 tabular-nums mt-0.5">
                    {spendPerGateVisitor !== null ? formatINR(spendPerGateVisitor) : '—'}
                  </div>
                  <div className="text-[10px] text-stone-400 mt-0.5">{gateFootfall > 0 ? 'Net sales ÷ visitor' : 'No gate data'}</div>
                </div>

                <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#E7E2D8]">
                  <div className="text-[10px] text-stone-500 font-semibold uppercase tracking-wider">Spend / Diner</div>
                  <div className="text-xl font-bold text-stone-900 tabular-nums mt-0.5">
                    {spendPerDiner !== null ? formatINR(spendPerDiner) : '—'}
                  </div>
                  <div className="text-[10px] text-stone-400 mt-0.5">{dineInPax > 0 ? 'Average per cover' : 'No covers'}</div>
                </div>

                <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#E7E2D8]">
                  <div className="text-[10px] text-stone-500 font-semibold uppercase tracking-wider">Party Size / Bill</div>
                  <div className="text-xl font-bold text-stone-900 tabular-nums mt-0.5">
                    {paxPerBill !== null ? `${paxPerBill.toFixed(1)}` : '—'}
                  </div>
                  <div className="text-[10px] text-stone-400 mt-0.5">{dineInBillsCount > 0 ? 'Covers per bill' : 'No bills'}</div>
                </div>
              </div>

              {/* Expandable Gate Counter Time Analytics Chart */}
              {showGateDetails && (
                <div className="mt-4 pt-4 border-t border-[#E7E2D8]">
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
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-sm font-bold text-stone-900 flex items-center gap-1.5">
                <Receipt className="h-4 w-4 text-[#6B162E]" />
                Revenue Streams &amp; P&amp;L Expenses ({formatDisplayDate(businessDate, 'short')})
              </h2>
              <span className="text-[11px] text-stone-500">
                Click a card to view details
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {/* Card 1: Restaurant Net Sales (Strictly Dine-In) */}
              <div
                onClick={() => toggleDrilldown('restaurant')}
                className={`relative p-3.5 rounded-xl border transition-all cursor-pointer shadow-xs overflow-hidden ${
                  activeDrilldown === 'restaurant'
                    ? 'border-amber-500 bg-[#FFFDF7] ring-2 ring-amber-500/20'
                    : 'border-[#E7E2D8] bg-white hover:border-amber-300/80 hover:bg-[#FAF8F5]/50'
                }`}
              >
                {activeDrilldown === 'restaurant' && (
                  <div className="absolute top-0 left-0 right-0 h-1 bg-amber-500" />
                )}
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold text-stone-800 tracking-tight">Restaurant Dine-In</span>
                  <Badge
                    variant={activeDrilldown === 'restaurant' ? 'warning' : 'outline'}
                    className="text-[9px] px-1.5 py-0.5"
                  >
                    View Details
                  </Badge>
                </div>
                <div className="mt-2">
                  <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider">Net Sales</div>
                  <div className="text-xl font-bold tracking-tight text-[#6B162E] tabular-nums mt-0.5">
                    {formatINR(dineInNet)}
                  </div>
                </div>
                <div className="text-[11px] text-stone-600 mt-2 flex justify-between items-center border-t border-[#F0ECE3] pt-1.5">
                  <span>Gross Sales {formatINR(dineInGross)}</span>
                  <span className="font-medium text-stone-700">{dineInBillsCount} Dine-In Bills</span>
                </div>
                <div className="text-[10px] text-stone-500 mt-0.5">
                  {dineInPax} Covers • APC {spendPerDiner !== null ? formatINR(spendPerDiner) : '—'}
                </div>
              </div>

              {/* Card 2: Snacks Stall */}
              <div
                onClick={() => toggleDrilldown('snacks')}
                className={`relative p-3.5 rounded-xl border transition-all cursor-pointer shadow-xs overflow-hidden ${
                  activeDrilldown === 'snacks'
                    ? 'border-amber-500 bg-[#FFFDF7] ring-2 ring-amber-500/20'
                    : 'border-[#E7E2D8] bg-white hover:border-amber-300/80 hover:bg-[#FAF8F5]/50'
                }`}
              >
                {activeDrilldown === 'snacks' && (
                  <div className="absolute top-0 left-0 right-0 h-1 bg-amber-500" />
                )}
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold text-stone-800 tracking-tight">Snacks Stall</span>
                  <Badge
                    variant={activeDrilldown === 'snacks' ? 'warning' : 'outline'}
                    className="text-[9px] px-1.5 py-0.5"
                  >
                    View Details
                  </Badge>
                </div>
                <div className="mt-2">
                  <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider">Gross Sales</div>
                  <div className="text-xl font-bold tracking-tight text-stone-900 tabular-nums mt-0.5">
                    {formatINR(snacksGross)}
                  </div>
                </div>
                <div className="text-[11px] text-stone-600 mt-2 flex justify-between items-center border-t border-[#F0ECE3] pt-1.5">
                  <span>Net Sales {formatINR(snacksNet)}</span>
                  <span className="font-medium text-stone-700">{snacksBillCount} Orders</span>
                </div>
                <div className="text-[10px] text-stone-500 mt-0.5">
                  ABV {snacksAbv !== null ? formatINR(snacksAbv) : '—'} • Peak 8–10 PM
                </div>
              </div>

              {/* Card 3: Camel Ride */}
              <div
                onClick={() => toggleDrilldown('camel')}
                className={`relative p-3.5 rounded-xl border transition-all cursor-pointer shadow-xs overflow-hidden ${
                  activeDrilldown === 'camel'
                    ? 'border-amber-500 bg-[#FFFDF7] ring-2 ring-amber-500/20'
                    : 'border-[#E7E2D8] bg-white hover:border-amber-300/80 hover:bg-[#FAF8F5]/50'
                }`}
              >
                {activeDrilldown === 'camel' && (
                  <div className="absolute top-0 left-0 right-0 h-1 bg-amber-500" />
                )}
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold text-stone-800 tracking-tight">Camel Ride</span>
                  <Badge
                    variant={activeDrilldown === 'camel' ? 'warning' : 'outline'}
                    className="text-[9px] px-1.5 py-0.5"
                  >
                    View Details
                  </Badge>
                </div>
                {camelData.totalQty > 0 ? (
                  <>
                    <div className="mt-2">
                      <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider">Gross Sales</div>
                      <div className="text-xl font-bold tracking-tight text-stone-900 tabular-nums mt-0.5">
                        {formatINR(camelData.totalGross)}
                      </div>
                    </div>
                    <div className="text-[11px] text-stone-600 mt-2 flex justify-between items-center border-t border-[#F0ECE3] pt-1.5">
                      <span>Rides: {camelData.totalQty}</span>
                      <span className="font-medium text-stone-700">Rate: {camelData.abv !== null ? formatINR(camelData.abv) : '—'}</span>
                    </div>
                    <div className="text-[10px] text-stone-500 mt-0.5">
                      Activity Sales
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mt-2">
                      <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">Activity Status</div>
                      <div className="text-lg font-semibold text-stone-400 mt-0.5">
                        No Activity
                      </div>
                    </div>
                    <div className="text-[11px] text-stone-400 mt-2 border-t border-[#F0ECE3] pt-1.5">
                      No transactions recorded
                    </div>
                    <div className="text-[10px] text-stone-400 mt-0.5">
                      Activity Sales
                    </div>
                  </>
                )}
              </div>

              {/* Card 4: Skill Games */}
              <div
                onClick={() => toggleDrilldown('games')}
                className={`relative p-3.5 rounded-xl border transition-all cursor-pointer shadow-xs overflow-hidden ${
                  activeDrilldown === 'games'
                    ? 'border-amber-500 bg-[#FFFDF7] ring-2 ring-amber-500/20'
                    : 'border-[#E7E2D8] bg-white hover:border-amber-300/80 hover:bg-[#FAF8F5]/50'
                }`}
              >
                {activeDrilldown === 'games' && (
                  <div className="absolute top-0 left-0 right-0 h-1 bg-amber-500" />
                )}
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold text-stone-800 tracking-tight">Skill Games</span>
                  <Badge
                    variant={activeDrilldown === 'games' ? 'warning' : 'outline'}
                    className="text-[9px] px-1.5 py-0.5"
                  >
                    View Details
                  </Badge>
                </div>
                {gamesData.totalQty > 0 ? (
                  <>
                    <div className="mt-2">
                      <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider">Gross Sales</div>
                      <div className="text-xl font-bold tracking-tight text-stone-900 tabular-nums mt-0.5">
                        {formatINR(gamesData.totalGross)}
                      </div>
                    </div>
                    <div className="text-[11px] text-stone-600 mt-2 flex justify-between items-center border-t border-[#F0ECE3] pt-1.5">
                      <span>Tickets: {gamesData.totalQty}</span>
                      <span className="font-medium text-stone-700">Rate: {gamesData.abv !== null ? formatINR(gamesData.abv) : '—'}</span>
                    </div>
                    <div className="text-[10px] text-stone-500 mt-0.5">
                      Activity Sales
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mt-2">
                      <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">Activity Status</div>
                      <div className="text-lg font-semibold text-stone-400 mt-0.5">
                        No Activity
                      </div>
                    </div>
                    <div className="text-[11px] text-stone-400 mt-2 border-t border-[#F0ECE3] pt-1.5">
                      No transactions recorded
                    </div>
                    <div className="text-[10px] text-stone-400 mt-0.5">
                      Activity Sales
                    </div>
                  </>
                )}
              </div>

              {/* Card 5: Mehendi */}
              <div
                onClick={() => toggleDrilldown('mehendi')}
                className={`relative p-3.5 rounded-xl border transition-all cursor-pointer shadow-xs overflow-hidden ${
                  activeDrilldown === 'mehendi'
                    ? 'border-amber-500 bg-[#FFFDF7] ring-2 ring-amber-500/20'
                    : 'border-[#E7E2D8] bg-white hover:border-amber-300/80 hover:bg-[#FAF8F5]/50'
                }`}
              >
                {activeDrilldown === 'mehendi' && (
                  <div className="absolute top-0 left-0 right-0 h-1 bg-amber-500" />
                )}
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold text-stone-800 tracking-tight">Mehendi</span>
                  <Badge
                    variant={activeDrilldown === 'mehendi' ? 'warning' : 'outline'}
                    className="text-[9px] px-1.5 py-0.5"
                  >
                    View Details
                  </Badge>
                </div>
                {mehendiData.totalQty > 0 ? (
                  <>
                    <div className="mt-2">
                      <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider">Gross Sales</div>
                      <div className="text-xl font-bold tracking-tight text-stone-900 tabular-nums mt-0.5">
                        {formatINR(mehendiData.totalGross)}
                      </div>
                    </div>
                    <div className="text-[11px] text-stone-600 mt-2 flex justify-between items-center border-t border-[#F0ECE3] pt-1.5">
                      <span>Clients: {mehendiData.totalQty}</span>
                      <span className="font-medium text-stone-700">Rate: {mehendiData.abv !== null ? formatINR(mehendiData.abv) : '—'}</span>
                    </div>
                    <div className="text-[10px] text-stone-500 mt-0.5">
                      Activity Sales
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mt-2">
                      <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">Activity Status</div>
                      <div className="text-lg font-semibold text-stone-400 mt-0.5">
                        No Activity
                      </div>
                    </div>
                    <div className="text-[11px] text-stone-400 mt-2 border-t border-[#F0ECE3] pt-1.5">
                      No transactions recorded
                    </div>
                    <div className="text-[10px] text-stone-400 mt-0.5">
                      Activity Sales
                    </div>
                  </>
                )}
              </div>

              {/* Card 6: Champi Maalish */}
              <div
                onClick={() => toggleDrilldown('champi')}
                className={`relative p-3.5 rounded-xl border transition-all cursor-pointer shadow-xs overflow-hidden ${
                  activeDrilldown === 'champi'
                    ? 'border-amber-500 bg-[#FFFDF7] ring-2 ring-amber-500/20'
                    : 'border-[#E7E2D8] bg-white hover:border-amber-300/80 hover:bg-[#FAF8F5]/50'
                }`}
              >
                {activeDrilldown === 'champi' && (
                  <div className="absolute top-0 left-0 right-0 h-1 bg-amber-500" />
                )}
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold text-stone-800 tracking-tight">Champi Maalish</span>
                  <Badge
                    variant={activeDrilldown === 'champi' ? 'warning' : 'outline'}
                    className="text-[9px] px-1.5 py-0.5"
                  >
                    View Details
                  </Badge>
                </div>
                {champiData.totalQty > 0 ? (
                  <>
                    <div className="mt-2">
                      <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider">Gross Sales</div>
                      <div className="text-xl font-bold tracking-tight text-stone-900 tabular-nums mt-0.5">
                        {formatINR(champiData.totalGross)}
                      </div>
                    </div>
                    <div className="text-[11px] text-stone-600 mt-2 flex justify-between items-center border-t border-[#F0ECE3] pt-1.5">
                      <span>Sessions: {champiData.totalQty}</span>
                      <span className="font-medium text-stone-700">Rate: {champiData.abv !== null ? formatINR(champiData.abv) : '—'}</span>
                    </div>
                    <div className="text-[10px] text-stone-500 mt-0.5">
                      Activity Sales
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mt-2">
                      <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">Activity Status</div>
                      <div className="text-lg font-semibold text-stone-400 mt-0.5">
                        No Activity
                      </div>
                    </div>
                    <div className="text-[11px] text-stone-400 mt-2 border-t border-[#F0ECE3] pt-1.5">
                      No transactions recorded
                    </div>
                    <div className="text-[10px] text-stone-400 mt-0.5">
                      Activity Sales
                    </div>
                  </>
                )}
              </div>

              {/* Card 7: Total Expenses (Daily P&L) */}
              <Link
                href={`/finance/profitability?date=${businessDate}`}
                className="relative p-3.5 rounded-xl border border-[#E7E2D8] bg-white hover:border-amber-400/80 hover:bg-[#FAF8F5]/50 transition-all cursor-pointer shadow-xs block"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold text-stone-800 tracking-tight">Daily Expenses</span>
                  <span className="text-[10px] font-semibold text-[#6B162E] flex items-center gap-0.5">
                    View P&amp;L →
                  </span>
                </div>
                <div className="mt-2">
                  <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider">Total Expenses</div>
                  <div className={`text-xl font-bold tracking-tight mt-0.5 tabular-nums ${hasExpensesLogged ? 'text-[#6B162E]' : 'text-stone-400'}`}>
                    {hasExpensesLogged ? formatINR(totalOperationalExpenses) : '—'}
                  </div>
                </div>
                <div className="text-[11px] text-stone-600 mt-2 flex justify-between items-center border-t border-[#F0ECE3] pt-1.5">
                  {hasExpensesLogged ? (
                    <>
                      <span>Direct: {formatINR(totalDirectVouchers)}</span>
                      <span>Store: {formatINR(totalStoreConsumption)}</span>
                    </>
                  ) : (
                    <span>No logged expenses</span>
                  )}
                </div>
                <div className="text-[10px] text-stone-500 font-medium mt-0.5 flex items-center justify-between">
                  <span>{hasExpensesLogged ? `Utilities: ${formatINR(totalUtilities)}` : 'Click to view full P&L'}</span>
                  <span className="text-[#6B162E] font-semibold flex items-center gap-0.5">
                    View P&amp;L <ExternalLink className="h-2.5 w-2.5" />
                  </span>
                </div>
              </Link>
            </div>
          </div>

          {/* Section 6: Granular Drill-Down Views (Expandable per Clicked Card) */}
          {activeDrilldown && (
            <div className="border border-[#E7E2D8] rounded-xl p-4 sm:p-5 bg-white shadow-xs space-y-4 animate-in fade-in duration-200">
              <div className="flex items-center justify-between pb-3 border-b border-[#E7E2D8]">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-stone-900 text-sm">
                    {activeDrilldown === 'restaurant' && 'Restaurant Sales Analytics'}
                    {activeDrilldown === 'snacks' && 'Snacks Stall — Hourly Sales & Top Items'}
                    {activeDrilldown === 'camel' && 'Camel Ride — Hourly Activity'}
                    {activeDrilldown === 'games' && 'Skill Games — Hourly Activity'}
                    {activeDrilldown === 'mehendi' && 'Mehendi — Hourly Activity'}
                    {activeDrilldown === 'champi' && 'Champi Maalish — Hourly Activity'}
                  </span>
                  <Badge variant="outline" className="text-[10px] border-[#E7E2D8]">
                    {formatDisplayDate(businessDate, 'short')}
                  </Badge>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setActiveDrilldown(null)}
                  className="h-7 text-xs rounded-lg border-[#E7E2D8]"
                >
                  Close
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
                  {/* Exactly 3 strong summary KPIs */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 bg-[#FAF8F5] rounded-xl border border-[#E7E2D8]">
                    <div>
                      <div className="text-[10px] text-stone-500 font-semibold uppercase tracking-wider">ORDERS</div>
                      <div className="text-xl sm:text-2xl font-bold text-stone-900 mt-0.5 tabular-nums">{snacksBillCount}</div>
                      <div className="text-[10px] text-stone-400 mt-0.5">Snack stall orders</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-stone-500 font-semibold uppercase tracking-wider">GROSS SALES</div>
                      <div className="text-xl sm:text-2xl font-bold text-[#6B162E] mt-0.5 tabular-nums">{formatINR(snacksGross)}</div>
                      <div className="text-[10px] text-stone-400 mt-0.5">Net Sales: {formatINR(snacksNet)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-stone-500 font-semibold uppercase tracking-wider">AVERAGE BILL</div>
                      <div className="text-xl sm:text-2xl font-bold text-stone-900 mt-0.5 tabular-nums">{snacksAbv !== null ? formatINR(snacksAbv) : '—'}</div>
                      <div className="text-[10px] text-stone-400 mt-0.5">Average bill value</div>
                    </div>
                  </div>

                  {/* Two Column Section: Hourly Sales & Top Street Food & Snack Items */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-1">
                    {/* Hourly Sales Horizontal Bar Chart */}
                    <div className="p-3.5 rounded-xl border border-[#E7E2D8] bg-[#FAF8F5]/60">
                      <div className="flex items-center justify-between pb-2 border-b border-[#E7E2D8] mb-3">
                        <h4 className="text-xs font-bold text-stone-900 flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-[#D97706]" />
                          Hourly Sales
                        </h4>
                        <span className="text-[10px] text-stone-400">Evening snack service</span>
                      </div>

                      {snacksHourly.every((h) => h.gross === 0 && h.count === 0) ? (
                        <div className="py-8 text-center text-stone-400 text-xs">No snack sales recorded for this date.</div>
                      ) : (
                        <div className="space-y-2">
                          {(() => {
                            const maxHourlyGross = Math.max(...snacksHourly.map((x) => x.gross), 1);
                            return snacksHourly
                              .filter((h) => h.count > 0 || h.gross > 0)
                              .map((h) => {
                                const pct = Math.max((h.gross / maxHourlyGross) * 100, 3);
                                return (
                                  <div key={h.hour} className="flex items-center gap-2 sm:gap-3 py-1">
                                    <span className="w-16 sm:w-20 text-xs font-medium text-stone-600 shrink-0">{h.label}</span>
                                    <div className="flex-1 bg-[#E7E2D8] h-3 rounded-full overflow-hidden">
                                      <div
                                        className="bg-amber-500 h-full rounded-full transition-all duration-300"
                                        style={{ width: `${pct}%` }}
                                      />
                                    </div>
                                    <span className="w-16 sm:w-20 text-right text-xs font-mono font-bold text-stone-900 tabular-nums shrink-0">
                                      {formatINR(h.gross)}
                                    </span>
                                    <span className="w-16 sm:w-20 text-right text-[11px] text-stone-500 shrink-0">
                                      {h.count} {h.count === 1 ? 'order' : 'orders'}
                                    </span>
                                  </div>
                                );
                              });
                          })()}
                        </div>
                      )}
                    </div>

                    {/* Top Street Food & Snack Items */}
                    <div className="p-3.5 rounded-xl border border-[#E7E2D8] bg-[#FAF8F5]/60">
                      <div className="flex items-center justify-between pb-2 border-b border-[#E7E2D8] mb-3">
                        <h4 className="text-xs font-bold text-stone-900 flex items-center gap-1.5">
                          <UtensilsCrossed className="h-3.5 w-3.5 text-[#D97706]" />
                          Top Street Food &amp; Snack Items
                        </h4>
                        <span className="text-[10px] text-stone-400">By units sold</span>
                      </div>

                      {snacksTopItems.length === 0 ? (
                        <div className="py-8 text-center text-stone-400 text-xs">No snack items logged for this date.</div>
                      ) : (
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-[#E7E2D8] text-stone-500 text-[10px]">
                              <th className="pb-1.5">Item Name</th>
                              <th className="pb-1.5 text-center">Units Sold</th>
                              <th className="pb-1.5 text-right">Net Sales</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#F0ECE3]">
                            {snacksTopItems.map((item, idx) => (
                              <tr key={item.name} className="hover:bg-white/80">
                                <td className="py-2 font-medium text-stone-900 flex items-center gap-1.5">
                                  <span className="w-4 h-4 rounded-full bg-stone-200 text-stone-700 flex items-center justify-center text-[9px] font-bold">
                                    {idx + 1}
                                  </span>
                                  {item.name}
                                </td>
                                <td className="py-2 text-center font-bold text-stone-700">{item.qty}</td>
                                <td className="py-2 text-right font-mono font-bold text-[#6B162E]">{formatINR(item.net)}</td>
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
                const isCamel = activeDrilldown === 'camel';
                const isGames = activeDrilldown === 'games';
                const isMehendi = activeDrilldown === 'mehendi';

                const act = isCamel
                  ? camelData
                  : isGames
                  ? gamesData
                  : isMehendi
                  ? mehendiData
                  : champiData;

                const unitLabel = isCamel
                  ? 'Rides'
                  : isGames
                  ? 'Tickets'
                  : isMehendi
                  ? 'Clients'
                  : 'Sessions';

                const unitSingular = isCamel
                  ? 'ride'
                  : isGames
                  ? 'ticket'
                  : isMehendi
                  ? 'client'
                  : 'session';

                const hasActivity = act.totalQty > 0;

                return (
                  <div className="space-y-4">
                    {/* Exactly 3 strong summary KPIs */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 bg-[#FAF8F5] rounded-xl border border-[#E7E2D8]">
                      <div>
                        <div className="text-[10px] text-stone-500 font-semibold uppercase tracking-wider">
                          {hasActivity ? unitLabel.toUpperCase() : 'ACTIVITY STATUS'}
                        </div>
                        <div className="text-xl sm:text-2xl font-bold text-stone-900 mt-0.5 tabular-nums">
                          {hasActivity ? act.totalQty : 'No Activity'}
                        </div>
                        <div className="text-[10px] text-stone-400 mt-0.5">
                          {hasActivity ? `Total ${unitLabel.toLowerCase()}` : 'No transactions recorded'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-stone-500 font-semibold uppercase tracking-wider">
                          {hasActivity ? 'GROSS SALES' : unitLabel.toUpperCase()}
                        </div>
                        <div className="text-xl sm:text-2xl font-bold text-[#6B162E] mt-0.5 tabular-nums">
                          {hasActivity ? formatINR(act.totalGross) : '0'}
                        </div>
                        <div className="text-[10px] text-stone-400 mt-0.5">
                          {hasActivity ? 'Activity sales' : `Recorded ${unitLabel.toLowerCase()}`}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-stone-500 font-semibold uppercase tracking-wider">
                          AVERAGE PRICE
                        </div>
                        <div className="text-xl sm:text-2xl font-bold text-stone-900 mt-0.5 tabular-nums">
                          {hasActivity && act.abv !== null ? formatINR(act.abv) : '—'}
                        </div>
                        <div className="text-[10px] text-stone-400 mt-0.5">
                          {hasActivity ? `Per ${unitSingular} rate` : 'Rate not available'}
                        </div>
                      </div>
                    </div>

                    {/* Horizontal Bar Chart for Hourly Activity */}
                    <div className="p-3.5 rounded-xl border border-[#E7E2D8] bg-[#FAF8F5]/60">
                      <div className="flex items-center justify-between pb-2 border-b border-[#E7E2D8] mb-3">
                        <h4 className="text-xs font-bold text-stone-900 flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-[#6B162E]" />
                          Hourly Activity
                        </h4>
                        <span className="text-[10px] text-stone-400">
                          {unitLabel} and revenue distribution
                        </span>
                      </div>

                      {!hasActivity || act.hourlyData.length === 0 ? (
                        <div className="py-8 text-center text-stone-400 text-xs">
                          No activity recorded for {formatDisplayDate(businessDate, 'short')}.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {(() => {
                            const maxGross = Math.max(...act.hourlyData.map((x) => x.amount), 1);
                            return act.hourlyData.map((pt) => {
                              const pct = Math.max((pt.amount / maxGross) * 100, 3);
                              const hourText =
                                pt.hour === 1
                                  ? '01:00 AM (Petpooja posting time)'
                                  : pt.label;

                              return (
                                <div key={pt.hour} className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 py-1.5 border-b border-[#F0ECE3] last:border-b-0">
                                  <div className="w-28 sm:w-48 text-xs font-semibold text-stone-700 shrink-0">
                                    {hourText}
                                  </div>
                                  <div className="flex-1 flex items-center gap-3">
                                    <div className="flex-1 bg-[#E7E2D8] h-3 rounded-full overflow-hidden">
                                      <div
                                        className="bg-amber-500 h-full rounded-full transition-all duration-300"
                                        style={{ width: `${pct}%` }}
                                      />
                                    </div>
                                    <div className="w-16 sm:w-20 text-right text-xs font-medium text-stone-600 shrink-0">
                                      {pt.qty} {pt.qty === 1 ? unitSingular : unitLabel.toLowerCase()}
                                    </div>
                                    <div className="w-20 sm:w-24 text-right text-xs font-mono font-bold text-[#6B162E] tabular-nums shrink-0">
                                      {formatINR(pt.amount)}
                                    </div>
                                  </div>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Section 7: Daily Operating Surplus */}
          <Card className="border-[#E7E2D8] shadow-xs bg-white rounded-xl">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-sm font-bold text-stone-900">
                  Daily Operating Surplus
                </CardTitle>
                <CardDescription className="text-xs text-stone-500">
                  Financial reconciliation of Net Sales against store consumption and operating expenses for {formatDisplayDate(businessDate, 'short')}
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportCSV([dailyData || {}], 'daily-operations-report')}
                className="gap-1.5 text-xs rounded-xl border-[#E7E2D8]"
              >
                <Download className="h-3.5 w-3.5" /> Export CSV
              </Button>
            </CardHeader>
            <CardContent className="pt-0 text-xs sm:text-sm space-y-3">
              {loading ? (
                <div className="py-10 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
                  <RefreshCw className="h-4 w-4 animate-spin text-[#6B162E]" /> Loading financial surplus...
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                  <div className="p-3.5 bg-[#FAF8F5] rounded-xl border border-[#E7E2D8]">
                    <div className="text-[11px] text-stone-500 font-semibold uppercase tracking-wider">Net Sales (POS)</div>
                    <div className="text-xl font-bold text-stone-900 tabular-nums mt-0.5">
                      {formatINR(consolidatedNet)}
                    </div>
                  </div>
                  <div className="p-3.5 bg-[#FAF8F5] rounded-xl border border-[#E7E2D8]">
                    <div className="text-[11px] text-stone-500 font-semibold uppercase tracking-wider">Store Consumption</div>
                    <div className="text-xl font-bold text-stone-900 tabular-nums mt-0.5">
                      {totalStoreConsumption > 0 ? formatINR(totalStoreConsumption) : '—'}
                    </div>
                  </div>
                  <div className="p-3.5 bg-[#FAF8F5] rounded-xl border border-[#E7E2D8]">
                    <div className="text-[11px] text-stone-500 font-semibold uppercase tracking-wider">Direct &amp; Utilities</div>
                    <div className="text-xl font-bold text-stone-900 tabular-nums mt-0.5">
                      {(totalDirectVouchers + totalUtilities) > 0 ? formatINR(totalDirectVouchers + totalUtilities) : '—'}
                    </div>
                  </div>
                  <div className="p-3.5 bg-emerald-50/80 rounded-xl border border-emerald-200/80">
                    <div className="text-[11px] text-emerald-900 font-bold uppercase tracking-wider">Gross Operating Surplus</div>
                    <div className="text-xl font-bold text-emerald-800 tabular-nums mt-0.5">
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
        <Card className="border-[#E7E2D8] shadow-xs bg-white rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Kitchen Store Issue Movements ({formatDisplayDate(businessDate, 'short')})</CardTitle>
              <CardDescription className="text-stone-500">Line-by-line consumption attributed to kitchen &amp; chef</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportCSV(inventoryMovements, 'store-consumption')}
              className="gap-1.5 text-xs rounded-xl border-[#E7E2D8]"
            >
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="py-12 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-[#6B162E]" /> Loading store consumption...
              </div>
            ) : inventoryMovements.length === 0 ? (
              <div className="py-12 text-center text-stone-400 text-xs">No inventory movements logged for {formatDisplayDate(businessDate, 'short')}.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#E7E2D8] text-stone-600 font-semibold bg-[#FAF8F5]">
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
                  <tbody className="divide-y divide-[#F0ECE3]">
                    {inventoryMovements.map((m) => (
                      <tr key={m.id} className="hover:bg-[#FAF8F5]/80">
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
        <Card className="border-[#E7E2D8] shadow-xs bg-white rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Vendor Accounts Summary</CardTitle>
              <CardDescription className="text-stone-500">Current balances derived from invoices and payment allocations</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportCSV(vendors, 'vendor-ledger')}
              className="gap-1.5 text-xs rounded-xl border-[#E7E2D8]"
            >
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="py-12 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-[#6B162E]" /> Loading vendor accounts...
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#E7E2D8] text-stone-600 font-semibold bg-[#FAF8F5]">
                      <th className="py-2.5 px-3">Supplier</th>
                      <th className="py-2.5 px-3">Contact</th>
                      <th className="py-2.5 px-3 text-right">Total Invoiced</th>
                      <th className="py-2.5 px-3 text-right">Total Settled</th>
                      <th className="py-2.5 px-3 text-right">Net Due</th>
                      <th className="py-2.5 px-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0ECE3]">
                    {vendors.map((v) => {
                      const out = Number(v.outstanding_balance) || 0;
                      return (
                        <tr key={v.vendor_id} className="hover:bg-[#FAF8F5]/80">
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
