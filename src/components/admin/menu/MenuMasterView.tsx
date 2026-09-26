'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { formatINR } from '@/lib/utils';
import {
  Layers,
  UtensilsCrossed,
  FolderTree,
  Tag,
  Plus,
  RefreshCw,
  Search,
  Filter,
  ChevronRight,
  ChevronDown,
  Edit2,
  Trash2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  Building,
} from 'lucide-react';
import { ParentCategoryModal } from './ParentCategoryModal';
import { CategoryModal } from './CategoryModal';
import { MenuItemModal } from './MenuItemModal';
import { ReclassifySalesModal } from './ReclassifySalesModal';
import { getCategoryColor, getCategoryBadgeClasses } from '@/lib/constants/category-colors';

export function MenuMasterView() {
  const [viewTab, setViewTab] = useState<'tree' | 'items' | 'categories' | 'parents' | 'aliases'>('tree');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Raw data from hierarchy endpoint
  const [hierarchy, setHierarchy] = useState<any[]>([]);
  const [stats, setStats] = useState({
    totalParents: 0,
    totalCategories: 0,
    totalItems: 0,
    activeItems: 0,
    totalAliases: 0,
  });

  // Flat lists for tables and selects
  const [parentsList, setParentsList] = useState<any[]>([]);
  const [categoriesList, setCategoriesList] = useState<any[]>([]);
  const [itemsList, setItemsList] = useState<any[]>([]);
  const [aliasesList, setAliasesList] = useState<any[]>([]);

  // Filtering states for items tab
  const [searchTerm, setSearchTerm] = useState('');
  const [filterParent, setFilterParent] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterActive, setFilterActive] = useState<string>('all');

  // Collapsed state for hierarchy tree
  const [collapsedParents, setCollapsedParents] = useState<Record<string, boolean>>({});
  const [collapsedCats, setCollapsedCats] = useState<Record<string, boolean>>({});

  // Modals state
  const [parentModalOpen, setParentModalOpen] = useState(false);
  const [editingParent, setEditingParent] = useState<any | null>(null);

  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<any | null>(null);

  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any | null>(null);

  const [reclassifyModalOpen, setReclassifyModalOpen] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [hRes, aRes] = await Promise.all([
        fetch('/api/admin/menu/hierarchy'),
        fetch('/api/admin/menu/aliases'),
      ]);

      const hJson = await hRes.json();
      const aJson = await aRes.json();

      if (!hRes.ok) throw new Error(hJson.error || 'Failed to fetch hierarchy');

      setHierarchy(hJson.hierarchy || []);
      setStats(hJson.stats || {});
      setAliasesList(aJson.aliases || []);

      // Flatten parents, categories, items
      const pList: any[] = [];
      const cList: any[] = [];
      const iList: any[] = [];

      (hJson.hierarchy || []).forEach((p: any) => {
        pList.push({
          id: p.id,
          name: p.name,
          color: p.color,
          display_order: p.display_order,
          is_active: p.is_active,
          categoryCount: p.categoryCount,
          itemCount: p.itemCount,
        });

        (p.categories || []).forEach((c: any) => {
          cList.push({
            id: c.id,
            name: c.name,
            parent_category_id: p.id,
            parent_category_name: p.name,
            display_order: c.display_order,
            is_active: c.is_active,
            itemCount: c.itemCount,
          });

          (c.items || []).forEach((it: any) => {
            iList.push({
              ...it,
              category_name: c.name,
              parent_category_name: p.name,
            });
          });
        });
      });

      setParentsList(pList);
      setCategoriesList(cList);
      setItemsList(iList);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const toggleParentCollapse = (id: string) => {
    setCollapsedParents((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleCatCollapse = (id: string) => {
    setCollapsedCats((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Filtered items
  const filteredItems = useMemo(() => {
    return itemsList.filter((item) => {
      const matchSearch =
        !searchTerm ||
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (item.aliases && item.aliases.some((a: string) => a.toLowerCase().includes(searchTerm.toLowerCase())));

      const matchParent = !filterParent || item.parent_category === filterParent;
      const matchCat = !filterCategory || item.category === filterCategory;
      const matchActive =
        filterActive === 'all'
          ? true
          : filterActive === 'active'
          ? item.is_active
          : !item.is_active;

      return matchSearch && matchParent && matchCat && matchActive;
    });
  }, [itemsList, searchTerm, filterParent, filterCategory, filterActive]);

  return (
    <div className="space-y-4">
      {/* Top Banner & Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white border border-stone-200 rounded-xl p-3.5 shadow-2xs">
          <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider block">
            Parent Categories
          </span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-xl font-extrabold text-stone-900">{stats.totalParents}</span>
            <span className="text-[11px] text-stone-400 font-medium">groups</span>
          </div>
        </div>

        <div className="bg-white border border-stone-200 rounded-xl p-3.5 shadow-2xs">
          <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider block">
            Categories
          </span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-xl font-extrabold text-stone-900">{stats.totalCategories}</span>
            <span className="text-[11px] text-stone-400 font-medium">subcategories</span>
          </div>
        </div>

        <div className="bg-white border border-stone-200 rounded-xl p-3.5 shadow-2xs">
          <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider block">
            Canonical Menu Items
          </span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-xl font-extrabold text-amber-600">{stats.totalItems}</span>
            <span className="text-[11px] text-stone-400 font-medium">items</span>
          </div>
        </div>

        <div className="bg-white border border-stone-200 rounded-xl p-3.5 shadow-2xs">
          <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider block">
            Tax Rule Status
          </span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-sm font-bold text-emerald-700">5.0% Forward</span>
            <span className="text-[10px] text-emerald-600">✓ Compliant</span>
          </div>
        </div>

        <div className="bg-white border border-stone-200 rounded-xl p-3.5 shadow-2xs">
          <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider block">
            POS Aliases Mapped
          </span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-xl font-extrabold text-stone-900">{stats.totalAliases}</span>
            <span className="text-[11px] text-stone-400 font-medium">aliases</span>
          </div>
        </div>
      </div>

      {/* Main Control Card */}
      <Card className="border-stone-200 shadow-xs overflow-hidden">
        {/* Header & Global Actions */}
        <div className="p-4 border-b border-stone-200 bg-stone-50/50 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 className="font-bold text-stone-900 text-base flex items-center gap-2">
              <UtensilsCrossed className="h-5 w-5 text-amber-600" />
              <span>Menu Master Architecture</span>
            </h2>
            <p className="text-xs text-stone-500 mt-0.5">
              Authoritative database configuration for Parent Category → Category → Menu Item hierarchy
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReclassifyModalOpen(true)}
              className="text-stone-700 border-stone-300 hover:bg-stone-100 flex items-center gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5 text-amber-600" />
              <span>Reclassify Sales</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditingParent(null);
                setParentModalOpen(true);
              }}
              className="flex items-center gap-1 text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Parent Category</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditingCategory(null);
                setCategoryModalOpen(true);
              }}
              className="flex items-center gap-1 text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Category</span>
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setEditingItem(null);
                setItemModalOpen(true);
              }}
              className="flex items-center gap-1 text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New Menu Item</span>
            </Button>
          </div>
        </div>

        {/* View Tabs */}
        <div className="flex border-b border-stone-200 bg-white px-4">
          <button
            onClick={() => setViewTab('tree')}
            className={`py-2.5 px-3 text-xs font-bold border-b-2 flex items-center gap-1.5 cursor-pointer transition ${
              viewTab === 'tree'
                ? 'border-amber-600 text-amber-700 bg-amber-50/30'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <FolderTree className="h-4 w-4" />
            <span>Hierarchy Tree View</span>
          </button>
          <button
            onClick={() => setViewTab('items')}
            className={`py-2.5 px-3 text-xs font-bold border-b-2 flex items-center gap-1.5 cursor-pointer transition ${
              viewTab === 'items'
                ? 'border-amber-600 text-amber-700 bg-amber-50/30'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <UtensilsCrossed className="h-4 w-4" />
            <span>Items Master ({stats.totalItems})</span>
          </button>
          <button
            onClick={() => setViewTab('categories')}
            className={`py-2.5 px-3 text-xs font-bold border-b-2 flex items-center gap-1.5 cursor-pointer transition ${
              viewTab === 'categories'
                ? 'border-amber-600 text-amber-700 bg-amber-50/30'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <Layers className="h-4 w-4" />
            <span>Categories ({stats.totalCategories})</span>
          </button>
          <button
            onClick={() => setViewTab('parents')}
            className={`py-2.5 px-3 text-xs font-bold border-b-2 flex items-center gap-1.5 cursor-pointer transition ${
              viewTab === 'parents'
                ? 'border-amber-600 text-amber-700 bg-amber-50/30'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <Building className="h-4 w-4" />
            <span>Parent Categories ({stats.totalParents})</span>
          </button>
          <button
            onClick={() => setViewTab('aliases')}
            className={`py-2.5 px-3 text-xs font-bold border-b-2 flex items-center gap-1.5 cursor-pointer transition ${
              viewTab === 'aliases'
                ? 'border-amber-600 text-amber-700 bg-amber-50/30'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <Tag className="h-4 w-4" />
            <span>POS Aliases ({stats.totalAliases})</span>
          </button>
        </div>

        {/* Content Area */}
        <CardContent className="p-4">
          {loading ? (
            <div className="py-20 text-center text-xs text-stone-400">Loading Menu Master data...</div>
          ) : error ? (
            <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-medium">
              {error}
            </div>
          ) : (
            <>
              {/* TAB 1: HIERARCHY TREE VIEW */}
              {viewTab === 'tree' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-stone-500 pb-1">
                    <span>Click on any parent or category to expand / collapse</span>
                    <span>{stats.totalParents} Parents • {stats.totalCategories} Categories • {stats.totalItems} Items</span>
                  </div>

                  <div className="space-y-3">
                    {hierarchy.map((parent) => {
                      const isParentCollapsed = !!collapsedParents[parent.id];
                      return (
                        <div
                          key={parent.id}
                          className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-2xs"
                        >
                          {/* Parent Header */}
                          <div className="px-4 py-3 bg-stone-50/70 border-b border-stone-150 flex items-center justify-between">
                            <div
                              onClick={() => toggleParentCollapse(parent.id)}
                              className="flex items-center gap-2.5 cursor-pointer select-none"
                            >
                              <button type="button" className="text-stone-400 hover:text-stone-700">
                                {isParentCollapsed ? (
                                  <ChevronRight className="h-4 w-4" />
                                ) : (
                                  <ChevronDown className="h-4 w-4" />
                                )}
                              </button>
                              <span
                                className="w-3 h-3 rounded-full shrink-0 border border-black/10 shadow-2xs"
                                style={{ backgroundColor: parent.color || getCategoryColor(parent.name) }}
                              />
                              <span className="font-bold text-stone-900 text-sm">{parent.name}</span>
                              <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                                {parent.categoryCount} Categories
                              </span>
                              <span className="text-[11px] text-stone-500 font-medium">
                                ({parent.itemCount} items)
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  setEditingParent(parent);
                                  setParentModalOpen(true);
                                }}
                                className="text-stone-400 hover:text-stone-700 p-1"
                                title="Edit Parent Category"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* Categories List */}
                          {!isParentCollapsed && (
                            <div className="p-3 space-y-2.5 bg-stone-50/20">
                              {parent.categories.length === 0 ? (
                                <div className="text-xs text-stone-400 italic py-2 pl-6">
                                  No subcategories in this parent category yet.
                                </div>
                              ) : (
                                parent.categories.map((cat: any) => {
                                  const isCatCollapsed = !!collapsedCats[cat.id];
                                  return (
                                    <div
                                      key={cat.id}
                                      className="border border-stone-200/80 rounded-lg bg-white overflow-hidden"
                                    >
                                      {/* Category Header */}
                                      <div className="px-3 py-2 bg-stone-50/40 border-b border-stone-100 flex items-center justify-between">
                                        <div
                                          onClick={() => toggleCatCollapse(cat.id)}
                                          className="flex items-center gap-2 cursor-pointer select-none"
                                        >
                                          <button type="button" className="text-stone-400 hover:text-stone-600">
                                            {isCatCollapsed ? (
                                              <ChevronRight className="h-3.5 w-3.5" />
                                            ) : (
                                              <ChevronDown className="h-3.5 w-3.5" />
                                            )}
                                          </button>
                                          <span className="font-semibold text-xs text-stone-800">
                                            {cat.name}
                                          </span>
                                          <span className="text-[10px] text-stone-500 bg-stone-100 px-2 py-0.5 rounded-full font-medium">
                                            {cat.itemCount} items
                                          </span>
                                        </div>

                                        <div className="flex items-center gap-2">
                                          <button
                                            onClick={() => {
                                              setEditingCategory(cat);
                                              setCategoryModalOpen(true);
                                            }}
                                            className="text-stone-400 hover:text-stone-700 p-1"
                                            title="Edit Category"
                                          >
                                            <Edit2 className="h-3 w-3" />
                                          </button>
                                        </div>
                                      </div>

                                      {/* Items Tags Grid */}
                                      {!isCatCollapsed && (
                                        <div className="p-3">
                                          {cat.items.length === 0 ? (
                                            <div className="text-[11px] text-stone-400 italic">
                                              No items in this category.
                                            </div>
                                          ) : (
                                            <div className="flex flex-wrap gap-2">
                                              {cat.items.map((it: any) => (
                                                <div
                                                  key={it.id}
                                                  onClick={() => {
                                                    setEditingItem(it);
                                                    setItemModalOpen(true);
                                                  }}
                                                  className="group inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-stone-200 bg-white hover:border-amber-400 hover:bg-amber-50/30 text-xs cursor-pointer transition shadow-2xs"
                                                >
                                                  <span className="font-medium text-stone-800 group-hover:text-amber-900">
                                                    {it.name}
                                                  </span>
                                                  <span className="font-mono text-[11px] font-bold text-stone-600 bg-stone-100 px-1.5 py-0.5 rounded">
                                                    {formatINR(it.price)}
                                                  </span>
                                                  {it.aliases && it.aliases.length > 0 && (
                                                    <span className="text-[10px] text-amber-700 bg-amber-50 px-1 rounded font-medium">
                                                      +{it.aliases.length} alias
                                                    </span>
                                                  )}
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* TAB 2: ITEMS MASTER TABLE */}
              {viewTab === 'items' && (
                <div className="space-y-3">
                  {/* Granular Filters */}
                  <div className="bg-stone-50/60 border border-stone-200 rounded-xl p-3 flex flex-wrap gap-2 text-xs">
                    <div className="relative flex-1 min-w-[200px]">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-stone-400" />
                      <input
                        type="text"
                        placeholder="Search item name or alias..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full rounded-lg border border-stone-200 pl-8 pr-3 py-1.5 text-xs focus:border-amber-500 focus:outline-none bg-white"
                      />
                    </div>

                    <select
                      value={filterParent}
                      onChange={(e) => {
                        setFilterParent(e.target.value);
                        setFilterCategory('');
                      }}
                      className="rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs bg-white focus:outline-none"
                    >
                      <option value="">All Parent Categories</option>
                      {parentsList.map((p) => (
                        <option key={p.id} value={p.name}>
                          {p.name}
                        </option>
                      ))}
                    </select>

                    <select
                      value={filterCategory}
                      onChange={(e) => setFilterCategory(e.target.value)}
                      className="rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs bg-white focus:outline-none"
                    >
                      <option value="">All Categories</option>
                      {categoriesList
                        .filter((c) => !filterParent || c.parent_category_name === filterParent)
                        .map((c) => (
                          <option key={c.id} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                    </select>

                    <select
                      value={filterActive}
                      onChange={(e) => setFilterActive(e.target.value)}
                      className="rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs bg-white focus:outline-none"
                    >
                      <option value="all">All Status</option>
                      <option value="active">Active Only</option>
                      <option value="inactive">Inactive Only</option>
                    </select>
                  </div>

                  {/* Items Table */}
                  <div className="overflow-x-auto border border-stone-200 rounded-xl">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-semibold">
                        <tr>
                          <th className="p-3">Item Name</th>
                          <th className="p-3">Category</th>
                          <th className="p-3">Parent Category</th>
                          <th className="p-3 text-right">Price</th>
                          <th className="p-3 text-center">GST Rate</th>
                          <th className="p-3">POS Aliases</th>
                          <th className="p-3 text-center">Status</th>
                          <th className="p-3 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {filteredItems.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="p-8 text-center text-stone-400 italic">
                              No menu items match your search filters.
                            </td>
                          </tr>
                        ) : (
                          filteredItems.map((item) => (
                            <tr key={item.id} className="hover:bg-stone-50/50">
                              <td className="p-3 font-semibold text-stone-900">
                                {item.name}
                              </td>
                              <td className="p-3 font-medium text-stone-700">
                                <span className="px-2 py-0.5 rounded bg-stone-100 border border-stone-200 text-[11px]">
                                  {item.category}
                                </span>
                              </td>
                              <td className="p-3 font-medium text-stone-600">
                                <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${getCategoryBadgeClasses(item.parent_category)}`}>
                                  {item.parent_category}
                                </span>
                              </td>
                              <td className="p-3 text-right font-mono font-bold text-stone-900">
                                {formatINR(item.price)}
                              </td>
                              <td className="p-3 text-center font-mono text-[11px] text-stone-600">
                                5.0% Forward
                              </td>
                              <td className="p-3">
                                {item.aliases && item.aliases.length > 0 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {item.aliases.map((al: string) => (
                                      <span
                                        key={al}
                                        className="px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 text-[10px] font-mono border border-stone-200"
                                      >
                                        {al}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-stone-300 text-[11px]">—</span>
                                )}
                              </td>
                              <td className="p-3 text-center">
                                {item.is_active ? (
                                  <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    Active
                                  </span>
                                ) : (
                                  <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-stone-100 text-stone-500">
                                    Inactive
                                  </span>
                                )}
                              </td>
                              <td className="p-3 text-center">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setEditingItem(item);
                                    setItemModalOpen(true);
                                  }}
                                  className="text-stone-500 hover:text-stone-900"
                                >
                                  <Edit2 className="h-3.5 w-3.5" />
                                </Button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 3: CATEGORIES TABLE */}
              {viewTab === 'categories' && (
                <div className="space-y-3">
                  <div className="overflow-x-auto border border-stone-200 rounded-xl">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-semibold">
                        <tr>
                          <th className="p-3">Category Name</th>
                          <th className="p-3">Parent Category</th>
                          <th className="p-3 text-center">Items Count</th>
                          <th className="p-3 text-center">Display Order</th>
                          <th className="p-3 text-center">Status</th>
                          <th className="p-3 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {categoriesList.map((cat) => (
                          <tr key={cat.id} className="hover:bg-stone-50/50">
                            <td className="p-3 font-semibold text-stone-900">
                              {cat.name}
                            </td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${getCategoryBadgeClasses(cat.parent_category_name)}`}>
                                {cat.parent_category_name}
                              </span>
                            </td>
                            <td className="p-3 text-center font-bold text-stone-800">
                              {cat.itemCount} items
                            </td>
                            <td className="p-3 text-center font-mono text-stone-500">
                              {cat.display_order}
                            </td>
                            <td className="p-3 text-center">
                              {cat.is_active ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  Active
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-stone-100 text-stone-500">
                                  Inactive
                                </span>
                              )}
                            </td>
                            <td className="p-3 text-center">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setEditingCategory(cat);
                                  setCategoryModalOpen(true);
                                }}
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 4: PARENT CATEGORIES TABLE */}
              {viewTab === 'parents' && (
                <div className="space-y-3">
                  <div className="overflow-x-auto border border-stone-200 rounded-xl">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-semibold">
                        <tr>
                          <th className="p-3">Parent Category Name</th>
                          <th className="p-3 text-center">Subcategories</th>
                          <th className="p-3 text-center">Total Items</th>
                          <th className="p-3 text-center">Display Order</th>
                          <th className="p-3 text-center">Status</th>
                          <th className="p-3 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {parentsList.map((p) => (
                          <tr key={p.id} className="hover:bg-stone-50/50">
                            <td className="p-3 font-bold text-stone-900 text-sm">
                              <div className="flex items-center gap-2.5">
                                <span
                                  className="w-3.5 h-3.5 rounded-full shrink-0 border border-black/10 shadow-2xs"
                                  style={{ backgroundColor: p.color || getCategoryColor(p.name) }}
                                />
                                <span>{p.name}</span>
                                {p.color && (
                                  <span className="text-[10px] font-mono font-normal text-stone-400 uppercase">
                                    {p.color}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="p-3 text-center font-semibold text-amber-700">
                              {p.categoryCount} categories
                            </td>
                            <td className="p-3 text-center font-bold text-stone-800">
                              {p.itemCount} items
                            </td>
                            <td className="p-3 text-center font-mono text-stone-500">
                              {p.display_order}
                            </td>
                            <td className="p-3 text-center">
                              {p.is_active ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  Active
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-stone-100 text-stone-500">
                                  Inactive
                                </span>
                              )}
                            </td>
                            <td className="p-3 text-center">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setEditingParent(p);
                                  setParentModalOpen(true);
                                }}
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 5: POS ALIASES TABLE */}
              {viewTab === 'aliases' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-stone-500">
                    <span>Mapped POS aliases used by Petpooja ingestion</span>
                    <span>{aliasesList.length} aliases</span>
                  </div>

                  <div className="overflow-x-auto border border-stone-200 rounded-xl">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-semibold">
                        <tr>
                          <th className="p-3">Petpooja Alias</th>
                          <th className="p-3">Normalized Key</th>
                          <th className="p-3">Mapped Menu Item</th>
                          <th className="p-3">Category</th>
                          <th className="p-3">Parent Category</th>
                          <th className="p-3">Notes</th>
                          <th className="p-3 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {aliasesList.map((al) => (
                          <tr key={al.id} className="hover:bg-stone-50/50">
                            <td className="p-3 font-bold font-mono text-stone-900">
                              {al.alias}
                            </td>
                            <td className="p-3 font-mono text-[11px] text-stone-500">
                              {al.normalized_alias}
                            </td>
                            <td className="p-3 font-semibold text-amber-900">
                              {al.pos_menu_items?.name || '—'}
                            </td>
                            <td className="p-3 text-stone-700">
                              {al.pos_menu_items?.category || '—'}
                            </td>
                            <td className="p-3 text-stone-700">
                              {al.pos_menu_items?.parent_category || '—'}
                            </td>
                            <td className="p-3 text-stone-400 text-[11px]">
                              {al.notes || '—'}
                            </td>
                            <td className="p-3 text-center">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={async () => {
                                  if (confirm(`Remove alias "${al.alias}"?`)) {
                                    await fetch(`/api/admin/menu/aliases?id=${al.id}`, { method: 'DELETE' });
                                    loadData();
                                  }
                                }}
                                className="text-red-500 hover:text-red-700"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Modals */}
      <ParentCategoryModal
        isOpen={parentModalOpen}
        onClose={() => setParentModalOpen(false)}
        onSuccess={loadData}
        parentCategory={editingParent}
      />

      <CategoryModal
        isOpen={categoryModalOpen}
        onClose={() => setCategoryModalOpen(false)}
        onSuccess={loadData}
        parents={parentsList}
        category={editingCategory}
      />

      <MenuItemModal
        isOpen={itemModalOpen}
        onClose={() => setItemModalOpen(false)}
        onSuccess={loadData}
        categories={categoriesList}
        parents={parentsList}
        item={editingItem}
      />

      <ReclassifySalesModal
        isOpen={reclassifyModalOpen}
        onClose={() => setReclassifyModalOpen(false)}
        onSuccess={loadData}
      />
    </div>
  );
}
