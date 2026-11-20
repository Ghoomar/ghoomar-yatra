'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Clock, ChevronUp, ChevronDown, Check, X, Edit3, ArrowRight } from 'lucide-react';
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

const ITEM_HEIGHT = 40; // Height in px of each wheel item
const VISIBLE_COUNT = 5; // Visible items in the wheel viewport (center is index 2)
const WHEEL_PADDING = 80; // (5 - 1) / 2 * 40 = 80px top & bottom spacer

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
  const { t, locale } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Parse hour & minute from value
  const parseTime = useCallback((val?: string) => {
    if (!val) {
      const now = new Date();
      return { hour: now.getHours(), minute: now.getMinutes(), valid: false };
    }
    const parts = val.split(':');
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    return {
      hour: isNaN(h) ? 12 : Math.max(0, Math.min(23, h)),
      minute: isNaN(m) ? 0 : Math.max(0, Math.min(59, m)),
      valid: !isNaN(h) && !isNaN(m),
    };
  }, []);

  const parsed = useMemo(() => parseTime(value), [value, parseTime]);

  // Draft state while picker is open
  const [draftHour, setDraftHour] = useState<number>(parsed.hour);
  const [draftMinute, setDraftMinute] = useState<number>(parsed.minute);

  // Manual mode state on mobile
  const [manualMode, setManualMode] = useState(false);
  const [manualText, setManualText] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  // Desktop popover positioning
  const [popoverCoords, setPopoverCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Wheel container refs for mobile
  const hourWheelRef = useRef<HTMLDivElement>(null);
  const minuteWheelRef = useRef<HTMLDivElement>(null);
  const isUserScrollingRef = useRef({ hour: false, minute: false });

  // Mobile visual viewport support
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [viewportOffsetTop, setViewportOffsetTop] = useState(0);

  // Detect mobile device
  useEffect(() => {
    setMounted(true);
    const checkMobile = () => {
      const isTouch = window.matchMedia('(pointer: coarse)').matches;
      const isNarrow = window.innerWidth < 768;
      setIsMobile(isTouch || isNarrow);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Update visualViewport on mobile
  useEffect(() => {
    if (!isOpen || !isMobile || typeof window === 'undefined') return;
    const vv = window.visualViewport;
    if (!vv) return;

    const updateVV = () => {
      setViewportHeight(vv.height);
      setViewportOffsetTop(vv.offsetTop);
    };
    updateVV();
    vv.addEventListener('resize', updateVV);
    vv.addEventListener('scroll', updateVV);
    return () => {
      vv.removeEventListener('resize', updateVV);
      vv.removeEventListener('scroll', updateVV);
    };
  }, [isOpen, isMobile]);

  // Sync draft when opened
  useEffect(() => {
    if (isOpen) {
      const p = parseTime(value);
      setDraftHour(p.hour);
      setDraftMinute(p.minute);
      setManualMode(false);
      setManualText(p.valid ? `${pad2(p.hour)}:${pad2(p.minute)}` : '');
      setManualError(null);
    }
  }, [isOpen, value, parseTime]);

  // Position desktop popover
  const updateDesktopPosition = useCallback(() => {
    if (!triggerRef.current || isMobile) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const popoverWidth = 260;
    const popoverHeight = 240;
    const padding = 8;

    let left = rect.left + window.scrollX;
    let top = rect.bottom + window.scrollY + 4;

    if (left + popoverWidth > window.innerWidth - padding) {
      left = Math.max(padding, window.innerWidth - popoverWidth - padding);
    }

    if (rect.bottom + popoverHeight > window.innerHeight && rect.top - popoverHeight > 0) {
      top = rect.top + window.scrollY - popoverHeight - 4;
    }

    setPopoverCoords({ top, left });
  }, [isMobile]);

  useEffect(() => {
    if (isOpen && !isMobile) {
      updateDesktopPosition();
      window.addEventListener('scroll', updateDesktopPosition, true);
      window.addEventListener('resize', updateDesktopPosition);
      return () => {
        window.removeEventListener('scroll', updateDesktopPosition, true);
        window.removeEventListener('resize', updateDesktopPosition);
      };
    }
  }, [isOpen, isMobile, updateDesktopPosition]);

  // Close on outside click (desktop)
  useEffect(() => {
    if (!isOpen || isMobile) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, isMobile]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Scroll wheels to draft values when opened in mobile mode
  useEffect(() => {
    if (isOpen && isMobile && !manualMode) {
      const timer = setTimeout(() => {
        if (hourWheelRef.current) {
          hourWheelRef.current.scrollTop = draftHour * ITEM_HEIGHT;
        }
        if (minuteWheelRef.current) {
          minuteWheelRef.current.scrollTop = draftMinute * ITEM_HEIGHT;
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen, isMobile, manualMode]);

  // Wheel scroll handlers for hour and minute
  const handleHourScroll = () => {
    if (!hourWheelRef.current) return;
    const scrollPos = hourWheelRef.current.scrollTop;
    const index = Math.round(scrollPos / ITEM_HEIGHT);
    const clamped = Math.max(0, Math.min(23, index));
    if (clamped !== draftHour) {
      setDraftHour(clamped);
    }
  };

  const handleMinuteScroll = () => {
    if (!minuteWheelRef.current) return;
    const scrollPos = minuteWheelRef.current.scrollTop;
    const index = Math.round(scrollPos / ITEM_HEIGHT);
    const clamped = Math.max(0, Math.min(59, index));
    if (clamped !== draftMinute) {
      setDraftMinute(clamped);
    }
  };

  const scrollToHour = (h: number) => {
    setDraftHour(h);
    if (hourWheelRef.current) {
      hourWheelRef.current.scrollTo({ top: h * ITEM_HEIGHT, behavior: 'smooth' });
    }
  };

  const scrollToMinute = (m: number) => {
    setDraftMinute(m);
    if (minuteWheelRef.current) {
      minuteWheelRef.current.scrollTo({ top: m * ITEM_HEIGHT, behavior: 'smooth' });
    }
  };

  // Actions
  const handleNow = () => {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    setDraftHour(h);
    setDraftMinute(m);
    if (isMobile && !manualMode) {
      scrollToHour(h);
      scrollToMinute(m);
    }
  };

  const handleConfirm = () => {
    const finalVal = `${pad2(draftHour)}:${pad2(draftMinute)}`;
    onChange(finalVal);
    setIsOpen(false);
  };

  const handleManualApply = () => {
    const trimmed = manualText.trim();
    const parts = trimmed.split(':');
    if (parts.length !== 2) {
      setManualError(t('common.datePicker.invalidTimeFormat') || 'Format: HH:mm (00:00 - 23:59)');
      return;
    }
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
      setManualError(t('common.datePicker.invalidTimeFormat') || 'Format: HH:mm (00:00 - 23:59)');
      return;
    }
    onChange(`${pad2(h)}:${pad2(m)}`);
    setIsOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setIsOpen(false);
  };

  // Format display text (e.g. "14:30" or localized)
  const displayFormatted = useMemo(() => {
    if (!value) return '';
    return value;
  }, [value]);

  // Hours array (0..23) and Minutes array (0..59)
  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);
  const minutes = useMemo(() => Array.from({ length: 60 }, (_, i) => i), []);

  return (
    <div className={`relative inline-block w-full ${className}`} data-testid={testId}>
      {/* Trigger Control */}
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
          border-stone-300 hover:border-stone-400
          ${disabled ? 'bg-stone-100 cursor-not-allowed opacity-60' : 'focus-within:ring-2 focus-within:ring-amber-500/20 focus-within:border-amber-500 shadow-2xs cursor-pointer'}
          ${triggerClassName}
        `}
      >
        <input
          ref={inputRef}
          type="text"
          readOnly
          inputMode="none"
          value={displayFormatted}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={ariaLabel || placeholder}
          className="w-full bg-transparent px-2.5 py-1.5 text-xs font-semibold text-stone-900 placeholder:text-stone-400 focus:outline-none cursor-pointer select-none"
        />

        {clearable && !required && !disabled && value && (
          <button
            type="button"
            onClick={handleClear}
            className="p-1 text-stone-400 hover:text-stone-700 transition-colors cursor-pointer"
            aria-label={t('common.datePicker.clear')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}

        <button
          type="button"
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            if (!disabled) {
              if (isMobile) inputRef.current?.blur();
              setIsOpen(!isOpen);
            }
          }}
          className="p-1.5 text-stone-500 hover:text-amber-600 transition-colors cursor-pointer flex items-center shrink-0"
          aria-label={t('common.datePicker.time')}
        >
          <Clock className="h-4 w-4" />
        </button>
      </div>

      {/* Desktop Popover */}
      {isOpen && !isMobile && mounted && typeof document !== 'undefined' && popoverCoords &&
        createPortal(
          <div
            ref={popoverRef}
            data-testid="time-picker-desktop-popover"
            style={{
              position: 'absolute',
              top: `${popoverCoords.top}px`,
              left: `${popoverCoords.left}px`,
              width: '260px',
              zIndex: 9999,
            }}
            className="rounded-xl border border-stone-200 bg-white p-3.5 shadow-xl animate-in fade-in zoom-in-95 duration-150"
          >
            {/* Header / Preview */}
            <div className="flex items-center justify-between pb-2.5 border-b border-stone-100">
              <span className="text-xs font-semibold text-stone-500 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-amber-600" />
                {t('common.datePicker.selectTime') || 'Select Time'}
              </span>
              <span className="font-mono text-sm font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200/60">
                {pad2(draftHour)}:{pad2(draftMinute)}
              </span>
            </div>

            {/* Stepper Controls */}
            <div className="py-4 flex items-center justify-center gap-3">
              {/* Hour Control */}
              <div className="flex flex-col items-center">
                <button
                  type="button"
                  onClick={() => setDraftHour((h) => (h + 1) % 24)}
                  className="p-1 rounded text-stone-500 hover:bg-stone-100 active:scale-95 transition-all cursor-pointer"
                  aria-label="Increase Hour"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <div className="w-12 h-10 flex items-center justify-center font-mono text-xl font-bold text-stone-900 bg-stone-50 rounded-lg border border-stone-200 shadow-2xs select-none">
                  {pad2(draftHour)}
                </div>
                <button
                  type="button"
                  onClick={() => setDraftHour((h) => (h - 1 + 24) % 24)}
                  className="p-1 rounded text-stone-500 hover:bg-stone-100 active:scale-95 transition-all cursor-pointer"
                  aria-label="Decrease Hour"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                <span className="text-[10px] font-medium text-stone-400 mt-0.5 uppercase tracking-wide">
                  {t('common.datePicker.hour') || 'Hour'}
                </span>
              </div>

              <div className="text-2xl font-bold text-stone-400 pb-4 select-none">:</div>

              {/* Minute Control */}
              <div className="flex flex-col items-center">
                <button
                  type="button"
                  onClick={() => setDraftMinute((m) => (m + 1) % 60)}
                  className="p-1 rounded text-stone-500 hover:bg-stone-100 active:scale-95 transition-all cursor-pointer"
                  aria-label="Increase Minute"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <div className="w-12 h-10 flex items-center justify-center font-mono text-xl font-bold text-stone-900 bg-stone-50 rounded-lg border border-stone-200 shadow-2xs select-none">
                  {pad2(draftMinute)}
                </div>
                <button
                  type="button"
                  onClick={() => setDraftMinute((m) => (m - 1 + 60) % 60)}
                  className="p-1 rounded text-stone-500 hover:bg-stone-100 active:scale-95 transition-all cursor-pointer"
                  aria-label="Decrease Minute"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                <span className="text-[10px] font-medium text-stone-400 mt-0.5 uppercase tracking-wide">
                  {t('common.datePicker.minute') || 'Minute'}
                </span>
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-between pt-2 border-t border-stone-100 text-xs">
              <button
                type="button"
                onClick={handleNow}
                className="text-amber-700 hover:text-amber-800 font-semibold cursor-pointer px-1 py-0.5 rounded hover:bg-amber-50 transition-colors"
              >
                {t('common.datePicker.now') || 'Now'}
              </button>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="px-2.5 py-1 text-stone-600 hover:bg-stone-100 rounded-md font-medium transition-colors cursor-pointer"
                >
                  {t('common.actions.cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-md font-semibold shadow-2xs active:scale-95 transition-all cursor-pointer flex items-center gap-1"
                >
                  <Check className="h-3 w-3" />
                  {t('common.actions.done') || 'Done'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Mobile Wheel Bottom Sheet Modal */}
      {isOpen && isMobile && mounted && typeof document !== 'undefined' &&
        createPortal(
          <div
            data-testid="time-picker-mobile-sheet"
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
                maxHeight: viewportHeight ? `${Math.min(viewportHeight, 480)}px` : '85dvh',
              }}
              className="w-full rounded-t-2xl bg-white shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-200 pb-[max(1rem,env(safe-area-inset-bottom))]"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 bg-stone-50/60">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-600" />
                  <span className="font-bold text-sm text-stone-900">
                    {t('common.datePicker.selectTime') || 'Select Time'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="p-1 rounded-full text-stone-400 hover:text-stone-700 hover:bg-stone-200 cursor-pointer"
                  aria-label={t('common.actions.close')}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {!manualMode ? (
                <>
                  {/* Large Time Display */}
                  <div className="py-3 bg-amber-50/40 border-b border-amber-100/60 flex items-center justify-center gap-2">
                    <span className="font-mono text-3xl font-extrabold text-amber-900 tracking-wider">
                      {pad2(draftHour)}:{pad2(draftMinute)}
                    </span>
                    <span className="text-[11px] font-bold text-amber-700/80 uppercase px-1.5 py-0.5 rounded bg-amber-100/60">
                      24H
                    </span>
                  </div>

                  {/* Wheel Picker Container */}
                  <div className="relative py-2 px-6 flex items-center justify-center gap-6 select-none touch-pan-y">
                    {/* Center Highlight Bar (Fixed overlay) */}
                    <div
                      style={{
                        top: `${WHEEL_PADDING}px`,
                        height: `${ITEM_HEIGHT}px`,
                      }}
                      className="pointer-events-none absolute inset-x-8 rounded-xl border border-amber-500/30 bg-amber-500/10 shadow-xs"
                    />

                    {/* Hour Column */}
                    <div className="flex flex-col items-center">
                      <span className="text-[11px] font-bold text-stone-400 uppercase tracking-wider mb-1">
                        {t('common.datePicker.hour') || 'Hour'}
                      </span>
                      <div
                        ref={hourWheelRef}
                        onScroll={handleHourScroll}
                        style={{
                          height: `${ITEM_HEIGHT * VISIBLE_COUNT}px`,
                        }}
                        className="w-24 overflow-y-scroll snap-y snap-mandatory scrollbar-none overscroll-contain"
                      >
                        {/* Top Spacer */}
                        <div style={{ height: `${WHEEL_PADDING}px` }} />

                        {hours.map((h) => {
                          const isSelected = h === draftHour;
                          return (
                            <div
                              key={h}
                              onClick={() => scrollToHour(h)}
                              style={{ height: `${ITEM_HEIGHT}px` }}
                              className={`snap-center flex items-center justify-center font-mono transition-all cursor-pointer ${
                                isSelected
                                  ? 'text-2xl font-black text-amber-900 scale-110'
                                  : 'text-lg font-semibold text-stone-400 hover:text-stone-600'
                              }`}
                            >
                              {pad2(h)}
                            </div>
                          );
                        })}

                        {/* Bottom Spacer */}
                        <div style={{ height: `${WHEEL_PADDING}px` }} />
                      </div>
                    </div>

                    <div className="text-3xl font-extrabold text-stone-300 pb-2 select-none self-center">:</div>

                    {/* Minute Column */}
                    <div className="flex flex-col items-center">
                      <span className="text-[11px] font-bold text-stone-400 uppercase tracking-wider mb-1">
                        {t('common.datePicker.minute') || 'Minute'}
                      </span>
                      <div
                        ref={minuteWheelRef}
                        onScroll={handleMinuteScroll}
                        style={{
                          height: `${ITEM_HEIGHT * VISIBLE_COUNT}px`,
                        }}
                        className="w-24 overflow-y-scroll snap-y snap-mandatory scrollbar-none overscroll-contain"
                      >
                        {/* Top Spacer */}
                        <div style={{ height: `${WHEEL_PADDING}px` }} />

                        {minutes.map((m) => {
                          const isSelected = m === draftMinute;
                          return (
                            <div
                              key={m}
                              onClick={() => scrollToMinute(m)}
                              style={{ height: `${ITEM_HEIGHT}px` }}
                              className={`snap-center flex items-center justify-center font-mono transition-all cursor-pointer ${
                                isSelected
                                  ? 'text-2xl font-black text-amber-900 scale-110'
                                  : 'text-lg font-semibold text-stone-400 hover:text-stone-600'
                              }`}
                            >
                              {pad2(m)}
                            </div>
                          );
                        })}

                        {/* Bottom Spacer */}
                        <div style={{ height: `${WHEEL_PADDING}px` }} />
                      </div>
                    </div>
                  </div>

                  {/* Manual entry switch */}
                  <div className="px-5 pt-1 pb-3 text-center">
                    <button
                      type="button"
                      onClick={() => setManualMode(true)}
                      className="text-xs font-semibold text-amber-800 hover:text-amber-900 flex items-center justify-center gap-1.5 mx-auto py-1 px-3 rounded-lg hover:bg-amber-50 cursor-pointer"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      <span>{t('common.datePicker.enterTimeManually') || 'Enter time manually'}</span>
                    </button>
                  </div>

                  {/* Mobile Actions Footer */}
                  <div className="px-5 pt-3 pb-2 border-t border-stone-200 flex items-center justify-between gap-3 bg-stone-50/50">
                    <button
                      type="button"
                      onClick={handleNow}
                      className="py-2.5 px-4 text-xs font-bold text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-xl transition-colors cursor-pointer"
                    >
                      {t('common.datePicker.now') || 'Now'}
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsOpen(false)}
                        className="py-2.5 px-4 text-xs font-semibold text-stone-600 hover:bg-stone-200 rounded-xl transition-colors cursor-pointer"
                      >
                        {t('common.actions.cancel')}
                      </button>
                      <button
                        type="button"
                        onClick={handleConfirm}
                        className="py-2.5 px-6 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 active:scale-95 rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-1.5"
                      >
                        <Check className="h-4 w-4" />
                        {t('common.actions.done') || 'Done'}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                /* Manual Entry Mode on Mobile */
                <div className="p-5 space-y-4">
                  <div className="text-xs text-stone-600">
                    {t('common.datePicker.manualTimeInstructions') || 'Type time in 24-hour format (e.g. 14:30 or 09:15):'}
                  </div>

                  <div className="relative">
                    <input
                      type="text"
                      autoFocus
                      inputMode="numeric"
                      value={manualText}
                      onChange={(e) => {
                        setManualText(e.target.value);
                        setManualError(null);
                      }}
                      placeholder="HH:mm"
                      className="w-full text-center font-mono text-2xl font-bold p-3 rounded-xl border border-stone-300 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    />
                  </div>

                  {manualError && (
                    <div className="text-xs text-rose-600 font-medium text-center">
                      {manualError}
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setManualMode(false)}
                      className="w-1/2 py-2.5 text-xs font-semibold text-stone-600 bg-stone-100 hover:bg-stone-200 rounded-xl transition-colors cursor-pointer"
                    >
                      {t('common.actions.back') || 'Back to Wheel'}
                    </button>
                    <button
                      type="button"
                      onClick={handleManualApply}
                      className="w-1/2 py-2.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-xs transition-all cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Check className="h-4 w-4" />
                      {t('common.actions.apply') || 'Apply'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
