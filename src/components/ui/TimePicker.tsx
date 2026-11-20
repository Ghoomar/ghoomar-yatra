'use client';

import React, { useMemo } from 'react';
import { TimeField, DateInput, DateSegment, TimeValue } from 'react-aria-components';
import { Time } from '@internationalized/date';
import { Clock, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';

export interface TimePickerProps {
  value: string; // "HH:mm" (24-hour format e.g. "14:30")
  onChange: (value: string) => void;
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

function parseTimeString(val?: string): Time | null {
  if (!val) return null;
  const parts = val.split(':');
  if (parts.length < 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return new Time(h, m);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function TimePicker({
  value,
  onChange,
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

  const timeVal = useMemo(() => parseTimeString(value), [value]);

  const handleTimeChange = (v: TimeValue | null) => {
    if (v) {
      onChange(`${pad2(v.hour)}:${pad2(v.minute)}`);
    } else {
      onChange('');
    }
  };

  const handleNow = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const now = new Date();
    onChange(`${pad2(now.getHours())}:${pad2(now.getMinutes())}`);
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
        hourCycle={24}
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
          {/* Left: Clock Icon + Segmented Input */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Clock className="h-4 w-4 text-amber-600 shrink-0" />
            <DateInput className="flex items-center gap-0.5 font-mono text-sm sm:text-base font-bold text-stone-900 select-none">
              {(segment) => (
                <DateSegment
                  segment={segment}
                  className="px-1 py-0.5 rounded-md font-mono text-stone-900 transition-colors focus:bg-amber-100 focus:text-amber-900 focus:outline-none data-[placeholder]:text-stone-400 caret-transparent"
                />
              )}
            </DateInput>
          </div>

          {/* Right: Actions (Clear + 1-Tap Now pill) */}
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

            <button
              type="button"
              onClick={handleNow}
              disabled={disabled}
              className="px-2.5 py-1 text-[11px] font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 active:bg-amber-200 rounded-lg border border-amber-200/70 transition-colors cursor-pointer select-none"
              title={t('common.datePicker.now') || 'Set current time'}
            >
              {t('common.datePicker.now') || 'Now'}
            </button>
          </div>
        </div>
      </TimeField>
    </div>
  );
}
