'use client';

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useI18n } from '@/lib/i18n/context';
import { useAppRole } from '@/components/layout/AppShell';
import { canViewCosting } from '@/lib/rbac';
import { formatINR } from '@/lib/utils';
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
  const [calculation, setCalculation] = useState<any>(null);
  const [whereUsed, setWhereUsed] = useState<{
    recipes: any[];
    menuItems: any[];
    combos: any[];
  }>({ recipes: [], menuItems: [], combos: [] });

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});

  const fetchRecipeDetail = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sops/recipes/${id}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to fetch recipe details');
      }
      const data = await res.json();
      setRecipe(data.recipe);
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
        instructions: data.recipe.instructions || '',
        notes: data.recipe.notes || '',
      });
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

  const handleSaveRecipe = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/sops/recipes/${id}`, {
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
          instructions: editForm.instructions || null,
          notes: editForm.notes || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
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
    <div className="space-y-6">
      {/* Top Nav & Breadcrumb */}
      <div className="flex items-center justify-between">
        <Link href="/sops/recipes">
          <Button variant="ghost" size="sm" className="gap-1.5 text-stone-600 hover:text-stone-900">
            <ArrowLeft className="h-4 w-4" />
            {t('sops.recipeDetail.backToRecipes')}
          </Button>
        </Link>

        {canManage && (
          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <Button variant="outline" size="sm" onClick={() => setIsEditing(false)} disabled={saving}>
                  <X className="h-3.5 w-3.5 mr-1" />
                  {t('sops.recipes.cancel')}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSaveRecipe}
                  disabled={saving}
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                >
                  <Save className="h-3.5 w-3.5 mr-1" />
                  {saving ? 'Saving...' : t('sops.recipes.save')}
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setIsEditing(true)} className="gap-1.5">
                <Edit2 className="h-3.5 w-3.5" />
                {t('sops.recipes.edit')}
              </Button>
            )}
          </div>
        )}
      </div>

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
              {recipe.category === 'PREPARATION' || recipe.category === 'COMBO_PORTION' || recipe.category === 'BULK_CATERING'
                ? 'Cost / Yield Unit'
                : 'Cost / Serving'}
            </div>
            <div className="text-lg font-bold font-mono text-emerald-700">
              {!hasCostAccess ? (
                <span className="inline-flex items-center gap-1 text-xs text-stone-400">
                  <Lock className="h-3.5 w-3.5" /> {t('sops.recipes.costRestricted')}
                </span>
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

      {/* Grid: Card 1 (Specs) & Card 3 (Instructions) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card 1: Recipe Specs */}
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Scale className="h-4 w-4 text-amber-600" />
              {t('sops.recipeDetail.recipeOverview')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isEditing ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                    Batch Yield Quantity
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={editForm.batch_yield_quantity}
                    onChange={(e) => setEditForm({ ...editForm, batch_yield_quantity: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-[#E7E2D8] rounded text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                    Yield Unit
                  </label>
                  <input
                    type="text"
                    value={editForm.batch_yield_unit}
                    onChange={(e) => setEditForm({ ...editForm, batch_yield_unit: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-[#E7E2D8] rounded text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                    Portion Size Quantity
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={editForm.portion_size_quantity}
                    onChange={(e) => setEditForm({ ...editForm, portion_size_quantity: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-[#E7E2D8] rounded text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                    Portion Unit
                  </label>
                  <input
                    type="text"
                    value={editForm.portion_size_unit}
                    onChange={(e) => setEditForm({ ...editForm, portion_size_unit: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-[#E7E2D8] rounded text-sm"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-sm divide-y divide-[#E7E2D8]">
                <div className="flex justify-between py-1">
                  <span className="text-stone-500">{t('sops.recipes.colBatchYield')}</span>
                  <span className="font-mono font-medium text-stone-900">
                    {recipe.batch_yield_quantity != null
                      ? `${recipe.batch_yield_quantity} ${recipe.batch_yield_unit || ''}`
                      : '—'}
                  </span>
                </div>
                <div className="flex justify-between py-1 pt-2">
                  <span className="text-stone-500">{t('sops.recipes.colPortion')}</span>
                  <span className="font-mono font-medium text-stone-900">
                    {recipe.portion_size_quantity != null
                      ? `${recipe.portion_size_quantity} ${recipe.portion_size_unit || ''}`
                      : '—'}
                  </span>
                </div>
                <div className="flex justify-between py-1 pt-2">
                  <span className="text-stone-500">Servings / Batch</span>
                  <span className="font-mono font-medium text-stone-900">
                    {calculation?.servingsPerBatch != null
                      ? Math.round(calculation.servingsPerBatch * 100) / 100
                      : '—'}
                  </span>
                </div>
                <div className="flex justify-between py-1 pt-2">
                  <span className="text-stone-500">Ingredient Count</span>
                  <span className="font-mono font-medium text-stone-900">
                    {ingredients.length} items
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Card 3: Instructions & Notes */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-amber-600" />
              {t('sops.recipeDetail.instructionsTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isEditing ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                    Instructions
                  </label>
                  <textarea
                    rows={4}
                    value={editForm.instructions}
                    onChange={(e) => setEditForm({ ...editForm, instructions: e.target.value })}
                    className="w-full p-2.5 border border-[#E7E2D8] rounded text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                    Culinary Notes
                  </label>
                  <textarea
                    rows={2}
                    value={editForm.notes}
                    onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                    className="w-full p-2.5 border border-[#E7E2D8] rounded text-sm"
                  />
                </div>
              </div>
            ) : (
              <div>
                {recipe.instructions ? (
                  <p className="text-sm text-stone-800 whitespace-pre-line leading-relaxed">
                    {recipe.instructions}
                  </p>
                ) : (
                  <p className="text-xs text-stone-400 italic">
                    {t('sops.recipeDetail.noInstructions')}
                  </p>
                )}

                {recipe.notes && (
                  <div className="mt-4 pt-3 border-t border-[#E7E2D8]">
                    <div className="text-xs font-semibold text-stone-700 mb-1">
                      {t('sops.recipeDetail.notesTitle')}
                    </div>
                    <p className="text-xs text-stone-600 whitespace-pre-line">
                      {recipe.notes}
                    </p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Card 2: Ingredients & Formulation Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <UtensilsCrossed className="h-4 w-4 text-amber-600" />
              {t('sops.recipeDetail.ingredientsTitle')}
            </CardTitle>
            <CardDescription>
              {ingredients.length} {locale === 'hi' ? 'घटक सामग्री' : 'ingredients and sub-preparations in this recipe'}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {ingredients.length === 0 ? (
            <div className="p-8 text-center text-stone-400 text-sm">
              No ingredients added to this formulation.
            </div>
          ) : (
            <div className="overflow-x-auto">
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
          )}
        </CardContent>
      </Card>

      {/* Card 4: Where-Used Dependency Graph (Reverse dependencies) */}
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
    </div>
  );
}
