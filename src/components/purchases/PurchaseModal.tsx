'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { DatePicker } from '@/components/ui/DatePicker';
import { formatINR, getTodayBusinessDate } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { VendorOutstandingSummary } from '@/lib/types/database';
import { PurchaseInvoiceRecord } from '@/components/purchases/PurchaseInvoicesView';
import { filterLogicalIngredientGroups } from '@/lib/inventory/search';
import {
  ShoppingBag,
  Plus,
  Trash2,
  X,
  Search,
  Package,
  Check,
  ChevronDown,
  AlertCircle,
  ChevronRight,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { getLocalizedMasterName, getLocalizedMasterSymbol } from '@/lib/i18n/master-data';

export interface PurchaseLineForm {
  line_id?: string | null;
  item_id: string;
  item_name?: string;
  brand_name?: string;
  group_name?: string;
  base_unit_canonical?: string; // 'kg', 'g', 'l', 'ml', 'pcs'
  base_unit_symbol?: string;    // localized symbol for UI
  use_pack?: boolean;
  packaging_unit_id?: string | null;
  pack_unit?: string;
  pack_quantity?: string | number | null;
  pack_rate?: string | number | null;
  conversion_factor?: number;
  is_custom_pack?: boolean;
  quantity?: string | number | null;
  rate?: string | number | null;
  line_total?: string | number | null;
  previous_rate?: number;
  previous_date?: string;
}

interface PurchaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  vendors: VendorOutstandingSummary[];
  items: any[];
  groups: any[];
  packagingUnits: any[];
  categories: any[];
  units: any[];
  locations: any[];
  aliases: any[];
  invoices: PurchaseInvoiceRecord[];
  vendorPriceMemory: Record<string, { rate: number; date: string }>;
  businessDate: string;
  onPurchaseSaved: (purchaseNumber: string) => void;
  onOpenQuickVendor: () => void;
  selectedVendorId: string;
  setSelectedVendorId: (id: string) => void;
  onNewItemCreated?: (newItem: any, newGroup?: any) => void;
  invoiceToEdit?: PurchaseInvoiceRecord | null;
}

export function PurchaseModal({
  isOpen,
  onClose,
  vendors,
  items,
  groups,
  packagingUnits,
  categories,
  units,
  locations,
  aliases,
  invoices,
  vendorPriceMemory,
  businessDate,
  onPurchaseSaved,
  onOpenQuickVendor,
  selectedVendorId,
  setSelectedVendorId,
  onNewItemCreated,
  invoiceToEdit,
}: PurchaseModalProps) {
  const { t, locale } = useI18n();
  const supabase = createClient();
  const isEdit = Boolean(invoiceToEdit?.id);

  // Invoice Header State
  const [purchaseDate, setPurchaseDate] = useState(businessDate || getTodayBusinessDate());
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<PurchaseLineForm[]>([]);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sync state whenever modal opens or invoiceToEdit changes
  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      if (invoiceToEdit) {
        setSelectedVendorId(invoiceToEdit.vendor_id);
        setPurchaseDate(invoiceToEdit.purchase_date);
        setInvoiceNumber(invoiceToEdit.invoice_number || '');
        setNotes((invoiceToEdit as any).notes || '');

        const mappedLines: PurchaseLineForm[] = (invoiceToEdit.lines || []).map((l: any) => {
          const matchedItem = items.find((it) => it.id === l.item_id);
          const matchedGroup = groups.find((g) => g.id === matchedItem?.group_id);
          const canonicalUnit = (matchedItem?.unit?.symbol || 'kg').toLowerCase();
          const baseUnitDisplay =
            getLocalizedMasterSymbol(matchedItem?.unit, locale) ||
            matchedItem?.unit?.symbol ||
            l.unit_symbol ||
            (locale === 'hi' ? 'किग्रा' : 'kg');

          const usePack = Boolean(l.pack_unit_snapshot);
          const qVal = usePack ? (l.pack_quantity ?? l.quantity) : l.quantity;
          const rVal = usePack ? (l.pack_rate ?? l.rate) : l.rate;

          return {
            line_id: l.id,
            item_id: l.item_id,
            item_name: (locale === 'hi' && matchedItem?.name_hi) ? matchedItem.name_hi : (l.item_name || matchedItem?.name || 'Item'),
            brand_name: l.brand_name_snapshot || matchedItem?.brand_name || 'Generic',
            group_name: matchedGroup?.name || matchedItem?.name?.split('—')[0]?.trim() || l.item_name,
            base_unit_canonical: canonicalUnit,
            base_unit_symbol: baseUnitDisplay,
            use_pack: usePack,
            packaging_unit_id: l.packaging_unit_id || null,
            pack_unit: l.pack_unit_snapshot || baseUnitDisplay,
            pack_quantity: usePack ? String(qVal) : '',
            pack_rate: usePack ? String(rVal) : '',
            conversion_factor: l.conversion_factor_snapshot ? Number(l.conversion_factor_snapshot) : 1,
            quantity: String(l.quantity),
            rate: String(l.rate),
            line_total: l.total_amount ? String(l.total_amount) : '',
          };
        });
        setLines(mappedLines);
      } else {
        setPurchaseDate(businessDate || getTodayBusinessDate());
        setInvoiceNumber('');
        setNotes('');
        setLines([]);
      }
    }
  }, [isOpen, invoiceToEdit, businessDate]);

  // Item Search Submodal State
  const [showItemSearch, setShowItemSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeLineIndex, setActiveLineIndex] = useState<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Brand Selector Submodal State
  const [brandSelectGroup, setBrandSelectGroup] = useState<any | null>(null);
  const [showAddBrandModal, setShowAddBrandModal] = useState(false);
  const [newBrandName, setNewBrandName] = useState('');
  const [brandSaving, setBrandSaving] = useState(false);

  // Add New Item Submodal State (When search has no results)
  const [showNewItemModal, setShowNewItemModal] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategoryId, setNewItemCategoryId] = useState('');
  const [categorySearchQuery, setCategorySearchQuery] = useState('');
  const [isCategoryPickerOpen, setIsCategoryPickerOpen] = useState(false);
  const [newItemUnitId, setNewItemUnitId] = useState('');
  const [newItemSaving, setNewItemSaving] = useState(false);

  // Unit & Packaging Selection Submodal State
  const [unitSelectLineIndex, setUnitSelectLineIndex] = useState<number | null>(null);
  const [sizePromptPackType, setSizePromptPackType] = useState<string | null>(null);
  const [customSizeValue, setCustomSizeValue] = useState('');
  const [customSizeUnit, setCustomSizeUnit] = useState('g');

  // Central Store Location lookup
  const centralStoreId = useMemo(() => {
    return (
      locations.find((l) => l.code?.toUpperCase() === 'STORE' && l.is_active)?.id ||
      locations.find((l) => l.name?.toLowerCase().includes('central store') && l.is_active)?.id ||
      'a89335e9-01b4-4edd-bee5-a894053d798d'
    );
  }, [locations]);

  // Build aliases map for search
  const aliasesMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    aliases.forEach((a) => {
      if (a.item_id) {
        if (!map[a.item_id]) map[a.item_id] = [];
        if (a.alias && !map[a.item_id].includes(a.alias)) map[a.item_id].push(a.alias);
      }
      if (a.group_id) {
        if (!map[a.group_id]) map[a.group_id] = [];
        if (a.alias && !map[a.group_id].includes(a.alias)) map[a.group_id].push(a.alias);
      }
    });
    return map;
  }, [aliases]);

  // Build consolidated parent groups with variants
  const enrichedGroups = useMemo(() => {
    // If groups were loaded from database
    if (groups && groups.length > 0) {
      const seenGroupIds = new Set<string>();
      const deduped: any[] = [];
      groups.forEach((g) => {
        if (!seenGroupIds.has(g.id)) {
          seenGroupIds.add(g.id);
          const variants = items.filter((it) => it.group_id === g.id && it.is_active !== false);
          deduped.push({
            ...g,
            variants,
          });
        }
      });
      return deduped;
    }

    // Fallback: Group items by group_id or create virtual parent groups
    const groupMap = new Map<string, any>();
    items.forEach((it) => {
      if (it.is_active === false) return;
      const gId = it.group_id || it.id;
      if (!groupMap.has(gId)) {
        const cleanName = it.name.split('—')[0].split('-')[0].trim();
        groupMap.set(gId, {
          id: gId,
          name: cleanName,
          name_hi: it.name_hi,
          group_code: it.item_code,
          base_unit: it.unit,
          category_id: it.category_id,
          inventory_class: it.inventory_class,
          variants: [],
        });
      }
      groupMap.get(gId).variants.push(it);
    });
    return Array.from(groupMap.values());
  }, [groups, items]);

  // Filter parent products for search
  const filteredParentGroups = useMemo(() => {
    if (!searchQuery.trim()) return enrichedGroups.slice(0, 30);
    return filterLogicalIngredientGroups(enrichedGroups, searchQuery, aliasesMap);
  }, [enrichedGroups, searchQuery, aliasesMap]);

  // Focus search input when item search opens
  useEffect(() => {
    if (showItemSearch) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [showItemSearch]);

  // Filtered categories for Add Item modal
  const filteredCategories = useMemo(() => {
    if (!categorySearchQuery.trim()) return categories;
    const q = categorySearchQuery.toLowerCase().trim();
    return categories.filter((c) => {
      const en = (c.name || '').toLowerCase();
      const hi = (c.name_hi || '').toLowerCase();
      return en.includes(q) || hi.includes(q);
    });
  }, [categories, categorySearchQuery]);

  // Reset or initialize modal
  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
    }
  }, [isOpen]);

  // Calculate invoice total
  const invoiceTotal = useMemo(() => {
    return lines.reduce((acc, l) => {
      if (l.line_total !== undefined && l.line_total !== null && l.line_total !== '') {
        return acc + (Number(l.line_total) || 0);
      }
      const q = Number(l.use_pack ? l.pack_quantity : l.quantity) || 0;
      const r = Number(l.use_pack ? l.pack_rate : l.rate) || 0;
      return acc + q * r;
    }, 0);
  }, [lines]);

  // Helper: Classify unit dimension strictly from canonical symbol (not localized)
  const getUnitDimension = (canonicalUnit?: string): 'mass' | 'volume' | 'count' => {
    const c = (canonicalUnit || '').toLowerCase().trim();
    if (['kg', 'g', 'mg', 'gram', 'kilogram'].includes(c)) return 'mass';
    if (['l', 'ml', 'liter', 'litre', 'milliliter'].includes(c)) return 'volume';
    return 'count';
  };

  // Helper: Find previous purchase memory for an item from history
  const findPreviousPurchaseMemory = (itemId: string) => {
    for (const inv of invoices) {
      if (inv.status === 'cancelled') continue;
      const matchingLine = (inv.lines || []).find((l) => l.item_id === itemId);
      if (matchingLine) {
        return {
          pack_unit_snapshot: matchingLine.pack_unit_snapshot,
          pack_rate: matchingLine.pack_rate ? Number(matchingLine.pack_rate) : undefined,
          conversion_factor_snapshot: matchingLine.conversion_factor_snapshot
            ? Number(matchingLine.conversion_factor_snapshot)
            : undefined,
          packaging_unit_id: matchingLine.packaging_unit_id,
          rate: matchingLine.rate ? Number(matchingLine.rate) : undefined,
          purchase_date: inv.purchase_date,
        };
      }
    }
    return null;
  };

  // Helper: Apply selected item & brand variant to a line
  const applyVariantToLine = (targetIndex: number | null, variantItem: any, parentGroup?: any) => {
    const nextLines = [...lines];
    const prevMemory = findPreviousPurchaseMemory(variantItem.id);
    const vendorMemory = vendorPriceMemory[variantItem.id];

    // Determine canonical symbol and localized display symbol
    const canonicalUnit = (variantItem.unit?.symbol || 'kg').toLowerCase();
    const baseUnitDisplay =
      getLocalizedMasterSymbol(variantItem.unit, locale) ||
      variantItem.unit?.symbol ||
      (locale === 'hi' ? 'किग्रा' : 'kg');

    // Determine default packaging
    const itemPkgs = packagingUnits.filter((p) => (p.inventory_item_id || p.item_id) === variantItem.id);
    const defaultPkg = itemPkgs.find((p) => p.is_default) || itemPkgs[0];

    // Empty numerical inputs by default (no prefilled 1s or rates)
    let newLine: PurchaseLineForm = {
      item_id: variantItem.id,
      item_name: (locale === 'hi' && variantItem.name_hi) ? variantItem.name_hi : variantItem.name,
      brand_name: variantItem.brand_name || variantItem.variant_name || (locale === 'hi' ? 'सामान्य' : 'Generic'),
      group_name: parentGroup?.name || variantItem.name.split('—')[0].trim(),
      base_unit_canonical: canonicalUnit,
      base_unit_symbol: baseUnitDisplay,
      quantity: '',
      rate: '',
      pack_quantity: '',
      pack_rate: '',
    };

    // Priority 1: Use previous purchase history memory for packaging unit & size
    if (prevMemory) {
      if (prevMemory.pack_unit_snapshot && prevMemory.conversion_factor_snapshot && prevMemory.conversion_factor_snapshot > 0) {
        newLine.use_pack = true;
        newLine.pack_unit = prevMemory.pack_unit_snapshot;
        newLine.conversion_factor = prevMemory.conversion_factor_snapshot;
        newLine.packaging_unit_id = prevMemory.packaging_unit_id || null;
        newLine.previous_rate = prevMemory.pack_rate || (vendorMemory ? vendorMemory.rate * prevMemory.conversion_factor_snapshot : undefined);
        newLine.previous_date = prevMemory.purchase_date;
      } else {
        newLine.use_pack = false;
        newLine.conversion_factor = 1;
        newLine.previous_rate = prevMemory.rate || (vendorMemory ? vendorMemory.rate : undefined);
        newLine.previous_date = prevMemory.purchase_date;
      }
    } else if (defaultPkg) {
      // Priority 2: Use default item packaging unit
      newLine.use_pack = true;
      newLine.packaging_unit_id = defaultPkg.id;
      newLine.pack_unit = defaultPkg.pack_unit_name || defaultPkg.packaging_name || `${defaultPkg.pack_size_in_base_units} ${baseUnitDisplay}`;
      newLine.conversion_factor = Number(defaultPkg.pack_size_in_base_units) || 1;
      if (defaultPkg.default_purchase_rate) {
        newLine.previous_rate = Number(defaultPkg.default_purchase_rate);
      } else if (vendorMemory) {
        newLine.previous_rate = vendorMemory.rate * newLine.conversion_factor;
        newLine.previous_date = vendorMemory.date;
      }
    } else if (variantItem.secondary_unit_id && Number(variantItem.conversion_factor) > 0) {
      // Priority 3: Legacy secondary unit
      newLine.use_pack = true;
      newLine.conversion_factor = Number(variantItem.conversion_factor);
      newLine.pack_unit = variantItem.sec_unit?.symbol || 'Pack';
      if (vendorMemory) {
        newLine.previous_rate = vendorMemory.rate * newLine.conversion_factor;
        newLine.previous_date = vendorMemory.date;
      }
    } else {
      // Priority 4: Base unit
      newLine.use_pack = false;
      newLine.conversion_factor = 1;
      if (vendorMemory) {
        newLine.previous_rate = vendorMemory.rate;
        newLine.previous_date = vendorMemory.date;
      }
    }

    if (targetIndex !== null && targetIndex >= 0 && targetIndex < nextLines.length) {
      const existingLine = nextLines[targetIndex];
      if (existingLine.quantity) newLine.quantity = existingLine.quantity;
      if (existingLine.pack_quantity) newLine.pack_quantity = existingLine.pack_quantity;
      if (existingLine.rate) newLine.rate = existingLine.rate;
      if (existingLine.pack_rate) newLine.pack_rate = existingLine.pack_rate;
      if (existingLine.line_total) newLine.line_total = existingLine.line_total;
      nextLines[targetIndex] = newLine;
    } else {
      nextLines.push(newLine);
    }

    setLines(nextLines);
    setShowItemSearch(false);
    setBrandSelectGroup(null);
    setSearchQuery('');
  };

  // Handler: Selecting a parent group from search
  const handleSelectParentGroup = (group: any) => {
    const variants = (group.variants || []).filter((v: any) => v.is_active !== false);

    // If exactly 1 variant, auto-select it immediately without extra tap
    if (variants.length <= 1) {
      const singleVariant = variants[0] || items.find((i) => i.id === group.id) || group;
      applyVariantToLine(activeLineIndex, singleVariant, group);
    } else {
      // Multiple variants: open "Select Brand" popup
      setBrandSelectGroup(group);
    }
  };

  // Handler: Save brand for an existing group
  const handleSaveNewBrand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBrandName.trim() || !brandSelectGroup) return;

    setBrandSaving(true);
    try {
      const cleanBrand = newBrandName.trim();
      const group = brandSelectGroup;
      const baseUnitId = group.base_unit_id || group.base_unit?.id || group.variants?.[0]?.unit_id;
      const categoryId = group.category_id || group.variants?.[0]?.category_id;
      const invClass = group.inventory_class || group.variants?.[0]?.inventory_class || 'Food Raw Material';
      const uniqueSuffix = `${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;
      const itemCode = `ITM-${cleanBrand.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || 'RAW'}-${uniqueSuffix}`;
      const itemName = `${group.name} — ${cleanBrand}`;
      const itemNameHi = group.name_hi ? `${group.name_hi} — ${cleanBrand}` : null;

      const { data: newItem, error: insErr } = await supabase
        .from('inventory_items')
        .insert({
          group_id: group.id,
          item_code: itemCode,
          name: itemName,
          name_hi: itemNameHi,
          brand_name: cleanBrand,
          variant_name: cleanBrand,
          category_id: categoryId,
          inventory_class: invClass,
          unit_id: baseUnitId,
          current_stock: 0,
          current_weighted_average_cost: 0,
          is_costed: false,
          is_active: true,
        })
        .select(`
          id, item_code, name, name_hi, group_id, brand_name, variant_name, category_id, inventory_class, unit_id, secondary_unit_id, conversion_factor, is_active, current_stock, current_weighted_average_cost,
          unit:units!inventory_items_unit_id_fkey(id, symbol, symbol_hi, name, name_hi),
          sec_unit:units!inventory_items_secondary_unit_id_fkey(id, symbol, symbol_hi, name, name_hi)
        `)
        .single();

      if (insErr) throw insErr;

      // Seed Central Store stock record
      if (centralStoreId) {
        await supabase
          .from('item_location_stocks')
          .insert({
            item_id: newItem.id,
            location_id: centralStoreId,
            quantity: 0,
          })
          .select();
      }

      if (onNewItemCreated) {
        onNewItemCreated(newItem, group);
      }

      // Automatically select newly created brand variant
      applyVariantToLine(activeLineIndex, newItem, group);
      setShowAddBrandModal(false);
      setNewBrandName('');
    } catch (err: any) {
      console.error('Error creating new brand:', err);
      alert('Failed to add brand: ' + (err.message || ''));
    } finally {
      setBrandSaving(false);
    }
  };

  // Handler: Save completely new item with 3 fields (Item Name, Category, Unit)
  const handleSaveNewItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim() || !newItemCategoryId || !newItemUnitId) {
      alert('Please fill Item Name, Category and Unit.');
      return;
    }

    setNewItemSaving(true);
    try {
      const cleanName = newItemName.trim();

      // Check for existing item with identical name to prevent duplicate creation
      const existingItem = items.find(
        (it) => it.name.toLowerCase().trim() === cleanName.toLowerCase() ||
                (it.name_hi && it.name_hi.trim() === cleanName)
      );

      if (existingItem) {
        const existingGroup = groups.find((g) => g.id === existingItem.group_id) || {
          id: existingItem.group_id || existingItem.id,
          name: existingItem.name,
          name_hi: existingItem.name_hi,
          variants: [existingItem],
        };
        applyVariantToLine(activeLineIndex, existingItem, existingGroup);
        setShowNewItemModal(false);
        setNewItemName('');
        return;
      }

      const uniqueSuffix = `${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;
      const groupCode = `GRP-ITM-${uniqueSuffix}`;
      const itemCode = `ITM-${uniqueSuffix}`;

      const selectedCat = categories.find((c) => c.id === newItemCategoryId);
      const validClasses = ['Food Raw Material', 'Non-Food Consumable', 'Physical Asset', 'Uniform'];
      const invClass = selectedCat?.inventory_class && validClasses.includes(selectedCat.inventory_class)
        ? selectedCat.inventory_class
        : 'Non-Food Consumable';

      // 1. Create logical ingredient group
      const { data: newGroup, error: grpErr } = await supabase
        .from('logical_ingredient_groups')
        .insert({
          group_code: groupCode,
          name: cleanName,
          category_id: newItemCategoryId,
          base_unit_id: newItemUnitId,
          inventory_class: invClass,
          is_active: true,
        })
        .select(`
          id, group_code, name, name_hi, category_id, inventory_class, base_unit_id,
          base_unit:units!logical_ingredient_groups_base_unit_id_fkey(id, symbol, symbol_hi, name, name_hi)
        `)
        .single();

      if (grpErr) throw grpErr;

      // 2. Create inventory item (unbranded / generic)
      const { data: newItem, error: itmErr } = await supabase
        .from('inventory_items')
        .insert({
          group_id: newGroup.id,
          item_code: itemCode,
          name: cleanName,
          brand_name: 'Generic',
          variant_name: cleanName,
          category_id: newItemCategoryId,
          unit_id: newItemUnitId,
          inventory_class: invClass,
          current_stock: 0,
          current_weighted_average_cost: 0,
          is_costed: false,
          is_active: true,
        })
        .select(`
          id, item_code, name, name_hi, group_id, brand_name, variant_name, category_id, inventory_class, unit_id, secondary_unit_id, conversion_factor, is_active, current_stock, current_weighted_average_cost,
          unit:units!inventory_items_unit_id_fkey(id, symbol, symbol_hi, name, name_hi),
          sec_unit:units!inventory_items_secondary_unit_id_fkey(id, symbol, symbol_hi, name, name_hi)
        `)
        .single();

      if (itmErr) throw itmErr;

      // 3. Central Store stock
      if (centralStoreId) {
        await supabase
          .from('item_location_stocks')
          .insert({
            item_id: newItem.id,
            location_id: centralStoreId,
            quantity: 0,
          });
      }

      if (onNewItemCreated) {
        onNewItemCreated(newItem, newGroup);
      }

      // 4. Auto-select created item without losing invoice state
      applyVariantToLine(activeLineIndex, newItem, newGroup);
      setShowNewItemModal(false);
      setNewItemName('');
    } catch (err: any) {
      console.error('Error creating new item:', err);
      alert('Failed to create new item: ' + (err.message || ''));
    } finally {
      setNewItemSaving(false);
    }
  };

  // Handler: Selecting / updating unit & packaging for a line
  const handleSelectUnitOption = (
    lineIdx: number,
    optionType: 'base' | 'kg' | 'existing_pkg' | 'prompt_size',
    pkgData?: any
  ) => {
    const nextLines = [...lines];
    const line = nextLines[lineIdx];
    const canonical = (line.base_unit_canonical || 'kg').toLowerCase();

    if (optionType === 'base') {
      line.use_pack = false;
      line.is_custom_pack = false;
      line.packaging_unit_id = null;
      line.conversion_factor = 1;
      if (line.pack_quantity && !line.quantity) {
        line.quantity = line.pack_quantity;
      }
      if (line.pack_rate && !line.rate) {
        line.rate = line.pack_rate;
      }
      setLines(nextLines);
      setUnitSelectLineIndex(null);
    } else if (optionType === 'kg') {
      const dim = getUnitDimension(canonical);
      if (dim === 'volume') {
        if (canonical === 'l') {
          line.use_pack = false;
          line.is_custom_pack = false;
          line.packaging_unit_id = null;
          line.pack_unit = 'L';
          line.conversion_factor = 1;
        } else {
          line.use_pack = true;
          line.is_custom_pack = false;
          line.packaging_unit_id = null;
          line.pack_unit = 'L';
          line.conversion_factor = 1000;
        }
      } else if (dim === 'mass') {
        if (canonical === 'kg') {
          line.use_pack = false;
          line.is_custom_pack = false;
          line.packaging_unit_id = null;
          line.pack_unit = 'kg';
          line.conversion_factor = 1;
        } else {
          line.use_pack = true;
          line.is_custom_pack = false;
          line.packaging_unit_id = null;
          line.pack_unit = 'kg';
          line.conversion_factor = canonical === 'g' ? 1000 : 1000000;
        }
      } else {
        // Count or other dimension: do not assign kg
        return;
      }

      if (line.quantity && !line.pack_quantity) {
        line.pack_quantity = line.quantity;
      }
      if (line.rate && !line.pack_rate) {
        line.pack_rate = line.rate;
      }
      setLines(nextLines);
      setUnitSelectLineIndex(null);
    } else if (optionType === 'existing_pkg' && pkgData) {
      line.use_pack = true;
      line.is_custom_pack = false;
      line.packaging_unit_id = pkgData.id;
      line.pack_unit = pkgData.pack_unit_name || `${pkgData.pack_size_in_base_units} ${line.base_unit_symbol}`;
      line.conversion_factor = Number(pkgData.pack_size_in_base_units) || 1;
      if (pkgData.default_purchase_rate) {
        line.previous_rate = Number(pkgData.default_purchase_rate);
      }
      if (line.quantity && !line.pack_quantity) {
        line.pack_quantity = line.quantity;
      }
      if (line.rate && !line.pack_rate) {
        line.pack_rate = line.rate;
      }
      setLines(nextLines);
      setUnitSelectLineIndex(null);
    } else if (optionType === 'prompt_size' && pkgData) {
      setSizePromptPackType(pkgData.type);
      setCustomSizeValue('');
      const dim = getUnitDimension(line.base_unit_canonical);
      setCustomSizeUnit(dim === 'mass' ? 'g' : dim === 'volume' ? 'ml' : 'pcs');
    }
  };

  // Handler: Apply size from preset or custom input
  const handleApplySize = (sizeStr: string, convFactor: number) => {
    if (unitSelectLineIndex === null) return;
    const nextLines = [...lines];
    const line = nextLines[unitSelectLineIndex];

    const typeLabel = sizePromptPackType || 'Pack';
    line.use_pack = true;
    line.is_custom_pack = true;
    line.packaging_unit_id = null;
    line.pack_unit = `${typeLabel} (${sizeStr})`;
    line.conversion_factor = convFactor;

    setLines(nextLines);
    setSizePromptPackType(null);
    setUnitSelectLineIndex(null);
  };

  // Handlers for Dual Rate / Total-Amount Entry
  const handleQuantityChange = (idx: number, val: string) => {
    const next = [...lines];
    const line = next[idx];
    if (line.use_pack) {
      line.pack_quantity = val;
    } else {
      line.quantity = val;
    }

    const q = parseFloat(val);
    const tot = parseFloat(String(line.line_total));
    const r = parseFloat(String(line.use_pack ? line.pack_rate : line.rate));

    if (!isNaN(q) && q > 0) {
      if (!isNaN(tot) && tot > 0) {
        const derivedRate = String(parseFloat((tot / q).toFixed(4)));
        if (line.use_pack) line.pack_rate = derivedRate;
        else line.rate = derivedRate;
      } else if (!isNaN(r) && r >= 0) {
        line.line_total = parseFloat((q * r).toFixed(2));
      }
    } else {
      if (!line.line_total) line.line_total = '';
    }
    setLines(next);
  };

  const handleRateChange = (idx: number, val: string) => {
    const next = [...lines];
    const line = next[idx];
    if (line.use_pack) {
      line.pack_rate = val;
    } else {
      line.rate = val;
    }

    const r = parseFloat(val);
    const q = parseFloat(String(line.use_pack ? line.pack_quantity : line.quantity));
    if (!isNaN(q) && q > 0 && !isNaN(r) && r >= 0) {
      line.line_total = parseFloat((q * r).toFixed(2));
    }
    setLines(next);
  };

  const handleTotalChange = (idx: number, val: string) => {
    const next = [...lines];
    const line = next[idx];
    line.line_total = val;

    const tot = parseFloat(val);
    const q = parseFloat(String(line.use_pack ? line.pack_quantity : line.quantity));
    if (!isNaN(tot) && tot >= 0 && !isNaN(q) && q > 0) {
      const derivedRate = String(parseFloat((tot / q).toFixed(4)));
      if (line.use_pack) {
        line.pack_rate = derivedRate;
      } else {
        line.rate = derivedRate;
      }
    }
    setLines(next);
  };

  const handleOpenBrandSelector = (lineIdx: number) => {
    const line = lines[lineIdx];
    if (!line) return;
    setActiveLineIndex(lineIdx);
    const itm = items.find((i) => i.id === line.item_id);
    const gId = itm?.group_id || line.item_id;
    const grp = enrichedGroups.find((g) => g.id === gId) || {
      id: gId,
      name: line.group_name || line.item_name,
      variants: items.filter((i) => (i.group_id && i.group_id === gId) || i.id === line.item_id),
    };
    setBrandSelectGroup(grp);
  };

  // Handler: Post / Save Purchase
  const handleSubmitPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVendorId) {
      alert(t('purchases.bills.errSelectVendor'));
      return;
    }

    if (!purchaseDate) {
      alert(t('purchases.bills.purchaseDate'));
      return;
    }

    if (lines.length === 0) {
      alert(t('purchases.bills.emptyItemsNotice'));
      return;
    }

    // Verify all lines have quantity and rate > 0
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const q = line.use_pack ? Number(line.pack_quantity) : Number(line.quantity);
      const r = line.use_pack ? Number(line.pack_rate) : Number(line.rate);
      if (!line.item_id) {
        alert(`Line ${i + 1}: Please select an item.`);
        return;
      }
      if (isNaN(q) || q <= 0) {
        alert(`Line ${i + 1} (${line.item_name}): Please enter a valid quantity.`);
        return;
      }
      if (isNaN(r) || r < 0) {
        alert(`Line ${i + 1} (${line.item_name}): Please enter a valid rate.`);
        return;
      }
    }

    setSaving(true);
    setErrorMessage(null);

    try {
      if (isEdit && invoiceToEdit) {
        // 1. Check if any new custom packaging units need to be persisted
        for (const line of lines) {
          if (line.use_pack && line.is_custom_pack && !line.packaging_unit_id) {
            const conv = Number(line.conversion_factor) || 1;
            const brandSnapshot = line.brand_name?.trim() || null;
            const packUnitSnapshot = line.pack_unit?.trim() || 'Pack';
            if (brandSnapshot && packUnitSnapshot && conv > 0) {
              try {
                const pkgRes = await fetch('/api/inventory/packaging', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    inventory_item_id: line.item_id,
                    brand_name: brandSnapshot,
                    pack_unit_name: packUnitSnapshot,
                    pack_size_in_base_units: conv,
                    vendor_id: selectedVendorId || null,
                    is_default: false,
                  }),
                });
                if (pkgRes.ok) {
                  const pkgJson = await pkgRes.json();
                  if (pkgJson.packaging?.id) line.packaging_unit_id = pkgJson.packaging.id;
                }
              } catch (pErr) {
                console.warn('Could not persist packaging definition:', pErr);
              }
            }
          }
        }

        // 2. Format payload lines
        const payloadLines = lines.map((line) => {
          let baseQty: number;
          let baseRate: number;
          let packQty: number | null = null;
          let packRate: number | null = null;
          let convFactorSnapshot: number | null = null;
          let packUnitSnapshot: string | null = null;

          const q = Number(line.use_pack ? line.pack_quantity : line.quantity) || 0;
          const r = Number(line.use_pack ? line.pack_rate : line.rate) || 0;
          const lineTotal = line.line_total !== undefined && line.line_total !== null && line.line_total !== ''
            ? Number(line.line_total)
            : q * r;

          if (line.use_pack) {
            const conv = Number(line.conversion_factor) || 1;
            packQty = q;
            packRate = r;
            baseQty = q * conv;
            baseRate = baseQty > 0 ? lineTotal / baseQty : (conv > 0 ? r / conv : r);
            convFactorSnapshot = conv;
            packUnitSnapshot = line.pack_unit?.trim() || 'Pack';
          } else {
            baseQty = q;
            baseRate = baseQty > 0 ? lineTotal / baseQty : r;
          }

          return {
            line_id: line.line_id || undefined,
            item_id: line.item_id,
            quantity: baseQty,
            rate: baseRate,
            total_amount: lineTotal,
            packaging_unit_id: line.packaging_unit_id || null,
            brand_name_snapshot: line.brand_name?.trim() || null,
            pack_unit_snapshot: packUnitSnapshot,
            pack_quantity: packQty,
            pack_rate: packRate,
            conversion_factor_snapshot: convFactorSnapshot,
          };
        });

        const res = await fetch('/api/finance/purchases/edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            purchase_id: invoiceToEdit.id,
            vendor_id: selectedVendorId,
            purchase_date: purchaseDate,
            invoice_number: invoiceNumber.trim() || undefined,
            lines: payloadLines,
            notes: notes.trim() || undefined,
          }),
        });

        const resData = await res.json();
        if (!res.ok) {
          throw new Error(resData.error || 'Failed to update invoice');
        }

        onPurchaseSaved(invoiceToEdit.purchase_number);
        onClose();
        return;
      }

      // Add Mode
      const netTotal = invoiceTotal;
      const purchaseNumber = `PO-${Date.now().toString().slice(-6)}`;

      // 1. Insert Purchase Header
      const { data: header, error: headerErr } = await supabase
        .from('purchase_headers')
        .insert({
          purchase_number: purchaseNumber,
          vendor_id: selectedVendorId,
          purchase_date: purchaseDate,
          business_date: purchaseDate,
          invoice_number: invoiceNumber.trim() || undefined,
          total_amount: netTotal,
          net_amount: netTotal,
        })
        .select()
        .single();

      if (headerErr) throw headerErr;

      // 2. Insert Lines & Inward Stock to Central Store
      for (const line of lines) {
        let baseQty: number;
        let baseRate: number;
        let pkgUnitId: string | null = null;
        let brandSnapshot: string | null = null;
        let packUnitSnapshot: string | null = null;
        let packQty: number | null = null;
        let packRate: number | null = null;
        let convFactorSnapshot: number | null = null;

        const q = Number(line.use_pack ? line.pack_quantity : line.quantity) || 0;
        const r = Number(line.use_pack ? line.pack_rate : line.rate) || 0;
        const lineTotal = line.line_total !== undefined && line.line_total !== null && line.line_total !== ''
          ? Number(line.line_total)
          : q * r;

        if (line.use_pack) {
          const conv = Number(line.conversion_factor) || 1;
          packQty = q;
          packRate = r;
          baseQty = packQty * conv;
          baseRate = baseQty > 0 ? lineTotal / baseQty : (conv > 0 ? packRate / conv : packRate);
          pkgUnitId = line.packaging_unit_id || null;
          brandSnapshot = line.brand_name?.trim() || null;
          packUnitSnapshot = line.pack_unit?.trim() || 'Pack';
          convFactorSnapshot = conv;

          // Save custom packaging unit if new
          if (line.is_custom_pack && brandSnapshot && packUnitSnapshot && conv > 0 && !pkgUnitId) {
            try {
              const pkgRes = await fetch('/api/inventory/packaging', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  inventory_item_id: line.item_id,
                  brand_name: brandSnapshot,
                  pack_unit_name: packUnitSnapshot,
                  pack_size_in_base_units: conv,
                  vendor_id: selectedVendorId || null,
                  is_default: false,
                }),
              });
              if (pkgRes.ok) {
                const pkgJson = await pkgRes.json();
                if (pkgJson.packaging?.id) pkgUnitId = pkgJson.packaging.id;
              }
            } catch (pErr) {
              console.warn('Could not persist packaging definition:', pErr);
            }
          }
        } else {
          baseQty = q;
          baseRate = baseQty > 0 ? lineTotal / baseQty : r;
        }

        // Insert Purchase Line
        const { error: lineErr } = await supabase.from('purchase_lines').insert({
          purchase_id: header.id,
          item_id: line.item_id,
          quantity: baseQty,
          rate: baseRate,
          total_amount: lineTotal,
          packaging_unit_id: pkgUnitId,
          brand_name_snapshot: brandSnapshot,
          pack_unit_snapshot: packUnitSnapshot,
          pack_quantity: packQty,
          pack_rate: packRate,
          conversion_factor_snapshot: convFactorSnapshot,
        });

        if (lineErr) throw lineErr;

        // Inward stock into Central Store Room using atomic RPC
        const { error: txErr } = await supabase.rpc('execute_inventory_transaction', {
          p_item_id: line.item_id,
          p_business_date: purchaseDate,
          p_movement_type: 'purchase',
          p_quantity: baseQty,
          p_unit_cost: baseRate,
          p_destination_location_id: centralStoreId,
          p_purpose: 'Vendor Inward Receipt',
          p_reference_id: header.id,
          p_reference_type: 'purchase_header',
          p_notes: `PO ${purchaseNumber} - ${selectedVendor?.vendor_name || 'Vendor'}`,
        });

        if (txErr) throw txErr;

        // Upsert vendor-item price memory
        try {
          await supabase.from('vendor_items').upsert(
            {
              vendor_id: selectedVendorId,
              inventory_item_id: line.item_id,
              last_purchase_rate: baseRate,
              last_purchase_date: purchaseDate,
              is_preferred: true,
            },
            { onConflict: 'vendor_id,inventory_item_id' }
          );
        } catch (memErr) {
          console.warn('Could not update vendor price memory:', memErr);
        }
      }

      onPurchaseSaved(purchaseNumber);
      // Clean reset after successful purchase
      setInvoiceNumber('');
      setLines([]);
      setSelectedVendorId('');
      setPurchaseDate(businessDate || getTodayBusinessDate());
      onClose();
    } catch (err: any) {
      console.error('Error posting purchase:', err);
      setErrorMessage(err.message || 'Failed to save purchase.');
    } finally {
      setSaving(false);
    }
  };

  const selectedVendor = vendors.find((v) => v.vendor_id === selectedVendorId);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4 backdrop-blur-xs">
      <div className="bg-white rounded-xl max-w-3xl w-full shadow-2xl border border-stone-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between bg-stone-50">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-amber-100 text-amber-800 rounded-lg">
              <ShoppingBag className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-stone-900">
                {isEdit
                  ? t('purchases.bills.editTitle', { number: invoiceToEdit?.purchase_number })
                  : t('purchases.bills.newPurchaseInvoice')}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-200/60 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmitPurchase} className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3.5 text-xs">
          {errorMessage && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 flex items-center gap-2 text-xs">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Top Row: Vendor, Purchase Date & Bill No. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-semibold text-stone-700">
                  {t('purchases.bills.vendor')} <span className="text-rose-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={onOpenQuickVendor}
                  className="text-[11px] text-amber-700 hover:text-amber-900 font-semibold hover:underline flex items-center gap-0.5"
                >
                  <Plus className="h-3 w-3" /> {t('purchases.bills.quickAddVendor')}
                </button>
              </div>
              <select
                value={selectedVendorId}
                onChange={(e) => setSelectedVendorId(e.target.value)}
                required
                className="w-full rounded-md border border-stone-300 p-2 text-stone-900 text-xs focus:outline-none focus:border-amber-500 bg-white"
              >
                <option value="">{t('purchases.bills.selectVendor')}</option>
                {vendors
                  .filter((v) => v.is_active !== false)
                  .map((v) => (
                    <option key={v.vendor_id} value={v.vendor_id}>
                      {v.vendor_name} {v.contact_person && v.contact_person !== v.vendor_name ? `(${v.contact_person})` : ''}
                    </option>
                  ))}
              </select>
            </div>

            <div className="grid grid-cols-2 sm:col-span-2 gap-2.5">
              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  {t('purchases.bills.purchaseDate')} <span className="text-rose-500">*</span>
                </label>
                <DatePicker
                  required
                  value={purchaseDate}
                  onChange={(val) => setPurchaseDate(val)}
                  clearable={false}
                  className="w-full"
                  triggerClassName="w-full rounded-md border border-stone-300 p-0.5 text-stone-900 text-xs bg-white"
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  {t('purchases.bills.invoiceNo')}
                </label>
                <input
                  type="text"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="e.g. 1042"
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 text-xs focus:outline-none focus:border-amber-500 bg-white"
                />
              </div>
            </div>
          </div>

          {/* Items Section Header */}
          <div className="border-t border-stone-200 pt-3">
            <div className="flex items-center justify-between mb-2">
              <label className="font-bold text-stone-900 text-sm">
                {t('purchases.bills.items')} ({lines.length})
              </label>
              <Button
                type="button"
                variant="amber"
                size="sm"
                onClick={() => {
                  setActiveLineIndex(lines.length);
                  setSearchQuery('');
                  setShowItemSearch(true);
                }}
                className="gap-1 text-xs shadow-xs"
              >
                <Plus className="h-3.5 w-3.5" /> {t('purchases.bills.addItem')}
              </Button>
            </div>

            {/* Empty state prompt */}
            {lines.length === 0 ? (
              <div
                onClick={() => {
                  setActiveLineIndex(0);
                  setSearchQuery('');
                  setShowItemSearch(true);
                }}
                className="border-2 border-dashed border-stone-200 rounded-lg p-6 text-center text-stone-500 cursor-pointer hover:border-amber-400 hover:bg-amber-50/20 transition-colors"
              >
                <Package className="h-8 w-8 mx-auto text-stone-300 mb-1" />
                <p className="font-medium text-xs text-stone-700">{t('purchases.bills.emptyItemsNotice')}</p>
              </div>
            ) : (
              <>
                {/* 1. Desktop 5-Column Table View (Screen >= 640px) */}
                <div className="hidden sm:block border border-stone-200 rounded-lg overflow-hidden bg-white">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-semibold">
                      <tr>
                        <th className="py-2.5 px-3">{t('purchases.bills.particulars')}</th>
                        <th className="py-2.5 px-3 w-28">{t('purchases.bills.qty')}</th>
                        <th className="py-2.5 px-3 w-32">{t('purchases.bills.unit')}</th>
                        <th className="py-2.5 px-3 w-28">{t('purchases.bills.rate')}</th>
                        <th className="py-2.5 px-3 w-32">{t('purchases.bills.lineTotal')}</th>
                        <th className="py-2.5 px-2 w-10 text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {lines.map((line, idx) => {
                        const q = Number(line.use_pack ? line.pack_quantity : line.quantity) || 0;
                        const r = Number(line.use_pack ? line.pack_rate : line.rate) || 0;
                        const conv = Number(line.conversion_factor) || 1;
                        const baseQty = line.use_pack ? q * conv : q;
                        const lineTotal = line.line_total !== undefined && line.line_total !== null && line.line_total !== ''
                          ? Number(line.line_total)
                          : q * r;
                        const baseRate = baseQty > 0 ? lineTotal / baseQty : (line.use_pack && conv > 0 ? r / conv : r);

                        return (
                          <tr key={idx} className="hover:bg-amber-50/20 transition-colors">
                            {/* Particulars (Item & Brand) with tappable brand chip */}
                            <td className="py-2 px-3 align-middle">
                              <div className="flex items-center gap-1.5 truncate">
                                <span className="font-bold text-stone-900 truncate">
                                  {line.group_name || line.item_name}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleOpenBrandSelector(idx)}
                                  className="px-2 py-0.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-800 text-[10px] font-semibold shrink-0 flex items-center gap-1 transition-colors cursor-pointer border border-amber-300"
                                  title={t('purchases.bills.selectBrand')}
                                >
                                  <span>{line.brand_name || 'Generic'}</span>
                                  <ChevronDown className="h-2.5 w-2.5 text-amber-700" />
                                </button>
                              </div>
                              {/* Subline helper */}
                              {((line.use_pack && q > 0) || line.previous_rate) && (
                                <div className="text-[10px] text-stone-500 pt-0.5 flex items-center gap-2">
                                  {line.use_pack && q > 0 && (
                                    <span className="font-mono text-amber-900">
                                      ↳ {q} {line.pack_unit} = <strong>{baseQty.toFixed(2)} {line.base_unit_symbol}</strong> @ {formatINR(baseRate)}/{line.base_unit_symbol}
                                    </span>
                                  )}
                                  {line.previous_rate && (
                                    <span className="text-stone-400">
                                      Last: {formatINR(line.previous_rate)}/{line.use_pack ? line.pack_unit : line.base_unit_symbol} {line.previous_date ? `(${line.previous_date})` : ''}
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>

                            {/* Quantity Input */}
                            <td className="py-2 px-3 align-middle">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={line.use_pack ? (line.pack_quantity ?? '') : (line.quantity ?? '')}
                                onChange={(e) => handleQuantityChange(idx, e.target.value)}
                                placeholder={t('purchases.bills.enterQty')}
                                className="w-full rounded border border-stone-300 p-1.5 text-stone-900 text-xs font-semibold focus:outline-none focus:border-amber-500 bg-white"
                              />
                            </td>

                            {/* Unit Selector Button */}
                            <td className="py-2 px-3 align-middle">
                              <button
                                type="button"
                                onClick={() => setUnitSelectLineIndex(idx)}
                                className="w-full px-2 py-1.5 rounded border border-amber-300 bg-amber-50/70 text-amber-900 text-xs font-semibold hover:bg-amber-100 flex items-center justify-between transition-colors"
                              >
                                <span className="truncate">{line.use_pack ? line.pack_unit : line.base_unit_symbol}</span>
                                <ChevronDown className="h-3 w-3 text-amber-700 shrink-0 ml-1" />
                              </button>
                            </td>

                            {/* Rate Input */}
                            <td className="py-2 px-3 align-middle">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={line.use_pack ? (line.pack_rate ?? '') : (line.rate ?? '')}
                                onChange={(e) => handleRateChange(idx, e.target.value)}
                                placeholder={t('purchases.bills.enterRate')}
                                className="w-full rounded border border-stone-300 p-1.5 text-stone-900 text-xs font-semibold focus:outline-none focus:border-amber-500 bg-white"
                              />
                            </td>

                            {/* Line Amount Input (Editable!) */}
                            <td className="py-2 px-3 align-middle">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={line.line_total ?? ''}
                                onChange={(e) => handleTotalChange(idx, e.target.value)}
                                placeholder="0.00"
                                className="w-full rounded border border-amber-300 bg-amber-50/30 p-1.5 text-stone-900 text-xs font-bold text-right focus:outline-none focus:border-amber-500"
                              />
                            </td>

                            {/* Delete Action */}
                            <td className="py-2 px-2 align-middle text-center">
                              <button
                                type="button"
                                onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                                className="text-stone-400 hover:text-rose-600 p-1 rounded transition-colors"
                                title={t('purchases.bills.delete')}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* 2. Mobile 2x2 Grid View (Screen < 640px) */}
                <div className="block sm:hidden divide-y divide-stone-200 border border-stone-200 rounded-lg bg-stone-50/40 overflow-hidden">
                  {lines.map((line, idx) => {
                    const q = Number(line.use_pack ? line.pack_quantity : line.quantity) || 0;
                    const r = Number(line.use_pack ? line.pack_rate : line.rate) || 0;
                    const conv = Number(line.conversion_factor) || 1;
                    const baseQty = line.use_pack ? q * conv : q;
                    const lineTotal = line.line_total !== undefined && line.line_total !== null && line.line_total !== ''
                      ? Number(line.line_total)
                      : q * r;
                    const baseRate = baseQty > 0 ? lineTotal / baseQty : (line.use_pack && conv > 0 ? r / conv : r);

                    return (
                      <div key={idx} className="p-3 space-y-2 bg-white">
                        {/* Row 1: Item Name + Brand chip + Delete button */}
                        <div className="flex items-center justify-between gap-1.5">
                          <div className="flex items-center gap-1.5 truncate flex-1 min-w-0">
                            <span className="font-bold text-stone-900 text-xs truncate">
                              {line.group_name || line.item_name}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleOpenBrandSelector(idx)}
                              className="px-2 py-0.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-800 text-[10px] font-semibold shrink-0 flex items-center gap-1 transition-colors cursor-pointer border border-amber-300"
                            >
                              <span>{line.brand_name || 'Generic'}</span>
                              <ChevronDown className="h-2.5 w-2.5 text-amber-700" />
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                            className="text-stone-400 hover:text-rose-600 p-1 rounded transition-colors shrink-0"
                            title={t('purchases.bills.delete')}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {/* Row 2: 2x2 grid (Qty + Unit; Rate + Total) */}
                        <div className="grid grid-cols-2 gap-2 pt-0.5">
                          <div>
                            <label className="text-[10px] font-semibold text-stone-500 mb-0.5 block">
                              {t('purchases.bills.qty')}
                            </label>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={line.use_pack ? (line.pack_quantity ?? '') : (line.quantity ?? '')}
                              onChange={(e) => handleQuantityChange(idx, e.target.value)}
                              placeholder="0"
                              className="w-full rounded border border-stone-300 p-1.5 text-stone-900 text-xs font-semibold focus:outline-none focus:border-amber-500 bg-white"
                            />
                          </div>

                          <div>
                            <label className="text-[10px] font-semibold text-stone-500 mb-0.5 block">
                              {t('purchases.bills.unit')}
                            </label>
                            <button
                              type="button"
                              onClick={() => setUnitSelectLineIndex(idx)}
                              className="w-full px-2 py-1.5 rounded border border-amber-300 bg-amber-50/70 text-amber-900 text-xs font-semibold hover:bg-amber-100 flex items-center justify-between transition-colors"
                            >
                              <span className="truncate">{line.use_pack ? line.pack_unit : line.base_unit_symbol}</span>
                              <ChevronDown className="h-3 w-3 text-amber-700 shrink-0 ml-1" />
                            </button>
                          </div>

                          <div>
                            <label className="text-[10px] font-semibold text-stone-500 mb-0.5 block">
                              {t('purchases.bills.rate')} (₹)
                            </label>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={line.use_pack ? (line.pack_rate ?? '') : (line.rate ?? '')}
                              onChange={(e) => handleRateChange(idx, e.target.value)}
                              placeholder="0.00"
                              className="w-full rounded border border-stone-300 p-1.5 text-stone-900 text-xs font-semibold focus:outline-none focus:border-amber-500 bg-white"
                            />
                          </div>

                          <div>
                            <label className="text-[10px] font-semibold text-stone-500 mb-0.5 block">
                              {t('purchases.bills.amount')} (₹)
                            </label>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={line.line_total ?? ''}
                              onChange={(e) => handleTotalChange(idx, e.target.value)}
                              placeholder="0.00"
                              className="w-full rounded border border-amber-300 bg-amber-50/30 p-1.5 text-stone-900 text-xs font-bold text-right focus:outline-none focus:border-amber-500"
                            />
                          </div>
                        </div>

                        {/* Row 3: Subline helper (hidden if qty <= 0 and no previous rate) */}
                        {((line.use_pack && q > 0) || line.previous_rate) && (
                          <div className="flex items-center justify-between text-[10px] text-stone-500 pt-1 border-t border-stone-100">
                            {line.use_pack && q > 0 ? (
                              <span className="font-mono text-amber-900 truncate">
                                ↳ {q} {line.pack_unit} = <strong>{baseQty.toFixed(2)} {line.base_unit_symbol}</strong> @ {formatINR(baseRate)}/{line.base_unit_symbol}
                              </span>
                            ) : <span />}
                            {line.previous_rate && (
                              <span className="text-stone-400 shrink-0 ml-2">
                                Last: {formatINR(line.previous_rate)}/{line.use_pack ? line.pack_unit : line.base_unit_symbol}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Mobile + Add Item button below the items list */}
                  <div className="p-2.5 bg-stone-50 border-t border-stone-200">
                    <Button
                      type="button"
                      variant="amber"
                      size="sm"
                      onClick={() => {
                        setActiveLineIndex(lines.length);
                        setSearchQuery('');
                        setShowItemSearch(true);
                      }}
                      className="w-full justify-center gap-1.5 text-xs font-bold py-2 shadow-xs"
                    >
                      <Plus className="h-3.5 w-3.5" /> {t('purchases.bills.addItem')}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Footer Area with Clearly Visible Total Bill & Save */}
          <div className="border-t border-stone-200 pt-3 flex items-center justify-between">
            <div>
              <span className="text-xs text-stone-500 block">{t('purchases.bills.invoiceTotal')}</span>
              <span className="text-lg sm:text-xl font-extrabold text-amber-700">
                {formatINR(invoiceTotal)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={saving}>
                {t('purchases.bills.cancel')}
              </Button>
              <Button type="submit" variant="amber" size="sm" disabled={saving || lines.length === 0} className="font-bold">
                {saving
                  ? (isEdit ? t('purchases.bills.updating') : t('purchases.bills.saving'))
                  : (isEdit ? t('purchases.bills.updatePurchase') : t('purchases.bills.postPurchase'))}
              </Button>
            </div>
          </div>
        </form>
      </div>

      {/* ======================================================== */}
      {/* 1. Item Search Submodal (Displays parent products once)  */}
      {/* ======================================================== */}
      {showItemSearch && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-3">
          <div className="bg-white rounded-xl max-w-md w-full shadow-2xl border border-stone-200 overflow-hidden flex flex-col max-h-[85vh]">
            <div className="p-3 border-b border-stone-200 flex items-center gap-2 bg-stone-50">
              <Search className="h-4 w-4 text-stone-400 shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('purchases.bills.searchItemPlaceholder')}
                className="w-full bg-transparent text-xs sm:text-sm text-stone-900 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowItemSearch(false)}
                className="text-stone-400 hover:text-stone-700 text-sm p-1"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-stone-100 p-1">
              {filteredParentGroups.length === 0 ? (
                <div className="p-4 text-center space-y-3">
                  <p className="text-xs text-stone-500">
                    No results for &ldquo;{searchQuery}&rdquo;
                  </p>
                  {/* + Add New Item Dynamic Button */}
                  <Button
                    type="button"
                    variant="amber"
                    size="sm"
                    onClick={() => {
                      setNewItemName(searchQuery.trim());
                      setNewItemCategoryId(categories[0]?.id || '');
                      setCategorySearchQuery('');
                      setNewItemUnitId(units.find((u) => u.symbol === 'kg')?.id || units[0]?.id || '');
                      setShowNewItemModal(true);
                      setShowItemSearch(false);
                    }}
                    className="w-full text-xs font-bold gap-1"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t('purchases.bills.addNewItemOption', { name: searchQuery.trim() })}
                  </Button>
                </div>
              ) : (
                filteredParentGroups.map((grp) => {
                  const variantCount = (grp.variants || []).length;
                  return (
                    <button
                      key={grp.id}
                      type="button"
                      onClick={() => handleSelectParentGroup(grp)}
                      className="w-full text-left p-2.5 hover:bg-amber-50/50 flex items-center justify-between rounded-lg transition-colors group"
                    >
                      <div>
                        <div className="font-semibold text-stone-900 text-xs sm:text-sm group-hover:text-amber-900">
                          {grp.name_hi && locale === 'hi' ? grp.name_hi : grp.name}
                        </div>
                        <div className="text-[10px] text-stone-400 mt-0.5">
                          {variantCount > 1
                            ? `${variantCount} brands available`
                            : (grp.variants?.[0]?.brand_name || 'Standard')}
                        </div>
                      </div>
                      <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                        {variantCount > 1 ? t('purchases.bills.selectBrand') : t('purchases.bills.select')}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 2. Brand Selector Bottom Sheet / Popup                   */}
      {/* ======================================================== */}
      {brandSelectGroup && (
        <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl max-w-sm w-full p-4 space-y-3 shadow-2xl border border-stone-200">
            <div className="flex items-center justify-between border-b pb-2">
              <div>
                <h3 className="text-sm font-bold text-stone-900">{t('purchases.bills.selectBrand')}</h3>
                <p className="text-[11px] text-stone-500">{brandSelectGroup.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setBrandSelectGroup(null)}
                className="text-stone-400 hover:text-stone-700"
              >
                ✕
              </button>
            </div>

            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {(brandSelectGroup.variants || []).map((v: any) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => applyVariantToLine(activeLineIndex, v, brandSelectGroup)}
                  className="w-full p-2.5 text-left text-xs font-semibold text-stone-800 bg-stone-50 hover:bg-amber-100/70 hover:text-amber-900 rounded-lg border border-stone-200 transition-colors flex items-center justify-between"
                >
                  <span>{v.brand_name || v.variant_name || 'Generic'}</span>
                  <span className="text-[10px] font-mono text-stone-400">{v.item_code}</span>
                </button>
              ))}

              {/* + Add New Brand Option */}
              <button
                type="button"
                onClick={() => {
                  setNewBrandName('');
                  setShowAddBrandModal(true);
                }}
                className="w-full p-2.5 text-left text-xs font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg border border-amber-200 flex items-center gap-1.5 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{t('purchases.bills.addNewBrand')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add New Brand Modal */}
      {showAddBrandModal && (
        <div className="fixed inset-0 z-80 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-xl max-w-xs w-full p-4 space-y-3 shadow-2xl border border-stone-200 text-xs">
            <h3 className="font-bold text-stone-900 text-sm">{t('purchases.bills.brandNamePrompt')}</h3>
            <form onSubmit={handleSaveNewBrand} className="space-y-3">
              <input
                type="text"
                autoFocus
                required
                value={newBrandName}
                onChange={(e) => setNewBrandName(e.target.value)}
                placeholder="e.g. Catch, Everest, Goldiee"
                className="w-full rounded border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowAddBrandModal(false)}
                >
                  {t('purchases.bills.cancel')}
                </Button>
                <Button type="submit" variant="amber" size="sm" disabled={brandSaving}>
                  {brandSaving ? t('purchases.bills.saving') : t('purchases.bills.saveBrand')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 3. Add New Item Submodal (Searchable Category Dropdown)   */}
      {/* ======================================================== */}
      {showNewItemModal && (
        <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl max-w-sm w-full p-4 space-y-3 shadow-2xl border border-stone-200 text-xs">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="font-bold text-stone-900 text-sm">{t('purchases.bills.newItemTitle')}</h3>
              <button
                type="button"
                onClick={() => setShowNewItemModal(false)}
                className="text-stone-400 hover:text-stone-700"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveNewItem} className="space-y-3">
              {/* Field 1: Item Name */}
              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  {t('purchases.bills.itemName')} <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  className="w-full rounded border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                />
              </div>

              {/* Field 2: Searchable Category Dropdown */}
              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  {t('purchases.bills.category')} <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <div
                    onClick={() => setIsCategoryPickerOpen(!isCategoryPickerOpen)}
                    className="w-full rounded border border-stone-300 p-2 text-stone-900 flex items-center justify-between cursor-pointer bg-white"
                  >
                    <span className="truncate">
                      {categories.find((c) => c.id === newItemCategoryId)
                        ? getLocalizedMasterName(categories.find((c) => c.id === newItemCategoryId), locale) || categories.find((c) => c.id === newItemCategoryId)?.name
                        : t('purchases.bills.selectCategory')}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 text-stone-500 shrink-0" />
                  </div>

                  {isCategoryPickerOpen && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-stone-200 rounded-lg shadow-xl z-80 p-2 space-y-1.5 max-h-52 flex flex-col">
                      <div className="flex items-center gap-1 border-b pb-1.5 px-1">
                        <Search className="h-3.5 w-3.5 text-stone-400 shrink-0" />
                        <input
                          type="text"
                          value={categorySearchQuery}
                          onChange={(e) => setCategorySearchQuery(e.target.value)}
                          placeholder="Search categories..."
                          className="w-full text-xs text-stone-900 focus:outline-none"
                          autoFocus
                        />
                      </div>
                      <div className="overflow-y-auto space-y-0.5 flex-1">
                        {filteredCategories.length === 0 ? (
                          <p className="text-[11px] text-stone-400 p-2 text-center">No categories found</p>
                        ) : (
                          filteredCategories.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => {
                                setNewItemCategoryId(c.id);
                                setIsCategoryPickerOpen(false);
                                setCategorySearchQuery('');
                              }}
                              className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center justify-between ${
                                newItemCategoryId === c.id ? 'bg-amber-100 text-amber-900 font-bold' : 'hover:bg-stone-50 text-stone-800'
                              }`}
                            >
                              <span>{getLocalizedMasterName(c, locale) || c.name}</span>
                              {newItemCategoryId === c.id && <Check className="h-3 w-3 text-amber-700" />}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Field 3: Unit */}
              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  {t('purchases.bills.unit')} <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={newItemUnitId}
                  onChange={(e) => setNewItemUnitId(e.target.value)}
                  className="w-full rounded border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500 bg-white"
                >
                  <option value="">{t('purchases.bills.selectUnit')}</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {getLocalizedMasterSymbol(u, locale) || u.symbol} ({getLocalizedMasterName(u, locale) || u.name})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowNewItemModal(false)}
                >
                  {t('purchases.bills.cancel')}
                </Button>
                <Button type="submit" variant="amber" size="sm" disabled={newItemSaving}>
                  {newItemSaving ? t('purchases.bills.saving') : t('purchases.bills.saveItem')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 4. Unit & Packaging Selection Submodal                   */}
      {/* ======================================================== */}
      {unitSelectLineIndex !== null && (
        <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl max-w-sm w-full p-4 space-y-3 shadow-2xl border border-stone-200 text-xs">
            <div className="flex items-center justify-between border-b pb-2">
              <div>
                <h3 className="font-bold text-stone-900 text-sm">{t('purchases.bills.selectPurchaseUnit')}</h3>
                <p className="text-[11px] text-stone-500">{lines[unitSelectLineIndex]?.item_name}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setUnitSelectLineIndex(null);
                  setSizePromptPackType(null);
                }}
                className="text-stone-400 hover:text-stone-700"
              >
                ✕
              </button>
            </div>

            {/* If a packaging type was selected that needs a size prompt */}
            {sizePromptPackType ? (
              <div className="space-y-3">
                <p className="font-semibold text-stone-800 text-xs">
                  {sizePromptPackType === 'Box'
                    ? t('purchases.bills.boxSizePrompt')
                    : sizePromptPackType === 'Bottle'
                    ? t('purchases.bills.bottleCapacityPrompt')
                    : sizePromptPackType === 'Packet'
                    ? t('purchases.bills.packSizePrompt')
                    : t('purchases.bills.unitSizePrompt', { unit: sizePromptPackType })}
                </p>

                {/* Preset Options strictly classified by canonical dimension */}
                <div className="grid grid-cols-2 gap-2">
                  {getUnitDimension(lines[unitSelectLineIndex]?.base_unit_canonical) === 'mass' ? (
                    lines[unitSelectLineIndex]?.base_unit_canonical === 'g' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleApplySize('50 g', 50)}
                          className="p-2 border rounded-lg bg-stone-50 hover:bg-amber-100 font-semibold text-stone-800 text-center"
                        >
                          50 g
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplySize('100 g', 100)}
                          className="p-2 border rounded-lg bg-stone-50 hover:bg-amber-100 font-semibold text-stone-800 text-center"
                        >
                          100 g
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplySize('200 g', 200)}
                          className="p-2 border rounded-lg bg-stone-50 hover:bg-amber-100 font-semibold text-stone-800 text-center"
                        >
                          200 g
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplySize('500 g', 500)}
                          className="p-2 border rounded-lg bg-stone-50 hover:bg-amber-100 font-semibold text-stone-800 text-center"
                        >
                          500 g
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplySize('1 kg', 1000)}
                          className="p-2 border rounded-lg bg-stone-50 hover:bg-amber-100 font-semibold text-stone-800 text-center"
                        >
                          1 kg
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplySize('5 kg', 5000)}
                          className="p-2 border rounded-lg bg-stone-50 hover:bg-amber-100 font-semibold text-stone-800 text-center"
                        >
                          5 kg
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleApplySize('50 g', 0.05)}
                          className="p-2 border rounded-lg bg-stone-50 hover:bg-amber-100 font-semibold text-stone-800 text-center"
                        >
                          50 g
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplySize('100 g', 0.1)}
                          className="p-2 border rounded-lg bg-stone-50 hover:bg-amber-100 font-semibold text-stone-800 text-center"
                        >
                          100 g
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplySize('200 g', 0.2)}
                          className="p-2 border rounded-lg bg-stone-50 hover:bg-amber-100 font-semibold text-stone-800 text-center"
                        >
                          200 g
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplySize('500 g', 0.5)}
                          className="p-2 border rounded-lg bg-stone-50 hover:bg-amber-100 font-semibold text-stone-800 text-center"
                        >
                          500 g
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplySize('1 kg', 1)}
                          className="p-2 border rounded-lg bg-stone-50 hover:bg-amber-100 font-semibold text-stone-800 text-center"
                        >
                          1 kg
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplySize('5 kg', 5)}
                          className="p-2 border rounded-lg bg-stone-50 hover:bg-amber-100 font-semibold text-stone-800 text-center"
                        >
                          5 kg
                        </button>
                      </>
                    )
                  ) : getUnitDimension(lines[unitSelectLineIndex]?.base_unit_canonical) === 'volume' ? (
                    lines[unitSelectLineIndex]?.base_unit_canonical === 'ml' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleApplySize('200 ml', 200)}
                          className="p-2 border rounded-lg bg-stone-50 hover:bg-amber-100 font-semibold text-stone-800 text-center"
                        >
                          200 ml
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplySize('400 ml', 400)}
                          className="p-2 border rounded-lg bg-stone-50 hover:bg-amber-100 font-semibold text-stone-800 text-center"
                        >
                          400 ml
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplySize('500 ml', 500)}
                          className="p-2 border rounded-lg bg-stone-50 hover:bg-amber-100 font-semibold text-stone-800 text-center"
                        >
                          500 ml
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplySize('600 ml', 600)}
                          className="p-2 border rounded-lg bg-stone-50 hover:bg-amber-100 font-semibold text-stone-800 text-center"
                        >
                          600 ml
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplySize('750 ml', 750)}
                          className="p-2 border rounded-lg bg-stone-50 hover:bg-amber-100 font-semibold text-stone-800 text-center"
                        >
                          750 ml
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplySize('1 L', 1000)}
                          className="p-2 border rounded-lg bg-stone-50 hover:bg-amber-100 font-semibold text-stone-800 text-center"
                        >
                          1 L
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleApplySize('200 ml', 0.2)}
                          className="p-2 border rounded-lg bg-stone-50 hover:bg-amber-100 font-semibold text-stone-800 text-center"
                        >
                          200 ml
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplySize('400 ml', 0.4)}
                          className="p-2 border rounded-lg bg-stone-50 hover:bg-amber-100 font-semibold text-stone-800 text-center"
                        >
                          400 ml
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplySize('500 ml', 0.5)}
                          className="p-2 border rounded-lg bg-stone-50 hover:bg-amber-100 font-semibold text-stone-800 text-center"
                        >
                          500 ml
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplySize('600 ml', 0.6)}
                          className="p-2 border rounded-lg bg-stone-50 hover:bg-amber-100 font-semibold text-stone-800 text-center"
                        >
                          600 ml
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplySize('750 ml', 0.75)}
                          className="p-2 border rounded-lg bg-stone-50 hover:bg-amber-100 font-semibold text-stone-800 text-center"
                        >
                          750 ml
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplySize('1 L', 1)}
                          className="p-2 border rounded-lg bg-stone-50 hover:bg-amber-100 font-semibold text-stone-800 text-center"
                        >
                          1 L
                        </button>
                      </>
                    )
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => handleApplySize('10 pcs', 10)}
                        className="p-2 border rounded-lg bg-stone-50 hover:bg-amber-100 font-semibold text-stone-800 text-center"
                      >
                        10 pcs
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApplySize('25 pcs', 25)}
                        className="p-2 border rounded-lg bg-stone-50 hover:bg-amber-100 font-semibold text-stone-800 text-center"
                      >
                        25 pcs
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApplySize('50 pcs', 50)}
                        className="p-2 border rounded-lg bg-stone-50 hover:bg-amber-100 font-semibold text-stone-800 text-center"
                      >
                        50 pcs
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApplySize('100 pcs', 100)}
                        className="p-2 border rounded-lg bg-stone-50 hover:bg-amber-100 font-semibold text-stone-800 text-center"
                      >
                        100 pcs
                      </button>
                    </>
                  )}
                </div>

                {/* Custom Size Form */}
                <div className="pt-2 border-t space-y-1.5">
                  <label className="font-semibold text-stone-700">
                    {t('purchases.bills.customSize')}
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      step="any"
                      value={customSizeValue}
                      onChange={(e) => setCustomSizeValue(e.target.value)}
                      placeholder="e.g. 250"
                      className="flex-1 rounded border border-stone-300 p-1.5 text-xs text-stone-900 focus:outline-none"
                    />
                    <select
                      value={customSizeUnit}
                      onChange={(e) => setCustomSizeUnit(e.target.value)}
                      className="rounded border border-stone-300 p-1.5 text-xs text-stone-900 bg-white"
                    >
                      {getUnitDimension(lines[unitSelectLineIndex]?.base_unit_canonical) === 'mass' ? (
                        <>
                          <option value="g">g</option>
                          <option value="kg">kg</option>
                        </>
                      ) : getUnitDimension(lines[unitSelectLineIndex]?.base_unit_canonical) === 'volume' ? (
                        <>
                          <option value="ml">ml</option>
                          <option value="L">L</option>
                        </>
                      ) : (
                        <option value="pcs">pcs</option>
                      )}
                    </select>
                    <Button
                      type="button"
                      variant="amber"
                      size="sm"
                      onClick={() => {
                        const num = parseFloat(customSizeValue);
                        if (!num || num <= 0) return;
                        const canonical = (lines[unitSelectLineIndex]?.base_unit_canonical || 'kg').toLowerCase();
                        const dim = getUnitDimension(canonical);
                        let conv = num;
                        if (dim === 'mass') {
                          if (customSizeUnit === 'g') {
                            conv = canonical === 'kg' ? num / 1000 : num;
                          } else if (customSizeUnit === 'kg') {
                            conv = canonical === 'kg' ? num : num * 1000;
                          } else {
                            alert('Cannot apply volume/count unit to mass item!');
                            return;
                          }
                        } else if (dim === 'volume') {
                          if (customSizeUnit === 'ml') {
                            conv = canonical === 'l' ? num / 1000 : num;
                          } else if (customSizeUnit === 'L' || customSizeUnit === 'l') {
                            conv = canonical === 'l' ? num : num * 1000;
                          } else {
                            alert('Cannot apply mass/count unit to volume item!');
                            return;
                          }
                        }
                        handleApplySize(`${num} ${customSizeUnit}`, conv);
                      }}
                    >
                      Set
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {/* 1. Base Unit Option (when base unit is not the primary large unit) */}
                {(() => {
                  const line = lines[unitSelectLineIndex];
                  const dim = getUnitDimension(line?.base_unit_canonical);
                  const isPrimaryLarge = (dim === 'mass' && line?.base_unit_canonical === 'kg') ||
                                         (dim === 'volume' && line?.base_unit_canonical === 'l');
                  if (isPrimaryLarge) return null;
                  return (
                    <button
                      type="button"
                      onClick={() => handleSelectUnitOption(unitSelectLineIndex, 'base')}
                      className="w-full p-2.5 rounded-lg border border-stone-200 bg-stone-50 hover:bg-amber-50 text-left font-semibold text-stone-800 flex items-center justify-between"
                    >
                      <span>{line?.base_unit_symbol} ({t('purchases.bills.base')})</span>
                      {!line?.use_pack && <Check className="h-4 w-4 text-emerald-600" />}
                    </button>
                  );
                })()}

                {/* 2. Primary Large Unit Option: kg for mass, L for volume */}
                {(() => {
                  const line = lines[unitSelectLineIndex];
                  const dim = getUnitDimension(line?.base_unit_canonical);
                  if (dim === 'mass') {
                    return (
                      <button
                        type="button"
                        onClick={() => handleSelectUnitOption(unitSelectLineIndex, 'kg')}
                        className="w-full p-2.5 rounded-lg border border-stone-200 bg-stone-50 hover:bg-amber-50 text-left font-semibold text-stone-800 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-stone-900">kg (Kilogram)</span>
                          {line?.base_unit_canonical === 'g' && (
                            <span className="text-[11px] text-stone-500 font-normal">
                              (1 kg = 1,000 {line?.base_unit_symbol})
                            </span>
                          )}
                          {line?.base_unit_canonical === 'kg' && (
                            <span className="text-[11px] text-stone-500 font-normal">
                              ({t('purchases.bills.base')})
                            </span>
                          )}
                        </div>
                        {((line?.use_pack && line?.pack_unit === 'kg') ||
                          (!line?.use_pack && line?.base_unit_canonical === 'kg')) && (
                          <Check className="h-4 w-4 text-emerald-600" />
                        )}
                      </button>
                    );
                  }
                  if (dim === 'volume') {
                    return (
                      <button
                        type="button"
                        onClick={() => handleSelectUnitOption(unitSelectLineIndex, 'kg')}
                        className="w-full p-2.5 rounded-lg border border-stone-200 bg-stone-50 hover:bg-amber-50 text-left font-semibold text-stone-800 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-stone-900">L (Liter)</span>
                          {line?.base_unit_canonical === 'ml' && (
                            <span className="text-[11px] text-stone-500 font-normal">
                              (1 L = 1,000 {line?.base_unit_symbol})
                            </span>
                          )}
                          {line?.base_unit_canonical === 'l' && (
                            <span className="text-[11px] text-stone-500 font-normal">
                              ({t('purchases.bills.base')})
                            </span>
                          )}
                        </div>
                        {((line?.use_pack && (line?.pack_unit === 'L' || line?.pack_unit === 'l')) ||
                          (!line?.use_pack && line?.base_unit_canonical === 'l')) && (
                          <Check className="h-4 w-4 text-emerald-600" />
                        )}
                      </button>
                    );
                  }
                  return null;
                })()}

                {/* 3. Known Packaged Units for this Item */}
                {packagingUnits
                  .filter(
                    (p) =>
                      (p.inventory_item_id || p.item_id) === lines[unitSelectLineIndex]?.item_id &&
                      p.pack_unit_name?.trim().toLowerCase() !== 'kg'
                  )
                  .map((pkg) => (
                    <button
                      key={pkg.id}
                      type="button"
                      onClick={() => handleSelectUnitOption(unitSelectLineIndex, 'existing_pkg', pkg)}
                      className="w-full p-2.5 rounded-lg border border-stone-200 bg-stone-50 hover:bg-amber-50 text-left font-semibold text-stone-800 flex items-center justify-between"
                    >
                      <span>
                        📦 {pkg.pack_unit_name || `${pkg.pack_size_in_base_units} ${lines[unitSelectLineIndex]?.base_unit_symbol}`}
                      </span>
                      {lines[unitSelectLineIndex]?.packaging_unit_id === pkg.id && (
                        <Check className="h-4 w-4 text-emerald-600" />
                      )}
                    </button>
                  ))}

                {/* 3. Relevant Generic Packaging Types */}
                <div className="pt-2 border-t space-y-1.5">
                  <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider block">
                    {t('purchases.bills.customPackaging')}
                  </span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {getUnitDimension(lines[unitSelectLineIndex]?.base_unit_canonical) === 'mass' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleSelectUnitOption(unitSelectLineIndex, 'prompt_size', { type: 'Box' })}
                          className="p-2 border rounded bg-stone-50 hover:bg-amber-100 font-bold text-center text-stone-800"
                        >
                          {locale === 'hi' ? 'बॉक्स' : 'Box'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSelectUnitOption(unitSelectLineIndex, 'prompt_size', { type: 'Packet' })}
                          className="p-2 border rounded bg-stone-50 hover:bg-amber-100 font-bold text-center text-stone-800"
                        >
                          {locale === 'hi' ? 'पैकेट' : 'Packet'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSelectUnitOption(unitSelectLineIndex, 'prompt_size', { type: 'Bag' })}
                          className="p-2 border rounded bg-stone-50 hover:bg-amber-100 font-bold text-center text-stone-800"
                        >
                          {locale === 'hi' ? 'बोरी / बैग' : 'Bag'}
                        </button>
                      </>
                    ) : getUnitDimension(lines[unitSelectLineIndex]?.base_unit_canonical) === 'volume' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleSelectUnitOption(unitSelectLineIndex, 'prompt_size', { type: 'Bottle' })}
                          className="p-2 border rounded bg-stone-50 hover:bg-amber-100 font-bold text-center text-stone-800"
                        >
                          {locale === 'hi' ? 'बोतल' : 'Bottle'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSelectUnitOption(unitSelectLineIndex, 'prompt_size', { type: 'Can' })}
                          className="p-2 border rounded bg-stone-50 hover:bg-amber-100 font-bold text-center text-stone-800"
                        >
                          {locale === 'hi' ? 'कैन' : 'Can'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSelectUnitOption(unitSelectLineIndex, 'prompt_size', { type: 'Box' })}
                          className="p-2 border rounded bg-stone-50 hover:bg-amber-100 font-bold text-center text-stone-800"
                        >
                          {locale === 'hi' ? 'केस' : 'Box / Case'}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleSelectUnitOption(unitSelectLineIndex, 'prompt_size', { type: 'Box' })}
                          className="p-2 border rounded bg-stone-50 hover:bg-amber-100 font-bold text-center text-stone-800"
                        >
                          {locale === 'hi' ? 'बॉक्स' : 'Box'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSelectUnitOption(unitSelectLineIndex, 'prompt_size', { type: 'Packet' })}
                          className="p-2 border rounded bg-stone-50 hover:bg-amber-100 font-bold text-center text-stone-800"
                        >
                          {locale === 'hi' ? 'पैकेट' : 'Packet'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSelectUnitOption(unitSelectLineIndex, 'prompt_size', { type: 'Case' })}
                          className="p-2 border rounded bg-stone-50 hover:bg-amber-100 font-bold text-center text-stone-800"
                        >
                          {locale === 'hi' ? 'केस' : 'Case'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}