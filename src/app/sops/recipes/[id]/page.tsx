'use client';

import React, { useState, useEffect, use, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useI18n } from '@/lib/i18n/context';
import { useAppRole } from '@/components/layout/AppShell';
import { canViewCosting } from '@/lib/rbac';
import { formatINR } from '@/lib/utils';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { getSearchableItemText } from '@/lib/inventory/search';
import { createClient } from '@/lib/supabase/client';
import {
  getCompatibleUnitOptions,
  getUnitDimension,
  areUnitsCompatible,
  convertDirectQuantity,
  CentralUnit,
} from '@/lib/sops/costing/units';
import {
  ArrowLeft,
  UtensilsCrossed,
  Scale,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Edit2,
  Save,
  X,
  Layers,
  BookOpen,
  Share2,
  RefreshCw,
  Plus,
  Trash2,
  ExternalLink,
  ArrowUp,
  ArrowDown,
  Info,
  Search,
} from 'lucide-react';

interface RecipeDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function RecipeDetailPage({ params }: RecipeDetailPageProps) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const { hasPermission, role: activeRole, permissions } = useAppRole();
  const router = useRouter();

  const canManage = hasPermission('sops.recipes.manage');
  const hasCostAccess = canViewCosting(activeRole, permissions);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [recipe, setRecipe] = useState<any>(null);
  const [canonicalDish, setCanonicalDish] = useState<any>(null);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [selectedFormulationId, setSelectedFormulationId] = useState<string | null>(null);
  const [calculation, setCalculation] = useState<any>(null);
  const [whereUsed, setWhereUsed] = useState<{
    recipes: any[];
    menuItems: any[];
    combos: any[];
  }>({ recipes: [], menuItems: [], combos: [] });

  // Quick Add & Conversions
  const [quickSearch, setQuickSearch] = useState('');
  const [conversionModalOpen, setConversionModalOpen] = useState(false);
  const [conversionsList, setConversionsList] = useState<any[]>([]);

  // Conversion creation form state
  const [newConvGroupId, setNewConvGroupId] = useState('');
  const [newConvFromUnit, setNewConvFromUnit] = useState('');
  const [newConvToUnit, setNewConvToUnit] = useState('g');
  const [newConvMultiplier, setNewConvMultiplier] = useState('');
  const [newConvNotes, setNewConvNotes] = useState('');
  const [convSaving, setConvSaving] = useState(false);
  const [convError, setConvError] = useState<string | null>(null);

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [editableIngredients, setEditableIngredients] = useState<any[]>([]);

  // Master data for editing
  const [foodGroups, setFoodGroups] = useState<any[]>([]);
  const [aliasesMap, setAliasesMap] = useState<Record<string, string[]>>({});
  const [allRecipes, setAllRecipes] = useState<any[]>([]);
  const [centralUnits, setCentralUnits] = useState<CentralUnit[]>([]);
  const [mastersLoaded, setMastersLoaded] = useState(false);
  const [mastersLoading, setMastersLoading] = useState(false);

  // Dialog states for category transitions and delete
  const [blockerDialog, setBlockerDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    items: string[];
  } | null>(null);

  const [warningDialog, setWarningDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    items: string[];
    onConfirm: () => void;
  } | null>(null);

  const loadMasters = async () => {
    if (mastersLoaded || mastersLoading) return;
    setMastersLoading(true);
    try {
      const supabase = createClient();
      const [grpRes, dishesRes, unitRes, convRes] = await Promise.all([
        fetch('/api/inventory/groups?class=Food Raw Material').then((r) => r.ok ? r.json() : { groups: [], aliasesMap: {} }),
        fetch('/api/sops/dishes').then((r) => r.ok ? r.json() : { dishes: [] }),
        supabase.from('units').select('id, name, name_hi, symbol, symbol_hi, is_active').eq('is_active', true).order('name'),
        fetch('/api/sops/conversions').then((r) => r.ok ? r.json() : { conversions: [] }),
      ]);
      setFoodGroups(grpRes.groups || []);
      setAliasesMap(grpRes.aliasesMap || {});
      const rawDishes = dishesRes.dishes || [];
      const mappedDishes = rawDishes.map((d: any) => {
        const form = d.formulations?.find((f: any) => f.id === d.default_formulation_id) || d.formulations?.[0];
        const batchYield = form?.batch_yield_quantity != null ? Number(form.batch_yield_quantity) : null;
        const batchCost = form?.batch_cost != null ? Number(form.batch_cost) : null;
        return {
          id: d.id,
          name: d.name,
          name_hi: d.name_hi,
          category: d.category,
          batch_yield_quantity: batchYield,
          batch_yield_unit: form?.batch_yield_unit || 'kg',
          total_batch_cost: batchCost,
          cost_per_output_unit: (batchCost != null && batchYield && batchYield > 0) ? Math.round((batchCost / batchYield) * 100) / 100 : null,
        };
      });
      setAllRecipes(mappedDishes);
      if (unitRes.data) setCentralUnits(unitRes.data as CentralUnit[]);
      if (convRes.conversions) setConversionsList(convRes.conversions);
      setMastersLoaded(true);
    } catch (err) {
      console.error('Failed to load recipe masters:', err);
    } finally {
      setMastersLoading(false);
    }
  };

  const fetchRecipeDetail = async () => {
    setLoading(true);
    setError(null);
    try {
      let res = await fetch(`/api/sops/dishes/${id}`);
      let is4Tier = true;
      if (!res.ok) {
        res = await fetch(`/api/sops/recipes/${id}`);
        is4Tier = false;
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to fetch recipe details');
      }
      const data = await res.json();

      if (is4Tier && data.dish) {
        const dish = data.dish;
        const defaultForm = dish.formulations?.find((f: any) => f.id === (selectedFormulationId || dish.default_formulation_id)) || dish.formulations?.[0];
        const defaultCfg = dish.configurations?.find((c: any) => c.id === selectedConfigId) || dish.configurations?.[0];

        const mappedRecipe = {
          id: dish.id,
          name: dish.name,
          name_hi: dish.name_hi,
          category: dish.category,
          is_preparation: dish.is_preparation,
          batch_yield_quantity: defaultForm?.batch_yield_quantity ?? null,
          batch_yield_unit: defaultForm?.batch_yield_unit || 'kg',
          portion_size_quantity: defaultCfg?.portion_size_quantity ?? null,
          portion_size_unit: defaultCfg?.portion_size_unit || 'g',
          description: dish.description || null,
          ingredients: (defaultForm?.ingredients || []).map((fi: any) => ({
            id: fi.id,
            ingredient_type: fi.ingredient_type,
            ingredient_group_id: fi.ingredient_group_id,
            inventory_item_id: fi.inventory_item_id,
            sub_recipe_id: fi.sub_preparation_dish_id || fi.sub_recipe_id,
            quantity: fi.quantity,
            unit: fi.unit,
            sort_order: fi.sort_order,
            notes: fi.notes,
            ingredient_group: fi.ingredient_group,
            inventory_item: fi.inventory_item,
            sub_recipe: fi.sub_preparation_dish || fi.sub_recipe,
            unit_rate: fi.unit_rate,
            line_cost: fi.line_cost,
          })),
          formulations: dish.formulations || [],
          configurations: dish.configurations || [],
          default_formulation_id: dish.default_formulation_id,
        };

        setRecipe(mappedRecipe);
        setCanonicalDish(dish);
        if (defaultCfg?.id) setSelectedConfigId(defaultCfg.id);
        if (defaultForm?.id) setSelectedFormulationId(defaultForm.id);

        const batchCost = defaultForm?.batch_cost != null ? Number(defaultForm.batch_cost) : null;
        const yieldQty = defaultForm?.batch_yield_quantity != null ? Number(defaultForm.batch_yield_quantity) : null;
        const unitCost = (batchCost != null && yieldQty && yieldQty > 0) ? Math.round((batchCost / yieldQty) * 100) / 100 : null;
        const servingCost = defaultCfg?.serving_cost != null ? Number(defaultCfg.serving_cost) : null;
        const portionQty = defaultCfg?.portion_size_quantity != null ? Number(defaultCfg.portion_size_quantity) : null;
        const servingsPerBatch = (yieldQty && portionQty && portionQty > 0)
          ? Math.round((yieldQty / (defaultCfg.portion_size_unit === 'kg' ? portionQty : portionQty / 1000)) * 10) / 10
          : null;

        setCalculation({
          status: defaultForm?.costing_status || 'UNCOSTED',
          totalBatchCost: batchCost,
          costPerOutputUnit: unitCost,
          costPerServing: servingCost,
          servingsPerBatch: servingsPerBatch,
          reasons: defaultForm?.costing_reasons || [],
          ingredientLineCosts: (defaultForm?.ingredients || []).map((fi: any) => ({
            ingredientName: fi.ingredient_group?.name || fi.inventory_item?.name || fi.sub_preparation_dish?.name,
            unitRate: fi.unit_rate,
            lineCost: fi.line_cost,
            status: fi.line_cost != null ? 'COSTED_ELIGIBLE' : 'UNCOSTED',
            rateUnit: fi.ingredient_group?.base_unit?.symbol || fi.sub_preparation_dish?.batch_yield_unit || fi.unit,
          })),
        });

        setWhereUsed({
          recipes: (data.whereUsed?.formulations || []).map((f: any) => ({
            id: f.dishId,
            name: f.dishName,
            category: f.dishCategory,
            quantity: f.quantity,
            unit: f.unit,
          })),
          menuItems: data.whereUsed?.menuItems || [],
          combos: data.whereUsed?.combos || [],
        });

        setEditForm({
          name: dish.name,
          name_hi: dish.name_hi || '',
          category: dish.category,
          batch_yield_quantity: defaultForm?.batch_yield_quantity ?? '',
          batch_yield_unit: defaultForm?.batch_yield_unit || 'kg',
          portion_size_quantity: defaultCfg?.portion_size_quantity ?? '',
          portion_size_unit: defaultCfg?.portion_size_unit || 'g',
          notes: dish.description || '',
        });
      } else {
        setRecipe(data.recipe);
        setCanonicalDish(data.canonicalDish || null);
        if (data.canonicalDish?.configurations?.length) {
          setSelectedConfigId(data.canonicalDish.configurations[0].id);
        }
        if (data.canonicalDish?.formulations?.length) {
          setSelectedFormulationId(data.canonicalDish.formulations[0].id);
        }
        setCalculation(data.calculation);
        setWhereUsed(data.whereUsed || { recipes: [], menuItems: [], combos: [] });
        setEditForm({
          name: data.recipe.name,
          name_hi: data.recipe.name_hi || '',
          category: data.recipe.category,
          batch_yield_quantity: data.recipe.batch_yield_quantity || '',
          batch_yield_unit: data.recipe.batch_yield_unit || '',
          portion_size_quantity: data.recipe.portion_size_quantity || '',
          portion_size_unit: data.recipe.portion_size_unit || '',
          notes: data.recipe.notes || '',
        });
      }
    } catch (err: any) {
      console.error('Fetch recipe error:', err);
      setError(err.message || 'Error fetching recipe');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) fetchRecipeDetail();
  }, [id]);

  const handleStartEdit = () => {
    loadMasters();
    const rows = (recipe?.ingredients || []).map((ing: any, idx: number) => ({
      tempId: ing.id || `ing_${idx}_${Date.now()}`,
      ingredient_type: ing.ingredient_type,
      ingredient_group_id: ing.ingredient_group_id || ing.ingredient_group?.id || null,
      sub_recipe_id: ing.sub_recipe_id || ing.sub_recipe?.id || null,
      quantity: ing.quantity,
      unit: ing.unit,
      sort_order: ing.sort_order ?? idx + 1,
      notes: ing.notes || '',
      base_unit_symbol: ing.ingredient_group?.base_unit?.symbol || ing.sub_recipe?.batch_yield_unit || ing.unit,
      selected_item_name: ing.ingredient_type === 'PREPARATION' ? ing.sub_recipe?.name : ing.ingredient_group?.name,
      selected_item_name_hi: ing.ingredient_type === 'PREPARATION' ? ing.sub_recipe?.name_hi : ing.ingredient_group?.name_hi,
    }));
    setEditableIngredients(rows);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditForm({
      name: recipe?.name || '',
      name_hi: recipe?.name_hi || '',
      category: recipe?.category || 'PREPARATION',
      batch_yield_quantity: recipe?.batch_yield_quantity || '',
      batch_yield_unit: recipe?.batch_yield_unit || '',
      portion_size_quantity: recipe?.portion_size_quantity || '',
      portion_size_unit: recipe?.portion_size_unit || '',
      instructions: recipe?.instructions || '',
      notes: recipe?.notes || '',
    });
  };

  const handleAddIngredient = (type: 'RAW_MATERIAL' | 'PREPARATION') => {
    loadMasters();
    setEditableIngredients((prev) => [
      ...prev,
      {
        tempId: `new_${Date.now()}_${Math.random()}`,
        ingredient_type: type,
        ingredient_group_id: null,
        sub_recipe_id: null,
        quantity: '',
        unit: type === 'PREPARATION' ? 'kg' : 'g',
        sort_order: prev.length + 1,
        notes: '',
        base_unit_symbol: type === 'PREPARATION' ? 'kg' : 'g',
      },
    ]);
  };

  const handleRemoveIngredient = (index: number) => {
    setEditableIngredients((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleMoveIngredient = (index: number, direction: 'up' | 'down') => {
    setEditableIngredients((prev) => {
      const next = [...prev];
      const targetIdx = direction === 'up' ? index - 1 : index + 1;
      if (targetIdx < 0 || targetIdx >= next.length) return prev;
      const temp = next[index];
      next[index] = next[targetIdx];
      next[targetIdx] = temp;
      return next.map((row, idx) => ({ ...row, sort_order: idx + 1 }));
    });
  };

  const handleUpdateIngredient = (index: number, updates: any) => {
    setEditableIngredients((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...updates };
      return next;
    });
  };

  const handleCategoryChange = (newCat: string) => {
    if (newCat === editForm.category) return;
    if (newCat === 'FINAL_DISH') {
      if (whereUsed.recipes.length > 0) {
        setBlockerDialog({
          open: true,
          title: t('sops.recipeDetail.categoryChangeBlockTitle'),
          message: t('sops.recipeDetail.categoryChangeBlockDesc'),
          items: whereUsed.recipes.map((r: any) => r.name),
        });
        return;
      }
    } else if (editForm.category === 'FINAL_DISH' && newCat === 'PREPARATION') {
      if (whereUsed.menuItems.length > 0 || whereUsed.combos.length > 0) {
        setWarningDialog({
          open: true,
          title: locale === 'hi' ? 'श्रेणी परिवर्तन चेतावनी' : 'Category Change Warning',
          message: locale === 'hi'
            ? 'इस रेसिपी से मेन्यू आइटम या कॉम्बो जुड़े हैं। पूर्व-तैयारी में बदलने पर सुनिश्चित करें कि बैच यील्ड सही है।'
            : 'Active menu items or combos are linked to this dish. Converting to Preparation will treat it as a sub-assembly.',
          items: [
            ...whereUsed.menuItems.map((m: any) => `Menu: ${m.menuItemName || m.name}`),
            ...whereUsed.combos.map((c: any) => `Combo: ${c.name || c.componentName}`),
          ],
          onConfirm: () => {
            setEditForm((prev: any) => ({ ...prev, category: newCat }));
          },
        });
        return;
      }
    }
    setEditForm((prev: any) => ({ ...prev, category: newCat }));
  };

  const handleSaveRecipe = async () => {
    // 1. Check yield unit for invalid unit
    if (editForm.batch_yield_unit && getUnitDimension(editForm.batch_yield_unit) === 'UNKNOWN') {
      alert(`Invalid Batch Yield Unit: '${editForm.batch_yield_unit}'. Please select a valid unit from the dropdown.`);
      return;
    }

    // 2. Check category transitions across all 12 transitions
    if (recipe.category !== editForm.category) {
      // RULE A: Transitions TO FINAL_DISH
      if (editForm.category === 'FINAL_DISH') {
        if (whereUsed.recipes.length > 0) {
          setBlockerDialog({
            open: true,
            title: t('sops.recipeDetail.categoryChangeBlockTitle'),
            message: t('sops.recipeDetail.categoryChangeBlockDesc'),
            items: whereUsed.recipes.map((r: any) => r.name),
          });
          return;
        }
        if (!editForm.portion_size_quantity || Number(editForm.portion_size_quantity) <= 0 || !editForm.portion_size_unit) {
          alert('Cannot change category to FINAL_DISH: recipe requires a positive portion size quantity and a valid portion size unit.');
          return;
        }
      }

      // RULE B: Transitions FROM FINAL_DISH
      if (recipe.category === 'FINAL_DISH' && editForm.category !== 'FINAL_DISH') {
        const hasYield = editForm.batch_yield_quantity && Number(editForm.batch_yield_quantity) > 0 && editForm.batch_yield_unit;
        if (whereUsed.menuItems.length > 0 && !hasYield) {
          alert(`Cannot change category from FINAL_DISH to ${editForm.category}: recipe is linked to ${whereUsed.menuItems.length} active menu item variant(s) and requires finished batch yield quantity and unit for variant costing.`);
          return;
        }
        if (whereUsed.combos.length > 0 && !hasYield) {
          alert(`Cannot change category from FINAL_DISH to ${editForm.category}: recipe is linked to ${whereUsed.combos.length} combo/thali component(s) and requires finished batch yield quantity and unit for component costing.`);
          return;
        }
      }

      // RULE C: Transitions between yield-based categories
      if (recipe.category !== 'FINAL_DISH' && editForm.category !== 'FINAL_DISH') {
        const hasYield = editForm.batch_yield_quantity && Number(editForm.batch_yield_quantity) > 0 && editForm.batch_yield_unit;
        if ((whereUsed.combos.length > 0 || whereUsed.recipes.length > 0) && !hasYield) {
          alert(`Cannot change category to ${editForm.category}: recipe has active dependencies and requires finished batch yield quantity and unit.`);
          return;
        }
      }
    }

    // 3. Check ingredient validation
    for (let i = 0; i < editableIngredients.length; i++) {
      const row = editableIngredients[i];
      if (row.ingredient_type === 'RAW_MATERIAL' && !row.ingredient_group_id) {
        alert(`Ingredient line ${i + 1}: Please select a Raw Material.`);
        return;
      }
      if (row.ingredient_type === 'PREPARATION' && !row.sub_recipe_id) {
        alert(`Ingredient line ${i + 1}: Please select a Sub-Preparation.`);
        return;
      }
      const qty = Number(row.quantity);
      if (isNaN(qty) || qty <= 0) {
        alert(`Ingredient line ${i + 1}: Quantity must be greater than 0.`);
        return;
      }
      if (!row.unit || !row.unit.trim()) {
        alert(`Ingredient line ${i + 1}: Please select a Unit.`);
        return;
      }
    }

    const sanitizedIngredients = editableIngredients.map((row, idx) => ({
      ingredient_type: row.ingredient_type,
      ingredient_group_id: row.ingredient_type === 'RAW_MATERIAL' ? row.ingredient_group_id : null,
      sub_recipe_id: row.ingredient_type === 'PREPARATION' ? row.sub_recipe_id : null,
      quantity: Number(row.quantity),
      unit: row.unit.trim(),
      sort_order: idx + 1,
      notes: row.notes?.trim() || null,
    }));

    setSaving(true);
    try {
      // 1. Update 4-tier canonical dish
      const dishRes = await fetch(`/api/sops/dishes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name,
          name_hi: editForm.name_hi || null,
          category: editForm.category,
          description: editForm.notes || null,
          configurations: editForm.category === 'FINAL_DISH' && editForm.portion_size_quantity ? [
            {
              id: canonicalDish?.configurations?.[0]?.id,
              name: 'Standard',
              portion_size_quantity: Number(editForm.portion_size_quantity),
              portion_size_unit: editForm.portion_size_unit || 'g',
            }
          ] : [],
        }),
      });

      // 2. Update 4-tier recipe formulation
      const formulationId = selectedFormulationId || canonicalDish?.default_formulation_id || canonicalDish?.formulations?.[0]?.id;
      if (formulationId) {
        await fetch(`/api/sops/formulations/${formulationId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            batch_yield_quantity: editForm.batch_yield_quantity ? Number(editForm.batch_yield_quantity) : null,
            batch_yield_unit: editForm.batch_yield_unit || null,
            ingredients: sanitizedIngredients.map((ing) => ({
              ingredient_type: ing.ingredient_type,
              ingredient_group_id: ing.ingredient_group_id,
              sub_preparation_dish_id: ing.sub_recipe_id,
              quantity: ing.quantity,
              unit: ing.unit,
              sort_order: ing.sort_order,
              notes: ing.notes,
            })),
          }),
        });
      }

      // 3. Mirror update to legacy yatra_recipes for compatibility
      await fetch(`/api/sops/recipes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name,
          name_hi: editForm.name_hi || null,
          category: editForm.category,
          batch_yield_quantity: editForm.batch_yield_quantity ? Number(editForm.batch_yield_quantity) : null,
          batch_yield_unit: editForm.batch_yield_unit || null,
          portion_size_quantity: editForm.portion_size_quantity ? Number(editForm.portion_size_quantity) : null,
          portion_size_unit: editForm.portion_size_unit || null,
          notes: editForm.notes || null,
          ingredients: sanitizedIngredients,
        }),
      }).catch(() => {});

      if (!dishRes.ok) {
        const data = await dishRes.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update recipe');
      }

      setIsEditing(false);
      await fetchRecipeDetail();
    } catch (err: any) {
      alert(`Error updating recipe: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleInitiateDelete = async () => {
    // Check active dependencies in whereUsed
    const activeVariants = (whereUsed.menuItems || []).filter((m: any) => m.is_active !== false);
    const activeCombos = whereUsed.combos || [];
    const activeFormulations = whereUsed.recipes || [];

    const hasDeps = activeVariants.length > 0 || activeCombos.length > 0 || activeFormulations.length > 0;
    if (hasDeps) {
      const items: string[] = [
        ...activeVariants.map((m: any) => `Menu Item: ${m.menuItemName || m.name}`),
        ...activeCombos.map((c: any) => `Combo: ${c.name || c.menuItemName}`),
        ...activeFormulations.map((f: any) => `Parent Recipe: ${f.name}`),
      ];
      setBlockerDialog({
        open: true,
        title: locale === 'hi' ? 'हटाना अवरुद्ध: सक्रिय निर्भरताएं मौजूद हैं' : 'Cannot Delete: Active Dependencies Exist',
        message: locale === 'hi'
          ? 'इस रेसिपी को हटाया या संग्रहीत नहीं किया जा सकता क्योंकि अन्य मेन्यू आइटम या रेसिपी इस पर निर्भर हैं। कृपया पहले इन निर्भरताओं को हटाएं:'
          : 'This recipe SOP cannot be deleted or archived while active items depend on it. Please unlink or reassign the following items first:',
        items,
      });
      return;
    }

    setWarningDialog({
      open: true,
      title: locale === 'hi' ? 'रेसिपी संग्रहीत करें?' : 'Archive Recipe SOP?',
      message: locale === 'hi'
        ? `क्या आप वाकई "${recipe?.name}" को संग्रहीत करना चाहते हैं? यह निष्क्रिय हो जाएगा और सक्रिय सूचियों से हटा दिया जाएगा।`
        : `Are you sure you want to archive "${recipe?.name}"? It will be marked inactive and removed from active recipe lists.`,
      items: [],
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/sops/dishes/${id}`, { method: 'DELETE' });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) {
            alert(json.error || 'Failed to archive recipe');
            return;
          }
          alert(json.message || 'Recipe successfully archived');
          router.push('/sops/recipes');
        } catch (err: any) {
          alert(`Error archiving recipe: ${err.message}`);
        }
      },
    });
  };

  // Helper to compute live costing for an ingredient row
  const getIngredientLiveCost = (row: any) => {
    if (!row.quantity || Number(row.quantity) <= 0 || !row.unit) {
      return { rate: null, rateUnit: '', lineCost: null, conversionError: false, errorMsg: '' };
    }
    const qty = Number(row.quantity);

    if (row.ingredient_type === 'RAW_MATERIAL') {
      const group = foodGroups.find((g) => g.id === row.ingredient_group_id);
      if (!group) return { rate: null, rateUnit: '', lineCost: null, conversionError: false, errorMsg: '' };
      const rate = group.current_weighted_average_cost ?? group.wac ?? null;
      const baseUnit = group.base_unit?.symbol || 'g';
      if (rate == null) {
        return { rate: null, rateUnit: baseUnit, lineCost: null, conversionError: false, errorMsg: 'Uncosted raw material' };
      }
      // Check verified conversions first
      const verified = conversionsList.find((c: any) =>
        (c.ingredient_group_id === group.id || c.inventory_item_id === row.inventory_item_id) &&
        c.from_unit?.toLowerCase() === row.unit?.toLowerCase() &&
        c.to_unit?.toLowerCase() === baseUnit.toLowerCase()
      );
      if (verified && (verified.conversion_factor || verified.multiplier)) {
        const factor = Number(verified.conversion_factor || verified.multiplier);
        const lineCost = qty * factor * Number(rate);
        return { rate: Number(rate), rateUnit: baseUnit, lineCost: Math.round(lineCost * 100) / 100, conversionError: false, errorMsg: '' };
      }

      const conv = convertDirectQuantity(qty, row.unit, baseUnit);
      if (conv.possible && conv.converted !== undefined) {
        const lineCost = conv.converted * Number(rate);
        return { rate: Number(rate), rateUnit: baseUnit, lineCost: Math.round(lineCost * 100) / 100, conversionError: false, errorMsg: '' };
      } else {
        return { rate: Number(rate), rateUnit: baseUnit, lineCost: null, conversionError: true, errorMsg: `Cannot convert ${row.unit} to ${baseUnit}` };
      }
    } else {
      // PREPARATION: resolve against sub-recipe unit costs instead of foodGroups!
      const sub = allRecipes.find((r) => r.id === row.sub_recipe_id || r.id === row.sub_preparation_dish_id);
      if (!sub) return { rate: null, rateUnit: '', lineCost: null, conversionError: false, errorMsg: '' };
      const rate = sub.cost_per_output_unit ?? (sub.total_batch_cost && sub.batch_yield_quantity ? sub.total_batch_cost / sub.batch_yield_quantity : null);
      const baseUnit = sub.batch_yield_unit || 'kg';
      if (rate == null) {
        return { rate: null, rateUnit: baseUnit, lineCost: null, conversionError: false, errorMsg: 'Uncosted sub-preparation' };
      }
      const conv = convertDirectQuantity(qty, row.unit, baseUnit);
      if (conv.possible && conv.converted !== undefined) {
        const lineCost = conv.converted * Number(rate);
        return { rate: Number(rate), rateUnit: baseUnit, lineCost: Math.round(lineCost * 100) / 100, conversionError: false, errorMsg: '' };
      } else {
        return { rate: Number(rate), rateUnit: baseUnit, lineCost: null, conversionError: true, errorMsg: `Cannot convert ${row.unit} to ${baseUnit}` };
      }
    }
  };

  const liveBatchCost = useMemo(() => {
    let sum = 0;
    let hasValid = false;
    for (const row of editableIngredients) {
      const res = getIngredientLiveCost(row);
      if (res.lineCost != null) {
        sum += res.lineCost;
        hasValid = true;
      }
    }
    return hasValid ? Math.round(sum * 100) / 100 : null;
  }, [editableIngredients, foodGroups, allRecipes, conversionsList]);

  const liveCostPerOutputUnit = useMemo(() => {
    if (liveBatchCost != null && Number(editForm.batch_yield_quantity) > 0) {
      return Math.round((liveBatchCost / Number(editForm.batch_yield_quantity)) * 100) / 100;
    }
    return null;
  }, [liveBatchCost, editForm.batch_yield_quantity]);

  const formattedFoodGroups = useMemo(() => {
    return foodGroups.map((g) => {
      const rate = g.current_weighted_average_cost ?? g.wac ?? null;
      const unitSymbol = g.base_unit?.symbol || 'g';
      const rateLabel = rate != null && Number(rate) > 0 ? ` — ₹${Math.round(Number(rate))}/${unitSymbol}` : '';
      return {
        ...g,
        display_label: `${g.name}${rateLabel}`,
      };
    });
  }, [foodGroups]);

  const formattedPreparations = useMemo(() => {
    return allRecipes.filter((r) => r.id !== recipe?.id).map((r) => {
      const rate = r.cost_per_output_unit ?? (r.total_batch_cost && r.batch_yield_quantity ? r.total_batch_cost / r.batch_yield_quantity : null);
      const unitSymbol = r.batch_yield_unit || 'kg';
      const rateLabel = rate != null && Number(rate) > 0 ? ` — ₹${Math.round(Number(rate))}/${unitSymbol}` : '';
      return {
        ...r,
        display_label: `${r.name}${rateLabel}`,
      };
    });
  }, [allRecipes, recipe?.id]);

  const handleQuickAddPrepInline = async (idx: number, term: string) => {
    try {
      const res = await fetch('/api/sops/dishes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: term.trim(),
          category: 'PREPARATION',
          batch_yield_unit: 'kg',
          ingredients: [],
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to create preparation');
      }
      const d = await res.json();
      const newDish = d.dish;
      setAllRecipes((prev) => [...prev, newDish]);
      handleUpdateIngredient(idx, {
        sub_recipe_id: newDish.id,
        selected_item_name: newDish.name,
        selected_item_name_hi: newDish.name_hi,
        unit: 'kg',
        base_unit_symbol: 'kg',
      });
    } catch (err: any) {
      alert(`Error creating preparation: ${err.message}`);
    }
  };

  const handleOpenConversionModalFor = (row: any) => {
    if (row.ingredient_group_id) {
      setNewConvGroupId(row.ingredient_group_id);
    }
    if (row.unit) {
      setNewConvFromUnit(row.unit);
    }
    if (row.base_unit_symbol) {
      setNewConvToUnit(row.base_unit_symbol);
    }
    setConversionModalOpen(true);
  };

  const handleSaveConversion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newConvGroupId || !newConvFromUnit || !newConvToUnit || !newConvMultiplier) {
      setConvError('All conversion fields are required');
      return;
    }
    setConvSaving(true);
    setConvError(null);
    try {
      const res = await fetch('/api/sops/conversions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ingredient_group_id: newConvGroupId,
          from_unit: newConvFromUnit.trim(),
          to_unit: newConvToUnit.trim(),
          conversion_factor: Number(newConvMultiplier),
          notes: newConvNotes.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save conversion');
      setConversionsList((prev) => [data.conversion, ...prev]);
      setNewConvFromUnit('');
      setNewConvMultiplier('');
      setNewConvNotes('');
      const ref = await fetch('/api/sops/conversions').then((r) => r.ok ? r.json() : { conversions: [] });
      if (ref.conversions) setConversionsList(ref.conversions);
    } catch (err: any) {
      setConvError(err.message || 'Error saving conversion');
    } finally {
      setConvSaving(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'COSTED_ELIGIBLE':
        return (
          <Badge variant="success" className="gap-1 font-mono text-xs">
            <CheckCircle2 className="h-3.5 w-3.5" /> {t('sops.statuses.COSTED_ELIGIBLE')}
          </Badge>
        );
      case 'UNCOSTED':
        return (
          <Badge variant="warning" className="gap-1 font-mono text-xs">
            <AlertTriangle className="h-3.5 w-3.5" /> {t('sops.statuses.UNCOSTED')}
          </Badge>
        );
      case 'COSTING_INCOMPLETE':
        return (
          <Badge variant="danger" className="gap-1 font-mono text-xs">
            <AlertTriangle className="h-3.5 w-3.5" /> {t('sops.statuses.COSTING_INCOMPLETE')}
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="gap-1 font-mono text-xs">
            {t('sops.statuses.INELIGIBLE')}
          </Badge>
        );
    }
  };

  const getCategoryBadge = (category: string) => {
    switch (category) {
      case 'PREPARATION':
        return <Badge variant="info">{t('sops.recipes.preparations')}</Badge>;
      case 'FINAL_DISH':
        return <Badge variant="purple">{t('sops.recipes.finalDishes')}</Badge>;
      case 'COMBO_PORTION':
        return <Badge variant="maroon">{t('sops.recipes.comboPortions')}</Badge>;
      case 'BULK_CATERING':
        return <Badge variant="warning">{t('sops.recipes.bulkCatering')}</Badge>;
      default:
        return <Badge variant="outline">{category}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="p-16 text-center text-stone-500 flex flex-col items-center gap-3">
        <RefreshCw className="h-8 w-8 animate-spin text-amber-600" />
        <p className="text-sm font-medium">{locale === 'hi' ? 'रेसिपी लोड हो रही है...' : 'Loading recipe details...'}</p>
      </div>
    );
  }

  if (error || !recipe) {
    return (
      <div className="space-y-4">
        <Link href="/sops/recipes">
          <Button variant="ghost" size="sm" className="gap-1 text-stone-600">
            <ArrowLeft className="h-4 w-4" /> {t('sops.recipeDetail.backToRecipes')}
          </Button>
        </Link>
        <div className="p-8 text-center text-rose-600 bg-rose-50 rounded-xl border border-rose-200">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-rose-500" />
          <p className="font-semibold">{error || 'Recipe not found'}</p>
        </div>
      </div>
    );
  }

  const ingredients = recipe.ingredients || [];
  const lineCosts = calculation?.ingredientLineCosts || [];

  return (
    <div className={`space-y-6 ${isEditing ? 'pb-24' : ''}`}>
      {/* Sticky Top Nav & Header Bar */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-xs py-3 -mx-4 px-4 sm:-mx-6 sm:px-6 border-b border-[#E7E2D8] flex items-center justify-between shadow-2xs">
        <div className="flex items-center gap-3 truncate">
          <Link href="/sops/recipes">
            <Button variant="ghost" size="sm" className="gap-1.5 text-stone-600 hover:text-stone-900">
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">{t('sops.recipeDetail.backToRecipes')}</span>
            </Button>
          </Link>
          <div className="h-4 w-px bg-[#E7E2D8] hidden sm:block" />
          <h1 className="text-lg font-bold text-stone-900 truncate">
            {recipe.name}
          </h1>
          {recipe.name_hi && (
            <span className="text-xs text-stone-500 font-sans hidden md:inline">({recipe.name_hi})</span>
          )}
          {calculation && getStatusBadge(calculation.status)}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const supabase = createClient();
              const { data } = await supabase.from('yatra_ingredient_unit_conversions').select('*');
              setConversionsList(data || []);
              setConversionModalOpen(true);
            }}
            className="text-xs gap-1 border-stone-300 text-stone-700 hover:bg-stone-50 cursor-pointer"
          >
            <Scale className="h-3.5 w-3.5 text-amber-600" />
            <span className="hidden sm:inline">Unit Conversions</span>
          </Button>

          {canManage && !isEditing && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleInitiateDelete}
              className="gap-1.5 border-rose-200 text-rose-600 hover:text-rose-700 hover:bg-rose-50 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5 text-rose-500" />
              <span>{locale === 'hi' ? 'संग्रहीत करें' : 'Archive / Delete'}</span>
            </Button>
          )}

          {canManage && (
            isEditing ? (
              <>
                <Button variant="outline" size="sm" onClick={handleCancelEdit} disabled={saving}>
                  <X className="h-3.5 w-3.5 mr-1" />
                  {t('sops.recipes.cancel')}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSaveRecipe}
                  disabled={saving}
                  className="bg-amber-600 hover:bg-amber-700 text-white cursor-pointer"
                >
                  <Save className="h-3.5 w-3.5 mr-1" />
                  {saving ? 'Saving...' : t('sops.recipes.save')}
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={handleStartEdit} className="gap-1.5 cursor-pointer">
                <Edit2 className="h-3.5 w-3.5" />
                {t('sops.recipes.edit')}
              </Button>
            )
          )}
        </div>
      </div>

      {/* Multi-Configuration Tabs (A La Carte, Combo, Thali) */}
      {canonicalDish?.configurations && canonicalDish.configurations.length > 0 && (
        <div className="bg-white border border-[#E7E2D8] rounded-xl p-4 shadow-2xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-amber-600" />
              <span className="text-xs font-bold uppercase tracking-wider text-stone-700">
                Serving Configurations ({canonicalDish.configurations.length})
              </span>
            </div>
            <span className="text-[11px] text-stone-400">Portion size & food cost per serving</span>
          </div>

          <div className="flex overflow-x-auto gap-2 pb-1">
            {canonicalDish.configurations.map((cfg: any) => {
              const isSelected = selectedConfigId === cfg.id || (!selectedConfigId && canonicalDish.configurations[0]?.id === cfg.id);
              const batchCost = calculation?.totalBatchCost;
              const yieldQty = Number(recipe.batch_yield_quantity) || 0;
              const yieldUnit = recipe.batch_yield_unit || 'kg';
              let cfgCost: number | null = null;
              if (batchCost && yieldQty > 0 && cfg.portion_size_quantity) {
                let portionInYieldUnit = Number(cfg.portion_size_quantity);
                if (yieldUnit === 'kg' && cfg.portion_size_unit === 'g') portionInYieldUnit /= 1000;
                else if (yieldUnit === 'g' && cfg.portion_size_unit === 'kg') portionInYieldUnit *= 1000;
                cfgCost = (batchCost / yieldQty) * portionInYieldUnit;
              }

              return (
                <div
                  key={cfg.id}
                  onClick={() => setSelectedConfigId(cfg.id)}
                  className={`p-3 rounded-xl border text-xs cursor-pointer min-w-[200px] flex-1 transition-all ${
                    isSelected
                      ? 'border-amber-500 bg-amber-50/60 shadow-xs'
                      : 'border-[#E7E2D8] bg-[#FAF8F5] hover:border-stone-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-bold text-stone-900">{cfg.name}</span>
                    <Badge variant={isSelected ? 'warning' : 'outline'} className="text-[10px] font-mono">
                      {cfg.portion_size_quantity} {cfg.portion_size_unit}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between pt-1.5 border-t border-stone-200/60">
                    <span className="text-[11px] text-stone-500">Portion Food Cost:</span>
                    <span className="font-mono font-bold text-emerald-700">
                      {!hasCostAccess ? (
                        <Lock className="h-3 w-3 inline text-stone-400" />
                      ) : cfgCost != null ? (
                        formatINR(Math.round(cfgCost * 100) / 100)
                      ) : (
                        '—'
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Multi-Formulation Cards */}
      {canonicalDish?.formulations && canonicalDish.formulations.length > 1 && (
        <div className="bg-white border border-[#E7E2D8] rounded-xl p-4 shadow-2xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UtensilsCrossed className="h-4 w-4 text-purple-600" />
              <span className="text-xs font-bold uppercase tracking-wider text-stone-700">
                Formulations & Chef Versions ({canonicalDish.formulations.length})
              </span>
            </div>
            <span className="text-[11px] text-stone-400">Multiple chef formulations for this dish</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {canonicalDish.formulations.map((f: any) => {
              const isSelected = selectedFormulationId === f.id || (!selectedFormulationId && canonicalDish.formulations[0]?.id === f.id);
              return (
                <div
                  key={f.id}
                  onClick={() => setSelectedFormulationId(f.id)}
                  className={`p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                    isSelected
                      ? 'border-purple-500 bg-purple-50/50 shadow-xs'
                      : 'border-[#E7E2D8] bg-[#FAF8F5] hover:border-stone-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-stone-900">{f.name}</span>
                    <Badge variant="outline" className="text-[9px] font-mono">v{f.version_number || 1}</Badge>
                  </div>
                  <div className="flex items-center justify-between text-stone-500 font-mono text-[11px]">
                    <span>Yield: {f.batch_yield_quantity || '—'} {f.batch_yield_unit}</span>
                    <Badge variant={f.is_active ? 'success' : 'outline'} className="text-[9px]">
                      {f.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-white border border-[#E7E2D8] rounded-xl p-6 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-stone-900 tracking-tight">
              {recipe.name}
            </h1>
            {getCategoryBadge(recipe.category)}
            {calculation && getStatusBadge(calculation.status)}
          </div>
          {recipe.name_hi && (
            <p className="text-base text-stone-600 mt-0.5 font-sans">
              {recipe.name_hi}
            </p>
          )}
        </div>

        {/* Costing Highlights Banner */}
        <div className="flex items-center gap-4 bg-[#FAF8F5] border border-[#E7E2D8] rounded-lg p-3">
          <div className="text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">
              {(isEditing ? editForm.category : recipe.category) === 'PREPARATION' || (isEditing ? editForm.category : recipe.category) === 'COMBO_PORTION' || (isEditing ? editForm.category : recipe.category) === 'BULK_CATERING'
                ? 'Cost / Yield Unit'
                : 'Cost / Serving'}
            </div>
            <div className="text-lg font-bold font-mono text-emerald-700">
              {!hasCostAccess ? (
                <span className="inline-flex items-center gap-1 text-xs text-stone-400">
                  <Lock className="h-3.5 w-3.5" /> {t('sops.recipes.costRestricted')}
                </span>
              ) : isEditing ? (
                liveCostPerOutputUnit != null ? (
                  <span>
                    {formatINR(liveCostPerOutputUnit)}
                    <span className="text-xs text-stone-500 font-normal ml-0.5">/{editForm.batch_yield_unit || 'unit'}</span>
                  </span>
                ) : (
                  <span className="text-stone-400">—</span>
                )
              ) : calculation?.costPerOutputUnit != null ? (
                <span>
                  {formatINR(calculation.costPerOutputUnit)}
                  <span className="text-xs text-stone-500 font-normal ml-0.5">/{recipe.batch_yield_unit}</span>
                </span>
              ) : calculation?.costPerServing != null ? (
                <span>
                  {formatINR(calculation.costPerServing)}
                  <span className="text-xs text-stone-500 font-normal ml-0.5">/{recipe.portion_size_unit}</span>
                </span>
              ) : (
                <span className="text-stone-400">—</span>
              )}
            </div>
          </div>

          <div className="h-8 w-px bg-[#E7E2D8]" />

          <div className="text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">
              {t('sops.recipes.colBatchCost')}
            </div>
            <div className="text-lg font-bold font-mono text-stone-900">
              {!hasCostAccess ? (
                <span className="inline-flex items-center gap-1 text-xs text-stone-400">
                  <Lock className="h-3.5 w-3.5" />
                </span>
              ) : isEditing ? (
                liveBatchCost != null ? (
                  formatINR(liveBatchCost)
                ) : (
                  <span className="text-stone-400">—</span>
                )
              ) : calculation?.totalBatchCost != null ? (
                formatINR(calculation.totalBatchCost)
              ) : (
                <span className="text-stone-400">—</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Warning Alert if Uncosted or Incomplete */}
      {calculation && calculation.status !== 'COSTED_ELIGIBLE' && (
        <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-amber-900">
              {calculation.status === 'UNCOSTED'
                ? t('sops.statuses.UNCOSTED')
                : t('sops.statuses.COSTING_INCOMPLETE')}
            </p>
            <p className="text-xs text-amber-800 mt-0.5">
              {t('sops.recipeDetail.uncostedWarning')}
            </p>
            {calculation.reasons && calculation.reasons.length > 0 && (
              <ul className="list-disc list-inside text-xs text-amber-900 mt-2 space-y-0.5 font-mono">
                {calculation.reasons.map((r: string, idx: number) => (
                  <li key={idx}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Card 1: Recipe Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Scale className="h-4 w-4 text-amber-600" />
            {t('sops.recipeDetail.recipeOverview')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isEditing ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                  {locale === 'hi' ? 'रेसिपी श्रेणी' : 'Recipe Category'}
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleCategoryChange('FINAL_DISH')}
                    className={`py-1.5 px-2.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                      editForm.category === 'FINAL_DISH'
                        ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                        : 'bg-white text-stone-700 border-[#E7E2D8] hover:bg-stone-50'
                    }`}
                  >
                    {t('sops.recipes.finalDishes')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCategoryChange('PREPARATION')}
                    className={`py-1.5 px-2.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                      editForm.category === 'PREPARATION'
                        ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                        : 'bg-white text-stone-700 border-[#E7E2D8] hover:bg-stone-50'
                    }`}
                  >
                    {t('sops.recipes.preparations')}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                  Batch Yield Quantity
                </label>
                <input
                  type="number"
                  step="any"
                  value={editForm.batch_yield_quantity}
                  onChange={(e) => setEditForm({ ...editForm, batch_yield_quantity: e.target.value })}
                  className="w-full px-2.5 py-1.5 border border-[#E7E2D8] rounded text-sm bg-white"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                  {t('sops.recipes.yieldUnit')}
                </label>
                <select
                  value={editForm.batch_yield_unit}
                  onChange={(e) => setEditForm({ ...editForm, batch_yield_unit: e.target.value })}
                  className="w-full px-2.5 py-1.5 border border-[#E7E2D8] rounded text-sm bg-white cursor-pointer"
                >
                  <option value="">{t('sops.recipes.selectUnit')}</option>
                  {['kg', 'g', 'pcs'].map((u) => (
                    <option key={u} value={u}>
                      {u === 'kg' ? (locale === 'hi' ? 'kg (किलोग्राम)' : 'kg (Kilograms)') : u === 'g' ? (locale === 'hi' ? 'g (ग्राम)' : 'g (Grams)') : (locale === 'hi' ? 'pcs (पीस)' : 'pcs (Pieces)')}
                    </option>
                  ))}
                </select>
              </div>
              {editForm.category !== 'PREPARATION' && (
                <>
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                      {t('sops.recipes.portionQuantity')}
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={editForm.portion_size_quantity}
                      onChange={(e) => setEditForm({ ...editForm, portion_size_quantity: e.target.value })}
                      className="w-full px-2.5 py-1.5 border border-[#E7E2D8] rounded text-sm bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                      {t('sops.recipes.portionUnit')}
                    </label>
                    <select
                      value={editForm.portion_size_unit}
                      onChange={(e) => setEditForm({ ...editForm, portion_size_unit: e.target.value })}
                      className="w-full px-2.5 py-1.5 border border-[#E7E2D8] rounded text-sm bg-white cursor-pointer"
                    >
                      <option value="">{t('sops.recipes.selectUnit')}</option>
                      {getCompatibleUnitOptions('g', centralUnits, undefined, locale).map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm divide-y sm:divide-y-0 sm:divide-x divide-[#E7E2D8]">
              <div className="py-1 sm:py-0 sm:px-3">
                <span className="text-xs text-stone-500 block">{t('sops.recipes.colBatchYield')}</span>
                <span className="font-mono font-bold text-stone-900 flex items-center mt-0.5">
                  {recipe.batch_yield_quantity != null
                    ? `${recipe.batch_yield_quantity} ${recipe.batch_yield_unit || ''}`
                    : '—'}
                  {recipe.batch_yield_unit && getUnitDimension(recipe.batch_yield_unit) === 'UNKNOWN' && (
                    <Badge variant="danger" className="ml-2 font-mono text-[10px]">
                      {t('sops.recipes.invalidUnit')}: {recipe.batch_yield_unit}
                    </Badge>
                  )}
                </span>
              </div>
              {recipe.category !== 'PREPARATION' && (
                <>
                  <div className="py-1 sm:py-0 sm:px-3">
                    <span className="text-xs text-stone-500 block">{t('sops.recipes.colPortion')}</span>
                    <span className="font-mono font-bold text-stone-900 mt-0.5 block">
                      {recipe.portion_size_quantity != null
                        ? `${recipe.portion_size_quantity} ${recipe.portion_size_unit || ''}`
                        : '—'}
                    </span>
                  </div>
                  <div className="py-1 sm:py-0 sm:px-3">
                    <span className="text-xs text-stone-500 block">Servings / Batch</span>
                    <span className="font-mono font-bold text-stone-900 mt-0.5 block">
                      {calculation?.servingsPerBatch != null
                        ? Math.round(calculation.servingsPerBatch * 100) / 100
                        : '—'}
                    </span>
                  </div>
                </>
              )}
              <div className="py-1 sm:py-0 sm:px-3">
                <span className="text-xs text-stone-500 block">Ingredient Count</span>
                <span className="font-mono font-bold text-stone-900 mt-0.5 block">
                  {ingredients.length} items
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Card 2: Ingredients & Formulation Table */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 gap-2">
          <div>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <UtensilsCrossed className="h-4 w-4 text-amber-600" />
              {isEditing ? t('sops.recipeDetail.editIngredients') : t('sops.recipeDetail.ingredientsTitle')}
            </CardTitle>
            <CardDescription>
              {isEditing ? editableIngredients.length : ingredients.length} {locale === 'hi' ? 'घटक सामग्री' : 'ingredients and sub-preparations in this recipe'}
            </CardDescription>
          </div>
          {isEditing && (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleAddIngredient('RAW_MATERIAL')}
                className="gap-1.5 text-xs border-amber-300 text-amber-800 hover:bg-amber-50 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5 text-amber-600" />
                {t('sops.recipeDetail.addRawMaterial')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleAddIngredient('PREPARATION')}
                className="gap-1.5 text-xs border-blue-300 text-blue-800 hover:bg-blue-50 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5 text-blue-600" />
                {t('sops.recipeDetail.addSubPrep')}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {isEditing ? (
            /* INTERACTIVE INGREDIENTS EDITOR */
            <div className="p-4 space-y-3">
              {/* Quick Add Bar */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-400" />
                <input
                  type="text"
                  value={quickSearch}
                  onChange={(e) => setQuickSearch(e.target.value)}
                  placeholder={locale === 'hi' ? 'सामग्री तुरंत खोजें और जोड़ें (उदा. पनीर, मक्खन, ग्रेवी)...' : 'Quick search and add ingredient (e.g. Paneer, Butter, Gravy)...'}
                  className="w-full pl-8 pr-3 py-1.5 border border-[#E7E2D8] rounded-lg text-xs bg-white text-stone-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
                {quickSearch.trim() && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-20 max-h-48 overflow-y-auto bg-white border border-[#E7E2D8] rounded-lg shadow-lg divide-y divide-stone-100">
                    {foodGroups
                      .filter((g) => g.name?.toLowerCase().includes(quickSearch.toLowerCase()) || g.name_hi?.includes(quickSearch))
                      .slice(0, 6)
                      .map((g) => (
                        <div
                          key={g.id}
                          onClick={() => {
                            const bUnit = g.base_unit?.symbol || 'g';
                            setEditableIngredients((prev) => [
                              ...prev,
                              {
                                tempId: `quick_${Date.now()}_${Math.random()}`,
                                ingredient_type: 'RAW_MATERIAL',
                                ingredient_group_id: g.id,
                                sub_recipe_id: null,
                                quantity: 1,
                                unit: bUnit,
                                sort_order: prev.length + 1,
                                notes: '',
                                base_unit_symbol: bUnit,
                                selected_item_name: g.name,
                                selected_item_name_hi: g.name_hi,
                              },
                            ]);
                            setQuickSearch('');
                          }}
                          className="p-2 hover:bg-amber-50 cursor-pointer flex items-center justify-between text-xs"
                        >
                          <div>
                            <span className="font-semibold text-stone-800">{g.name}</span>
                            {g.name_hi && <span className="text-stone-500 ml-1">({g.name_hi})</span>}
                          </div>
                          <Badge variant="outline" className="text-[10px] font-mono">{g.base_unit?.symbol || 'g'}</Badge>
                        </div>
                      ))}
                  </div>
                )}
              </div>
              {editableIngredients.length === 0 ? (
                <div className="p-8 text-center text-stone-400 text-sm border-2 border-dashed border-[#E7E2D8] rounded-xl">
                  <p>{t('sops.recipeDetail.noIngredientsEdit')}</p>
                  <div className="flex justify-center gap-2 mt-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleAddIngredient('RAW_MATERIAL')}
                      className="gap-1 text-xs"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {t('sops.recipeDetail.addRawMaterial')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleAddIngredient('PREPARATION')}
                      className="gap-1 text-xs"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {t('sops.recipeDetail.addSubPrep')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {editableIngredients.map((row, idx) => {
                    const isPrep = row.ingredient_type === 'PREPARATION';
                    const baseUnit = isPrep
                      ? row.base_unit_symbol || 'kg'
                      : row.base_unit_symbol || 'g';
                    const unitOptions = getCompatibleUnitOptions(baseUnit, centralUnits, undefined, locale);
                    const availablePreps = allRecipes.filter((r) => r.id !== id && r.category === 'PREPARATION');

                    return (
                      <div
                        key={row.tempId || idx}
                        className="bg-white border border-[#E7E2D8] rounded-xl p-3 flex flex-col md:flex-row md:items-center gap-3 shadow-2xs hover:border-amber-300 transition-colors"
                      >
                        {/* Drag / Reorder Buttons & Index */}
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="font-mono text-xs text-stone-400 w-5 text-center">
                            {idx + 1}
                          </span>
                          <div className="flex flex-col">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => handleMoveIngredient(idx, 'up')}
                              className="p-0.5 text-stone-400 hover:text-stone-700 disabled:opacity-20 cursor-pointer"
                              title={t('sops.recipeDetail.moveUp')}
                            >
                              <ArrowUp className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === editableIngredients.length - 1}
                              onClick={() => handleMoveIngredient(idx, 'down')}
                              className="p-0.5 text-stone-400 hover:text-stone-700 disabled:opacity-20 cursor-pointer"
                              title={t('sops.recipeDetail.moveDown')}
                            >
                              <ArrowDown className="h-3 w-3" />
                            </button>
                          </div>
                          <Badge
                            variant={isPrep ? 'info' : 'default'}
                            className="text-[10px] uppercase font-mono ml-1"
                          >
                            {isPrep ? t('sops.recipeDetail.typePrep') : t('sops.recipeDetail.typeRaw')}
                          </Badge>
                        </div>

                        {/* Searchable Item Selector */}
                        <div className="flex-1 min-w-[200px]">
                          {isPrep ? (
                            <SearchableSelect<any>
                              options={formattedPreparations}
                              value={row.sub_recipe_id}
                              onChange={(val, opt) => {
                                handleUpdateIngredient(idx, {
                                  sub_recipe_id: val,
                                  selected_item_name: opt?.name,
                                  selected_item_name_hi: opt?.name_hi,
                                  base_unit_symbol: opt?.batch_yield_unit || 'kg',
                                  unit: opt?.batch_yield_unit || 'kg',
                                });
                              }}
                              onAddNew={(term) => handleQuickAddPrepInline(idx, term)}
                              labelKey="display_label"
                              valueKey="id"
                              secondaryLabelKey="name_hi"
                              placeholder={locale === 'hi' ? 'पूर्व-तैयारी चुनें...' : 'Select preparation...'}
                              className="text-xs"
                            />
                          ) : (
                            <SearchableSelect<any>
                              options={formattedFoodGroups}
                              value={row.ingredient_group_id}
                              onChange={(val, opt) => {
                                const bUnit = opt?.base_unit?.symbol || 'g';
                                handleUpdateIngredient(idx, {
                                  ingredient_group_id: val,
                                  selected_item_name: opt?.name,
                                  selected_item_name_hi: opt?.name_hi,
                                  base_unit_symbol: bUnit,
                                  unit: bUnit,
                                });
                              }}
                              labelKey="display_label"
                              valueKey="id"
                              secondaryLabelKey="name_hi"
                              getSearchableText={(g: any) => getSearchableItemText(g, aliasesMap)}
                              placeholder={locale === 'hi' ? 'कच्ची सामग्री चुनें...' : 'Select raw material...'}
                              className="text-xs"
                            />
                          )}
                        </div>

                        {/* Quantity Input */}
                        <div className="w-24 shrink-0">
                          <input
                            type="number"
                            step="any"
                            min="0.001"
                            value={row.quantity}
                            onChange={(e) => handleUpdateIngredient(idx, { quantity: e.target.value })}
                            placeholder="Qty"
                            className="w-full px-2.5 py-1.5 border border-[#E7E2D8] rounded-lg text-xs bg-white text-stone-900 focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono"
                          />
                        </div>

                        {/* Unit Select Dropdown */}
                        <div className="w-28 shrink-0">
                          <select
                            value={row.unit}
                            onChange={(e) => handleUpdateIngredient(idx, { unit: e.target.value })}
                            className="w-full px-2 py-1.5 border border-[#E7E2D8] rounded-lg text-xs bg-white text-stone-900 focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer"
                          >
                            {unitOptions.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Notes Input */}
                        <div className="w-28 shrink-0 hidden sm:block">
                          <input
                            type="text"
                            value={row.notes || ''}
                            onChange={(e) => handleUpdateIngredient(idx, { notes: e.target.value })}
                            placeholder={locale === 'hi' ? 'टिप्पणी' : 'Notes'}
                            className="w-full px-2 py-1.5 border border-[#E7E2D8] rounded-lg text-xs bg-white text-stone-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                          />
                        </div>

                        {/* Live Cost & Conversion Warning Display */}
                        {hasCostAccess && (() => {
                          const liveCost = getIngredientLiveCost(row);
                          return (
                            <div className="w-32 text-right shrink-0">
                              {liveCost.conversionError ? (
                                <button
                                  type="button"
                                  onClick={() => handleOpenConversionModalFor(row)}
                                  className="inline-flex items-center gap-1 text-[10px] bg-rose-50 text-rose-700 border border-rose-200 px-1.5 py-0.5 rounded cursor-pointer hover:bg-rose-100 font-sans"
                                  title={liveCost.errorMsg}
                                >
                                  <AlertTriangle className="h-3 w-3 text-rose-500 shrink-0" />
                                  <span className="truncate max-w-[80px]">No Conv</span>
                                </button>
                              ) : (
                                <>
                                  <div className="text-[10px] text-stone-400 font-mono">
                                    {liveCost.rate != null ? `@ ₹${Math.round(liveCost.rate)}/${liveCost.rateUnit}` : '—'}
                                  </div>
                                  <div className="font-mono text-xs font-semibold text-emerald-700">
                                    {liveCost.lineCost != null ? formatINR(liveCost.lineCost) : '—'}
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })()}

                        {/* Delete Button */}
                        <button
                          type="button"
                          onClick={() => handleRemoveIngredient(idx)}
                          className="p-1.5 text-stone-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors shrink-0 cursor-pointer"
                          title={t('sops.recipeDetail.deleteIngredient')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : ingredients.length === 0 ? (
            <div className="p-8 text-center text-stone-400 text-sm">
              No ingredients added to this formulation.
            </div>
          ) : (
            <div>
              {/* Desktop 7-Column Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#E7E2D8] bg-[#FAF8F5] text-xs font-semibold text-stone-600">
                      <th className="py-2.5 px-4">#</th>
                      <th className="py-2.5 px-4">{t('sops.recipeDetail.colIngredient')}</th>
                      <th className="py-2.5 px-4">{t('sops.recipeDetail.colType')}</th>
                      <th className="py-2.5 px-4">{t('sops.recipeDetail.colQuantity')}</th>
                      <th className="py-2.5 px-4 text-right">{t('sops.recipeDetail.colUnitRate')}</th>
                      <th className="py-2.5 px-4 text-right">{t('sops.recipeDetail.colLineCost')}</th>
                      <th className="py-2.5 px-4">{t('sops.recipes.colStatus')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E7E2D8]">
                    {ingredients.map((ing: any, idx: number) => {
                      const line = lineCosts[idx] || {};
                      const isPrep = ing.ingredient_type === 'PREPARATION';
                      const targetName = isPrep
                        ? ing.sub_recipe?.name
                        : ing.ingredient_group?.name || ing.inventory_item?.name;
                      const targetNameHi = isPrep
                        ? ing.sub_recipe?.name_hi
                        : ing.ingredient_group?.name_hi || ing.inventory_item?.name_hi;

                      return (
                        <tr key={ing.id || idx} className="hover:bg-amber-50/20">
                          <td className="py-3 px-4 font-mono text-xs text-stone-400">
                            {idx + 1}
                          </td>

                          <td className="py-3 px-4">
                            <div className="font-medium text-stone-900">
                              {isPrep ? (
                                <Link
                                  href={`/sops/recipes/${ing.sub_recipe_id}`}
                                  className="text-amber-700 hover:underline flex items-center gap-1"
                                >
                                  {targetName}
                                  <ExternalLink className="h-3 w-3" />
                                </Link>
                              ) : (
                                <span>{targetName}</span>
                              )}
                            </div>
                            {targetNameHi && (
                              <div className="text-xs text-stone-500 font-sans">{targetNameHi}</div>
                            )}
                          </td>

                          <td className="py-3 px-4">
                            {isPrep ? (
                              <Badge variant="info" className="text-[10px]">
                                {t('sops.recipeDetail.typePrep')}
                              </Badge>
                            ) : (
                              <Badge variant="default" className="text-[10px]">
                                {t('sops.recipeDetail.typeRaw')}
                              </Badge>
                            )}
                          </td>

                          <td className="py-3 px-4 font-mono text-xs text-stone-800">
                            {Number(ing.quantity)} {ing.unit}
                          </td>

                          <td className="py-3 px-4 text-right font-mono text-xs text-stone-700">
                            {!hasCostAccess ? (
                              <Lock className="h-3 w-3 inline text-stone-400" />
                            ) : line.unitRate != null ? (
                              <span>
                                {formatINR(line.unitRate)}
                                <span className="text-[10px] text-stone-400 ml-0.5">/{line.rateUnit || ''}</span>
                              </span>
                            ) : (
                              <span className="text-stone-400">—</span>
                            )}
                          </td>

                          <td className="py-3 px-4 text-right font-mono text-xs font-medium text-stone-900">
                            {!hasCostAccess ? (
                              <Lock className="h-3 w-3 inline text-stone-400" />
                            ) : line.lineCost != null ? (
                              formatINR(line.lineCost)
                            ) : (
                              <span className="text-stone-400">—</span>
                            )}
                          </td>

                          <td className="py-3 px-4">
                            {line.status === 'COSTED_ELIGIBLE' ? (
                              <Badge variant="success" className="text-[10px]">
                                Ready
                              </Badge>
                            ) : line.status === 'UNCOSTED' ? (
                              <Badge variant="warning" className="text-[10px]" title={line.error || ''}>
                                Uncosted
                              </Badge>
                            ) : (
                              <Badge variant="danger" className="text-[10px]" title={line.error || ''}>
                                Incomplete
                              </Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Responsive Cards */}
              <div className="block md:hidden divide-y divide-[#E7E2D8] p-3 space-y-3">
                {ingredients.map((ing: any, idx: number) => {
                  const line = lineCosts[idx] || {};
                  const isPrep = ing.ingredient_type === 'PREPARATION';
                  const targetName = isPrep
                    ? ing.sub_recipe?.name
                    : ing.ingredient_group?.name || ing.inventory_item?.name;
                  const targetNameHi = isPrep
                    ? ing.sub_recipe?.name_hi
                    : ing.ingredient_group?.name_hi || ing.inventory_item?.name_hi;

                  return (
                    <div key={ing.id || idx} className="pt-3 first:pt-0 space-y-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="font-medium text-stone-900 text-sm">
                            {isPrep ? (
                              <Link href={`/sops/recipes/${ing.sub_recipe_id}`} className="text-amber-700 hover:underline flex items-center gap-1">
                                {targetName} <ExternalLink className="h-3 w-3" />
                              </Link>
                            ) : (
                              <span>{targetName}</span>
                            )}
                          </div>
                          {targetNameHi && <div className="text-xs text-stone-500 font-sans">{targetNameHi}</div>}
                        </div>
                        <Badge variant={isPrep ? 'info' : 'default'} className="text-[10px]">
                          {isPrep ? t('sops.recipeDetail.typePrep') : t('sops.recipeDetail.typeRaw')}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-xs bg-[#FAF8F5] p-2 rounded-lg border border-[#E7E2D8]">
                        <div>
                          <span className="text-[10px] text-stone-400 block uppercase tracking-wider">{t('sops.recipeDetail.colQuantity')}</span>
                          <span className="font-mono font-medium text-stone-800">{Number(ing.quantity)} {ing.unit}</span>
                        </div>
                        <div className="text-center">
                          <span className="text-[10px] text-stone-400 block uppercase tracking-wider">{t('sops.recipeDetail.colUnitRate')}</span>
                          <span className="font-mono text-stone-700">
                            {!hasCostAccess ? (
                              <Lock className="h-3 w-3 inline text-stone-400" />
                            ) : line.unitRate != null ? (
                              `₹${line.unitRate}/${line.rateUnit || ''}`
                            ) : (
                              '—'
                            )}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] text-stone-400 block uppercase tracking-wider">{t('sops.recipeDetail.colLineCost')}</span>
                          <span className="font-mono font-bold text-stone-900">
                            {!hasCostAccess ? (
                              <Lock className="h-3 w-3 inline text-stone-400" />
                            ) : line.lineCost != null ? (
                              formatINR(line.lineCost)
                            ) : (
                              '—'
                            )}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Card 4: Where-Used Dependency Graph (Reverse dependencies - only in read-only mode) */}
      {!isEditing && (
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Share2 className="h-4 w-4 text-amber-600" />
            {t('sops.recipeDetail.whereUsedTitle')}
          </CardTitle>
          <CardDescription>
            Upstream recipes, POS menu items, and combos relying directly on this formulation
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* 1. Parent Recipes */}
            <div className="border border-[#E7E2D8] rounded-lg p-4 bg-[#FAF8F5]">
              <div className="font-semibold text-xs text-stone-700 uppercase tracking-wider mb-2 flex items-center justify-between">
                <span>{t('sops.recipeDetail.parentRecipes')}</span>
                <Badge variant="outline" className="text-[10px]">
                  {whereUsed.recipes.length}
                </Badge>
              </div>

              {whereUsed.recipes.length === 0 ? (
                <p className="text-xs text-stone-400 italic">None</p>
              ) : (
                <ul className="space-y-2">
                  {whereUsed.recipes.map((p: any, idx: number) => (
                    <li key={idx} className="text-xs bg-white p-2 rounded border border-[#E7E2D8] flex items-center justify-between">
                      <Link href={`/sops/recipes/${p.id}`} className="font-medium text-amber-800 hover:underline">
                        {p.name}
                      </Link>
                      <span className="font-mono text-[11px] text-stone-500">
                        {p.quantity} {p.unit}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 2. Menu Item Variants */}
            <div className="border border-[#E7E2D8] rounded-lg p-4 bg-[#FAF8F5]">
              <div className="font-semibold text-xs text-stone-700 uppercase tracking-wider mb-2 flex items-center justify-between">
                <span>{t('sops.recipeDetail.menuItems')}</span>
                <Badge variant="outline" className="text-[10px]">
                  {whereUsed.menuItems.length}
                </Badge>
              </div>

              {whereUsed.menuItems.length === 0 ? (
                <p className="text-xs text-stone-400 italic">None</p>
              ) : (
                <ul className="space-y-2">
                  {whereUsed.menuItems.map((m: any, idx: number) => (
                    <li key={idx} className="text-xs bg-white p-2 rounded border border-[#E7E2D8] flex items-center justify-between">
                      <div>
                        <Link href={`/sops/menu/${m.menuItemId}`} className="font-medium text-amber-800 hover:underline">
                          {m.menuItemName}
                        </Link>
                        <div className="text-[10px] text-stone-500 font-mono">
                          {m.variantName} {m.isDefault ? '(Default)' : ''}
                        </div>
                      </div>
                      <span className="font-mono text-[11px] text-stone-700 font-semibold">
                        {m.price ? formatINR(m.price) : '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 3. Combos & Thalis */}
            <div className="border border-[#E7E2D8] rounded-lg p-4 bg-[#FAF8F5]">
              <div className="font-semibold text-xs text-stone-700 uppercase tracking-wider mb-2 flex items-center justify-between">
                <span>{t('sops.recipeDetail.combos')}</span>
                <Badge variant="outline" className="text-[10px]">
                  {whereUsed.combos.length}
                </Badge>
              </div>

              {whereUsed.combos.length === 0 ? (
                <p className="text-xs text-stone-400 italic">None</p>
              ) : (
                <ul className="space-y-2">
                  {whereUsed.combos.map((c: any, idx: number) => (
                    <li key={idx} className="text-xs bg-white p-2 rounded border border-[#E7E2D8] flex items-center justify-between">
                      <div>
                        <div className="font-medium text-stone-900">{c.name}</div>
                        <div className="text-[10px] text-stone-500 font-mono">
                          {c.componentName} ({c.portionQuantity} {c.portionUnit})
                        </div>
                      </div>
                      <span className="font-mono text-[11px] text-stone-700 font-semibold">
                        {c.sellingPrice ? formatINR(c.sellingPrice) : '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      {/* Category Change Blocker Dialog */}
      {blockerDialog?.open && (
        <div className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full overflow-hidden border border-rose-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-6 py-4 border-b border-rose-100 bg-rose-50/50">
              <h2 className="text-base font-bold text-rose-900 flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-rose-600" />
                {blockerDialog.title}
              </h2>
              <button
                type="button"
                onClick={() => setBlockerDialog(null)}
                className="text-stone-400 hover:text-stone-600 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-stone-700 leading-relaxed">
                {blockerDialog.message}
              </p>
              <div className="bg-stone-50 border border-stone-200 rounded-lg p-3 max-h-48 overflow-y-auto space-y-1.5">
                <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-1">
                  {t('sops.recipeDetail.affectedParentRecipes')} ({blockerDialog.items.length}):
                </div>
                {blockerDialog.items.map((name, i) => (
                  <div key={i} className="text-xs font-medium text-stone-800 flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-500 shrink-0" />
                    {name}
                  </div>
                ))}
              </div>
              <p className="text-xs text-stone-500 italic">
                {locale === 'hi' ? 'श्रेणी बदलने से पहले इन मूल रेसिपी से यह उप-तैयारी हटाना अनिवार्य है।' : 'You must remove this sub-preparation from all parent recipes before converting it to a Final Dish.'}
              </p>
              <div className="flex justify-end pt-2">
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => setBlockerDialog(null)}
                  className="bg-stone-800 hover:bg-stone-900 text-white cursor-pointer"
                >
                  {locale === 'hi' ? 'समझ गया' : 'Understood'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Category Change Warning Dialog */}
      {warningDialog?.open && (
        <div className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full overflow-hidden border border-amber-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-6 py-4 border-b border-amber-100 bg-amber-50/50">
              <h2 className="text-base font-bold text-amber-900 flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                {warningDialog.title}
              </h2>
              <button
                type="button"
                onClick={() => setWarningDialog(null)}
                className="text-stone-400 hover:text-stone-600 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-stone-700 leading-relaxed">
                {warningDialog.message}
              </p>
              <div className="bg-stone-50 border border-stone-200 rounded-lg p-3 max-h-48 overflow-y-auto space-y-1.5">
                {warningDialog.items.map((name, i) => (
                  <div key={i} className="text-xs font-medium text-stone-800 flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                    {name}
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setWarningDialog(null)}
                >
                  {t('sops.recipes.cancel')}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => {
                    const fn = warningDialog.onConfirm;
                    setWarningDialog(null);
                    fn();
                  }}
                  className="bg-amber-600 hover:bg-amber-700 text-white cursor-pointer"
                >
                  {locale === 'hi' ? 'परिवर्तन जारी रखें' : 'Proceed with Change'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Sticky Bottom Save Bar when editing */}
      {isEditing && (
        <div className="sticky bottom-0 z-40 bg-white/95 backdrop-blur-xs border-t border-[#E7E2D8] p-3 -mx-4 sm:-mx-6 px-4 sm:px-6 shadow-lg flex items-center justify-between animate-in slide-in-from-bottom-2">
          <div className="flex items-center gap-3">
            <span className="text-xs text-stone-500 hidden sm:inline">Editing recipe formulation</span>
            <span className="font-mono text-xs font-semibold text-stone-800">
              {editableIngredients.length} ingredients
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleCancelEdit} disabled={saving}>
              <X className="h-3.5 w-3.5 mr-1" />
              {t('sops.recipes.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSaveRecipe}
              disabled={saving}
              className="bg-amber-600 hover:bg-amber-700 text-white cursor-pointer font-semibold shadow-xs"
            >
              <Save className="h-3.5 w-3.5 mr-1" />
              {saving ? 'Saving...' : t('sops.recipes.save')}
            </Button>
          </div>
        </div>
      )}

      {/* Unit Conversion Modal */}
      {conversionModalOpen && (
        <div className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full overflow-hidden border border-[#E7E2D8]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E7E2D8] bg-[#FAF8F5]">
              <h2 className="text-base font-bold text-stone-900 flex items-center gap-2">
                <Scale className="h-4 w-4 text-amber-600" />
                Verified Unit Conversions
              </h2>
              <button
                type="button"
                onClick={() => setConversionModalOpen(false)}
                className="text-stone-400 hover:text-stone-600 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
              {/* Interactive Add Conversion Form */}
              <form onSubmit={handleSaveConversion} className="bg-amber-50/50 border border-amber-200 rounded-xl p-4 space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
                  <Plus className="h-3.5 w-3.5 text-amber-600" />
                  Add / Configure Verified Conversion
                </h3>
                {convError && (
                  <div className="text-xs text-rose-600 bg-rose-50 p-2 rounded border border-rose-200">
                    {convError}
                  </div>
                )}
                <div className="space-y-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                      Ingredient Group
                    </label>
                    <select
                      value={newConvGroupId}
                      onChange={(e) => {
                        const gId = e.target.value;
                        setNewConvGroupId(gId);
                        const g = foodGroups.find((fg) => fg.id === gId);
                        if (g?.base_unit?.symbol) {
                          setNewConvToUnit(g.base_unit.symbol);
                        }
                      }}
                      className="w-full px-2.5 py-1.5 border border-[#E7E2D8] rounded text-xs bg-white text-stone-900 cursor-pointer"
                    >
                      <option value="">Select ingredient group...</option>
                      {foodGroups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name} ({g.base_unit?.symbol || 'g'})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                        From Unit (Recipe Unit)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. piece, cup, bunch"
                        value={newConvFromUnit}
                        onChange={(e) => setNewConvFromUnit(e.target.value)}
                        className="w-full px-2.5 py-1.5 border border-[#E7E2D8] rounded text-xs bg-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                        To Unit (Base Unit)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. g, kg"
                        value={newConvToUnit}
                        onChange={(e) => setNewConvToUnit(e.target.value)}
                        className="w-full px-2.5 py-1.5 border border-[#E7E2D8] rounded text-xs bg-white font-mono"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                        Multiplier (1 [From] = ? [To])
                      </label>
                      <input
                        type="number"
                        step="any"
                        placeholder="e.g. 50"
                        value={newConvMultiplier}
                        onChange={(e) => setNewConvMultiplier(e.target.value)}
                        className="w-full px-2.5 py-1.5 border border-[#E7E2D8] rounded text-xs bg-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                        Notes / Reference
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. 1 piece ~ 50g"
                        value={newConvNotes}
                        onChange={(e) => setNewConvNotes(e.target.value)}
                        className="w-full px-2.5 py-1.5 border border-[#E7E2D8] rounded text-xs bg-white"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end pt-1">
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      disabled={convSaving}
                      className="bg-amber-600 hover:bg-amber-700 text-white cursor-pointer text-xs"
                    >
                      {convSaving ? 'Saving...' : 'Save Conversion'}
                    </Button>
                  </div>
                </div>
              </form>

              {/* Verified conversions list */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-stone-500 mb-2">
                  Active Verified Conversions ({conversionsList.length})
                </h4>
                {conversionsList.length === 0 ? (
                  <div className="p-4 text-center text-stone-400 text-xs bg-stone-50 rounded-lg">
                    No verified conversions registered.
                  </div>
                ) : (
                  <div className="divide-y divide-stone-100 border border-[#E7E2D8] rounded-lg max-h-48 overflow-y-auto">
                    {conversionsList.map((c: any) => (
                      <div key={c.id} className="p-3 text-xs flex items-center justify-between">
                        <div>
                          <span className="font-mono font-bold text-stone-900">
                            1 {c.from_unit} = {c.conversion_factor || c.multiplier} {c.to_unit}
                          </span>
                          {c.notes && (
                            <span className="text-[10px] text-stone-400 block font-sans">{c.notes}</span>
                          )}
                        </div>
                        <Badge variant={c.is_verified ? 'success' : 'warning'} className="text-[10px]">
                          {c.is_verified ? 'Verified' : 'Active'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-3 border-t border-[#E7E2D8] bg-[#FAF8F5] flex justify-end">
              <Button variant="outline" size="sm" onClick={() => setConversionModalOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
