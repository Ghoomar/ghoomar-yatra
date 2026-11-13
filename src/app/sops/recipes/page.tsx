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
import { BilingualNameInput } from '@/components/admin/BilingualNameInput';
import { createClient } from '@/lib/supabase/client';
import { getCompatibleUnitOptions, CentralUnit } from '@/lib/sops/costing/units';
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
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Filter,
  X,
  BookOpen,
  ArrowRight,
  Zap,
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
  const [foodGroups, setFoodGroups] = useState<any[]>([]);
  const [aliasesMap, setAliasesMap] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Lazy loading state for modal autocomplete
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [groupsLoading, setGroupsLoading] = useState(false);

  // Filters
  const [categoryTab, setCategoryTab] = useState<string>('FINAL_DISH');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Sorting
  const [sortField, setSortField] = useState<'name' | 'category' | 'batch_yield' | 'status'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Units Master Data
  const [centralUnits, setCentralUnits] = useState<CentralUnit[]>([]);

  // Quick Add Preparation Modal State
  const [isQuickPrepOpen, setIsQuickPrepOpen] = useState(false);
  const [quickPrepName, setQuickPrepName] = useState('');
  const [quickPrepNameHi, setQuickPrepNameHi] = useState('');
  const [isQuickCustomHindi, setIsQuickCustomHindi] = useState(false);
  const [quickPrepCreating, setQuickPrepCreating] = useState(false);
  const [quickPrepError, setQuickPrepError] = useState<string | null>(null);

  // New Recipe Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [groupSearchQuery, setGroupSearchQuery] = useState('');
  const [selectedInitialGroup, setSelectedInitialGroup] = useState<any | null>(null);
  const [initialQty, setInitialQty] = useState('');
  const [isCustomHindi, setIsCustomHindi] = useState(false);
  const [newForm, setNewForm] = useState({
    name: '',
    name_hi: '',
    category: 'PREPARATION',
    batch_yield_quantity: '',
    batch_yield_unit: 'kg',
    portion_size_quantity: '',
    portion_size_unit: 'g',
  });

  const fetchRecipes = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/sops/dishes');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load recipes');
      }
      const data = await res.json();
      const rawDishes = data.dishes || [];
      const mappedRecipes: RecipeListItem[] = rawDishes.map((dish: any) => {
        const defaultForm = dish.formulations?.find((f: any) => f.id === dish.default_formulation_id) || dish.formulations?.[0];
        const defaultCfg = dish.configurations?.[0];
        const batchYieldQty = defaultForm?.batch_yield_quantity != null ? Number(defaultForm.batch_yield_quantity) : null;
        const batchYieldUnit = defaultForm?.batch_yield_unit || null;
        const portionQty = defaultCfg?.portion_size_quantity != null ? Number(defaultCfg.portion_size_quantity) : null;
        const portionUnit = defaultCfg?.portion_size_unit || null;
        const batchCost = defaultForm?.batch_cost != null ? Number(defaultForm.batch_cost) : null;
        const costPerOutputUnit = (batchCost != null && batchYieldQty && batchYieldQty > 0)
          ? Math.round((batchCost / batchYieldQty) * 100) / 100
          : null;
        const costPerServing = defaultCfg?.serving_cost != null ? Number(defaultCfg.serving_cost) : null;
        const servingsPerBatch = (batchYieldQty && portionQty && portionQty > 0)
          ? Math.round((batchYieldQty / (portionUnit === 'kg' ? portionQty : portionQty / 1000)) * 10) / 10
          : null;

        return {
          id: dish.id,
          name: dish.name,
          name_hi: dish.name_hi,
          category: dish.category,
          batch_yield_quantity: batchYieldQty,
          batch_yield_unit: batchYieldUnit,
          portion_size_quantity: portionQty,
          portion_size_unit: portionUnit,
          costing_status: defaultForm?.costing_status || 'UNCOSTED',
          costing_reasons: defaultForm?.costing_reasons || [],
          total_batch_cost: batchCost,
          cost_per_output_unit: costPerOutputUnit,
          cost_per_serving: costPerServing,
          servings_per_batch: servingsPerBatch,
          ingredients: defaultForm?.ingredients || [],
        };
      });
      setRecipes(mappedRecipes);
    } catch (err: any) {
      console.error('Fetch recipes error:', err);
      setError(err.message || 'Error fetching recipes');
    } finally {
      setLoading(false);
    }
  };



  const fetchFoodGroups = async () => {
    if (groupsLoaded || groupsLoading) return;
    setGroupsLoading(true);
    try {
      const res = await fetch('/api/inventory/groups?class=Food Raw Material');
      if (res.ok) {
        const data = await res.json();
        setFoodGroups(data.groups || []);
        setAliasesMap(data.aliasesMap || {});
        setGroupsLoaded(true);
      }
    } catch (err) {
      console.error('Fetch food groups error:', err);
    } finally {
      setGroupsLoading(false);
    }
  };

  useEffect(() => {
    fetchRecipes();
    const supabase = createClient();
    supabase
      .from('units')
      .select('id, name, name_hi, symbol, symbol_hi, is_active')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        if (data) setCentralUnits(data as CentralUnit[]);
      });
  }, []);

  const handleQuickAddPrep = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickPrepName.trim()) {
      setQuickPrepError(locale === 'hi' ? 'रेसिपी का नाम आवश्यक है' : 'Recipe name is required');
      return;
    }

    setQuickPrepCreating(true);
    setQuickPrepError(null);
    try {
      const res = await fetch('/api/sops/dishes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: quickPrepName.trim(),
          name_hi: quickPrepNameHi?.trim() || null,
          category: 'PREPARATION',
          batch_yield_unit: 'kg',
          ingredients: [],
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create preparation');
      }

      const data = await res.json();
      setIsQuickPrepOpen(false);
      setQuickPrepName('');
      setQuickPrepNameHi('');
      setIsQuickCustomHindi(false);
      const targetId = data.dish?.id || data.recipe?.id;
      router.push(`/sops/recipes/${targetId}`);
    } catch (err: any) {
      setQuickPrepError(err.message || 'Error creating preparation');
    } finally {
      setQuickPrepCreating(false);
    }
  };

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

      const res = await fetch('/api/sops/dishes', {
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
          ingredients: initialIngredients,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create recipe');
      }

      const data = await res.json();
      setIsModalOpen(false);
      setIsCustomHindi(false);
      setSelectedInitialGroup(null);
      setGroupSearchQuery('');
      setInitialQty('');
      const targetId = data.dish?.id || data.recipe?.id;
      router.push(`/sops/recipes/${targetId}`);
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

  const sortedRecipes = useMemo(() => {
    const list = [...filteredRecipes];
    list.sort((a, b) => {
      let res = 0;
      if (sortField === 'name') {
        res = (a.name || '').localeCompare(b.name || '', locale || 'en');
      } else if (sortField === 'category') {
        res = (a.category || '').localeCompare(b.category || '', locale || 'en');
      } else if (sortField === 'batch_yield') {
        const aVal = a.batch_yield_quantity != null ? Number(a.batch_yield_quantity) : -1;
        const bVal = b.batch_yield_quantity != null ? Number(b.batch_yield_quantity) : -1;
        res = aVal - bVal;
      } else if (sortField === 'status') {
        const rank: Record<string, number> = {
          COSTED_ELIGIBLE: 1,
          UNCOSTED: 2,
          COSTING_INCOMPLETE: 3,
          INELIGIBLE: 4,
        };
        const aRank = rank[a.costing_status] || 5;
        const bRank = rank[b.costing_status] || 5;
        res = aRank - bRank;
      }
      return sortOrder === 'asc' ? res : -res;
    });
    return list;
  }, [filteredRecipes, sortField, sortOrder, locale]);

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
              variant="outline"
              size="sm"
              onClick={() => {
                setQuickPrepName('');
                setQuickPrepNameHi('');
                setIsQuickCustomHindi(false);
                setQuickPrepError(null);
                setIsQuickPrepOpen(true);
              }}
              className="gap-1.5 border-amber-300 text-amber-800 hover:bg-amber-50 cursor-pointer"
            >
              <Zap className="h-4 w-4 text-amber-600" />
              {t('sops.recipes.quickAddPrep')}
            </Button>
          )}

          {canManage && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setNewForm({
                  name: '',
                  name_hi: '',
                  category: 'PREPARATION',
                  batch_yield_quantity: '',
                  batch_yield_unit: 'kg',
                  portion_size_quantity: '',
                  portion_size_unit: 'g',
                });
                setIsCustomHindi(false);
                setSelectedInitialGroup(null);
                setGroupSearchQuery('');
                setInitialQty('');
                setCreateError(null);
                if (!groupsLoaded) {
                  fetchFoodGroups();
                }
                setIsModalOpen(true);
              }}
              className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white shadow-sm cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              {t('sops.recipes.createFullRecipe')}
            </Button>
          )}
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex overflow-x-auto gap-1 border-b border-[#E7E2D8] pb-px">
        {[
          { key: 'FINAL_DISH', label: t('sops.recipes.finalDishes') },
          { key: 'PREPARATION', label: locale === 'hi' ? 'पूर्व-तैयारियां (YM)' : 'Preparations (YM)' },
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

      {/* Recipes Table Card */}
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
                    <th
                      onClick={() => {
                        if (sortField === 'name') setSortOrder((p) => (p === 'asc' ? 'desc' : 'asc'));
                        else { setSortField('name'); setSortOrder('asc'); }
                      }}
                      className="py-3 px-4 cursor-pointer select-none hover:text-amber-800 transition-colors"
                    >
                      <div className="inline-flex items-center gap-1.5">
                        <span>{t('sops.recipes.colName')}</span>
                        {sortField === 'name' ? (
                          sortOrder === 'asc' ? <ChevronUp className="h-3.5 w-3.5 text-amber-600" /> : <ChevronDown className="h-3.5 w-3.5 text-amber-600" />
                        ) : (
                          <ChevronsUpDown className="h-3.5 w-3.5 text-stone-300" />
                        )}
                      </div>
                    </th>
                    <th
                      onClick={() => {
                        if (sortField === 'category') setSortOrder((p) => (p === 'asc' ? 'desc' : 'asc'));
                        else { setSortField('category'); setSortOrder('asc'); }
                      }}
                      className="py-3 px-4 cursor-pointer select-none hover:text-amber-800 transition-colors"
                    >
                      <div className="inline-flex items-center gap-1.5">
                        <span>{t('sops.recipes.colCategory')}</span>
                        {sortField === 'category' ? (
                          sortOrder === 'asc' ? <ChevronUp className="h-3.5 w-3.5 text-amber-600" /> : <ChevronDown className="h-3.5 w-3.5 text-amber-600" />
                        ) : (
                          <ChevronsUpDown className="h-3.5 w-3.5 text-stone-300" />
                        )}
                      </div>
                    </th>
                    <th
                      onClick={() => {
                        if (sortField === 'batch_yield') setSortOrder((p) => (p === 'asc' ? 'desc' : 'asc'));
                        else { setSortField('batch_yield'); setSortOrder('asc'); }
                      }}
                      className="py-3 px-4 cursor-pointer select-none hover:text-amber-800 transition-colors"
                    >
                      <div className="inline-flex items-center gap-1.5">
                        <span>{t('sops.recipes.colBatchYield')}</span>
                        {sortField === 'batch_yield' ? (
                          sortOrder === 'asc' ? <ChevronUp className="h-3.5 w-3.5 text-amber-600" /> : <ChevronDown className="h-3.5 w-3.5 text-amber-600" />
                        ) : (
                          <ChevronsUpDown className="h-3.5 w-3.5 text-stone-300" />
                        )}
                      </div>
                    </th>
                    <th className="py-3 px-4">{t('sops.recipes.colPortion')}</th>
                    <th className="py-3 px-4 text-right">{t('sops.recipes.colBatchCost')}</th>
                    <th className="py-3 px-4 text-right">{t('sops.recipes.colUnitCost')}</th>
                    <th
                      onClick={() => {
                        if (sortField === 'status') setSortOrder((p) => (p === 'asc' ? 'desc' : 'asc'));
                        else { setSortField('status'); setSortOrder('asc'); }
                      }}
                      className="py-3 px-4 cursor-pointer select-none hover:text-amber-800 transition-colors"
                    >
                      <div className="inline-flex items-center gap-1.5">
                        <span>{t('sops.recipes.colStatus')}</span>
                        {sortField === 'status' ? (
                          sortOrder === 'asc' ? <ChevronUp className="h-3.5 w-3.5 text-amber-600" /> : <ChevronDown className="h-3.5 w-3.5 text-amber-600" />
                        ) : (
                          <ChevronsUpDown className="h-3.5 w-3.5 text-stone-300" />
                        )}
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E7E2D8]">
                  {sortedRecipes.map((r) => {
                    const unitOrServingCost =
                      r.category === 'PREPARATION' || r.category === 'COMBO_PORTION' || r.category === 'BULK_CATERING'
                        ? r.cost_per_output_unit
                        : r.cost_per_serving;

                    const unitLabel =
                      r.category === 'PREPARATION' || r.category === 'COMBO_PORTION' || r.category === 'BULK_CATERING'
                        ? `/${r.batch_yield_unit || 'unit'}`
                        : `/${r.portion_size_unit || 'portion'}`;

                    return (
                      <tr
                        key={r.id}
                        onClick={() => router.push(`/sops/recipes/${r.id}`)}
                        className="hover:bg-amber-50/30 cursor-pointer transition-colors group"
                      >
                        <td className="py-3.5 px-4">
                          <div className="font-medium text-stone-900 group-hover:text-amber-700 transition-colors">
                            {r.name}
                          </div>
                          {r.name_hi && (
                            <div className="text-xs text-stone-500 font-sans">{r.name_hi}</div>
                          )}
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
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Add Preparation Modal */}
      {isQuickPrepOpen && (
        <div className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full overflow-hidden border border-[#E7E2D8] animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E7E2D8] bg-[#FAF8F5]">
              <h2 className="text-base font-bold text-stone-900 flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-600" />
                {t('sops.recipes.quickAddPrep')}
              </h2>
              <button
                type="button"
                onClick={() => setIsQuickPrepOpen(false)}
                className="text-stone-400 hover:text-stone-600 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleQuickAddPrep} className="p-6 space-y-4">
              <p className="text-xs text-stone-500">
                {t('sops.recipes.quickAddDescription')}
              </p>

              {quickPrepError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs">
                  {quickPrepError}
                </div>
              )}

              <BilingualNameInput
                englishName={quickPrepName}
                onChangeEnglish={setQuickPrepName}
                hindiName={quickPrepNameHi}
                onChangeHindi={setQuickPrepNameHi}
                isCustomHindi={isQuickCustomHindi}
                onCustomHindiChange={setIsQuickCustomHindi}
                entityType="recipe"
                englishLabel={locale === 'hi' ? 'रेसिपी का नाम (अंग्रेज़ी) *' : 'Recipe Name (English) *'}
                hindiLabel={locale === 'hi' ? 'रेसिपी का नाम (हिंदी) - वैकल्पिक' : 'Recipe Name (Hindi) — Optional'}
                placeholderEnglish="e.g. Tomato Gravy Base"
                placeholderHindi="उदा. टमाटर ग्रेवी बेस"
                required
              />

              <div className="text-xs text-stone-500 bg-stone-50 p-2.5 rounded-lg border border-[#E7E2D8] flex items-center gap-2">
                <Badge variant="info" className="text-[10px]">
                  {t('sops.recipes.preparations')}
                </Badge>
                <span>{locale === 'hi' ? 'श्रेणी स्वतः बेस तैयारी (PREPARATION) पर सेट होगी' : 'Category automatically set to Base Preparation'}</span>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsQuickPrepOpen(false)}
                  disabled={quickPrepCreating}
                >
                  {t('sops.recipes.cancel')}
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={quickPrepCreating || !quickPrepName.trim()}
                  className="bg-amber-600 hover:bg-amber-700 text-white cursor-pointer"
                >
                  {quickPrepCreating ? (locale === 'hi' ? 'सहेजा जा रहा है...' : 'Creating...') : (locale === 'hi' ? 'तैयारी बनाएं' : 'Create Preparation')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

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

              <BilingualNameInput
                englishName={newForm.name}
                onChangeEnglish={(val) => setNewForm((prev) => ({ ...prev, name: val }))}
                hindiName={newForm.name_hi}
                onChangeHindi={(val) => setNewForm((prev) => ({ ...prev, name_hi: val }))}
                isCustomHindi={isCustomHindi}
                onCustomHindiChange={setIsCustomHindi}
                entityType="recipe"
                englishLabel={locale === 'hi' ? 'रेसिपी का नाम (अंग्रेज़ी)' : 'Recipe Name (English)'}
                hindiLabel={locale === 'hi' ? 'रेसिपी का नाम (हिंदी)' : 'Recipe Name (Hindi)'}
                placeholderEnglish="e.g. Makhani Gravy Base"
                placeholderHindi="उदा. मखनी ग्रेवी बेस"
                required
              />

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
                    {t('sops.recipes.yieldUnit')}
                  </label>
                  <select
                    value={newForm.batch_yield_unit}
                    onChange={(e) => setNewForm({ ...newForm, batch_yield_unit: e.target.value })}
                    className="w-full px-3 py-2 border border-[#E7E2D8] rounded-lg text-sm text-stone-900 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 cursor-pointer"
                  >
                    {['kg', 'g', 'pcs'].map((u) => (
                      <option key={u} value={u}>
                        {u === 'kg' ? (locale === 'hi' ? 'kg (किलोग्राम)' : 'kg (Kilograms)') : u === 'g' ? (locale === 'hi' ? 'g (ग्राम)' : 'g (Grams)') : (locale === 'hi' ? 'pcs (पीस)' : 'pcs (Pieces)')}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    {t('sops.recipes.portionQuantity')}
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
                    {t('sops.recipes.portionUnit')}
                  </label>
                  <select
                    value={newForm.portion_size_unit}
                    onChange={(e) => setNewForm({ ...newForm, portion_size_unit: e.target.value })}
                    className="w-full px-3 py-2 border border-[#E7E2D8] rounded-lg text-sm text-stone-900 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 cursor-pointer"
                  >
                    <option value="">{t('sops.recipes.selectUnit')}</option>
                    {getCompatibleUnitOptions('g', centralUnits, undefined, locale).map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
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
                    {groupsLoading ? (
                      <p className="p-2 text-stone-400 italic">
                        {locale === 'hi' ? 'सामग्री लोड हो रही है...' : 'Loading food raw materials...'}
                      </p>
                    ) : matchingFoodGroups.length === 0 ? (
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
                  onClick={() => {
                    setIsModalOpen(false);
                    setIsCustomHindi(false);
                  }}
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
