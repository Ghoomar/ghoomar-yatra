'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { createClient } from '@/lib/supabase/client';
import { Vendor } from '@/lib/types/database';
import { X, Building2, AlertCircle, Plus } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';

interface VendorModalProps {
  isOpen: boolean;
  onClose: () => void;
  vendor?: Vendor | null;
  onSaved?: (vendor: Vendor) => void;
}

const PAYMENT_TERMS_CONFIG = [
  { id: 'Net 7 Days', en: 'Net 7 Days', hi: '7 दिन की अवधि' },
  { id: 'Immediate / Cash on Delivery', en: 'Immediate / Cash on Delivery', hi: 'तत्काल / डिलीवरी पर नकद' },
  { id: 'Net 15 Days', en: 'Net 15 Days', hi: '15 दिन की अवधि' },
  { id: 'Net 30 Days', en: 'Net 30 Days', hi: '30 दिन की अवधि' },
  { id: 'Advance Payment', en: 'Advance Payment', hi: 'एडवांस पेमेंट' },
];

export function VendorModal({ isOpen, onClose, vendor, onSaved }: VendorModalProps) {
  const { t, locale } = useI18n();
  const supabase = createClient();
  const isEdit = Boolean(vendor?.id);

  // Form Fields
  const [vendorCode, setVendorCode] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  // Expandable Optional Fields
  const [showShopName, setShowShopName] = useState(false);
  const [shopName, setShopName] = useState('');

  const [showAltPhone, setShowAltPhone] = useState(false);
  const [alternatePhone, setAlternatePhone] = useState('');

  const [showPaymentTerms, setShowPaymentTerms] = useState(false);
  const [paymentTerms, setPaymentTerms] = useState('Net 7 Days');

  // Internal states
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Input refs for sequential keyboard Enter navigation
  const nameInputRef = useRef<HTMLInputElement>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const shopNameInputRef = useRef<HTMLInputElement>(null);
  const altPhoneInputRef = useRef<HTMLInputElement>(null);
  const paymentTermsSelectRef = useRef<HTMLSelectElement>(null);

  // Auto-focus on vendorName when modal opens
  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      if (vendor) {
        setVendorCode(vendor.vendor_code || '');
        // If contact_person exists, vendor.name was the shop name and contact_person was vendor's person name
        if (vendor.contact_person && vendor.contact_person !== vendor.name) {
          setVendorName(vendor.contact_person);
          setShopName(vendor.name || '');
          setShowShopName(true);
        } else {
          setVendorName(vendor.name || '');
          setShopName('');
          setShowShopName(false);
        }
        setPhone(vendor.phone || '');
        setAddress(vendor.address || '');
        setAlternatePhone(vendor.alternate_phone || '');
        setShowAltPhone(Boolean(vendor.alternate_phone));
        setPaymentTerms(vendor.payment_terms || 'Net 7 Days');
        setShowPaymentTerms(Boolean(vendor.payment_terms && vendor.payment_terms !== 'Net 7 Days'));
      } else {
        // Reset form for new vendor
        setVendorName('');
        setPhone('');
        setAddress('');
        setShopName('');
        setShowShopName(false);
        setAlternatePhone('');
        setShowAltPhone(false);
        setPaymentTerms('Net 7 Days');
        setShowPaymentTerms(false);
        generateNextVendorCode();
      }

      // Automatically focus on Name of Vendor
      const timer = setTimeout(() => {
        nameInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen, vendor]);

  const generateNextVendorCode = async () => {
    try {
      const { data } = await supabase.from('vendors').select('vendor_code');
      let maxNum = 0;
      if (data && data.length > 0) {
        for (const row of data) {
          if (!row.vendor_code) continue;
          const match = row.vendor_code.match(/(\d+)/);
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) maxNum = num;
          }
        }
      }
      const nextNum = maxNum + 1;
      setVendorCode(`VEND-${String(nextNum).padStart(3, '0')}`);
    } catch {
      setVendorCode('VEND-001');
    }
  };

  // Keyboard Enter navigation handler
  const handleKeyDown = (e: React.KeyboardEvent, currentField: 'name' | 'phone' | 'address' | 'shopName' | 'altPhone' | 'paymentTerms') => {
    if (e.key !== 'Enter') return;
    e.preventDefault();

    // Determine the visible sequence of fields
    const sequence: { key: string; ref: React.RefObject<HTMLElement | null> }[] = [
      { key: 'name', ref: nameInputRef },
      { key: 'phone', ref: phoneInputRef },
      { key: 'address', ref: addressInputRef },
    ];

    if (showShopName) sequence.push({ key: 'shopName', ref: shopNameInputRef });
    if (showAltPhone) sequence.push({ key: 'altPhone', ref: altPhoneInputRef });
    if (showPaymentTerms) sequence.push({ key: 'paymentTerms', ref: paymentTermsSelectRef });

    const currentIndex = sequence.findIndex((item) => item.key === currentField);

    if (currentIndex !== -1 && currentIndex < sequence.length - 1) {
      // Focus next visible field
      const nextItem = sequence[currentIndex + 1];
      nextItem.ref.current?.focus();
    } else {
      // Last visible field: trigger submit
      handleSubmit(e);
    }
  };

  const getEnterKeyHint = (fieldKey: 'name' | 'phone' | 'address' | 'shopName' | 'altPhone' | 'paymentTerms'): 'next' | 'done' => {
    const sequence = ['name', 'phone', 'address'];
    if (showShopName) sequence.push('shopName');
    if (showAltPhone) sequence.push('altPhone');
    if (showPaymentTerms) sequence.push('paymentTerms');
    const idx = sequence.indexOf(fieldKey);
    return idx === sequence.length - 1 ? 'done' : 'next';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendorName.trim()) {
      setErrorMessage(locale === 'hi' ? 'कृपया वेंडर का नाम भरें।' : 'Vendor name is required.');
      nameInputRef.current?.focus();
      return;
    }

    setSaving(true);
    setErrorMessage(null);

    try {
      const trimmedName = vendorName.trim();
      const trimmedShop = shopName.trim();

      // Canonical database mapping:
      // If shop name is entered: name = shopName, contact_person = vendorName
      // If no shop name is entered: name = vendorName, contact_person = null
      const finalName = trimmedShop || trimmedName;
      const finalContact = trimmedShop ? trimmedName : (isEdit && vendor?.contact_person ? vendor.contact_person : null);

      const payload: Partial<Vendor> = {
        name: finalName,
        contact_person: finalContact || undefined,
        vendor_code: vendorCode.trim() || undefined,
        phone: phone.trim() || undefined,
        alternate_phone: alternatePhone.trim() || undefined,
        address: address.trim() || undefined,
        payment_terms: paymentTerms || 'Net 7 Days',
        payment_frequency: vendor?.payment_frequency || 'Weekly',
        preferred_payment_method_id: vendor?.preferred_payment_method_id || undefined,
        supplier_categories: vendor?.supplier_categories || [],
        notes: vendor?.notes || undefined,
        is_active: vendor?.is_active !== false,
        updated_at: new Date().toISOString(),
      };

      let savedVendor: Vendor;

      if (isEdit && vendor?.id) {
        const { data, error } = await supabase
          .from('vendors')
          .update(payload)
          .eq('id', vendor.id)
          .select()
          .single();

        if (error) throw error;
        savedVendor = data;
      } else {
        const { data, error } = await supabase
          .from('vendors')
          .insert({
            ...payload,
            created_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (error) throw error;
        savedVendor = data;
      }

      if (onSaved) {
        onSaved(savedVendor);
      }
      onClose();
    } catch (err: any) {
      console.error('Error saving vendor:', err);
      setErrorMessage(err.message || 'Failed to save vendor record.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="bg-white rounded-xl max-w-md w-full shadow-2xl border border-stone-200 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-stone-200 flex items-center justify-between bg-stone-50">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-amber-100 text-amber-800 rounded-lg">
              <Building2 className="h-4 w-4" />
            </div>
            <h2 className="text-sm sm:text-base font-bold text-stone-900">
              {isEdit ? t('purchases.vendors.modal.titleEdit') : t('purchases.vendors.modal.titleNew')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-200/60 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 text-xs">
          {errorMessage && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 flex items-center gap-2 text-xs">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* 1. Mandatory: Name of Vendor */}
          <div>
            <label className="block font-semibold text-stone-800 mb-1">
              {t('purchases.vendors.modal.vendorName')} <span className="text-rose-500">*</span>
            </label>
            <input
              ref={nameInputRef}
              type="text"
              required
              value={vendorName}
              onChange={(e) => setVendorName(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, 'name')}
              enterKeyHint={getEnterKeyHint('name')}
              placeholder={t('purchases.vendors.modal.vendorNamePlaceholder')}
              className="w-full rounded-md border border-stone-300 p-2.5 text-stone-900 text-sm focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
            />
          </div>

          {/* 2. Optional: Phone Number */}
          <div>
            <label className="block font-medium text-stone-700 mb-1">
              {t('purchases.vendors.modal.phone')}
            </label>
            <input
              ref={phoneInputRef}
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, 'phone')}
              enterKeyHint={getEnterKeyHint('phone')}
              placeholder={t('purchases.vendors.modal.phonePlaceholder')}
              className="w-full rounded-md border border-stone-300 p-2 text-stone-900 text-xs focus:outline-none focus:border-amber-500"
            />
          </div>

          {/* 3. Optional: Address */}
          <div>
            <label className="block font-medium text-stone-700 mb-1">
              {t('purchases.vendors.modal.address')}
            </label>
            <input
              ref={addressInputRef}
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, 'address')}
              enterKeyHint={getEnterKeyHint('address')}
              placeholder={t('purchases.vendors.modal.addressPlaceholder')}
              className="w-full rounded-md border border-stone-300 p-2 text-stone-900 text-xs focus:outline-none focus:border-amber-500"
            />
          </div>

          {/* Optional Expandable: Shop Name */}
          {showShopName ? (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-medium text-stone-700">{t('purchases.vendors.modal.shopName')}</label>
                <button
                  type="button"
                  onClick={() => {
                    setShowShopName(false);
                    setShopName('');
                  }}
                  className="text-[10px] text-stone-400 hover:text-stone-600"
                >
                  ✕
                </button>
              </div>
              <input
                ref={shopNameInputRef}
                type="text"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, 'shopName')}
                enterKeyHint={getEnterKeyHint('shopName')}
                placeholder={t('purchases.vendors.modal.shopPlaceholder')}
                className="w-full rounded-md border border-stone-300 p-2 text-stone-900 text-xs focus:outline-none focus:border-amber-500"
              />
            </div>
          ) : (
            <div>
              <button
                type="button"
                onClick={() => {
                  setShowShopName(true);
                  setTimeout(() => shopNameInputRef.current?.focus(), 50);
                }}
                className="text-[11px] text-amber-700 hover:text-amber-900 font-semibold hover:underline flex items-center gap-1"
              >
                <Plus className="h-3 w-3" />
                {t('purchases.vendors.modal.addShopName')}
              </button>
            </div>
          )}

          {/* Optional Expandable: Alternate Phone */}
          {showAltPhone ? (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-medium text-stone-700">{t('purchases.vendors.modal.altPhone')}</label>
                <button
                  type="button"
                  onClick={() => {
                    setShowAltPhone(false);
                    setAlternatePhone('');
                  }}
                  className="text-[10px] text-stone-400 hover:text-stone-600"
                >
                  ✕
                </button>
              </div>
              <input
                ref={altPhoneInputRef}
                type="tel"
                inputMode="tel"
                value={alternatePhone}
                onChange={(e) => setAlternatePhone(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, 'altPhone')}
                enterKeyHint={getEnterKeyHint('altPhone')}
                placeholder={t('purchases.vendors.modal.phonePlaceholder')}
                className="w-full rounded-md border border-stone-300 p-2 text-stone-900 text-xs focus:outline-none focus:border-amber-500"
              />
            </div>
          ) : (
            <div>
              <button
                type="button"
                onClick={() => {
                  setShowAltPhone(true);
                  setTimeout(() => altPhoneInputRef.current?.focus(), 50);
                }}
                className="text-[11px] text-amber-700 hover:text-amber-900 font-semibold hover:underline flex items-center gap-1"
              >
                <Plus className="h-3 w-3" />
                {t('purchases.vendors.modal.addAltPhone')}
              </button>
            </div>
          )}

          {/* Optional Expandable: Payment Terms */}
          {showPaymentTerms ? (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-medium text-stone-700">{t('purchases.vendors.modal.paymentTerms')}</label>
                <button
                  type="button"
                  onClick={() => {
                    setShowPaymentTerms(false);
                    setPaymentTerms('Net 7 Days');
                  }}
                  className="text-[10px] text-stone-400 hover:text-stone-600"
                >
                  ✕
                </button>
              </div>
              <select
                ref={paymentTermsSelectRef}
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, 'paymentTerms')}
                className="w-full rounded-md border border-stone-300 p-2 text-stone-900 text-xs focus:outline-none focus:border-amber-500"
              >
                {PAYMENT_TERMS_CONFIG.map((term) => (
                  <option key={term.id} value={term.id}>
                    {locale === 'hi' ? term.hi : term.en}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <button
                type="button"
                onClick={() => {
                  setShowPaymentTerms(true);
                  setTimeout(() => paymentTermsSelectRef.current?.focus(), 50);
                }}
                className="text-[11px] text-amber-700 hover:text-amber-900 font-semibold hover:underline flex items-center gap-1"
              >
                <Plus className="h-3 w-3" />
                {t('purchases.vendors.modal.addPaymentTerms')}
              </button>
            </div>
          )}

          {/* Footer Buttons */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-200">
            <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={saving}>
              {t('purchases.vendors.modal.cancel')}
            </Button>
            <Button type="submit" variant="amber" size="sm" disabled={saving} className="gap-1.5 font-bold">
              {saving ? t('purchases.vendors.modal.saving') : t('purchases.vendors.modal.save')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
