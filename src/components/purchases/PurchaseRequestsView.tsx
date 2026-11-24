'use client';

import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useI18n } from '@/lib/i18n/context';
import { formatINR, formatNumber } from '@/lib/utils';
import { getLocalizedMasterName, getLocalizedMasterSymbol } from '@/lib/i18n/master-data';
import { PurchaseLineForm } from '@/components/purchases/PurchaseModal';
import {
  Clock,
  CheckCircle2,
  AlertTriangle,
  ShoppingBag,
  Plus,
  Sliders,
  Check,
  X,
  Edit2,
  ChevronDown,
  Layers,
  ArrowRight,
  Shield,
  RefreshCw,
  Sparkles,
} from 'lucide-react';

interface PurchaseRequestsViewProps {
  requests: any[];
  vendors: any[];
  items: any[];
  groups: any[];
  packagingUnits: any[];
  canApprove: boolean;
  isAdmin: boolean;
  onOpenCreateModal: () => void;
  onOpenPolicyModal: () => void;
  onConvertBasket: (vendorId: string | null, lines: PurchaseLineForm[]) => void;
  onRefresh: () => void;
}

export function PurchaseRequestsView({
  requests,
  vendors,
  items,
  groups,
  packagingUnits,
  canApprove,
  isAdmin,
  onOpenCreateModal,
  onOpenPolicyModal,
  onConvertBasket,
  onRefresh,
}: PurchaseRequestsViewProps) {
  const { t, locale } = useI18n();

  // Action state for pending review lines
  const [activeActionLineId, setActiveActionLineId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<'adjust' | 'set_max_par' | 'reject' | null>(null);
  const [actionCustomQty, setActionCustomQty] = useState('');
  const [actionMaxPar, setActionMaxPar] = useState('');
  const [actionMaxParUnitMode, setActionMaxParUnitMode] = useState<'base' | 'kilo_liter'>('base');
  const [actionNote, setActionNote] = useState('');
  const [processingLineId, setProcessingLineId] = useState<string | null>(null);

  // Smart Suggestions state
  const [forecastSuggestions, setForecastSuggestions] = useState<any[]>([]);
  const [forecastConfidence, setForecastConfidence] = useState<number>(85);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [buildingRequest, setBuildingRequest] = useState(false);

  React.useEffect(() => {
    let active = true;
    const loadSuggestions = async () => {
      setLoadingSuggestions(true);
      try {
        const res = await fetch('/api/finance/purchase-forecast');
        const data = await res.json();
        if (active && data.success) {
          setForecastSuggestions((data.suggestions || []).filter((s: any) => s.suggested_order_qty > 0));
          setForecastConfidence(data.qty_confidence_score || 85);
        }
      } catch (err) {
        console.error('Failed to load purchase suggestions:', err);
      } finally {
        if (active) setLoadingSuggestions(false);
      }
    };
    loadSuggestions();
    return () => {
      active = false;
    };
  }, []);

  const handleBuildRequestFromSuggestions = async () => {
    if (forecastSuggestions.length === 0) return;
    setBuildingRequest(true);
    try {
      const lines = forecastSuggestions.map((s) => ({
        item_id: s.item_id,
        requested_quantity: s.suggested_order_qty,
        pack_unit_snapshot: null,
        pack_quantity: null,
        conversion_factor_snapshot: 1,
        notes: `Smart Suggestion (Demand: ${s.forecast_demand_qty} ${s.unit_symbol}, Source: ${s.demand_source})`,
      }));

      const res = await fetch('/api/finance/purchase-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_purchase_date: new Date().toISOString().slice(0, 10),
          notes: 'Auto-built from Tomorrow Forecast Smart Suggestions',
          lines,
        }),
      });

      const data = await res.json();
      if (data.success) {
        onRefresh();
        alert('Successfully created purchase request from Smart Suggestions!');
      } else {
        alert(data.error || 'Failed to create request');
      }
    } catch (err: any) {
      alert(err.message || 'Failed to build request');
    } finally {
      setBuildingRequest(false);
    }
  };

  const switchActionMaxParMode = (newMode: 'base' | 'kilo_liter') => {
    if (newMode === actionMaxParUnitMode) return;
    if (newMode === 'kilo_liter') {
      if (actionMaxPar && !isNaN(Number(actionMaxPar))) {
        setActionMaxPar(String(Math.round((Number(actionMaxPar) / 1000) * 10000) / 10000));
      }
    } else {
      if (actionMaxPar && !isNaN(Number(actionMaxPar))) {
        setActionMaxPar(String(Math.round(Number(actionMaxPar) * 1000)));
      }
    }
    setActionMaxParUnitMode(newMode);
  };

  // Flatten all lines across all requests
  const allLines = React.useMemo(() => {
    const list: any[] = [];
    (requests || []).forEach((req) => {
      (req.lines || []).forEach((line: any) => {
        list.push({
          ...line,
          request_number: req.request_number,
          target_purchase_date: req.target_purchase_date,
        });
      });
    });
    return list;
  }, [requests]);

  // Queue 1: Pending Approval lines
  const pendingLines = React.useMemo(() => {
    return allLines.filter((l) => l.approval_status === 'pending_approval');
  }, [allLines]);

  // Queue 2: Ready to Buy Basket lines (auto_approved or approved, not yet converted to purchase)
  const readyLines = React.useMemo(() => {
    return allLines.filter(
      (l) => ['auto_approved', 'approved'].includes(l.approval_status) && !l.converted_purchase_id
    );
  }, [allLines]);

  // Group Queue 2 lines by Preferred Vendor
  const readyGroupedByVendor = React.useMemo(() => {
    const groupsMap = new Map<string, { vendor: any; lines: any[] }>();

    readyLines.forEach((line) => {
      const vendorId = line.preferred_vendor_id || 'UNASSIGNED';
      if (!groupsMap.has(vendorId)) {
        const vendorObj = vendors.find((v) => v.vendor_id === vendorId || v.id === vendorId);
        groupsMap.set(vendorId, { vendor: vendorObj || null, lines: [] });
      }
      groupsMap.get(vendorId)!.lines.push(line);
    });

    return Array.from(groupsMap.entries()).map(([vId, group]) => ({
      vendorId: vId === 'UNASSIGNED' ? null : vId,
      vendor: group.vendor,
      lines: group.lines,
      totalAmount: group.lines.reduce((sum, l) => sum + (Number(l.estimated_total) || 0), 0),
    }));
  }, [readyLines, vendors]);

  const handleApproverAction = async (
    requestId: string,
    lineId: string,
    action: 'approve' | 'adjust_and_approve' | 'set_max_par_and_approve' | 'reject'
  ) => {
    setProcessingLineId(lineId);
    try {
      const payload: any = { action };
      if (action === 'adjust_and_approve') {
        payload.approved_quantity = Number(actionCustomQty);
        payload.review_note = actionNote;
      } else if (action === 'set_max_par_and_approve') {
        let finalMaxPar = Number(actionMaxPar);
        if (actionMaxParUnitMode === 'kilo_liter') {
          finalMaxPar = finalMaxPar * 1000;
        }
        payload.new_max_par = finalMaxPar;
        if (actionCustomQty) payload.approved_quantity = Number(actionCustomQty);
        payload.review_note = actionNote;
      } else if (action === 'reject') {
        payload.review_note = actionNote;
      }

      const res = await fetch(`/api/finance/purchase-requests/${requestId}/lines/${lineId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to process approver action');
      }

      // Reset action drawer
      setActiveActionLineId(null);
      setActionType(null);
      setActionCustomQty('');
      setActionMaxPar('');
      setActionNote('');
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Action failed');
    } finally {
      setProcessingLineId(null);
    }
  };

  const handleConvertVendorGroup = (group: { vendorId: string | null; vendor: any; lines: any[] }) => {
    const formattedLines: PurchaseLineForm[] = group.lines.map((line) => {
      const matchedItem = items.find((it) => it.id === line.item_id);
      const canonicalUnit = (matchedItem?.unit?.symbol || 'kg').toLowerCase();
      const baseUnitDisplay =
        getLocalizedMasterSymbol(matchedItem?.unit, locale) ||
        matchedItem?.unit?.symbol ||
        line.item?.unit?.symbol ||
        (locale === 'hi' ? 'किग्रा' : 'kg');

      const usePack = Boolean(line.pack_unit_snapshot);
      const qVal = Number(line.approved_quantity || line.requested_quantity) || 1;
      const conv = Number(line.conversion_factor_snapshot) || 1;
      const packQty = line.pack_quantity != null ? Number(line.pack_quantity) : Math.round((qVal / conv) * 100) / 100;
      const rate = Number(line.estimated_unit_rate) || 0;
      const packRate = rate * conv;

      return {
        source_request_line_id: line.id,
        item_id: line.item_id,
        item_name: (locale === 'hi' && matchedItem?.name_hi) ? matchedItem.name_hi : (matchedItem?.name || line.item?.name),
        brand_name: line.item?.brand_name || 'Generic',
        group_name: matchedItem?.name?.split('—')[0]?.trim() || line.item?.name,
        base_unit_canonical: canonicalUnit,
        base_unit_symbol: baseUnitDisplay,
        use_pack: usePack,
        pack_unit: line.pack_unit_snapshot || baseUnitDisplay,
        pack_quantity: usePack ? String(packQty) : '',
        pack_rate: usePack ? String(packRate) : '',
        conversion_factor: conv,
        quantity: String(qVal),
        rate: String(rate),
        line_total: String(Math.round(qVal * rate * 100) / 100),
      };
    });

    onConvertBasket(group.vendorId, formattedLines);
  };

  return (
    <div className="space-y-6">
      {/* Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white p-4 rounded-xl border border-stone-200 shadow-2xs">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-stone-900 flex items-center gap-2">
            <Layers className="h-5 w-5 text-amber-600" />
            {t('purchases.requests.tabTitle')}
          </h2>
          <p className="text-xs text-stone-500">
            {pendingLines.length > 0
              ? t('purchases.requests.pendingCount', { count: pendingLines.length })
              : t('purchases.requests.emptyQueue1')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenPolicyModal}
              className="gap-1.5 text-xs text-purple-700 border-purple-200 hover:bg-purple-50 shadow-2xs"
            >
              <Sliders className="h-3.5 w-3.5" />
              {t('purchases.requests.policySettings')}
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            className="gap-1 text-xs shadow-2xs"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t('common.refresh')}
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={onOpenCreateModal}
            className="gap-1.5 text-xs bg-amber-700 hover:bg-amber-800 text-white shadow-2xs"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('purchases.requests.newRequest')}
          </Button>
        </div>
      </div>

      {/* Smart Suggestions Panel (Powered by Phase 2 BOM Explosion) */}
      {forecastSuggestions.length > 0 && (
        <div className="bg-gradient-to-r from-amber-50/80 via-white to-amber-50/40 border border-amber-200/90 rounded-xl p-4 shadow-2xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2.5 border-b border-amber-100">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-amber-600 text-white">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-stone-900 flex items-center gap-2">
                  <span>Smart Reorder Suggestions</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                    {forecastConfidence}% Volume Confidence
                  </span>
                </h3>
                <p className="text-[11px] text-stone-500">
                  {forecastSuggestions.length} items below par level based on tomorrow&apos;s culinary dish forecasts.
                </p>
              </div>
            </div>

            <Button
              size="sm"
              disabled={buildingRequest}
              onClick={handleBuildRequestFromSuggestions}
              className="gap-1.5 text-xs bg-amber-700 hover:bg-amber-800 text-white shadow-2xs self-start sm:self-auto"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>{buildingRequest ? 'Creating Request...' : 'Build Request from Suggestions (1-Tap)'}</span>
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
            {forecastSuggestions.slice(0, 8).map((s) => (
              <div
                key={s.item_id}
                className="bg-white p-2.5 rounded-lg border border-stone-200 text-xs flex flex-col justify-between"
              >
                <div>
                  <div className="font-bold text-stone-900 truncate" title={s.item_name}>
                    {s.item_name}
                  </div>
                  <div className="text-[10px] text-stone-400 mt-0.5">
                    Stock: {s.current_stock} &middot; Par: {s.par_level} {s.unit_symbol}
                  </div>
                </div>

                <div className="mt-2 pt-2 border-t border-stone-100 flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                    Order: {s.suggested_order_qty} {s.unit_symbol}
                  </span>
                  {s.line_cost != null && (
                    <span className="text-[11px] font-bold text-stone-700">
                      ₹{Math.round(s.line_cost).toLocaleString('en-IN')}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* QUEUE 1: Pending Approval */}
      <Card className="border-amber-200/80 shadow-2xs overflow-hidden">
        <CardHeader className="bg-amber-50/50 border-b border-amber-100/80 py-3.5 px-4 sm:px-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-amber-100 text-amber-800 rounded-lg">
                <Clock className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-sm sm:text-base font-bold text-amber-950 flex items-center gap-2">
                  {t('purchases.requests.queue1Title')}
                  {pendingLines.length > 0 && (
                    <Badge variant="warning" className="text-[10px] font-mono">
                      {pendingLines.length}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-xs text-amber-800/80">
                  {t('purchases.requests.queue1Subtitle')}
                </CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-3 sm:p-5">
          {pendingLines.length === 0 ? (
            <div className="py-8 text-center text-stone-400">
              <CheckCircle2 className="h-8 w-8 text-emerald-500/70 mx-auto mb-2" />
              <p className="text-xs font-medium text-stone-600">{t('purchases.requests.emptyQueue1')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pendingLines.map((line) => {
                const baseUnit =
                  getLocalizedMasterSymbol(line.item?.unit, locale) ||
                  line.item?.unit?.symbol ||
                  'units';
                const isGramOrMl = baseUnit === 'g' || baseUnit === 'ml';

                return (
                  <div
                    key={line.id}
                    className="p-3.5 rounded-xl border border-stone-200 bg-white hover:border-amber-300 transition-colors shadow-2xs space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-stone-900 text-xs sm:text-sm">
                            {locale === 'hi' && line.item?.name_hi ? line.item.name_hi : line.item?.name}
                          </span>
                          <span className="text-[10px] text-stone-400 font-mono">
                            {line.item?.item_code}
                          </span>
                          {line.item?.brand_name && line.item.brand_name !== 'Generic' && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-stone-100 text-stone-700 border">
                              {line.item.brand_name}
                            </span>
                          )}
                          <Badge
                            variant={
                              line.abc_class_snapshot === 'high_control'
                                ? 'danger'
                                : line.abc_class_snapshot === 'frequent_monitoring'
                                ? 'warning'
                                : 'outline'
                            }
                            className="text-[9px]"
                          >
                            {line.abc_class_snapshot === 'high_control'
                              ? t('inventory.abc.highControlShort')
                              : line.abc_class_snapshot === 'frequent_monitoring'
                              ? t('inventory.abc.frequentShort')
                              : t('inventory.abc.routineShort')}
                          </Badge>
                        </div>

                        {/* Red / Amber Reason Pills */}
                        {line.routing_reasons && line.routing_reasons.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-0.5">
                            {line.routing_reasons.map((r: string, ri: number) => (
                              <span
                                key={ri}
                                className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-1"
                              >
                                <AlertTriangle className="h-3 w-3 text-rose-500" />
                                {r}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Financial & Request Details */}
                      <div className="text-right sm:shrink-0 space-y-0.5">
                        <span className="font-mono font-bold text-stone-900 text-sm block">
                          {formatINR(Number(line.estimated_total) || 0)}
                        </span>
                        <span className="text-[10px] text-stone-500 font-mono block">
                          Rate: {formatINR(Number(line.estimated_unit_rate) || 0)} / {baseUnit}
                        </span>
                      </div>
                    </div>

                    {/* Context Row */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-stone-50 p-2.5 rounded-lg border border-stone-200/70 text-[11px]">
                      <div>
                        <span className="text-stone-400 block text-[10px]">{t('purchases.requests.qty')}</span>
                        <span className="font-bold font-mono text-stone-800">
                          {line.pack_quantity
                            ? `${line.pack_quantity} ${line.pack_unit_snapshot} (${formatNumber(line.requested_quantity)} ${baseUnit})`
                            : `${formatNumber(line.requested_quantity)} ${baseUnit}`}
                        </span>
                      </div>

                      <div>
                        <span className="text-stone-400 block text-[10px]">{t('purchases.requests.stockParLabel')}</span>
                        <span className="font-bold font-mono text-stone-800">
                          {formatNumber(Number(line.current_stock))} /{' '}
                          {line.max_par_snapshot != null ? `${formatNumber(Number(line.max_par_snapshot))} ${baseUnit}` : '—'}
                        </span>
                      </div>

                      <div>
                        <span className="text-stone-400 block text-[10px]">30d Usage</span>
                        <span className="font-bold font-mono text-stone-800">
                          {formatNumber(Number(line.usage_30d || 0))} {baseUnit}
                        </span>
                      </div>

                      <div>
                        <span className="text-stone-400 block text-[10px]">{t('purchases.requests.vendor')}</span>
                        <span className="font-semibold text-stone-700 truncate block">
                          {line.preferred_vendor
                            ? (getLocalizedMasterName(line.preferred_vendor, locale) || line.preferred_vendor.name)
                            : t('purchases.requests.unassignedVendor')}
                        </span>
                      </div>
                    </div>

                    {/* Approver Action Bar (Gated to Approvers) */}
                    {canApprove && (
                      <div className="pt-2 border-t border-stone-100 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[10px] text-stone-400 font-mono">
                          {line.request_number} • {line.target_purchase_date}
                        </span>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={processingLineId === line.id}
                            onClick={() => handleApproverAction(line.request_id, line.id, 'approve')}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-7 px-2.5 gap-1"
                          >
                            <Check className="h-3 w-3" />
                            {t('purchases.requests.approve')}
                          </Button>

                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={processingLineId === line.id}
                            onClick={() => {
                              setActiveActionLineId(line.id);
                              setActionType('adjust');
                              setActionCustomQty(String(line.requested_quantity));
                            }}
                            className="text-xs h-7 px-2 text-stone-700 border"
                          >
                            {t('purchases.requests.adjustAndApprove')}
                          </Button>

                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={processingLineId === line.id}
                            onClick={() => {
                              setActiveActionLineId(line.id);
                              setActionType('set_max_par');
                              if (isGramOrMl) {
                                setActionMaxParUnitMode('kilo_liter');
                                setActionMaxPar(line.max_par_snapshot ? String(Math.round((Number(line.max_par_snapshot) / 1000) * 10000) / 10000) : '');
                              } else {
                                setActionMaxParUnitMode('base');
                                setActionMaxPar(line.max_par_snapshot ? String(line.max_par_snapshot) : '');
                              }
                            }}
                            className="text-xs h-7 px-2 text-stone-700 border"
                          >
                            {t('purchases.requests.setMaxParAndApprove')}
                          </Button>

                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={processingLineId === line.id}
                            onClick={() => {
                              setActiveActionLineId(line.id);
                              setActionType('reject');
                            }}
                            className="text-xs h-7 px-2 text-rose-700 hover:bg-rose-50 border border-rose-200"
                          >
                            {t('purchases.requests.reject')}
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Inline Action Controls when user clicks Adjust / Set Max-Par / Reject */}
                    {activeActionLineId === line.id && (
                      <div className="p-3 bg-stone-50 rounded-lg border border-stone-200 text-xs space-y-2 mt-2">
                        {actionType === 'adjust' && (
                          <div className="space-y-2">
                            <label className="font-bold text-stone-800 block">
                              {t('purchases.requests.adjustQtyPrompt')}
                            </label>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min="0.001"
                                step="any"
                                value={actionCustomQty}
                                onChange={(e) => setActionCustomQty(e.target.value)}
                                className="w-32 p-1.5 border border-stone-300 rounded font-mono font-bold bg-white text-xs"
                              />
                              <span className="text-stone-500 font-mono">{baseUnit}</span>
                            </div>
                          </div>
                        )}

                        {actionType === 'set_max_par' && (
                          <div className="space-y-2">
                            <label className="font-bold text-stone-800 block">
                              {t('purchases.requests.setMaxParPrompt')}
                            </label>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min="0.001"
                                step="any"
                                value={actionMaxPar}
                                onChange={(e) => setActionMaxPar(e.target.value)}
                                className="w-32 p-1.5 border border-stone-300 rounded font-mono font-bold bg-white text-xs"
                              />
                              {isGramOrMl ? (
                                <div className="flex items-center rounded border border-stone-300 overflow-hidden text-[11px]">
                                  <button
                                    type="button"
                                    onClick={() => switchActionMaxParMode('base')}
                                    className={`px-2 py-1 ${
                                      actionMaxParUnitMode === 'base' ? 'bg-amber-600 text-white font-bold' : 'bg-white text-stone-700'
                                    }`}
                                  >
                                    {baseUnit}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => switchActionMaxParMode('kilo_liter')}
                                    className={`px-2 py-1 ${
                                      actionMaxParUnitMode === 'kilo_liter' ? 'bg-amber-600 text-white font-bold' : 'bg-white text-stone-700'
                                    }`}
                                  >
                                    {baseUnit === 'g' ? 'kg' : 'L'}
                                  </button>
                                </div>
                              ) : (
                                <span className="text-stone-500 font-mono">{baseUnit}</span>
                              )}
                            </div>
                            {isGramOrMl && actionMaxPar && (
                              <p className="text-[10px] text-stone-500 font-mono">
                                Live equivalent:{' '}
                                {actionMaxParUnitMode === 'kilo_liter'
                                  ? `${actionMaxPar} ${baseUnit === 'g' ? 'kg' : 'L'} = ${(Number(actionMaxPar) * 1000).toLocaleString('en-IN')} ${baseUnit}`
                                  : `${actionMaxPar} ${baseUnit} = ${(Number(actionMaxPar) / 1000).toFixed(2)} ${baseUnit === 'g' ? 'kg' : 'L'}`}
                              </p>
                            )}
                          </div>
                        )}

                        {actionType === 'reject' && (
                          <div className="space-y-1">
                            <label className="font-bold text-stone-800 block">
                              {t('purchases.requests.rejectNotePlaceholder')}
                            </label>
                            <input
                              type="text"
                              value={actionNote}
                              onChange={(e) => setActionNote(e.target.value)}
                              placeholder={t('purchases.requests.rejectNotePlaceholder')}
                              className="w-full p-1.5 border border-stone-300 rounded bg-white text-xs text-stone-900"
                            />
                          </div>
                        )}

                        <div className="flex items-center justify-end gap-2 pt-1">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setActiveActionLineId(null);
                              setActionType(null);
                            }}
                            className="text-xs h-7"
                          >
                            {t('purchases.requests.cancel')}
                          </Button>
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={processingLineId === line.id}
                            onClick={() => {
                              if (actionType === 'adjust') {
                                handleApproverAction(line.request_id, line.id, 'adjust_and_approve');
                              } else if (actionType === 'set_max_par') {
                                handleApproverAction(line.request_id, line.id, 'set_max_par_and_approve');
                              } else if (actionType === 'reject') {
                                handleApproverAction(line.request_id, line.id, 'reject');
                              }
                            }}
                            className="text-xs h-7 bg-amber-700 hover:bg-amber-800 text-white"
                          >
                            {t('purchases.requests.save')}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* QUEUE 2: Ready to Buy Basket */}
      <Card className="border-emerald-200/80 shadow-2xs overflow-hidden">
        <CardHeader className="bg-emerald-50/50 border-b border-emerald-100/80 py-3.5 px-4 sm:px-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-emerald-100 text-emerald-800 rounded-lg">
                <ShoppingBag className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-sm sm:text-base font-bold text-emerald-950 flex items-center gap-2">
                  {t('purchases.requests.queue2Title')}
                  {readyLines.length > 0 && (
                    <Badge variant="success" className="text-[10px] font-mono">
                      {readyLines.length}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-xs text-emerald-800/80">
                  {t('purchases.requests.queue2Subtitle')}
                </CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-3 sm:p-5">
          {readyGroupedByVendor.length === 0 ? (
            <div className="py-8 text-center text-stone-400">
              <ShoppingBag className="h-8 w-8 text-stone-300 mx-auto mb-2" />
              <p className="text-xs font-medium text-stone-600">{t('purchases.requests.emptyQueue2')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {readyGroupedByVendor.map((group, gIdx) => {
                const vendorName = group.vendor
                  ? (getLocalizedMasterName(group.vendor, locale) || group.vendor.name || group.vendor.vendor_name)
                  : t('purchases.requests.unassignedVendor');

                return (
                  <div
                    key={gIdx}
                    className="p-4 rounded-xl border border-stone-200 bg-white shadow-2xs space-y-3"
                  >
                    {/* Vendor Group Header with 1-Tap Convert */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-stone-100">
                      <div>
                        <h3 className="font-bold text-stone-900 text-sm flex items-center gap-2">
                          {vendorName}
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-mono font-bold">
                            {group.lines.length} items
                          </span>
                        </h3>
                        <p className="text-xs text-stone-500 font-mono">
                          Est. Total: {formatINR(group.totalAmount)}
                        </p>
                      </div>

                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleConvertVendorGroup(group)}
                        className="bg-emerald-700 hover:bg-emerald-800 text-white text-xs gap-1.5 shadow-2xs shrink-0"
                      >
                        <ShoppingBag className="h-3.5 w-3.5" />
                        {t('purchases.requests.convertBasket')}
                      </Button>
                    </div>

                    {/* Lines List in this Vendor Group */}
                    <div className="divide-y divide-stone-100 text-xs">
                      {group.lines.map((line) => {
                        const baseUnit =
                          getLocalizedMasterSymbol(line.item?.unit, locale) ||
                          line.item?.unit?.symbol ||
                          'units';

                        return (
                          <div key={line.id} className="py-2 flex items-center justify-between gap-2">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-stone-900">
                                  {locale === 'hi' && line.item?.name_hi ? line.item.name_hi : line.item?.name}
                                </span>
                                <span className="text-[10px] text-stone-400 font-mono">
                                  {line.item?.item_code}
                                </span>
                                <Badge variant="outline" className="text-[9px]">
                                  {line.approval_status === 'auto_approved' ? 'Auto-Approved' : 'Manager Approved'}
                                </Badge>
                              </div>
                              <span className="text-[11px] text-stone-500 font-mono block">
                                {line.pack_quantity
                                  ? `${line.pack_quantity} ${line.pack_unit_snapshot} (${formatNumber(line.approved_quantity || line.requested_quantity)} ${baseUnit})`
                                  : `${formatNumber(line.approved_quantity || line.requested_quantity)} ${baseUnit}`}
                              </span>
                            </div>

                            <div className="text-right">
                              <span className="font-mono font-bold text-stone-900 block">
                                {formatINR(Number(line.estimated_total) || 0)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
