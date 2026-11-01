'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useI18n } from '@/lib/i18n/context';
import { useAppRole } from '@/components/layout/AppShell';
import { canViewCosting } from '@/lib/rbac';
import { formatINR } from '@/lib/utils';
import { filterLogicalIngredientGroups } from '@/lib/inventory/search';
import {
  UtensilsCrossed,
  Plus,
  Search,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Lock,
  ChevronRight,
  Filter,
  X,
  BookOpen,
  ArrowRight,
} from 'lucide-react';

interface RecipeListItem {
  id: string;
  name: string;
  name_hi?: string | null;
  category: 'PREPARATION' | 'FINAL_DISH' | 'COMBO_PORTION' | 'BULK_CATERING';
  batch_yield_quantity?: number | null;
  batch_yield_unit?: string | null;
  portion_size_quantity?: number | null;
  portion_size_unit?: string | null;
  costing_status: 'COSTED_ELIGIBLE' | 'UNCOSTED' | 'COSTING_INCOMPLETE' | 'INELIGIBLE';
  costing_reasons?: string[];
  total_batch_cost?: number | null;
  cost_per_output_unit?: number | null;
  cost_per_serving?: number | null;
  servings_per_batch?: number | null;
  ingredients?: any[];
}

function RecipesContent() {
  const { t, locale } = useI18n();
  const { hasPermission, role: activeRole, permissions } = useAppRole();
  const router = useRouter();
  const searchParams = useSearchParams();

  const canManage = hasPermission('sops.recipes.manage');
  const hasCostAccess = canViewCosting(activeRole, permissions);

  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);
  const [combos, setCombos] = useState<any[]>([]);
  const [foodGroups, setFoodGroups] = useState<any[]>([]);
  const [aliasesMap, setAliasesMap] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [categoryTab, setCategoryTab] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // New Recipe Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [groupSearchQuery, setGroupSearchQuery] = useState('');
  const [selectedInitialGroup, setSelectedInitialGroup] = useState<any | null>(null);
  const [initialQty, setInitialQty] = useState('');
  const [newForm, setNewForm] = useState({
    name: '',
    name_hi: '',
    category: 'PREPARATION',
    batch_yield_quantity: '',
    batch_yield_unit: 'kg',
    portion_size_quantity: '',
    portion_size_unit: 'g',
    instructions: '',
    notes: '',
  });

  const fetchRecipes = async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, menuRes, groupsRes] = await Promise.all([
        fetch('/api/sops/recipes'),
        fetch('/api/sops/menu?channel=DINE_IN'),
        fetch('/api/inventory/groups?class=Food Raw Material'),
      ]);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load recipes');
      }
      const data = await res.json();
      setRecipes(data.recipes || []);

      if (menuRes.ok) {
        const menuData = await menuRes.json();
        setCombos(menuData.combos || []);
      }
      if (groupsRes.ok) {
        const groupsData = await groupsRes.json();
        setFoodGroups(groupsData.groups || []);
        setAliasesMap(groupsData.aliasesMap || {});
      }
    } catch (err: any) {
      console.error('Fetch recipes error:', err);
      setError(err.message || 'Error fetching recipes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecipes();
  }, []);

  // Filtered food groups for Recipe Builder via filterLogicalIngredientGroups
  const matchingFoodGroups = useMemo(() => {
    if (!groupSearchQuery.trim()) return foodGroups.slice(0, 8);
    return filterLogicalIngredientGroups(foodGroups, groupSearchQuery, aliasesMap).slice(0, 8);
  }, [foodGroups, groupSearchQuery, aliasesMap]);

  const handleCreateRecipe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newForm.name.trim()) {
      setCreateError('Recipe name is required');
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const initialIngredients = selectedInitialGroup
        ? [
            {
              ingredient_type: 'RAW_MATERIAL',
              ingredient_group_id: selectedInitialGroup.id,
              quantity: Number(initialQty) || 1,
              unit: selectedInitialGroup.base_unit?.symbol || 'g',
            },
          ]
        : [];

      const res = await fetch('/api/sops/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newForm.name,
          name_hi: newForm.name_hi || null,
          category: newForm.category,
          batch_yield_quantity: newForm.batch_yield_quantity ? Number(newForm.batch_yield_quantity) : null,
          batch_yield_unit: newForm.batch_yield_unit || null,
          portion_size_quantity: newForm.portion_size_quantity ? Number(newForm.portion_size_quantity) : null,
          portion_size_unit: newForm.portion_size_unit || null,
          instructions: newForm.instructions || null,
          notes: newForm.notes || null,
          ingredients: initialIngredients,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create recipe');
      }

      const data = await res.json();
      setIsModalOpen(false);
      setSelectedInitialGroup(null);
      setGroupSearchQuery('');
      setInitialQty('');
      router.push(`/sops/recipes/${data.recipe.id}`);
    } catch (err: any) {
      setCreateError(err.message || 'Error creating recipe');
    } finally {
      setCreating(false);
    }
  };

  const filteredRecipes = useMemo(() => {
    return recipes.filter((r) => {
      if (categoryTab !== 'ALL' && r.category !== categoryTab) return false;
      if (statusFilter !== 'ALL' && r.costing_status !== statusFilter) return false;
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase().trim();
        const nameMatch = r.name?.toLowerCase().includes(query);
        const nameHiMatch = r.name_hi?.toLowerCase().includes(query);
        if (!nameMatch && !nameHiMatch) return false;
      }
      return true;
    });
  }, [recipes, categoryTab, statusFilter, searchTerm]);

  const getStatusBadge = (status: string, reasons?: string[]) => {
    switch (status) {
      case 'COSTED_ELIGIBLE':
        return (
          <Badge variant="success" className="gap-1 font-mono text-[11px]">
            <CheckCircle2 className="h-3 w-3" /> {t('sops.statuses.COSTED_ELIGIBLE')}
          </Badge>
        );
      case 'UNCOSTED':
        return (
          <Badge variant="warning" className="gap-1 font-mono text-[11px]" title={reasons?.join('; ')}>
            <AlertTriangle className="h-3 w-3" /> {t('sops.statuses.UNCOSTED')}
          </Badge>
        );
      case 'COSTING_INCOMPLETE':
        return (
          <Badge variant="danger" className="gap-1 font-mono text-[11px]" title={reasons?.join('; ')}>
            <AlertTriangle className="h-3 w-3" /> {t('sops.statuses.COSTING_INCOMPLETE')}
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="gap-1 font-mono text-[11px]">
            <HelpCircle className="h-3 w-3" /> {t('sops.statuses.INELIGIBLE')}
          </Badge>
        );
    }
  };

  const getCategoryBadge = (category: string) => {
    switch (category) {
      case 'PREPARATION':
        return <Badge variant="info" className="text-[11px]">{t('sops.recipes.preparations')}</Badge>;
      case 'FINAL_DISH':
        return <Badge variant="purple" className="text-[11px]">{t('sops.recipes.finalDishes')}</Badge>;
      case 'COMBO_PORTION':
        return <Badge variant="maroon" className="text-[11px]">{t('sops.recipes.comboPortions')}</Badge>;
      case 'BULK_CATERING':
        return <Badge variant="warning" className="text-[11px]">{t('sops.recipes.bulkCatering')}</Badge>;
      default:
        return <Badge variant="outline" className="text-[11px]">{category}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-stone-900">
              {t('sops.recipes.title')}
            </h1>
            <Badge variant="outline" className="font-mono text-xs text-stone-600 bg-stone-50">
              {recipes.length} {locale === 'hi' ? 'रेसिपी' : 'Formulations'}
            </Badge>
          </div>
          <p className="text-sm text-stone-500 mt-1">
            {t('sops.recipes.description')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchRecipes}
            disabled={loading}
            className="gap-1.5"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {locale === 'hi' ? 'रिफ्रेश' : 'Refresh'}
          </Button>

          {canManage && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsModalOpen(true)}
              className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white shadow-sm"
            >
              <Plus className="h-4 w-4" />
              {t('sops.recipes.newRecipe')}
            </Button>
          )}
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex overflow-x-auto gap-1 border-b border-[#E7E2D8] pb-px">
        {[
          { key: 'ALL', label: t('sops.recipes.allCategories') },
          { key: 'FINAL_DISH', label: t('sops.recipes.finalDishes') },
          { key: 'PREPARATION', label: locale === 'hi' ? 'पूर्व-तैयारियां (YM)' : 'Preparations (YM)' },
          { key: 'COMBO_PORTION', label: t('sops.recipes.comboPortions') },
          { key: 'COMBOS', label: `${locale === 'hi' ? 'कॉम्बो और थाली' : 'Combos & Thalis'}${combos.length ? ` (${combos.length})` : ''}` },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setCategoryTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
              categoryTab === tab.key
                ? 'border-amber-600 text-amber-700 font-semibold'
                : 'border-transparent text-stone-600 hover:text-stone-900 hover:border-stone-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search and Filters Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
          <input
            type="text"
            placeholder={t('sops.recipes.searchPlaceholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-9 py-2 bg-white border border-[#E7E2D8] rounded-lg text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-stone-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-white border border-[#E7E2D8] rounded-lg text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 cursor-pointer"
          >
            <option value="ALL">{locale === 'hi' ? 'सभी स्थितियां' : 'All Statuses'}</option>
            <option value="COSTED_ELIGIBLE">{t('sops.statuses.COSTED_ELIGIBLE')}</option>
            <option value="UNCOSTED">{t('sops.statuses.UNCOSTED')}</option>
            <option value="COSTING_INCOMPLETE">{t('sops.statuses.COSTING_INCOMPLETE')}</option>
          </select>
        </div>
      </div>

      {/* Recipes or Combos Table Card */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 text-center text-stone-500 flex flex-col items-center gap-2">
              <RefreshCw className="h-6 w-6 animate-spin text-amber-600" />
              <span>{locale === 'hi' ? 'रेसिपी लोड हो रही हैं...' : 'Loading formulations...'}</span>
            </div>
          ) : error ? (
            <div className="p-8 text-center text-rose-600 bg-rose-50/50 rounded-xl m-4 border border-rose-200">
              <AlertTriangle className="h-6 w-6 mx-auto mb-2 text-rose-500" />
              <p className="font-semibold">{locale === 'hi' ? 'त्रुटि हुई' : 'Error loading recipes'}</p>
              <p className="text-xs text-rose-700 mt-1">{error}</p>
              <Button variant="outline" size="sm" onClick={fetchRecipes} className="mt-4">
                {locale === 'hi' ? 'पुनः प्रयास करें' : 'Try Again'}
              </Button>
            </div>
          ) : categoryTab === 'COMBOS' ? (
            combos.length === 0 ? (
              <div className="p-12 text-center text-stone-400 flex flex-col items-center gap-2">
                <BookOpen className="h-8 w-8 text-stone-300" />
                <p className="text-sm font-medium text-stone-600">No combos or thalis configured.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#E7E2D8] bg-[#FAF8F5] text-xs font-semibold text-stone-600">
                      <th className="py-3 px-4">Combo / Thali Name</th>
                      <th className="py-3 px-4">Product Type</th>
                      <th className="py-3 px-4">Components</th>
                      <th className="py-3 px-4 text-right">Selling Price</th>
                      <th className="py-3 px-4 text-right">Food Cost</th>
                      <th className="py-3 px-4 text-right">Margin</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E7E2D8]">
                    {combos.map((c: any) => (
                      <tr key={c.id} className="hover:bg-amber-50/20 transition-colors">
                        <td className="py-3.5 px-4 font-medium text-stone-900">
                          <div>{c.name}</div>
                          {c.name_hi && <div className="text-xs text-stone-500 font-sans">{c.name_hi}</div>}
                        </td>
                        <td className="py-3.5 px-4">
                          <Badge variant="maroon" className="text-[10px]">{c.product_type}</Badge>
                        </td>
                        <td className="py-3.5 px-4 text-xs text-stone-600">
                          {c.components?.length || 0} items
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono text-sm font-medium text-stone-900">
                          {c.selling_price ? formatINR(c.selling_price) : '—'}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono text-sm font-medium text-emerald-700">
                          {!hasCostAccess ? (
                            <Lock className="h-3 w-3 inline text-stone-400" />
                          ) : c.food_cost != null ? (
                            formatINR(c.food_cost)
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono text-sm font-medium text-stone-900">
                          {!hasCostAccess ? (
                            <Lock className="h-3 w-3 inline text-stone-400" />
                          ) : c.margin_amount != null ? (
                            formatINR(c.margin_amount)
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          {getStatusBadge(c.status || c.costing_status || 'UNCOSTED', c.incomplete_reasons)}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <Link href="/sops/menu?tab=combos">
                            <Button variant="ghost" size="sm" className="h-8 px-2 text-stone-600 hover:text-amber-700">
                              <span className="text-xs mr-1">{t('sops.recipes.viewDetails')}</span>
                              <ChevronRight className="h-3.5 w-3.5" />
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : filteredRecipes.length === 0 ? (
            <div className="p-12 text-center text-stone-400 flex flex-col items-center gap-2">
              <BookOpen className="h-8 w-8 text-stone-300" />
              <p className="text-sm font-medium text-stone-600">{t('sops.recipes.noRecipesFound')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[#E7E2D8] bg-[#FAF8F5] text-xs font-semibold text-stone-600">
                    <th className="py-3 px-4">{t('sops.recipes.colName')}</th>
                    <th className="py-3 px-4">{t('sops.recipes.colCategory')}</th>
                    <th className="py-3 px-4">{t('sops.recipes.colBatchYield')}</th>
                    <th className="py-3 px-4">{t('sops.recipes.colPortion')}</th>
                    <th className="py-3 px-4 text-right">{t('sops.recipes.colBatchCost')}</th>
                    <th className="py-3 px-4 text-right">{t('sops.recipes.colUnitCost')}</th>
                    <th className="py-3 px-4">{t('sops.recipes.colStatus')}</th>
                    <th className="py-3 px-4 text-right">{t('sops.recipes.colActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E7E2D8]">
                  {filteredRecipes.map((r) => {
                    const unitOrServingCost =
                      r.category === 'PREPARATION' || r.category === 'COMBO_PORTION' || r.category === 'BULK_CATERING'
                        ? r.cost_per_output_unit
                        : r.cost_per_serving;

                    const unitLabel =
                      r.category === 'PREPARATION' || r.category === 'COMBO_PORTION' || r.category === 'BULK_CATERING'
                        ? `/${r.batch_yield_unit || 'unit'}`
                        : `/${r.portion_size_unit || 'portion'}`;

                    return (
                      <tr key={r.id} className="hover:bg-amber-50/20 transition-colors group">
                        <td className="py-3.5 px-4">
                          <Link href={`/sops/recipes/${r.id}`} className="block">
                            <div className="font-medium text-stone-900 group-hover:text-amber-700 transition-colors">
                              {r.name}
                            </div>
                            {r.name_hi && (
                              <div className="text-xs text-stone-500 font-sans">{r.name_hi}</div>
                            )}
                          </Link>
                        </td>

                        <td className="py-3.5 px-4">
                          {getCategoryBadge(r.category)}
                        </td>

                        <td className="py-3.5 px-4 font-mono text-xs text-stone-700">
                          {r.batch_yield_quantity != null ? (
                            <span>
                              {Number(r.batch_yield_quantity)} {r.batch_yield_unit}
                            </span>
                          ) : (
                            <span className="text-stone-400">—</span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 font-mono text-xs text-stone-700">
                          {r.portion_size_quantity != null ? (
                            <span>
                              {Number(r.portion_size_quantity)} {r.portion_size_unit}
                            </span>
                          ) : (
                            <span className="text-stone-400">—</span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-right font-mono text-sm">
                          {!hasCostAccess ? (
                            <span className="inline-flex items-center gap-1 text-xs text-stone-400">
                              <Lock className="h-3 w-3" />
                            </span>
                          ) : r.total_batch_cost != null ? (
                            <span className="font-medium text-stone-900">
                              {formatINR(r.total_batch_cost)}
                            </span>
                          ) : (
                            <span className="text-stone-400">—</span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-right font-mono text-sm">
                          {!hasCostAccess ? (
                            <span className="inline-flex items-center gap-1 text-xs text-stone-400">
                              <Lock className="h-3 w-3" />
                            </span>
                          ) : unitOrServingCost != null ? (
                            <span className="font-semibold text-emerald-700">
                              {formatINR(unitOrServingCost)}
                              <span className="text-[10px] text-stone-500 font-normal ml-0.5">{unitLabel}</span>
                            </span>
                          ) : (
                            <span className="text-stone-400">—</span>
                          )}
                        </td>

                        <td className="py-3.5 px-4">
                          {getStatusBadge(r.costing_status, r.costing_reasons)}
                        </td>

                        <td className="py-3.5 px-4 text-right">
                          <Link href={`/sops/recipes/${r.id}`}>
                            <Button variant="ghost" size="sm" className="h-8 px-2 text-stone-600 hover:text-amber-700">
                              <span className="text-xs mr-1">{t('sops.recipes.viewDetails')}</span>
                              <ChevronRight className="h-3.5 w-3.5" />
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Recipe Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full overflow-hidden border border-[#E7E2D8] animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E7E2D8] bg-[#FAF8F5]">
              <h2 className="text-base font-bold text-stone-900 flex items-center gap-2">
                <UtensilsCrossed className="h-4 w-4 text-amber-600" />
                {t('sops.recipes.newRecipe')}
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-stone-400 hover:text-stone-600 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateRecipe} className="p-6 space-y-4">
              {createError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs">
                  {createError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Recipe Name (English) *
                </label>
                <input
                  type="text"
                  required
                  value={newForm.name}
                  onChange={(e) => setNewForm({ ...newForm, name: e.target.value })}
                  placeholder="e.g. Makhani Gravy Base"
                  className="w-full px-3 py-2 border border-[#E7E2D8] rounded-lg text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  रेसिपी का नाम (हिंदी)
                </label>
                <input
                  type="text"
                  value={newForm.name_hi}
                  onChange={(e) => setNewForm({ ...newForm, name_hi: e.target.value })}
                  placeholder="उदा. मखनी ग्रेवी बेस"
                  className="w-full px-3 py-2 border border-[#E7E2D8] rounded-lg text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 font-sans"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Category *
                </label>
                <select
                  value={newForm.category}
                  onChange={(e) => setNewForm({ ...newForm, category: e.target.value })}
                  className="w-full px-3 py-2 border border-[#E7E2D8] rounded-lg text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 cursor-pointer"
                >
                  <option value="PREPARATION">{t('sops.recipes.preparations')}</option>
                  <option value="FINAL_DISH">{t('sops.recipes.finalDishes')}</option>
                  <option value="COMBO_PORTION">{t('sops.recipes.comboPortions')}</option>
                  <option value="BULK_CATERING">{t('sops.recipes.bulkCatering')}</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Batch Yield Quantity
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={newForm.batch_yield_quantity}
                    onChange={(e) => setNewForm({ ...newForm, batch_yield_quantity: e.target.value })}
                    placeholder="e.g. 10"
                    className="w-full px-3 py-2 border border-[#E7E2D8] rounded-lg text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Yield Unit
                  </label>
                  <input
                    type="text"
                    value={newForm.batch_yield_unit}
                    onChange={(e) => setNewForm({ ...newForm, batch_yield_unit: e.target.value })}
                    placeholder="kg, L, pcs..."
                    className="w-full px-3 py-2 border border-[#E7E2D8] rounded-lg text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Portion Size Quantity
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={newForm.portion_size_quantity}
                    onChange={(e) => setNewForm({ ...newForm, portion_size_quantity: e.target.value })}
                    placeholder="e.g. 250"
                    className="w-full px-3 py-2 border border-[#E7E2D8] rounded-lg text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Portion Unit
                  </label>
                  <input
                    type="text"
                    value={newForm.portion_size_unit}
                    onChange={(e) => setNewForm({ ...newForm, portion_size_unit: e.target.value })}
                    placeholder="g, ml, pcs..."
                    className="w-full px-3 py-2 border border-[#E7E2D8] rounded-lg text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  />
                </div>
              </div>

              {/* Optional Primary Ingredient with filterLogicalIngredientGroups */}
              <div className="pt-2 border-t border-[#E7E2D8] space-y-2">
                <label className="block text-xs font-semibold text-stone-700">
                  Initial Ingredient (Food Raw Material) — Optional
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-400" />
                  <input
                    type="text"
                    value={groupSearchQuery}
                    onChange={(e) => setGroupSearchQuery(e.target.value)}
                    placeholder="Search food raw material group (e.g. Chilli, Paneer, Maida)..."
                    className="w-full pl-8 pr-3 py-1.5 border border-[#E7E2D8] rounded text-xs bg-white text-stone-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
                {groupSearchQuery.trim() && (
                  <div className="max-h-36 overflow-y-auto border border-[#E7E2D8] rounded bg-white divide-y divide-[#E7E2D8] text-xs">
                    {matchingFoodGroups.length === 0 ? (
                      <p className="p-2 text-stone-400 italic">No food raw materials matched.</p>
                    ) : (
                      matchingFoodGroups.map((g: any) => (
                        <div
                          key={g.id}
                          onClick={() => {
                            setSelectedInitialGroup(g);
                            setGroupSearchQuery('');
                          }}
                          className="p-2 hover:bg-amber-50 cursor-pointer flex items-center justify-between"
                        >
                          <div>
                            <span className="font-semibold text-stone-800">{g.name}</span>
                            {g.name_hi && <span className="text-stone-500 font-sans ml-1">({g.name_hi})</span>}
                          </div>
                          <span className="font-mono text-[10px] text-stone-400">
                            {g.base_unit?.symbol}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}
                {selectedInitialGroup && (
                  <div className="p-2.5 bg-amber-50/60 border border-amber-200 rounded-lg text-xs flex items-center justify-between">
                    <div>
                      <span className="font-bold text-amber-950">{selectedInitialGroup.name}</span>
                      <span className="text-[10px] text-stone-500 ml-1">({selectedInitialGroup.group_code})</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        step="any"
                        value={initialQty}
                        onChange={(e) => setInitialQty(e.target.value)}
                        placeholder="Qty"
                        className="w-16 px-1.5 py-0.5 border border-[#E7E2D8] rounded bg-white text-xs font-mono"
                      />
                      <span className="font-mono text-[11px] text-stone-600">{selectedInitialGroup.base_unit?.symbol}</span>
                      <button
                        type="button"
                        onClick={() => setSelectedInitialGroup(null)}
                        className="text-stone-400 hover:text-stone-600 ml-1"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-[#E7E2D8]">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsModalOpen(false)}
                  disabled={creating}
                >
                  {t('sops.recipes.cancel')}
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={creating}
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {creating ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    locale === 'hi' ? 'रेसिपी बनाएं और सामग्री जोड़ें' : 'Create & Add Ingredients'
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RecipesPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-stone-500">Loading Recipe Book...</div>}>
      <RecipesContent />
    </Suspense>
  );
}
