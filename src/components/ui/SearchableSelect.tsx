'use client';

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown, Check, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';

export interface SearchableSelectProps<T = any> {
  options: T[];
  value: any;
  onChange: (value: any, option?: T) => void;
  labelKey?: keyof T | ((opt: T) => string);
  valueKey?: keyof T | ((opt: T) => any);
  secondaryLabelKey?: keyof T | ((opt: T) => string | undefined);
  getSearchableText?: (opt: T) => string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  triggerClassName?: string;
  maxVisibleOptions?: number;
  renderOption?: (option: T, state: { selected: boolean; highlighted: boolean }) => React.ReactNode;
  renderSelected?: (option: T) => React.ReactNode;
  allowClear?: boolean;
  onClear?: () => void;
  name?: string;
  id?: string;
  isOptionDisabled?: (option: T) => boolean;
}

export function SearchableSelect<T = any>({
  options = [],
  value,
  onChange,
  labelKey = 'name' as keyof T,
  valueKey = 'id' as keyof T,
  secondaryLabelKey,
  getSearchableText,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  disabled = false,
  required = false,
  className = '',
  triggerClassName = '',
  maxVisibleOptions = 50,
  renderOption,
  renderSelected,
  allowClear = false,
  onClear,
  name,
  id,
  isOptionDisabled,
}: SearchableSelectProps<T>) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Detect mobile screen (< 640px)
  useEffect(() => {
    setMounted(true);
    const media = window.matchMedia('(max-width: 639px)');
    const updateMobile = () => setIsMobile(media.matches);
    updateMobile();
    media.addEventListener('change', updateMobile);
    return () => media.removeEventListener('change', updateMobile);
  }, []);

  // Helper to extract value
  const getOptValue = useCallback(
    (opt: T): any => {
      if (!opt) return undefined;
      if (typeof valueKey === 'function') return valueKey(opt);
      return (opt as any)[valueKey];
    },
    [valueKey]
  );

  // Helper to extract primary label
  const getOptLabel = useCallback(
    (opt: T): string => {
      if (!opt) return '';
      if (typeof labelKey === 'function') return labelKey(opt);
      return String((opt as any)[labelKey] || '');
    },
    [labelKey]
  );

  // Helper to extract secondary label
  const getOptSecondary = useCallback(
    (opt: T): string | undefined => {
      if (!opt || !secondaryLabelKey) return undefined;
      if (typeof secondaryLabelKey === 'function') return secondaryLabelKey(opt);
      return (opt as any)[secondaryLabelKey];
    },
    [secondaryLabelKey]
  );

  // Currently selected option object
  const selectedOption = useMemo(() => {
    return options.find((opt) => getOptValue(opt) === value) || null;
  }, [options, value, getOptValue]);

  // Multi-token search filtering
  const filteredOptions = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return options;

    const tokens = trimmed.split(/\s+/).filter(Boolean);
    return options.filter((opt) => {
      let searchable = '';
      if (getSearchableText) {
        searchable = getSearchableText(opt).toLowerCase();
      } else {
        const primary = getOptLabel(opt).toLowerCase();
        const secondary = getOptSecondary(opt)?.toLowerCase() || '';
        const rawCode = (opt as any).item_code || (opt as any).code || (opt as any).employee_code || '';
        const rawNameHi = (opt as any).name_hi || '';
        searchable = `${primary} ${secondary} ${rawCode} ${rawNameHi}`.toLowerCase();
      }
      return tokens.every((token) => searchable.includes(token));
    });
  }, [options, query, getSearchableText, getOptLabel, getOptSecondary]);

  // Sliced options for DOM performance
  const visibleOptions = useMemo(() => {
    return filteredOptions.slice(0, maxVisibleOptions);
  }, [filteredOptions, maxVisibleOptions]);

  // Reset highlight on query change or open
  useEffect(() => {
    setHighlightedIndex(0);
  }, [query, isOpen]);

  // Autofocus input when opened
  useEffect(() => {
    if (isOpen) {
      // Small timeout ensures modal DOM is rendered
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    } else {
      setQuery('');
    }
  }, [isOpen]);

  // Close desktop popover on outside click
  useEffect(() => {
    if (!isOpen || isMobile) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, isMobile]);

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

  const handleSelect = (opt: T) => {
    if (isOptionDisabled && isOptionDisabled(opt)) return;
    const optVal = getOptValue(opt);
    onChange(optVal, opt);
    setIsOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    onClear?.();
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev < visibleOptions.length - 1 ? prev + 1 : prev));
      scrollHighlightedIntoView(highlightedIndex + 1);
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
      scrollHighlightedIntoView(highlightedIndex - 1);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const current = visibleOptions[highlightedIndex];
      if (current) {
        handleSelect(current);
      }
    }
  };

  const scrollHighlightedIntoView = (index: number) => {
    if (!listRef.current) return;
    const element = listRef.current.children[index] as HTMLElement;
    if (element) {
      element.scrollIntoView({ block: 'nearest' });
    }
  };

  const effectivePlaceholder = placeholder || t('common.labels.select');
  const effectiveSearchPlaceholder = searchPlaceholder || t('common.labels.searchPlaceholder');
  const effectiveEmptyMessage = emptyMessage || t('common.labels.noResultsFound');

  // Trigger content
  const triggerDisplay = selectedOption ? (
    renderSelected ? (
      renderSelected(selectedOption)
    ) : (
      <span className="truncate text-stone-900 font-medium">
        {getOptLabel(selectedOption)}
        {getOptSecondary(selectedOption) && (
          <span className="text-stone-400 font-normal ml-1.5 text-[11px]">
            ({getOptSecondary(selectedOption)})
          </span>
        )}
      </span>
    )
  ) : (
    <span className="truncate text-stone-400 font-normal">{effectivePlaceholder}</span>
  );

  // Render options list content
  const renderListContent = () => (
    <>
      {/* Search Input Bar */}
      <div className="p-2 border-b border-stone-200 bg-stone-50/80 sticky top-0 z-10">
        <div className="relative flex items-center">
          <Search className="h-4 w-4 text-stone-400 absolute left-2.5 pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={effectiveSearchPlaceholder}
            className="w-full bg-white pl-8 pr-7 py-1.5 text-xs rounded-lg border border-stone-300 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 text-stone-900 placeholder:text-stone-400"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 p-0.5 text-stone-400 hover:text-stone-700"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {filteredOptions.length > maxVisibleOptions && (
          <div className="text-[10px] text-stone-500 mt-1 px-1">
            {t('common.labels.showingResults', {
              count: visibleOptions.length,
              total: filteredOptions.length,
            })}
          </div>
        )}
      </div>

      {/* Options Scrollable Container */}
      <div
        ref={listRef}
        role="listbox"
        className="flex-1 overflow-y-auto overscroll-contain p-1 divide-y divide-stone-100 max-h-[300px] sm:max-h-[320px]"
      >
        {visibleOptions.length === 0 ? (
          <div className="py-6 text-center text-xs text-stone-400">
            {effectiveEmptyMessage}
          </div>
        ) : (
          visibleOptions.map((opt, idx) => {
            const isSelected = getOptValue(opt) === value;
            const isHighlighted = idx === highlightedIndex;
            const isDisabled = isOptionDisabled ? isOptionDisabled(opt) : false;

            return (
              <div
                key={getOptValue(opt) ?? idx}
                role="option"
                aria-selected={isSelected}
                aria-disabled={isDisabled}
                onMouseEnter={() => setHighlightedIndex(idx)}
                onClick={() => !isDisabled && handleSelect(opt)}
                className={`
                  flex items-center justify-between px-3 py-2 text-xs rounded-md transition-colors cursor-pointer select-none
                  ${isDisabled ? 'opacity-40 cursor-not-allowed bg-stone-50' : ''}
                  ${!isDisabled && isHighlighted ? 'bg-amber-50 text-amber-950 font-medium' : 'text-stone-800'}
                  ${!isDisabled && isSelected ? 'bg-amber-100/70 text-amber-950 font-semibold' : ''}
                `}
              >
                <div className="flex-1 min-w-0 pr-2">
                  {renderOption ? (
                    renderOption(opt, { selected: isSelected, highlighted: isHighlighted })
                  ) : (
                    <div>
                      <div className="truncate font-medium">{getOptLabel(opt)}</div>
                      {getOptSecondary(opt) && (
                        <div className="text-[10px] text-stone-500 truncate">{getOptSecondary(opt)}</div>
                      )}
                    </div>
                  )}
                </div>
                {isSelected && (
                  <Check className="h-4 w-4 text-amber-600 shrink-0 ml-1" />
                )}
              </div>
            );
          })
        )}
      </div>
    </>
  );

  return (
    <div
      ref={containerRef}
      className={`relative w-full ${className}`}
      onKeyDown={handleKeyDown}
    >
      {/* Hidden input for HTML form validation */}
      {required && (
        <input
          tabIndex={-1}
          autoComplete="off"
          value={value || ''}
          onChange={() => {}}
          required={required}
          name={name}
          id={id}
          className="sr-only"
        />
      )}

      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className={`
          w-full flex items-center justify-between gap-2 px-3 py-2 text-xs rounded-lg border bg-white text-left transition-all
          focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500
          ${disabled ? 'bg-stone-100 border-stone-200 cursor-not-allowed text-stone-400' : 'border-stone-300 hover:border-stone-400 shadow-2xs'}
          ${triggerClassName}
        `}
      >
        <div className="flex-1 min-w-0 overflow-hidden">{triggerDisplay}</div>
        <div className="flex items-center gap-1 shrink-0 text-stone-400">
          {allowClear && selectedOption && !disabled && (
            <span
              role="button"
              tabIndex={0}
              onClick={handleClear}
              className="p-0.5 hover:text-stone-700 rounded transition-colors"
              title={t('common.actions.clear')}
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-200 ${isOpen ? 'rotate-180 text-amber-600' : ''}`}
          />
        </div>
      </button>

      {/* DESKTOP POPOVER (Anchored Dropdown) */}
      {isOpen && !isMobile && (
        <div
          data-testid="searchable-select-desktop-popover"
          className="absolute z-50 mt-1 w-full min-w-[240px] rounded-xl border border-stone-200 bg-white shadow-xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-100"
        >
          {renderListContent()}
        </div>
      )}

      {/* MOBILE BOTTOM-SHEET MODAL (React Portal) */}
      {isOpen && isMobile && mounted && typeof document !== 'undefined' &&
        createPortal(
          <div
            data-testid="searchable-select-mobile-portal"
            className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
            onClick={(e) => {
              if (e.target === e.currentTarget) setIsOpen(false);
            }}
          >
            <div className="w-full max-h-[85vh] rounded-t-2xl bg-white shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-200">
              {/* Mobile Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
                <span className="font-bold text-sm text-stone-900">{effectivePlaceholder}</span>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="p-1 rounded-full text-stone-400 hover:text-stone-700 hover:bg-stone-100"
                  aria-label={t('common.actions.close')}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Mobile List Content */}
              {renderListContent()}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
