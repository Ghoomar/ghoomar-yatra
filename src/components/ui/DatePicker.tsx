'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Drawer } from 'vaul';
import * as Popover from '@radix-ui/react-popover';
import { DayPicker } from 'react-day-picker';
import { Calendar as CalendarIcon, Check, X, ChevronDown } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';

export interface DatePickerProps {
  value: string; // ISO YYYY-MM-DD
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  clearable?: boolean;
  hideIcon?: boolean;
  hideChevron?: boolean;
  name?: string;
  id?: string;
  className?: string;
  triggerClassName?: string;
  autoFocus?: boolean;
  'aria-label'?: string;
  'data-testid'?: string;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function parseIsoDate(val?: string): Date | undefined {
  if (!val || !val.includes('-')) return undefined;
  const [y, m, d] = val.split('-').map(Number);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return undefined;
  return new Date(y, m - 1, d);
}

function formatIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function formatDisplayDate(val?: string, locale: string = 'en'): string {
  if (!val) return '';
  const d = parseIsoDate(val);
  if (!d) return val;
  return d.toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder,
  disabled = false,
  required = false,
  clearable = true,
  hideIcon = false,
  hideChevron = false,
  name,
  id,
  className = '',
  triggerClassName = '',
  'aria-label': ariaLabel,
  'data-testid': testId,
}: DatePickerProps) {
  const { t, locale } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const selectedDate = useMemo(() => parseIsoDate(value), [value]);
  const [draftDate, setDraftDate] = useState<Date>(selectedDate || new Date());

  useEffect(() => {
    if (isOpen) {
      setDraftDate(parseIsoDate(value) || new Date());
    }
  }, [isOpen, value]);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 640);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handleSelectDay = (date?: Date) => {
    if (!date) return;
    setDraftDate(date);
    onChange(formatIsoDate(date));
    setIsOpen(false);
  };

  const handleQuickToday = () => {
    const today = new Date();
    setDraftDate(today);
    onChange(formatIsoDate(today));
    setIsOpen(false);
  };

  const handleQuickYesterday = () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    setDraftDate(yesterday);
    onChange(formatIsoDate(yesterday));
    setIsOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onChange('');
  };

  const displayString = useMemo(() => {
    return formatDisplayDate(value, locale);
  }, [value, locale]);

  const renderCalendar = () => (
    <div className="flex flex-col gap-2.5 select-none">
      {/* Quick Pills */}
      <div className="flex items-center gap-1.5 pb-2 border-b border-stone-100">
        <button
          type="button"
          onClick={handleQuickToday}
          className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 transition-colors cursor-pointer"
        >
          {t('common.datePicker.today') || 'Today'}
        </button>
        <button
          type="button"
          onClick={handleQuickYesterday}
          className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 transition-colors cursor-pointer"
        >
          {t('common.datePicker.yesterday') || 'Yesterday'}
        </button>
      </div>

      {/* Calendar Grid */}
      <div className="flex justify-center">
        <DayPicker
          mode="single"
          selected={draftDate}
          onSelect={handleSelectDay}
          classNames={{
            root: 'w-full max-w-[280px]',
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

      {/* Footer */}
      <div className="pt-2 border-t border-stone-100 flex items-center justify-between text-xs">
        {clearable && !required && value ? (
          <button
            type="button"
            onClick={handleClear}
            className="text-stone-400 hover:text-rose-600 font-medium transition-colors cursor-pointer"
          >
            {t('common.datePicker.clear') || 'Clear'}
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="px-3.5 py-1.5 rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-100 font-semibold cursor-pointer"
        >
          {t('common.actions.close') || 'Close'}
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
      aria-label={ariaLabel || placeholder || 'Select date'}
      className={`
        w-full flex items-center justify-between h-10 px-3 bg-white rounded-xl border transition-all select-none
        border-stone-300 hover:border-stone-400
        focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 focus-visible:border-amber-500
        shadow-2xs cursor-pointer
        ${disabled ? 'bg-stone-100 border-stone-200 cursor-not-allowed opacity-60' : ''}
        ${triggerClassName}
      `}
    >
      <div className={`flex items-center gap-2 flex-1 min-w-0 ${hideIcon && hideChevron ? 'justify-center text-center' : ''}`}>
        {!hideIcon && <CalendarIcon className="h-4 w-4 text-amber-600 shrink-0" />}
        <span
          className={`truncate text-xs font-bold ${
            displayString ? 'text-stone-900' : 'text-stone-400'
          }`}
        >
          {displayString || placeholder || t('common.datePicker.selectDate') || 'Select Date'}
        </span>
      </div>

      {(!hideChevron || (clearable && !required && !disabled && value)) && (
        <div className="flex items-center gap-1 shrink-0 ml-1">
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
          {!hideChevron && <ChevronDown className="h-3.5 w-3.5 text-stone-400" />}
        </div>
      )}
    </div>
  );

  return (
    <div className={`relative w-full ${className}`} data-testid={testId}>
      {name && <input type="hidden" name={name} id={id} value={value || ''} />}

      {/* Mobile: Vaul Drawer */}
      {isMobile ? (
        <>
          {triggerElement}
          <Drawer.Root open={isOpen} onOpenChange={setIsOpen}>
            <Drawer.Portal>
              <Drawer.Overlay className="fixed inset-0 bg-black/60 z-50 backdrop-blur-xs animate-in fade-in duration-150" />
              <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 max-h-[85dvh] bg-white rounded-t-2xl shadow-2xl flex flex-col outline-none overflow-hidden pb-[max(1rem,env(safe-area-inset-bottom))] animate-in slide-in-from-bottom duration-200">
                <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-stone-300 my-2.5" />
                <div className="px-4 pb-4 overflow-y-auto max-w-xs mx-auto w-full">
                  {renderCalendar()}
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
              className="z-50 w-[300px] rounded-2xl border border-stone-200 bg-white p-3.5 shadow-xl outline-none animate-in fade-in zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
            >
              {renderCalendar()}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </div>
  );
}
