'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { createClient } from '@/lib/supabase/client';
import { Vendor } from '@/lib/types/database';
import { X, Check, Building2, Phone, Mail, MapPin, CreditCard, Tag, AlertCircle } from 'lucide-react';

interface VendorModalProps {
  isOpen: boolean;
  onClose: () => void;
  vendor?: Vendor | null;
  onSaved?: (vendor: Vendor) => void;
}

const DEFAULT_CATEGORIES = [
  'Vegetables & Fruits',
  'Groceries & Spices',
  'Dairy & Milk',
  'LPG & Fuel',
  'Beverages',
  'Disposables & Packaging',
  'Maintenance & Hardware',
  'Uniforms & Linens',
  'Cleaning & Sanitation',
  'Other',
];

const PAYMENT_TERMS_OPTIONS = [
  'Immediate / Cash on Delivery',
  'Net 7 Days',
  'Net 15 Days',
  'Net 30 Days',
  'Advance Payment',
];

const PAYMENT_FREQUENCY_OPTIONS = [
  'Per Delivery',
  'Weekly',
  'Bi-weekly',
  'Monthly',
  'As Needed',
];

export function VendorModal({ isOpen, onClose, vendor, onSaved }: VendorModalProps) {
  const supabase = createClient();
  const isEdit = Boolean(vendor?.id);

  const [vendorCode, setVendorCode] = useState('');
  const [name, setName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [alternatePhone, setAlternatePhone] = useState('');
  const [address, setAddress] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('Net 7 Days');
  const [paymentFrequency, setPaymentFrequency] = useState('Weekly');
  const [preferredPaymentMethodId, setPreferredPaymentMethodId] = useState('');
  const [supplierCategories, setSupplierCategories] = useState<string[]>([]);
  const [customCategory, setCustomCategory] = useState('');
  const [notes, setNotes] = useState('');
  const [isActive, setIsActive] = useState(true);

  const [paymentMethods, setPaymentMethods] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fetch payment methods
  useEffect(() => {
    async function fetchPaymentMethods() {
      const { data } = await supabase
        .from('payment_methods')
        .select('id, name')
        .order('name');
      if (data) setPaymentMethods(data);
    }
    if (isOpen) {
      fetchPaymentMethods();
    }
  }, [isOpen, supabase]);

  // Initialize or generate vendor code
  useEffect(() => {
    if (!isOpen) return;
    setErrorMessage(null);

    if (vendor) {
      setVendorCode(vendor.vendor_code || '');
      setName(vendor.name || '');
      setContactPerson(vendor.contact_person || '');
      setPhone(vendor.phone || '');
      setAlternatePhone(vendor.alternate_phone || '');
      setAddress(vendor.address || '');
      setPaymentTerms(vendor.payment_terms || 'Net 7 Days');
      setPaymentFrequency(vendor.payment_frequency || 'Weekly');
      setPreferredPaymentMethodId(vendor.preferred_payment_method_id || '');
      setSupplierCategories(vendor.supplier_categories || []);
      setNotes(vendor.notes || '');
      setIsActive(vendor.is_active !== false);
    } else {
      // Reset form
      setName('');
      setContactPerson('');
      setPhone('');
      setAlternatePhone('');
      setAddress('');
      setPaymentTerms('Net 7 Days');
      setPaymentFrequency('Weekly');
      setPreferredPaymentMethodId('');
      setSupplierCategories([]);
      setNotes('');
      setIsActive(true);

      // Generate next vendor code
      generateNextVendorCode();
    }
  }, [isOpen, vendor]);

  const generateNextVendorCode = async () => {
    try {
      const { data } = await supabase
        .from('vendors')
        .select('vendor_code');

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

  const toggleCategory = (cat: string) => {
    if (supplierCategories.includes(cat)) {
      setSupplierCategories(supplierCategories.filter((c) => c !== cat));
    } else {
      setSupplierCategories([...supplierCategories, cat]);
    }
  };

  const handleAddCustomCategory = (e: React.KeyboardEvent | React.MouseEvent) => {
    if ('key' in e && e.key !== 'Enter') return;
    e.preventDefault();
    const trimmed = customCategory.trim();
    if (trimmed && !supplierCategories.includes(trimmed)) {
      setSupplierCategories([...supplierCategories, trimmed]);
      setCustomCategory('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMessage('Vendor Name is required.');
      return;
    }

    setSaving(true);
    setErrorMessage(null);

    try {
      const payload = {
        vendor_code: vendorCode.trim() || null,
        name: name.trim(),
        contact_person: contactPerson.trim() || null,
        phone: phone.trim() || null,
        alternate_phone: alternatePhone.trim() || null,
        address: address.trim() || null,
        payment_terms: paymentTerms.trim() || null,
        payment_frequency: paymentFrequency.trim() || null,
        preferred_payment_method_id: preferredPaymentMethodId || null,
        supplier_categories: supplierCategories,
        notes: notes.trim() || null,
        is_active: isActive,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-xl max-w-2xl w-full my-8 shadow-2xl border border-stone-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between bg-stone-50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-100 text-amber-800 rounded-lg">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-stone-900">
                {isEdit ? `Edit Vendor: ${vendor?.name}` : 'Add New Supplier / Vendor'}
              </h2>
              <p className="text-xs text-stone-500">
                {isEdit ? 'Update vendor details and commercial terms safely' : 'Register a new supplier for purchasing & inventory'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-200/60 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Section 1: Basic Identification */}
          <div className="space-y-3">
            <h3 className="font-semibold text-stone-900 text-sm border-b border-stone-100 pb-1.5 flex items-center gap-2">
              <span>Basic Information</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block font-medium text-stone-700 mb-1">
                  Vendor / Supplier Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Sharma Fresh Vegetables"
                  className="w-full rounded-md border border-stone-300 p-2.5 text-stone-900 text-sm focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">
                  Vendor Code
                </label>
                <input
                  type="text"
                  value={vendorCode}
                  onChange={(e) => setVendorCode(e.target.value)}
                  placeholder="e.g. VEND-001"
                  className="w-full rounded-md border border-stone-300 bg-stone-50 p-2.5 font-mono text-stone-800 text-sm focus:outline-none focus:border-amber-500"
                />
                <span className="text-[10px] text-stone-400 mt-0.5 block">Auto-generated</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-medium text-stone-700 mb-1">Contact Person</label>
                <input
                  type="text"
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  placeholder="e.g. Ramesh Sharma"
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Primary Phone</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Alternate Phone</label>
                <input
                  type="tel"
                  value={alternatePhone}
                  onChange={(e) => setAlternatePhone(e.target.value)}
                  placeholder="Optional backup phone"
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div>
              <label className="block font-medium text-stone-700 mb-1">Physical / Billing Address</label>
              <textarea
                rows={2}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Shop/Mandi number, street, city..."
                className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500 resize-none"
              />
            </div>
          </div>

          {/* Section 2: Supplier Categories */}
          <div className="space-y-2">
            <h3 className="font-semibold text-stone-900 text-sm border-b border-stone-100 pb-1.5 flex items-center justify-between">
              <span>Supplier Categories</span>
              <span className="text-[11px] font-normal text-stone-500">Select all that apply</span>
            </h3>

            <div className="flex flex-wrap gap-1.5 pt-1">
              {DEFAULT_CATEGORIES.map((cat) => {
                const isSelected = supplierCategories.includes(cat);
                return (
                  <button
                    type="button"
                    key={cat}
                    onClick={() => toggleCategory(cat)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors flex items-center gap-1 ${
                      isSelected
                        ? 'bg-amber-100 text-amber-900 border-amber-300 font-semibold'
                        : 'bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100'
                    }`}
                  >
                    {isSelected && <Check className="h-3 w-3 text-amber-700" />}
                    {cat}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                onKeyDown={handleAddCustomCategory}
                placeholder="Add custom category..."
                className="rounded-md border border-stone-300 px-2 py-1 text-xs text-stone-900 w-48 focus:outline-none focus:border-amber-500"
              />
              <button
                type="button"
                onClick={handleAddCustomCategory}
                className="px-2.5 py-1 bg-stone-100 text-stone-700 rounded-md hover:bg-stone-200 font-medium text-xs"
              >
                + Add
              </button>
            </div>
          </div>

          {/* Section 3: Commercial & Payment Terms */}
          <div className="space-y-3">
            <h3 className="font-semibold text-stone-900 text-sm border-b border-stone-100 pb-1.5">
              Commercial & Settlement Terms
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-medium text-stone-700 mb-1">Payment Terms</label>
                <select
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                >
                  {PAYMENT_TERMS_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                  <option value="Custom">Custom Terms</option>
                </select>
                {paymentTerms === 'Custom' && (
                  <input
                    type="text"
                    onChange={(e) => setPaymentTerms(e.target.value)}
                    placeholder="Specify custom terms..."
                    className="mt-1.5 w-full rounded-md border border-stone-300 p-1.5 text-stone-900 focus:outline-none focus:border-amber-500 text-xs"
                  />
                )}
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Payment Frequency</label>
                <select
                  value={paymentFrequency}
                  onChange={(e) => setPaymentFrequency(e.target.value)}
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                >
                  {PAYMENT_FREQUENCY_OPTIONS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Preferred Payment Mode</label>
                <select
                  value={preferredPaymentMethodId}
                  onChange={(e) => setPreferredPaymentMethodId(e.target.value)}
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                >
                  <option value="">Any / Not Specified</option>
                  {paymentMethods.map((pm) => (
                    <option key={pm.id} value={pm.id}>
                      {pm.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Section 4: Notes & Status */}
          <div className="space-y-3">
            <h3 className="font-semibold text-stone-900 text-sm border-b border-stone-100 pb-1.5">
              Notes & Status
            </h3>

            <div>
              <label className="block font-medium text-stone-700 mb-1">Internal Notes</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Bank details, GSTIN, delivery schedule instructions, preferred mandi broker..."
                className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500 resize-none"
              />
            </div>

            <div className="flex items-center justify-between p-3 bg-stone-50 rounded-lg border border-stone-200">
              <div>
                <div className="font-semibold text-stone-800">Vendor Active Status</div>
                <div className="text-[11px] text-stone-500">
                  Inactive vendors are hidden from purchase entry dropdowns but preserved in financial records.
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
              </label>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-stone-200">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" variant="amber" disabled={saving} className="gap-1.5">
              {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Vendor'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
