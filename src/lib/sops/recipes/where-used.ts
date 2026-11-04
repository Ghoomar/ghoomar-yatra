export interface RecipeGraphEntry {
  id: string;
  name: string;
  name_hi?: string | null;
  category: string;
  batch_yield_quantity?: number | null;
  batch_yield_unit?: string | null;
  ingredients?: Array<{
    ingredient_type?: string | null;
    sub_recipe_id?: string | null;
    quantity?: number | string | null;
    unit?: string | null;
    sub_recipe?: { id?: string | null } | null;
  }>;
}

export interface RecipeCostStatus {
  status?: string | null;
}

export interface WhereUsedRecipe {
  id: string;
  name: string;
  name_hi?: string | null;
  category: string;
  depth: number;
  quantity?: number | string | null;
  unit?: string | null;
  status: string;
  costing_status: string;
}

export function getWhereUsedRecipes(
  recipes: readonly RecipeGraphEntry[],
  targetRecipeId: string,
  calculations: ReadonlyMap<string, RecipeCostStatus>,
  maxDepth = 10
): WhereUsedRecipe[] {
  const visitedRecipeIds = new Set<string>([targetRecipeId]);
  let frontierRecipeIds = [targetRecipeId];
  const parentRecipeMap = new Map<string, WhereUsedRecipe>();

  for (let depth = 1; depth <= maxDepth && frontierRecipeIds.length > 0; depth++) {
    const frontier = new Set(frontierRecipeIds);
    const nextFrontier: string[] = [];

    for (const parentRecipe of recipes) {
      for (const ingredient of parentRecipe.ingredients || []) {
        if (ingredient.ingredient_type !== 'PREPARATION') continue;

        const subRecipeId = ingredient.sub_recipe_id || ingredient.sub_recipe?.id;
        if (!subRecipeId || !frontier.has(subRecipeId) || visitedRecipeIds.has(parentRecipe.id)) {
          continue;
        }

        visitedRecipeIds.add(parentRecipe.id);
        nextFrontier.push(parentRecipe.id);
        const status = calculations.get(parentRecipe.id)?.status || 'UNCOSTED';
        parentRecipeMap.set(parentRecipe.id, {
          id: parentRecipe.id,
          name: parentRecipe.name,
          name_hi: parentRecipe.name_hi,
          category: parentRecipe.category,
          depth,
          quantity: ingredient.quantity,
          unit: ingredient.unit,
          status,
          costing_status: status,
        });
      }
    }

    frontierRecipeIds = nextFrontier;
  }

  return Array.from(parentRecipeMap.values());
}
