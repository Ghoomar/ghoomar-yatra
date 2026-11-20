'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Calendar as CalendarIcon, Clock, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, X, AlertCircle, Check, Edit3 } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import {
  formatToDisplay,
  parseDisplayToISO,
  getTodayISO,
  getYesterdayISO,
  getCalendarGrid,
  isDateDisabled,
  padZero,
  formatTime24,
  CalendarDay,
} from '@/lib/date/date-picker-utils';

export interface DateTimePickerProps {
  value: string; // ISO string e.g. YYYY-MM-DDTHH:mm or full ISO
  onChange: (value: string) => void;
  min?: string; // ISO YYYY-MM-DD or YYYY-MM-DDTHH:mm
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

export function DateTimePicker({
  value,
  onChange,
  min,
  max,
  placeholder = 'DD-MM-YYYY HH:mm',
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
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Manual mode state on mobile bottom sheet
  const [manualMode, setManualMode] = useState(false);
  const [mobileManualDate, setMobileManualDate] = useState('');
  const [mobileManualError, setMobileManualError] = useState<string | null>(null);

  // Parse initial date part and time part
  const parseVal = useCallback((valStr?: string) => {
    if (!valStr) return { date: '', time: '12:00' };
    const parts = valStr.split('T');
    const date = parts[0] || '';
    let time = '12:00';
    if (parts.length > 1) {
      time = parts[1].slice(0, 5);
    }
    return { date, time: formatTime24(time) };
  }, []);

  const { date: initialDate, time: initialTime } = parseVal(value);
  const [selectedDate, setSelectedDate] = useState<string>(initialDate);
  const [selectedHour, setSelectedHour] = useState<number>(() => {
    const h = parseInt(initialTime.split(':')[0], 10);
    return isNaN(h) ? 12 : h;
  });
  const [selectedMinute, setSelectedMinute] = useState<number>(() => {
    const m = parseInt(initialTime.split(':')[1], 10);
    return isNaN(m) ? 0 : m;
  });

  // Display text formatted as DD-MM-YYYY HH:mm
  const formatDateTimeDisplay = (d: string, h: number, m: number) => {
    if (!d) return '';
    return `${formatToDisplay(d)} ${padZero(h)}:${padZero(m)}`;
  };

  const [typedText, setTypedText] = useState(() =>
    initialDate ? formatDateTimeDisplay(initialDate, selectedHour, selectedMinute) : ''
  );
  const [inputError, setInputError] = useState<string | null>(null);

  // Desktop popover positioning
  const [popoverCoords, setPopoverCoords] = useState<{ top: number; left: number } | null>(null);

  // Mobile virtual keyboard resilience via window.visualViewport
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [viewportOffsetTop, setViewportOffsetTop] = useState<number>(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);

  // Calendar view year and month
  const [viewYear, setViewYear] = useState<number>(() => {
    if (initialDate && initialDate.length >= 4) {
      const y = parseInt(initialDate.slice(0, 4), 10);
      if (!isNaN(y)) return y;
    }
    return new Date().getFullYear();
  });

  const [viewMonth, setViewMonth] = useState<number>(() => {
    if (initialDate && initialDate.length >= 7) {
      const m = parseInt(initialDate.slice(5, 7), 10);
      if (!isNaN(m) && m >= 1 && m <= 12) return m;
    }
    return new Date().getMonth() + 1;
  });

  // Sync with value prop changes
  useEffect(() => {
    const { date, time } = parseVal(value);
    setSelectedDate(date);
    const h = parseInt(time.split(':')[0], 10);
    const m = parseInt(time.split(':')[1], 10);
    const validH = isNaN(h) ? 12 : h;
    const validM = isNaN(m) ? 0 : m;
    setSelectedHour(validH);
    setSelectedMinute(validM);

    if (date) {
      setTypedText(formatDateTimeDisplay(date, validH, validM));
      setMobileManualDate(formatToDisplay(date));
      const y = parseInt(date.slice(0, 4), 10);
      const mon = parseInt(date.slice(5, 7), 10);
      if (!isNaN(y) && !isNaN(mon)) {
        setViewYear(y);
        setViewMonth(mon);
      }
    } else {
      setTypedText('');
      setMobileManualDate('');
    }
    setInputError(null);
    setMobileManualError(null);
  }, [value, parseVal]);

  // Mobile detection
  useEffect(() => {
    setMounted(true);
    const media = window.matchMedia('(max-width: 639px)');
    const updateMobile = () => setIsMobile(media.matches);
    updateMobile();
    media.addEventListener('change', updateMobile);
    return () => media.removeEventListener('change', updateMobile);
  }, []);

  // Track window.visualViewport for mobile Android keyboard resilience
  useEffect(() => {
    if (!isOpen || !isMobile || typeof window === 'undefined') return;
    const vv = window.visualViewport;
    if (!vv) return;

    const handleViewportChange = () => {
      setViewportHeight(vv.height);
      setViewportOffsetTop(vv.offsetTop);
    };
    handleViewportChange();
    vv.addEventListener('resize', handleViewportChange);
    vv.addEventListener('scroll', handleViewportChange);
    return () => {
      vv.removeEventListener('resize', handleViewportChange);
      vv.removeEventListener('scroll', handleViewportChange);
      setViewportHeight(null);
      setViewportOffsetTop(0);
    };
  }, [isOpen, isMobile]);

  // Reset manualMode on modal close
  useEffect(() => {
    if (!isOpen) {
      setManualMode(false);
      setMobileManualError(null);
    }
  }, [isOpen]);

  // Autofocus mobile manual entry input when switching to manualMode
  useEffect(() => {
    if (manualMode && isMobile) {
      setMobileManualDate(formatToDisplay(selectedDate));
      setMobileManualError(null);
      const timer = setTimeout(() => {
        manualInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [manualMode, isMobile, selectedDate]);

  // Update desktop coordinates
  const updateCoords = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const popoverWidth = 320;
    const popoverHeight = 420;

    let left = rect.left + window.scrollX;
    if (left + popoverWidth > window.innerWidth - 16) {
      left = Math.max(16, window.innerWidth - popoverWidth - 16 + window.scrollX);
    }

    let top = rect.bottom + window.scrollY + 6;
    if (rect.bottom + popoverHeight > window.innerHeight && rect.top > popoverHeight) {
      top = rect.top + window.scrollY - popoverHeight - 6;
    }

    setPopoverCoords({ top, left });
  }, []);

  useEffect(() => {
    if (!isOpen || isMobile) return;
    updateCoords();

    const handleScrollOrResize = () => updateCoords();
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);
    return () => {
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [isOpen, isMobile, updateCoords]);

  // Close desktop on outside click
  useEffect(() => {
    if (!isOpen || isMobile) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, isMobile]);

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Prevent background scroll on mobile
  useEffect(() => {
    if (isOpen && isMobile) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prevOverflow;
      };
    }
  }, [isOpen, isMobile]);

  const commitDateTime = (d: string, h: number, m: number) => {
    if (!d) return;
    const isoDateTime = `${d}T${padZero(h)}:${padZero(m)}`;
    onChange(isoDateTime);
    setTypedText(formatDateTimeDisplay(d, h, m));
    setMobileManualDate(formatToDisplay(d));
    setInputError(null);
  };

  const handleSelectDay = (cell: CalendarDay) => {
    if (cell.isDisabled) return;
    setSelectedDate(cell.iso);
    commitDateTime(cell.iso, selectedHour, selectedMinute);
  };

  const handleNow = () => {
    const now = new Date();
    const today = getTodayISO();
    const h = now.getHours();
    const m = now.getMinutes();
    setSelectedDate(today);
    setSelectedHour(h);
    setSelectedMinute(m);
    commitDateTime(today, h, m);
    setIsOpen(false);
  };

  const handleClear = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    onChange('');
    setSelectedDate('');
    setTypedText('');
    setMobileManualDate('');
    setInputError(null);
    setMobileManualError(null);
  };

  const handleHourChange = (newH: number) => {
    const clamped = Math.max(0, Math.min(23, newH));
    setSelectedHour(clamped);
    if (selectedDate) {
      commitDateTime(selectedDate, clamped, selectedMinute);
    }
  };

  const handleMinuteChange = (newM: number) => {
    const clamped = Math.max(0, Math.min(59, newM));
    setSelectedMinute(clamped);
    if (selectedDate) {
      commitDateTime(selectedDate, selectedHour, clamped);
    }
  };

  // Month navigation
  const handlePrevMonth = () => {
    if (viewMonth === 1) {
      setViewMonth(12);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 12) {
      setViewMonth(1);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  // Manual typing handler on desktop
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setTypedText(text);

    if (!text.trim()) {
      setInputError(null);
      if (!required) onChange('');
      return;
    }

    // Try parsing: DD-MM-YYYY HH:mm
    const parts = text.trim().split(/\s+/);
    const datePart = parseDisplayToISO(parts[0]);
    if (datePart) {
      let h = selectedHour;
      let m = selectedMinute;
      if (parts[1]) {
        const timeParts = parts[1].split(':');
        if (timeParts.length >= 2) {
          const parsedH = parseInt(timeParts[0], 10);
          const parsedM = parseInt(timeParts[1], 10);
          if (!isNaN(parsedH) && parsedH >= 0 && parsedH <= 23) h = parsedH;
          if (!isNaN(parsedM) && parsedM >= 0 && parsedM <= 59) m = parsedM;
        }
      }
      setSelectedDate(datePart);
      setSelectedHour(h);
      setSelectedMinute(m);
      setInputError(null);
      onChange(`${datePart}T${padZero(h)}:${padZero(m)}`);
    } else {
      if (text.length >= 10) {
        setInputError(t('common.datePicker.invalidDate'));
      }
    }
  };

  const handleInputBlur = () => {
    if (!typedText.trim()) {
      if (value) onChange('');
      setInputError(null);
      return;
    }
    if (selectedDate) {
      setTypedText(formatDateTimeDisplay(selectedDate, selectedHour, selectedMinute));
      setInputError(null);
    } else if (value) {
      const { date, time } = parseVal(value);
      setTypedText(date ? `${formatToDisplay(date)} ${time}` : '');
      setInputError(null);
    } else {
      setInputError(t('common.datePicker.invalidDate'));
    }
  };

  // Mobile Manual submission
  const handleApplyMobileManual = () => {
    if (!mobileManualDate.trim()) {
      if (!required) {
        onChange('');
        setSelectedDate('');
        setTypedText('');
        setMobileManualDate('');
        setInputError(null);
        setMobileManualError(null);
        setIsOpen(false);
      } else {
        setMobileManualError(t('common.datePicker.invalidDate'));
      }
      return;
    }

    const iso = parseDisplayToISO(mobileManualDate);
    if (iso) {
      if (isDateDisabled(iso, min, max)) {
        setMobileManualError('Date out of allowed range');
      } else {
        setMobileManualError(null);
        setInputError(null);
        setSelectedDate(iso);
        commitDateTime(iso, selectedHour, selectedMinute);
        setIsOpen(false);
      }
    } else {
      setMobileManualError(t('common.datePicker.invalidDate'));
    }
  };

  const weekdayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

  const monthOptions = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => i + 1).map((m) => ({
      value: m,
      label: t(`common.datePicker.months.${m}` as any),
    }));
  }, [t]);

  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const startYear = Math.min(2018, viewYear - 5);
    const endYear = Math.max(currentYear + 5, 2035);
    const years: number[] = [];
    for (let y = startYear; y <= endYear; y++) years.push(y);
    return years;
  }, [viewYear]);

  const calendarGrid = useMemo(() => {
    return getCalendarGrid(viewYear, viewMonth, selectedDate, min, max);
  }, [viewYear, viewMonth, selectedDate, min, max]);

  const renderContent = () => (
    <div className="p-3 select-none flex flex-col gap-2.5">
      {/* Month & Year Navigation Header */}
      <div className="flex items-center justify-between gap-1 pb-1 border-b border-stone-100">
        <button
          type="button"
          onClick={handlePrevMonth}
          aria-label={t('common.datePicker.previousMonth')}
          className="p-1.5 rounded-lg text-stone-500 hover:text-stone-900 hover:bg-stone-100 active:scale-95 transition-all cursor-pointer"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-1.5 font-semibold text-stone-800 text-xs">
          <select
            value={viewMonth}
            onChange={(e) => setViewMonth(parseInt(e.target.value, 10))}
            className="bg-stone-50 hover:bg-stone-100 text-stone-900 rounded-md py-1 px-1.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer border border-stone-200"
          >
            {monthOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <select
            value={viewYear}
            onChange={(e) => setViewYear(parseInt(e.target.value, 10))}
            className="bg-stone-50 hover:bg-stone-100 text-stone-900 rounded-md py-1 px-1.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer border border-stone-200"
          >
            {yearOptions.map((yr) => (
              <option key={yr} value={yr}>
                {yr}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={handleNextMonth}
          aria-label={t('common.datePicker.nextMonth')}
          className="p-1.5 rounded-lg text-stone-500 hover:text-stone-900 hover:bg-stone-100 active:scale-95 transition-all cursor-pointer"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Weekdays */}
      <div className="grid grid-cols-7 gap-1 text-center">
        {weekdayKeys.map((wKey) => (
          <div key={wKey} className="text-[11px] font-bold text-stone-400 py-0.5">
            {t(`common.datePicker.weekdaysShort.${wKey}` as any)}
          </div>
        ))}
      </div>

      {/* Day Cells Grid */}
      <div className="grid grid-cols-7 gap-1">
        {calendarGrid.map((cell, idx) => {
          let btnClass = 'h-9 sm:h-7.5 w-full rounded-md text-xs font-medium flex items-center justify-center transition-all cursor-pointer ';
          if (cell.isSelected) {
            btnClass += 'bg-amber-600 text-white font-bold shadow-xs hover:bg-amber-700';
          } else if (cell.isDisabled) {
            btnClass += 'text-stone-300 opacity-40 cursor-not-allowed pointer-events-none';
          } else if (cell.isToday) {
            btnClass += 'border border-amber-500 text-amber-900 font-bold bg-amber-50/50 hover:bg-amber-100';
          } else if (!cell.isCurrentMonth) {
            btnClass += 'text-stone-350 hover:text-stone-700 hover:bg-stone-100';
          } else {
            btnClass += 'text-stone-800 hover:bg-amber-50 hover:text-amber-900 active:scale-95';
          }

          return (
            <button
              key={`${cell.iso}-${idx}`}
              type="button"
              disabled={cell.isDisabled}
              onClick={() => handleSelectDay(cell)}
              className={btnClass}
            >
              {cell.day}
            </button>
          );
        })}
      </div>

      {/* 24-HOUR TIME SELECTOR SECTION */}
      <div className="pt-2 pb-1.5 border-t border-stone-200 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-stone-700 font-semibold">
          <Clock className="h-4 w-4 text-amber-600 shrink-0" />
          <span>{t('common.datePicker.time')}:</span>
        </div>

        <div className="flex items-center gap-1.5 bg-stone-50 border border-stone-200 rounded-lg p-1">
          {/* Hour Stepper */}
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => handleHourChange((selectedHour - 1 + 24) % 24)}
              className="p-1 rounded text-stone-500 hover:bg-stone-200 hover:text-stone-800 transition-colors cursor-pointer"
              aria-label="Decrease Hour"
            >
              <ChevronDown className="h-3 w-3" />
            </button>
            <span className="w-6 text-center font-mono text-xs font-bold text-stone-900 select-none">
              {padZero(selectedHour)}
            </span>
            <button
              type="button"
              onClick={() => handleHourChange((selectedHour + 1) % 24)}
              className="p-1 rounded text-stone-500 hover:bg-stone-200 hover:text-stone-800 transition-colors cursor-pointer"
              aria-label="Increase Hour"
            >
              <ChevronUp className="h-3 w-3" />
            </button>
          </div>

          <span className="font-bold text-stone-400 select-none">:</span>

          {/* Minute Stepper */}
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => handleMinuteChange((selectedMinute - 1 + 60) % 60)}
              className="p-1 rounded text-stone-500 hover:bg-stone-200 hover:text-stone-800 transition-colors cursor-pointer"
              aria-label="Decrease Minute"
            >
              <ChevronDown className="h-3 w-3" />
            </button>
            <span className="w-6 text-center font-mono text-xs font-bold text-stone-900 select-none">
              {padZero(selectedMinute)}
            </span>
            <button
              type="button"
              onClick={() => handleMinuteChange((selectedMinute + 1) % 60)}
              className="p-1 rounded text-stone-500 hover:bg-stone-200 hover:text-stone-800 transition-colors cursor-pointer"
              aria-label="Increase Minute"
            >
              <ChevronUp className="h-3 w-3" />
            </button>
          </div>

          <span className="text-[10px] font-bold text-amber-700 bg-amber-100/60 px-1 py-0.2 rounded ml-0.5 select-none">
            24H
          </span>
        </div>
      </div>

      {/* Shortcuts & Action Footer */}
      <div className="pt-2 border-t border-stone-100 flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleNow}
            className="px-2.5 py-1 text-[11px] font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-md transition-colors cursor-pointer"
          >
            {t('common.datePicker.now')}
          </button>
          {clearable && !required && (
            <button
              type="button"
              onClick={() => handleClear()}
              className="px-2 py-1 text-[11px] font-medium text-stone-400 hover:text-rose-600 rounded-md transition-colors cursor-pointer"
            >
              {t('common.datePicker.clear')}
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="px-3 py-1 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-md transition-all shadow-xs flex items-center gap-1 cursor-pointer"
        >
          <Check className="h-3.5 w-3.5" />
          {t('common.datePicker.done')}
        </button>
      </div>
    </div>
  );

  // Dedicated Mobile Manual Entry Mode Content
  const renderMobileManualContent = () => (
    <div className="flex flex-col">
      {/* Header with Back to Calendar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
        <button
          type="button"
          onClick={() => setManualMode(false)}
          className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 hover:text-amber-800 p-1 -ml-1 rounded-md hover:bg-amber-50 cursor-pointer transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          <CalendarIcon className="h-3.5 w-3.5" />
          <span>{t('common.datePicker.backToCalendar')}</span>
        </button>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="p-1 rounded-full text-stone-400 hover:text-stone-700 hover:bg-stone-100 cursor-pointer"
          aria-label={t('common.actions.close')}
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="p-4 flex flex-col gap-3.5">
        <div>
          <label className="block text-xs font-bold text-stone-800 mb-1">
            {t('common.datePicker.enterDateTimeManually')}
          </label>
          <p className="text-[11px] text-stone-500 mb-2">
            {t('common.datePicker.manualEntryHint')}
          </p>
          <div className="relative">
            <input
              ref={manualInputRef}
              type="text"
              inputMode="numeric"
              value={mobileManualDate}
              onChange={(e) => {
                setMobileManualDate(e.target.value);
                setMobileManualError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleApplyMobileManual();
                }
              }}
              placeholder="DD-MM-YYYY"
              className={`w-full text-base font-bold text-stone-900 px-3.5 py-2.5 rounded-xl border bg-stone-50/50 focus:bg-white focus:outline-none transition-all ${
                mobileManualError
                  ? 'border-rose-400 ring-2 ring-rose-300/40 bg-rose-50/20'
                  : 'border-stone-300 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20'
              }`}
            />
            {mobileManualDate && (
              <button
                type="button"
                onClick={() => {
                  setMobileManualDate('');
                  setMobileManualError(null);
                  manualInputRef.current?.focus();
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-stone-400 hover:text-stone-600 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {mobileManualError && (
            <p className="text-xs text-rose-600 font-medium mt-1.5 flex items-center gap-1 animate-in fade-in">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>{mobileManualError}</span>
            </p>
          )}
        </div>

        {/* Time Selector in Manual Mode */}
        <div className="pt-2 pb-1 border-t border-stone-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs text-stone-700 font-semibold">
            <Clock className="h-4 w-4 text-amber-600 shrink-0" />
            <span>{t('common.datePicker.time')}:</span>
          </div>

          <div className="flex items-center gap-1">
            <div className="flex items-center bg-stone-50 border border-stone-200 rounded-lg p-0.5">
              <select
                value={selectedHour}
                onChange={(e) => handleHourChange(parseInt(e.target.value, 10))}
                aria-label={t('common.datePicker.hour')}
                className="bg-transparent text-xs font-bold text-stone-900 py-1 px-1.5 focus:outline-none cursor-pointer"
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>
                    {padZero(i)}
                  </option>
                ))}
              </select>
            </div>

            <span className="font-bold text-stone-400">:</span>

            <div className="flex items-center bg-stone-50 border border-stone-200 rounded-lg p-0.5">
              <select
                value={selectedMinute}
                onChange={(e) => handleMinuteChange(parseInt(e.target.value, 10))}
                aria-label={t('common.datePicker.minute')}
                className="bg-transparent text-xs font-bold text-stone-900 py-1 px-1.5 focus:outline-none cursor-pointer"
              >
                {Array.from({ length: 60 }, (_, i) => (
                  <option key={i} value={i}>
                    {padZero(i)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Quick helper shortcuts */}
        <div className="flex items-center gap-2 pt-0.5">
          <button
            type="button"
            onClick={() => {
              const today = getTodayISO();
              setMobileManualDate(formatToDisplay(today));
              setMobileManualError(null);
            }}
            className="px-2.5 py-1 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg border border-amber-200/80 cursor-pointer transition-colors"
          >
            {t('common.datePicker.today')}
          </button>
          <button
            type="button"
            onClick={() => {
              const now = new Date();
              const today = getTodayISO();
              setMobileManualDate(formatToDisplay(today));
              setSelectedHour(now.getHours());
              setSelectedMinute(now.getMinutes());
              setMobileManualError(null);
            }}
            className="px-2.5 py-1 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg border border-amber-200/80 cursor-pointer transition-colors"
          >
            {t('common.datePicker.now')}
          </button>
        </div>

        {/* Apply Button */}
        <div className="pt-2">
          <button
            type="button"
            onClick={handleApplyMobileManual}
            className="w-full py-2.5 px-4 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5"
          >
            <Check className="h-4 w-4" />
            <span>{t('common.datePicker.apply')}</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`} data-testid={testId}>
      {/* Hidden input */}
      <input type="hidden" name={name} id={id} value={value || ''} required={required} />

      {/* Visible Trigger Box */}
      <div
        ref={triggerRef}
        onClick={() => {
          if (!disabled) {
            if (isMobile) {
              inputRef.current?.blur();
            }
            setIsOpen(true);
          }
        }}
        className={`
          relative flex items-center rounded-lg border bg-white transition-all
          ${inputError ? 'border-rose-400 ring-1 ring-rose-300' : 'border-stone-300 hover:border-stone-400'}
          ${disabled ? 'bg-stone-100 cursor-not-allowed opacity-60' : 'focus-within:ring-2 focus-within:ring-amber-500/20 focus-within:border-amber-500 shadow-2xs'}
          ${isMobile ? 'cursor-pointer' : ''}
          ${triggerClassName}
        `}
      >
        <input
          ref={inputRef}
          type="text"
          value={typedText}
          readOnly={isMobile}
          inputMode={isMobile ? 'none' : 'text'}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          onFocus={(e) => {
            if (disabled) return;
            if (isMobile) {
              e.target.blur();
              if (!isOpen) setIsOpen(true);
              return;
            }
            if (!isOpen) setIsOpen(true);
          }}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={ariaLabel || placeholder}
          className={`w-full bg-transparent px-2.5 py-1.5 text-xs font-semibold text-stone-900 placeholder:text-stone-400 focus:outline-none ${
            isMobile ? 'cursor-pointer select-none' : ''
          }`}
        />

        {/* Clear Button */}
        {clearable && !required && !disabled && (typedText || value) && (
          <button
            type="button"
            onClick={handleClear}
            className="p-1 text-stone-400 hover:text-stone-700 transition-colors cursor-pointer"
            title={t('common.datePicker.clear')}
            aria-label={t('common.datePicker.clear')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}

        {/* Calendar / Clock Button */}
        <button
          type="button"
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            if (!disabled) {
              if (isMobile) {
                inputRef.current?.blur();
              }
              setIsOpen(!isOpen);
            }
          }}
          className="p-1.5 text-stone-500 hover:text-amber-600 transition-colors cursor-pointer flex items-center gap-0.5"
          aria-label={t('common.datePicker.selectDateTime')}
        >
          <CalendarIcon className="h-4 w-4" />
        </button>
      </div>

      {/* Validation tooltip */}
      {inputError && !isMobile && (
        <div className="absolute left-0 top-full mt-1 z-20 flex items-center gap-1 text-[11px] font-medium text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-200 shadow-xs whitespace-nowrap">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span>{inputError}</span>
        </div>
      )}

      {/* Desktop Popover */}
      {isOpen && !isMobile && mounted && typeof document !== 'undefined' && popoverCoords &&
        createPortal(
          <div
            ref={popoverRef}
            data-testid="datetime-picker-desktop-popover"
            style={{
              position: 'absolute',
              top: `${popoverCoords.top}px`,
              left: `${popoverCoords.left}px`,
              width: '320px',
              zIndex: 9999,
            }}
            className="rounded-xl border border-stone-200 bg-white shadow-xl animate-in fade-in zoom-in-95 duration-150"
          >
            {renderContent()}
          </div>,
          document.body
        )}

      {/* Mobile Bottom Sheet Modal (Portaled, visualViewport-aware) */}
      {isOpen && isMobile && mounted && typeof document !== 'undefined' &&
        createPortal(
          <div
            data-testid="datetime-picker-mobile-sheet"
            className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
            style={{
              height: viewportHeight ? `${viewportHeight}px` : '100dvh',
              top: `${viewportOffsetTop}px`,
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setIsOpen(false);
            }}
          >
            <div
              style={{
                maxHeight: viewportHeight ? `${Math.min(viewportHeight, 620)}px` : '90dvh',
              }}
              className="w-full rounded-t-2xl bg-white shadow-2xl flex flex-col overflow-y-auto animate-in slide-in-from-bottom duration-200 pb-[max(1rem,env(safe-area-inset-bottom))]"
            >
              {!manualMode ? (
                <>
                  <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
                    <span className="font-bold text-sm text-stone-900 flex items-center gap-1.5">
                      <CalendarIcon className="h-4 w-4 text-amber-600" />
                      {t('common.datePicker.selectDateTime')}
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsOpen(false)}
                      className="p-1 rounded-full text-stone-400 hover:text-stone-700 hover:bg-stone-100 cursor-pointer"
                      aria-label={t('common.actions.close')}
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="max-w-md mx-auto w-full">
                    {renderContent()}
                  </div>

                  {/* Option: Enter date & time manually */}
                  <div className="px-4 pb-4 max-w-md mx-auto w-full">
                    <button
                      type="button"
                      onClick={() => setManualMode(true)}
                      className="w-full py-2 px-3 text-xs font-semibold text-amber-800 bg-amber-50/80 hover:bg-amber-100 rounded-xl flex items-center justify-center gap-2 border border-amber-200/80 transition-colors cursor-pointer"
                    >
                      <Edit3 className="h-3.5 w-3.5 text-amber-700" />
                      <span>{t('common.datePicker.enterDateTimeManually')}</span>
                    </button>
                  </div>
                </>
              ) : (
                renderMobileManualContent()
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
