'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { FinancialCostRule } from '@/lib/types/database';
import { logAuditAction } from '@/lib/audit-logger';
import {
  X,
  Check,
  AlertCircle,
  RefreshCw,
  Calculator,
  Calendar,
  Percent,
  IndianRupee,
  FileText,
} from 'lucide-react';

interface EditCostRuleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdated?: () => void;
  rule: FinancialCostRule | null;
}

export function EditCostRuleModal({
  isOpen,
  onClose,
  onUpdated,
  rule,
}: EditCostRuleModalProps) {
  const supabase = createClient();

  const [costName, setCostName] = useState('');
  const [category, setCategory] = useState('Rent');
  const [calculationMethod, setCalculationMethod] = useState<'fixed_monthly' | 'percentage_of_revenue' | 'actual_variable' | 'meter_based' | 'monthly_estimated'>('fixed_monthly');
  const [rateInput, setRateInput] = useState('');
  const [costClassification, setCostClassification] = useState<'Fixed' | 'Variable'>('Fixed');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [includeInDailyProfit, setIncludeInDailyProfit] = useState(true);
  const [includeInBreakEven, setIncludeInBreakEven] = useState(true);
  const [notes, setNotes] = useState('');

  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (rule && isOpen) {
      setCostName(rule.cost_name || '');
      setCategory(rule.category || 'General');
      const method = (rule.calculation_method || 'fixed_monthly') as any;
      setCalculationMethod(method);
      setCostClassification(rule.cost_classification || 'Fixed');
      setStartDate(rule.start_date || new Date().toISOString().split('T')[0]);
      setEndDate(rule.end_date || '');
      setIsActive(rule.is_active !== false);
      setIncludeInDailyProfit(rule.include_in_daily_profit !== false);
      setIncludeInBreakEven(rule.include_in_break_even !== false);
      setNotes(rule.notes || '');

      // Handle percentage vs currency rate conversion
      const rawVal = Number(rule.amount_or_rate || 0);
      if (method === 'percentage_of_revenue') {
        // e.g. 0.08 -> 8, 0.10 -> 10
        setRateInput((rawVal * 100).toString());
      } else {
        setRateInput(rawVal.toString());
      }

      setErrorMessage(null);
    }
  }, [rule, isOpen]);

  if (!isOpen || !rule) return null;

  const parsedNumber = parseFloat(rateInput);
  const isNumberValid = !isNaN(parsedNumber) && parsedNumber >= 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!costName.trim()) {
      setErrorMessage('Cost Name is required.');
      return;
    }
    if (!category.trim()) {
      setErrorMessage('Category is required.');
      return;
    }
    if (isNaN(parsedNumber) || parsedNumber < 0) {
      setErrorMessage('Please enter a valid, non-negative amount or rate.');
      return;
    }
    if (calculationMethod === 'percentage_of_revenue' && parsedNumber > 100) {
      setErrorMessage('Percentage rate cannot exceed 100%.');
      return;
    }
    if (!startDate) {
      setErrorMessage('Start Date is required.');
      return;
    }
    if (endDate && endDate < startDate) {
      setErrorMessage('End Date cannot precede Start Date.');
      return;
    }

    // Convert UI value to database representation:
    // For percentage_of_revenue: UI entered 8% -> store 0.08 in DB
    // For fixed_monthly / other: UI entered 3500 -> store 3500 in DB
    const finalAmountOrRate = calculationMethod === 'percentage_of_revenue'
      ? parsedNumber / 100
      : parsedNumber;

    setSaving(true);

    try {
      const updatePayload = {
        cost_name: costName.trim(),
        category: category.trim(),
        calculation_method: calculationMethod,
        amount_or_rate: finalAmountOrRate,
        cost_classification: costClassification,
        is_active: isActive,
        start_date: startDate,
        end_date: endDate || null,
        include_in_daily_profit: includeInDailyProfit,
        include_in_break_even: includeInBreakEven,
        notes: notes.trim() || null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('financial_cost_rules')
        .update(updatePayload)
        .eq('id', rule.id);

      if (error) throw error;

      // Audit Log with complete old/new trace
      await logAuditAction({
        action: 'UPDATE',
        entityType: 'Financial Cost Rule',
        entityId: rule.id,
        oldValues: {
          cost_name: rule.cost_name,
          category: rule.category,
          calculation_method: rule.calculation_method,
          amount_or_rate: rule.amount_or_rate,
          cost_classification: rule.cost_classification,
          is_active: rule.is_active,
          start_date: rule.start_date,
          end_date: rule.end_date,
          include_in_daily_profit: rule.include_in_daily_profit,
          include_in_break_even: rule.include_in_break_even,
          notes: rule.notes,
        },
        newValues: updatePayload,
        details: {
          rule_name: costName.trim(),
          calculation_method: calculationMethod,
          previous_display: rule.calculation_method === 'percentage_of_revenue'
            ? `${(Number(rule.amount_or_rate || 0) * 100).toFixed(1)}%`
            : `₹${Number(rule.amount_or_rate || 0).toLocaleString('en-IN')}`,
          new_display: calculationMethod === 'percentage_of_revenue'
            ? `${parsedNumber.toFixed(1)}%`
            : `₹${parsedNumber.toLocaleString('en-IN')}`,
        },
      });

      if (onUpdated) onUpdated();
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to update cost rule.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="bg-white rounded-xl max-w-xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-stone-200 overflow-hidden text-xs">
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between bg-stone-50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-100 text-amber-800 rounded-lg">
              <Calculator className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-stone-900">
                Edit Financial Cost Rule
              </h2>
              <p className="text-xs text-stone-500">
                Configure rate, classification, calculation method, and operational P&amp;L inclusion
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-200/60 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg flex items-center gap-2 text-xs">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Rule Name & Category */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-stone-700 mb-1">
                Cost Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={costName}
                onChange={(e) => setCostName(e.target.value)}
                placeholder="e.g. Internet & Telecom"
                className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none text-xs font-medium"
                required
              />
            </div>

            <div>
              <label className="block font-semibold text-stone-700 mb-1">
                Category <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Utilities, Rent, Finance"
                className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none text-xs"
                required
              />
            </div>
          </div>

          {/* Method & Classification */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-stone-700 mb-1">
                Calculation Method
              </label>
              <select
                value={calculationMethod}
                onChange={(e) => {
                  const newMethod = e.target.value as any;
                  // If switching to percentage, suggest reasonable percentage if old val was huge
                  if (newMethod === 'percentage_of_revenue' && calculationMethod !== 'percentage_of_revenue') {
                    if (Number(rateInput) > 100) setRateInput('10');
                  }
                  setCalculationMethod(newMethod);
                }}
                className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none text-xs bg-white"
              >
                <option value="fixed_monthly">Fixed Monthly Amount (₹)</option>
                <option value="percentage_of_revenue">Percentage of Revenue (%)</option>
                <option value="actual_variable">Actual Variable</option>
                <option value="meter_based">Meter Based</option>
                <option value="monthly_estimated">Monthly Estimated</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-stone-700 mb-1">
                Cost Classification
              </label>
              <select
                value={costClassification}
                onChange={(e) => setCostClassification(e.target.value as 'Fixed' | 'Variable')}
                className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none text-xs bg-white"
              >
                <option value="Fixed">Fixed Cost (Overhead)</option>
                <option value="Variable">Variable Cost (Activity Linked)</option>
              </select>
            </div>
          </div>

          {/* Amount / Rate Input */}
          <div className="bg-stone-50/70 p-3.5 rounded-xl border border-stone-200 space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-bold text-stone-800 flex items-center gap-1.5">
                {calculationMethod === 'percentage_of_revenue' ? (
                  <>
                    <Percent className="h-4 w-4 text-amber-600" />
                    Revenue Percentage Rate (%)
                  </>
                ) : (
                  <>
                    <IndianRupee className="h-4 w-4 text-amber-600" />
                    Monthly Amount (₹)
                  </>
                )}
                <span className="text-rose-500">*</span>
              </label>

              {calculationMethod === 'percentage_of_revenue' && (
                <span className="text-[11px] text-stone-500">
                  DB Value: <strong className="font-mono text-stone-800">{isNumberValid ? (parsedNumber / 100).toFixed(4) : '0.0000'}</strong>
                </span>
              )}
            </div>

            <div className="relative rounded-lg shadow-xs">
              {calculationMethod !== 'percentage_of_revenue' && (
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-stone-400 font-bold">
                  ₹
                </div>
              )}
              <input
                type="number"
                step="any"
                min="0"
                max={calculationMethod === 'percentage_of_revenue' ? '100' : undefined}
                value={rateInput}
                onChange={(e) => setRateInput(e.target.value)}
                placeholder={calculationMethod === 'percentage_of_revenue' ? 'e.g. 10 for 10%' : 'e.g. 3500'}
                className={`w-full py-2.5 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none text-sm font-bold text-stone-900 bg-white ${
                  calculationMethod !== 'percentage_of_revenue' ? 'pl-8 pr-3' : 'pl-3 pr-8'
                }`}
                required
              />
              {calculationMethod === 'percentage_of_revenue' && (
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-stone-500 font-bold">
                  %
                </div>
              )}
            </div>

            <p className="text-[11px] text-stone-500 leading-relaxed">
              {calculationMethod === 'percentage_of_revenue' ? (
                <>
                  Enter standard percentage (e.g. <strong>8</strong> for 8% or <strong>10</strong> for 10%).
                  This is converted to decimal fraction (e.g. 0.08 or 0.10) in the database without calculation distortion.
                </>
              ) : (
                <>
                  Enter fixed monthly rupee cost (e.g. <strong>3,500</strong> for Internet &amp; Telecom).
                  The Daily P&amp;L engine allocates this cost on a per-day basis (÷ days in the active month).
                </>
              )}
            </p>
          </div>

          {/* Effective Date Range */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-stone-700 mb-1 flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-stone-400" />
                Start Date <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none text-xs"
                required
              />
            </div>

            <div>
              <label className="block font-semibold text-stone-700 mb-1 flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-stone-400" />
                End Date (Optional)
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none text-xs"
              />
            </div>
          </div>

          {/* Operational Inclusions & Active Status */}
          <div className="p-3 bg-stone-50 rounded-lg border border-stone-100 space-y-2.5">
            <div className="font-semibold text-stone-800 text-[11px] uppercase tracking-wider">
              Operational Inclusions
            </div>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-stone-300 text-amber-600 focus:ring-amber-500"
              />
              <span className="text-xs text-stone-700 font-medium">
                Active Rule (Enable in current operational computations)
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeInDailyProfit}
                onChange={(e) => setIncludeInDailyProfit(e.target.checked)}
                className="h-4 w-4 rounded border-stone-300 text-amber-600 focus:ring-amber-500"
              />
              <span className="text-xs text-stone-700 font-medium">
                Include in Daily Profit &amp; Loss (P&amp;L) calculations
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeInBreakEven}
                onChange={(e) => setIncludeInBreakEven(e.target.checked)}
                className="h-4 w-4 rounded border-stone-300 text-amber-600 focus:ring-amber-500"
              />
              <span className="text-xs text-stone-700 font-medium">
                Include in Dynamic Break-Even Point (BEP) engine
              </span>
            </label>
          </div>

          {/* Notes */}
          <div>
            <label className="block font-semibold text-stone-700 mb-1 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-stone-400" />
              Operational Notes (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="e.g. Fiber broadband contract monthly billing, 100Mbps dedicated connection."
              className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none text-xs"
            />
          </div>

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-stone-200">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="amber"
              size="sm"
              disabled={saving}
              className="gap-1.5"
            >
              {saving ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Saving Changes...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Save Cost Rule
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
