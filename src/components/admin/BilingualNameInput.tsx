'use client';

import React, { useEffect, useRef } from 'react';
import { Sparkles, RotateCcw } from 'lucide-react';
import { suggestHindiName, MasterEntityType } from '@/lib/i18n/suggest-hindi';
import { useI18n } from '@/lib/i18n/context';

interface BilingualNameInputProps {
  englishName: string;
  onChangeEnglish: (val: string) => void;
  hindiName: string;
  onChangeHindi: (val: string, isCustom?: boolean) => void;
  isCustomHindi?: boolean;
  onCustomHindiChange?: (isCustom: boolean) => void;
  entityType?: MasterEntityType;
  englishLabel?: string;
  hindiLabel?: string;
  required?: boolean;
  disabled?: boolean;
  placeholderEnglish?: string;
  placeholderHindi?: string;
  className?: string;
}

export function BilingualNameInput({
  englishName,
  onChangeEnglish,
  hindiName,
  onChangeHindi,
  isCustomHindi = false,
  onCustomHindiChange,
  entityType = 'general',
  englishLabel,
  hindiLabel,
  required = true,
  disabled = false,
  placeholderEnglish = 'e.g. Sunflower Oil',
  placeholderHindi = 'उदा. सनफ्लावर ऑयल',
  className = '',
}: BilingualNameInputProps) {
  const { locale } = useI18n();
  const prevEnglishRef = useRef(englishName);

  // Auto-generate suggestion when English changes and Hindi has not been manually customized
  useEffect(() => {
    const prev = prevEnglishRef.current;
    if (englishName !== prev) {
      prevEnglishRef.current = englishName;
      if (!isCustomHindi) {
        if (!englishName.trim()) {
          onChangeHindi('', false);
        } else {
          const res = suggestHindiName(englishName, entityType);
          onChangeHindi(res.suggestion, false);
        }
      }
    }
  }, [englishName, isCustomHindi, entityType, onChangeHindi]);

  const handleManualHindiChange = (val: string) => {
    if (onCustomHindiChange) {
      onCustomHindiChange(true);
    }
    onChangeHindi(val, true);
  };

  const handleForceSuggest = () => {
    if (!englishName.trim()) return;
    const res = suggestHindiName(englishName, entityType);
    if (onCustomHindiChange) {
      onCustomHindiChange(false);
    }
    onChangeHindi(res.suggestion, false);
  };

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* English Name Input */}
        <div>
          <label className="block text-xs font-medium text-stone-700 mb-1">
            {englishLabel || (locale === 'hi' ? 'नाम (अंग्रेज़ी)' : 'Name (English)')}{' '}
            {required && <span className="text-rose-500">*</span>}
          </label>
          <input
            type="text"
            required={required}
            disabled={disabled}
            value={englishName}
            onChange={(e) => onChangeEnglish(e.target.value)}
            placeholder={placeholderEnglish}
            className="w-full rounded-lg border border-stone-200 px-3 py-2 text-xs text-stone-900 bg-white focus:border-amber-500 focus:outline-none disabled:bg-stone-50 disabled:text-stone-400"
          />
        </div>

        {/* Hindi Display Name Input */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-stone-700">
              {hindiLabel || (locale === 'hi' ? 'नाम (हिंदी / देवनागरी)' : 'Name (Hindi)')}
            </label>
            <button
              type="button"
              onClick={handleForceSuggest}
              disabled={disabled || !englishName.trim()}
              title={locale === 'hi' ? 'हिंदी सुझाव पुनः बनाएं' : 'Suggest Hindi display name'}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 hover:text-amber-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Sparkles className="h-3 w-3" />
              <span>{locale === 'hi' ? 'सुझाव बनाएं' : 'Suggest'}</span>
            </button>
          </div>
          <div className="relative">
            <input
              type="text"
              disabled={disabled}
              value={hindiName}
              onChange={(e) => handleManualHindiChange(e.target.value)}
              placeholder={placeholderHindi}
              className="w-full rounded-lg border border-stone-200 px-3 py-2 text-xs text-stone-900 bg-white focus:border-amber-500 focus:outline-none disabled:bg-stone-50 disabled:text-stone-400"
            />
          </div>
          {isCustomHindi && (
            <div className="flex items-center justify-between mt-1 text-[10px] text-stone-500">
              <span>{locale === 'hi' ? 'हाथ से बदला गया' : 'Manually edited'}</span>
              <button
                type="button"
                onClick={handleForceSuggest}
                className="text-amber-700 hover:underline flex items-center gap-0.5"
              >
                <RotateCcw className="h-2.5 w-2.5" />
                <span>{locale === 'hi' ? 'सुझाव पर रीसेट करें' : 'Reset to suggestion'}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
