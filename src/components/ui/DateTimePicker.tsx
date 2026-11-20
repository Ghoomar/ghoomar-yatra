'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Drawer } from 'vaul';
import * as Popover from '@radix-ui/react-popover';
import { DayPicker } from 'react-day-picker';
import { Calendar as CalendarIcon, Clock, Check, X, ChevronDown } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { TimePicker } from '@/components/ui/TimePicker';

export interface DateTimePickerProps {
  value: string; // ISO string: YYYY-MM-DDTHH:mm or YYYY-MM-DD
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  clearable?: boolean;
  name?: string;
  id?: string;
  className?: string;
  triggerClassName?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function parseIso(val?: string) {
  if (!val) {
    const now = new Date();
    return {
      date: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
      time: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`,
      hasValue: false,
    };
  }
  const [datePart, timePart] = val.split('T');
  let d = new Date();
  if (datePart && datePart.includes('-')) {
    const [y, m, day] = datePart.split('-').map(Number);
    if (!isNaN(y) && !isNaN(m) && !isNaN(day)) {
      d = new Date(y, m - 1, day);
    }
  }
  let t = `${pad2(new Date().getHours())}:${pad2(new Date().getMinutes())}`;
  if (timePart) {
    t = timePart.slice(0, 5);
  }
  return { date: d, time: t, hasValue: true };
}

export function formatDateTimeDisplay(val?: string, locale: string = 'en'): string {
  if (!val) return '';
  const [datePart, timePart] = val.split('T');
  if (!datePart || !datePart.includes('-')) return val;
  const [y, m, d] = datePart.split('-').map(Number);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return val;
  const dateObj = new Date(y, m - 1, d);
  const formattedDate = dateObj.toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  if (timePart) {
    const shortTime = timePart.slice(0, 5);
    return `${formattedDate} · ${shortTime}`;
  }
  return formattedDate;
}

export function DateTimePicker({
  value,
  onChange,
  min,
  max,
  placeholder,
  disabled = false,
  required = false,
  clearable = true,
  name,
  id,
  className = '',
  triggerClassName = '',
  'aria-label': ariaLabel,
  'data-testid': testId,
}: DateTimePickerProps) {
  const { t, locale } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const initial = useMemo(() => parseIso(value), [value]);
  const [draftDate, setDraftDate] = useState<Date>(initial.date);
  const [draftTime, setDraftTime] = useState<string>(initial.time);

  // Sync draft state on open
  useEffect(() => {
    if (isOpen) {
      const p = parseIso(value);
      setDraftDate(p.date);
      setDraftTime(p.time);
    }
  }, [isOpen, value]);

  // Mobile viewport detection
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 640);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handleDone = () => {
    const y = draftDate.getFullYear();
    const m = pad2(draftDate.getMonth() + 1);
    const d = pad2(draftDate.getDate());
    const finalIso = `${y}-${m}-${d}T${draftTime || '12:00'}`;
    onChange(finalIso);
    setIsOpen(false);
  };

  const handleNow = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    const now = new Date();
    const y = now.getFullYear();
    const m = pad2(now.getMonth() + 1);
    const d = pad2(now.getDate());
    const t = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
    onChange(`${y}-${m}-${d}T${t}`);
    setDraftDate(new Date(y, now.getMonth(), now.getDate()));
    setDraftTime(t);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onChange('');
  };

  const handleQuickDate = (daysAgo: number) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    setDraftDate(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
  };

  const displayString = useMemo(() => {
    return formatDateTimeDisplay(value, locale);
  }, [value, locale]);

  // Unified picker content
  const renderPickerContent = () => (
    <div className="flex flex-col gap-3 select-none">
      {/* 1. Quick Date Pills */}
      <div className="flex items-center gap-1.5 pb-2 border-b border-stone-100">
        <button
          type="button"
          onClick={() => handleQuickDate(0)}
          className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 transition-colors cursor-pointer"
        >
          {t('common.datePicker.today') || 'Today'}
        </button>
        <button
          type="button"
          onClick={() => handleQuickDate(1)}
          className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 transition-colors cursor-pointer"
        >
          {t('common.datePicker.yesterday') || 'Yesterday'}
        </button>
        <button
          type="button"
          onClick={() => handleQuickDate(2)}
          className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 transition-colors cursor-pointer"
        >
          {t('common.datePicker.twoDaysAgo') || '2 days ago'}
        </button>
      </div>

      {/* 2. Compact Calendar Grid (react-day-picker) */}
      <div className="flex justify-center">
        <DayPicker
          mode="single"
          selected={draftDate}
          onSelect={(d) => d && setDraftDate(d)}
          classNames={{
            root: 'w-full max-w-[300px]',
            months: 'w-full',
            month: 'w-full space-y-2',
            month_caption: 'relative flex justify-center items-center h-8 font-bold text-xs text-stone-900',
            caption_label: 'text-xs font-bold text-stone-900',
            nav: 'absolute inset-x-0 flex items-center justify-between z-10 px-1',
            button_previous:
              'p-1.5 rounded-lg text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer',
            button_next:
              'p-1.5 rounded-lg text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer',
            month_grid: 'w-full border-collapse',
            weekdays: 'grid grid-cols-7 gap-1 text-center mb-1',
            weekday: 'text-[11px] font-bold text-stone-400 py-0.5',
            week: 'grid grid-cols-7 gap-1 mt-0.5',
            day: 'h-8 w-full p-0 flex items-center justify-center font-normal',
            day_button:
              'h-8 w-8 rounded-lg text-xs font-medium flex items-center justify-center transition-all hover:bg-amber-50 hover:text-amber-900 cursor-pointer',
            selected:
              '[&>.rdp-day_button]:bg-amber-600 [&>.rdp-day_button]:text-white [&>.rdp-day_button]:font-bold [&>.rdp-day_button]:hover:bg-amber-700 shadow-2xs',
            today:
              '[&>.rdp-day_button]:border [&>.rdp-day_button]:border-amber-500 [&>.rdp-day_button]:text-amber-900 [&>.rdp-day_button]:font-bold',
            outside: 'text-stone-300 opacity-40',
            disabled: 'text-stone-300 opacity-30 cursor-not-allowed pointer-events-none',
          }}
        />
      </div>

      {/* 3. Inline Time Row */}
      <div className="pt-2 border-t border-stone-100 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-stone-700">
          <Clock className="h-4 w-4 text-amber-600 shrink-0" />
          <span>{t('common.datePicker.time') || 'Time'}</span>
        </div>
        <div className="w-36">
          <TimePicker
            value={draftTime}
            onChange={(val) => setDraftTime(val)}
            triggerClassName="h-9 px-2 text-xs"
          />
        </div>
      </div>

      {/* 4. Action Buttons Footer */}
      <div className="pt-2 border-t border-stone-100 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="px-3.5 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition-colors cursor-pointer"
        >
          {t('common.actions.cancel') || 'Cancel'}
        </button>
        <button
          type="button"
          onClick={handleDone}
          className="px-5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 active:scale-95 rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
        >
          <Check className="h-3.5 w-3.5" />
          <span>{t('common.actions.done') || 'Done'}</span>
        </button>
      </div>
    </div>
  );

  const triggerElement = (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && setIsOpen((prev) => !prev)}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          setIsOpen((prev) => !prev);
        }
      }}
      aria-label={ariaLabel || placeholder || 'Select date and time'}
      className={`
        w-full flex items-center justify-between h-11 px-3 bg-white rounded-xl border transition-all select-none
        border-stone-300 hover:border-stone-400
        focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 focus-visible:border-amber-500
        shadow-2xs cursor-pointer
        ${disabled ? 'bg-stone-100 border-stone-200 cursor-not-allowed opacity-60' : ''}
        ${triggerClassName}
      `}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <CalendarIcon className="h-4 w-4 text-amber-600 shrink-0" />
        <span
          className={`truncate text-xs font-bold ${
            displayString ? 'text-stone-900' : 'text-stone-400'
          }`}
        >
          {displayString || placeholder || t('common.datePicker.selectDateTime') || 'Select Date & Time'}
        </span>
      </div>

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
          className="px-2 py-0.5 text-[10px] font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 active:bg-amber-200 rounded border border-amber-200/70 transition-colors cursor-pointer"
          title={t('common.datePicker.now') || 'Set current time'}
        >
          {t('common.datePicker.now') || 'Now'}
        </button>

        <ChevronDown className="h-3.5 w-3.5 text-stone-400" />
      </div>
    </div>
  );

  return (
    <div className={`relative w-full ${className}`} data-testid={testId}>
      {/* Hidden input for form parity */}
      {name && <input type="hidden" name={name} id={id} value={value || ''} />}

      {/* Mobile: Vaul Bottom Sheet */}
      {isMobile ? (
        <>
          {triggerElement}
          <Drawer.Root open={isOpen} onOpenChange={setIsOpen}>
            <Drawer.Portal>
              <Drawer.Overlay className="fixed inset-0 bg-black/60 z-50 backdrop-blur-xs animate-in fade-in duration-150" />
              <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 max-h-[90dvh] bg-white rounded-t-2xl shadow-2xl flex flex-col outline-none overflow-hidden pb-[max(1rem,env(safe-area-inset-bottom))] animate-in slide-in-from-bottom duration-200">
                <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-stone-300 my-2.5" />
                <div className="px-4 pb-4 overflow-y-auto max-w-sm mx-auto w-full">
                  {renderPickerContent()}
                </div>
              </Drawer.Content>
            </Drawer.Portal>
          </Drawer.Root>
        </>
      ) : (
        /* Desktop: Radix Popover with Anchor */
        <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
          <Popover.Anchor asChild>
            {triggerElement}
          </Popover.Anchor>
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={6}
              className="z-50 w-[320px] rounded-2xl border border-stone-200 bg-white p-3.5 shadow-xl outline-none animate-in fade-in zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
            >
              {renderPickerContent()}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </div>
  );
}
