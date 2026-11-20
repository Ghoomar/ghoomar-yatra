'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X, AlertCircle, Edit3, Check } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import {
  formatToDisplay,
  parseDisplayToISO,
  getTodayISO,
  getYesterdayISO,
  getCalendarGrid,
  isDateDisabled,
  CalendarDay,
} from '@/lib/date/date-picker-utils';

export interface DatePickerProps {
  value: string; // ISO YYYY-MM-DD or empty
  onChange: (value: string) => void; // Emits ISO YYYY-MM-DD or empty
  min?: string; // ISO YYYY-MM-DD
  max?: string; // ISO YYYY-MM-DD
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  clearable?: boolean;
  name?: string;
  id?: string;
  className?: string; // Wrapper className
  triggerClassName?: string; // Custom styling for input container / trigger
  autoFocus?: boolean;
  'aria-label'?: string;
  'data-testid'?: string;
}

export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = 'DD-MM-YYYY',
  disabled = false,
  required = false,
  clearable = true,
  name,
  id,
  className = '',
  triggerClassName = '',
  autoFocus = false,
  'aria-label': ariaLabel,
  'data-testid': testId,
}: DatePickerProps) {
  const { t, locale } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Manual mode state on mobile bottom sheet
  const [manualMode, setManualMode] = useState(false);
  const [mobileManualText, setMobileManualText] = useState('');
  const [mobileManualError, setMobileManualError] = useState<string | null>(null);

  // Manual typing text buffer for desktop input
  const [typedText, setTypedText] = useState(() => formatToDisplay(value));
  const [inputError, setInputError] = useState<string | null>(null);

  // Viewport popover positioning state (Desktop)
  const [popoverCoords, setPopoverCoords] = useState<{ top: number; left: number } | null>(null);

  // Mobile virtual keyboard resilience via window.visualViewport
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [viewportOffsetTop, setViewportOffsetTop] = useState<number>(0);

  // Anchor and dropdown references
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);

  // Calendar view year and month (1 - 12)
  const [viewYear, setViewYear] = useState<number>(() => {
    if (value && value.length >= 4) {
      const y = parseInt(value.slice(0, 4), 10);
      if (!isNaN(y)) return y;
    }
    return new Date().getFullYear();
  });

  const [viewMonth, setViewMonth] = useState<number>(() => {
    if (value && value.length >= 7) {
      const m = parseInt(value.slice(5, 7), 10);
      if (!isNaN(m) && m >= 1 && m <= 12) return m;
    }
    return new Date().getMonth() + 1;
  });

  // Keep typedText in sync when external value prop changes
  useEffect(() => {
    const formatted = formatToDisplay(value);
    setTypedText(formatted);
    setMobileManualText(formatted);
    setInputError(null);
    setMobileManualError(null);
    if (value && value.length >= 10) {
      const y = parseInt(value.slice(0, 4), 10);
      const m = parseInt(value.slice(5, 7), 10);
      if (!isNaN(y) && !isNaN(m)) {
        setViewYear(y);
        setViewMonth(m);
      }
    }
  }, [value]);

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
      setMobileManualText(formatToDisplay(value));
      setMobileManualError(null);
      const timer = setTimeout(() => {
        manualInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [manualMode, isMobile, value]);

  // Update popover desktop coordinates
  const updateCoords = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const popoverWidth = 300;
    const popoverHeight = 350;

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

  // Recalculate position when opened or scrolled (Desktop)
  useEffect(() => {
    if (!isOpen || isMobile) return;
    updateCoords();

    const handleScrollOrResize = () => {
      updateCoords();
    };

    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);
    return () => {
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [isOpen, isMobile, updateCoords]);

  // Close desktop popover on outside click
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

  // Prevent background scroll when mobile sheet is open
  useEffect(() => {
    if (isOpen && isMobile) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prevOverflow;
      };
    }
  }, [isOpen, isMobile]);

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

  // Select day from calendar grid
  const handleSelectDay = (cell: CalendarDay) => {
    if (cell.isDisabled) return;
    onChange(cell.iso);
    setTypedText(formatToDisplay(cell.iso));
    setMobileManualText(formatToDisplay(cell.iso));
    setInputError(null);
    setMobileManualError(null);
    setIsOpen(false);
  };

  // Shortcut: Today
  const handleSelectToday = () => {
    const today = getTodayISO();
    if (isDateDisabled(today, min, max)) return;
    onChange(today);
    setTypedText(formatToDisplay(today));
    setMobileManualText(formatToDisplay(today));
    setInputError(null);
    setMobileManualError(null);
    setIsOpen(false);
  };

  // Shortcut: Yesterday
  const handleSelectYesterday = () => {
    const yesterday = getYesterdayISO();
    if (isDateDisabled(yesterday, min, max)) return;
    onChange(yesterday);
    setTypedText(formatToDisplay(yesterday));
    setMobileManualText(formatToDisplay(yesterday));
    setInputError(null);
    setMobileManualError(null);
    setIsOpen(false);
  };

  // Action: Clear
  const handleClear = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    onChange('');
    setTypedText('');
    setMobileManualText('');
    setInputError(null);
    setMobileManualError(null);
  };

  // Handle manual typing in desktop input box
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setTypedText(text);

    if (!text.trim()) {
      setInputError(null);
      if (!required) onChange('');
      return;
    }

    const iso = parseDisplayToISO(text);
    if (iso) {
      if (isDateDisabled(iso, min, max)) {
        setInputError('Date out of allowed range');
      } else {
        setInputError(null);
        onChange(iso);
        const y = parseInt(iso.slice(0, 4), 10);
        const m = parseInt(iso.slice(5, 7), 10);
        if (!isNaN(y) && !isNaN(m)) {
          setViewYear(y);
          setViewMonth(m);
        }
      }
    } else {
      if (text.replace(/[^0-9]/g, '').length >= 8) {
        setInputError(t('common.datePicker.invalidDate'));
      } else {
        setInputError(null);
      }
    }
  };

  const handleInputBlur = () => {
    if (!typedText.trim()) {
      if (value) onChange('');
      setInputError(null);
      return;
    }
    const iso = parseDisplayToISO(typedText);
    if (iso && !isDateDisabled(iso, min, max)) {
      setTypedText(formatToDisplay(iso));
      setInputError(null);
      onChange(iso);
    } else if (value) {
      setTypedText(formatToDisplay(value));
      setInputError(null);
    } else {
      setInputError(t('common.datePicker.invalidDate'));
    }
  };

  // Mobile Manual Mode submission
  const handleApplyMobileManual = () => {
    if (!mobileManualText.trim()) {
      if (!required) {
        onChange('');
        setTypedText('');
        setMobileManualText('');
        setInputError(null);
        setMobileManualError(null);
        setIsOpen(false);
      } else {
        setMobileManualError(t('common.datePicker.invalidDate'));
      }
      return;
    }

    const iso = parseDisplayToISO(mobileManualText);
    if (iso) {
      if (isDateDisabled(iso, min, max)) {
        setMobileManualError('Date out of allowed range');
      } else {
        setMobileManualError(null);
        setInputError(null);
        onChange(iso);
        setTypedText(formatToDisplay(iso));
        setIsOpen(false);
      }
    } else {
      setMobileManualError(t('common.datePicker.invalidDate'));
    }
  };

  // Weekday translation keys
  const weekdayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

  // Month select options (1 - 12)
  const monthOptions = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => i + 1).map((m) => ({
      value: m,
      label: t(`common.datePicker.months.${m}` as any),
    }));
  }, [t]);

  // Year select options (2018 - 2035)
  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const startYear = Math.min(2018, viewYear - 5);
    const endYear = Math.max(currentYear + 5, 2035);
    const years: number[] = [];
    for (let y = startYear; y <= endYear; y++) {
      years.push(y);
    }
    return years;
  }, [viewYear]);

  // Calendar cells
  const calendarGrid = useMemo(() => {
    return getCalendarGrid(viewYear, viewMonth, value, min, max);
  }, [viewYear, viewMonth, value, min, max]);

  // Calendar Panel Content (reused in desktop popover and mobile sheet)
  const renderCalendarContent = () => (
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

      {/* Weekday Row (Monday-First) */}
      <div className="grid grid-cols-7 gap-1 text-center">
        {weekdayKeys.map((wKey) => (
          <div key={wKey} className="text-[11px] font-bold text-stone-400 py-0.5">
            {t(`common.datePicker.weekdaysShort.${wKey}` as any)}
          </div>
        ))}
      </div>

      {/* Day Cells Grid (42 slots) */}
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

      {/* Shortcuts Footer Bar */}
      <div className="pt-2 border-t border-stone-100 flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleSelectToday}
            className="px-2.5 py-1 text-[11px] font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-md transition-colors cursor-pointer"
          >
            {t('common.datePicker.today')}
          </button>
          <button
            type="button"
            onClick={handleSelectYesterday}
            className="px-2.5 py-1 text-[11px] font-medium text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-md transition-colors cursor-pointer"
          >
            {t('common.datePicker.yesterday')}
          </button>
        </div>

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
            {t('common.datePicker.enterManually')}
          </label>
          <p className="text-[11px] text-stone-500 mb-2">
            {t('common.datePicker.manualEntryHint')}
          </p>
          <div className="relative">
            <input
              ref={manualInputRef}
              type="text"
              inputMode="numeric"
              value={mobileManualText}
              onChange={(e) => {
                setMobileManualText(e.target.value);
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
            {mobileManualText && (
              <button
                type="button"
                onClick={() => {
                  setMobileManualText('');
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

        {/* Quick helper shortcuts inside manual entry */}
        <div className="flex items-center gap-2 pt-0.5">
          <button
            type="button"
            onClick={() => {
              const today = getTodayISO();
              setMobileManualText(formatToDisplay(today));
              setMobileManualError(null);
            }}
            className="px-2.5 py-1 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg border border-amber-200/80 cursor-pointer transition-colors"
          >
            {t('common.datePicker.today')}
          </button>
          <button
            type="button"
            onClick={() => {
              const yest = getYesterdayISO();
              setMobileManualText(formatToDisplay(yest));
              setMobileManualError(null);
            }}
            className="px-2.5 py-1 text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg cursor-pointer transition-colors"
          >
            {t('common.datePicker.yesterday')}
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
      {/* Hidden input for HTML form submissions */}
      <input
        type="hidden"
        name={name}
        id={id}
        value={value || ''}
        required={required}
      />

      {/* Visible Form Input with Calendar Trigger */}
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
              // Immediately blur on mobile so virtual keyboard never opens
              e.target.blur();
              if (!isOpen) setIsOpen(true);
              return;
            }
            if (!isOpen) setIsOpen(true);
          }}
          disabled={disabled}
          placeholder={placeholder}
          autoFocus={autoFocus && !isMobile}
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

        {/* Calendar Icon Button */}
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
          className="p-1.5 text-stone-500 hover:text-amber-600 transition-colors cursor-pointer"
          aria-label={t('common.datePicker.selectDate')}
        >
          <CalendarIcon className="h-4 w-4" />
        </button>
      </div>

      {/* Input Validation Error Tooltip */}
      {inputError && !isMobile && (
        <div className="absolute left-0 top-full mt-1 z-20 flex items-center gap-1 text-[11px] font-medium text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-200 shadow-xs whitespace-nowrap">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span>{inputError}</span>
        </div>
      )}

      {/* DESKTOP POPOVER (Portaled to document.body to prevent overflow-hidden clipping) */}
      {isOpen && !isMobile && mounted && typeof document !== 'undefined' && popoverCoords &&
        createPortal(
          <div
            ref={popoverRef}
            data-testid="date-picker-desktop-popover"
            style={{
              position: 'absolute',
              top: `${popoverCoords.top}px`,
              left: `${popoverCoords.left}px`,
              width: '300px',
              zIndex: 9999,
            }}
            className="rounded-xl border border-stone-200 bg-white shadow-xl animate-in fade-in zoom-in-95 duration-150"
          >
            {renderCalendarContent()}
          </div>,
          document.body
        )}

      {/* MOBILE BOTTOM SHEET MODAL (Portaled to document.body, visualViewport-aware) */}
      {isOpen && isMobile && mounted && typeof document !== 'undefined' &&
        createPortal(
          <div
            data-testid="date-picker-mobile-sheet"
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
                  {/* Sheet Header */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
                    <span className="font-bold text-sm text-stone-900 flex items-center gap-1.5">
                      <CalendarIcon className="h-4 w-4 text-amber-600" />
                      {t('common.datePicker.selectDate')}
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

                  {/* Calendar Grid */}
                  <div className="max-w-md mx-auto w-full">
                    {renderCalendarContent()}
                  </div>

                  {/* Option: Enter date manually */}
                  <div className="px-4 pb-4 max-w-md mx-auto w-full">
                    <button
                      type="button"
                      onClick={() => setManualMode(true)}
                      className="w-full py-2 px-3 text-xs font-semibold text-amber-800 bg-amber-50/80 hover:bg-amber-100 rounded-xl flex items-center justify-center gap-2 border border-amber-200/80 transition-colors cursor-pointer"
                    >
                      <Edit3 className="h-3.5 w-3.5 text-amber-700" />
                      <span>{t('common.datePicker.enterManually')}</span>
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
