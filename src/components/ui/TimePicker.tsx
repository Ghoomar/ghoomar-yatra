'use client';

import React, { useMemo } from 'react';
import { TimeField, DateInput, DateSegment, TimeValue } from 'react-aria-components';
import { Time } from '@internationalized/date';
import { Clock, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';

export interface TimePickerProps {
  value: string; // "HH:mm" (24-hour e.g. "14:30") or "hh:mm AM/PM" (12-hour e.g. "11:57 PM")
  onChange: (value: string) => void;
  hourCycle?: 12 | 24;
  hideIcon?: boolean;
  hideNow?: boolean;
  onNow?: () => void;
  disabled?: boolean;
  required?: boolean;
  clearable?: boolean;
  name?: string;
  id?: string;
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function parseTimeString(val?: string): { time: Time; h: number; m: number; isPM: boolean } | null {
  if (!val) return null;
  const match = val.trim().match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!match) return null;
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const p = match[3]?.toUpperCase();
  if (isNaN(h) || isNaN(m) || m < 0 || m > 59) return null;

  let isPM = false;
  if (p) {
    if (h < 1 || h > 12) return null;
    isPM = p === 'PM';
    if (p === 'PM' && h < 12) h += 12;
    if (p === 'AM' && h === 12) h = 0;
  } else {
    if (h < 0 || h > 23) return null;
    isPM = h >= 12;
  }
  return { time: new Time(h, m), h, m, isPM };
}

export function formatTime(h: number, m: number, cycle: 12 | 24 = 24): string {
  if (cycle === 12) {
    const isPM = h >= 12;
    let h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return `${pad2(h12)}:${pad2(m)} ${isPM ? 'PM' : 'AM'}`;
  }
  return `${pad2(h)}:${pad2(m)}`;
}

export function time12To24(timeStr?: string): string {
  const p = parseTimeString(timeStr);
  if (!p) return '12:00';
  return `${pad2(p.h)}:${pad2(p.m)}`;
}

export function TimePicker({
  value,
  onChange,
  hourCycle = 24,
  hideIcon = false,
  hideNow = false,
  onNow,
  disabled = false,
  required = false,
  clearable = false,
  name,
  id,
  placeholder = 'HH:mm',
  className = '',
  triggerClassName = '',
  'aria-label': ariaLabel,
  'data-testid': testId,
}: TimePickerProps) {
  const { t } = useI18n();

  const parsed = useMemo(() => parseTimeString(value), [value]);
  const timeVal = useMemo(() => (parsed ? parsed.time : null), [parsed]);
  const isPM = parsed ? parsed.isPM : false;

  const handleTimeChange = (v: TimeValue | null) => {
    if (v) {
      onChange(formatTime(v.hour, v.minute, hourCycle));
    } else {
      onChange('');
    }
  };

  const handleNow = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onNow) {
      onNow();
      return;
    }
    const now = new Date();
    onChange(formatTime(now.getHours(), now.getMinutes(), hourCycle));
  };

  const handleSetPeriod = (targetPeriod: 'AM' | 'PM') => {
    const curH = parsed ? parsed.h : (targetPeriod === 'PM' ? 12 : 9);
    const curM = parsed ? parsed.m : 0;
    const isCurPM = curH >= 12;
    let newH = curH;
    if (targetPeriod === 'PM' && !isCurPM) {
      newH = curH + 12;
    } else if (targetPeriod === 'AM' && isCurPM) {
      newH = curH - 12;
    }
    onChange(formatTime(newH, curM, hourCycle));
  };

  const handleClear = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onChange('');
  };

  return (
    <div className={`relative w-full ${className}`} data-testid={testId}>
      {/* Hidden input for form submission parity */}
      {name && <input type="hidden" name={name} id={id} value={value || ''} />}

      <TimeField
        hourCycle={hourCycle}
        value={timeVal}
        onChange={handleTimeChange}
        isDisabled={disabled}
        isRequired={required}
        aria-label={ariaLabel || placeholder || 'Time'}
        className="w-full"
      >
        <div
          className={`
            flex items-center justify-between h-11 px-3 bg-white rounded-xl border transition-all
            border-stone-300 hover:border-stone-400
            focus-within:border-amber-500 focus-within:ring-2 focus-within:ring-amber-500/20
            shadow-2xs
            ${disabled ? 'bg-stone-100 border-stone-200 cursor-not-allowed opacity-60' : ''}
            ${triggerClassName}
          `}
        >
          {/* Left: Optional Clock Icon + Segmented Input + 12h AM/PM toggle */}
          <div className={`flex items-center gap-1.5 min-w-0 ${triggerClassName.includes('justify-center') || (hideNow && hourCycle === 24) ? 'w-full justify-center' : 'flex-1'}`}>
            {!hideIcon && <Clock className="h-4 w-4 text-amber-600 shrink-0" />}
            <DateInput className="flex items-center gap-0.5 font-mono text-sm sm:text-base font-bold text-stone-900 select-none shrink-0 tabular-nums">
              {(segment) => {
                const isHidden =
                  segment.type === 'dayPeriod' ||
                  (segment.type === 'literal' && !segment.text.includes(':'));
                return (
                  <DateSegment
                    segment={segment}
                    className={
                      isHidden
                        ? 'hidden pointer-events-none'
                        : 'px-1 py-0.5 rounded-md font-mono text-stone-900 transition-colors focus:bg-amber-100 focus:text-amber-900 focus:outline-none data-[placeholder]:text-stone-400 caret-transparent'
                    }
                  />
                );
              }}
            </DateInput>

            {hourCycle === 12 && (
              <div className="flex items-center rounded-lg bg-stone-100 p-0.5 border border-stone-200/80 text-[10px] font-bold select-none shrink-0 ml-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSetPeriod('AM');
                  }}
                  disabled={disabled}
                  className={`px-1.5 py-0.5 rounded transition-all cursor-pointer ${
                    !isPM
                      ? 'bg-amber-600 text-white font-extrabold shadow-2xs'
                      : 'text-stone-500 hover:text-stone-800'
                  }`}
                  aria-label="Set AM"
                >
                  AM
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSetPeriod('PM');
                  }}
                  disabled={disabled}
                  className={`px-1.5 py-0.5 rounded transition-all cursor-pointer ${
                    isPM
                      ? 'bg-amber-600 text-white font-extrabold shadow-2xs'
                      : 'text-stone-500 hover:text-stone-800'
                  }`}
                  aria-label="Set PM"
                >
                  PM
                </button>
              </div>
            )}
          </div>

          {/* Right: Actions (Clear + 1-Tap Now pill if not hidden) */}
          {(!hideNow || (clearable && !required && !disabled && value)) && (
            <div className="flex items-center gap-1.5 shrink-0 ml-2">
              {clearable && !required && !disabled && value && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="p-1 rounded-md text-stone-400 hover:text-stone-700 transition-colors cursor-pointer"
                  aria-label={t('common.datePicker.clear') || 'Clear'}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}

              {!hideNow && (
                <button
                  type="button"
                  onClick={handleNow}
                  disabled={disabled}
                  className="px-2.5 py-1 text-[11px] font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 active:bg-amber-200 rounded-lg border border-amber-200/70 transition-colors cursor-pointer select-none"
                  title={t('common.datePicker.now') || 'Set current time'}
                >
                  {t('common.datePicker.now') || 'Now'}
                </button>
              )}
            </div>
          )}
        </div>
      </TimeField>
    </div>
  );
}
