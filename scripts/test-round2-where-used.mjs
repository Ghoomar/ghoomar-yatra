import assert from 'node:assert/strict';
import test from 'node:test';
import { getWhereUsedRecipes } from '../src/lib/sops/recipes/where-used.ts';

test('where-used traversal keeps the first parent edge, reports depth and status, and terminates cycles', () => {
  const recipes = [
    {
      id: 'target',
      name: 'Target',
      category: 'PREPARATION',
      ingredients: [{ ingredient_type: 'PREPARATION', sub_recipe_id: 'parent-a', quantity: 1, unit: 'kg' }],
    },
    {
      id: 'parent-a',
      name: 'Parent A',
      name_hi: 'अ',
      category: 'PREPARATION',
      ingredients: [
        { ingredient_type: 'PREPARATION', sub_recipe_id: 'target', quantity: 2.5, unit: 'g' },
        { ingredient_type: 'PREPARATION', sub_recipe_id: 'target', quantity: 8, unit: 'g' },
      ],
    },
    {
      id: 'parent-b',
      name: 'Parent B',
      category: 'FINAL_DISH',
      ingredients: [{ ingredient_type: 'PREPARATION', sub_recipe: { id: 'target' }, quantity: 3, unit: 'pcs' }],
    },
    {
      id: 'grandparent',
      name: 'Grandparent',
      category: 'FINAL_DISH',
      ingredients: [{ ingredient_type: 'PREPARATION', sub_recipe_id: 'parent-a', quantity: 4, unit: 'portion' }],
    },
  ];
  const calculations = new Map([
    ['parent-a', { status: 'COSTED_ELIGIBLE' }],
    ['parent-b', { status: 'COSTING_INCOMPLETE' }],
  ]);

  assert.deepEqual(getWhereUsedRecipes(recipes, 'target', calculations), [
    {
      id: 'parent-a', name: 'Parent A', name_hi: 'अ', category: 'PREPARATION', depth: 1,
      quantity: 2.5, unit: 'g', status: 'COSTED_ELIGIBLE', costing_status: 'COSTED_ELIGIBLE',
    },
    {
      id: 'parent-b', name: 'Parent B', name_hi: undefined, category: 'FINAL_DISH', depth: 1,
      quantity: 3, unit: 'pcs', status: 'COSTING_INCOMPLETE', costing_status: 'COSTING_INCOMPLETE',
    },
    {
      id: 'grandparent', name: 'Grandparent', name_hi: undefined, category: 'FINAL_DISH', depth: 2,
      quantity: 4, unit: 'portion', status: 'UNCOSTED', costing_status: 'UNCOSTED',
    },
  ]);
});

test('where-used traversal retains the existing ten-level limit', () => {
  const recipes = Array.from({ length: 12 }, (_, index) => ({
    id: `recipe-${index}`,
    name: `Recipe ${index}`,
    category: 'PREPARATION',
    ingredients: index === 0
      ? []
      : [{ ingredient_type: 'PREPARATION', sub_recipe_id: `recipe-${index - 1}`, quantity: index, unit: 'kg' }],
  }));

  const results = getWhereUsedRecipes(recipes, 'recipe-0', new Map());
  assert.equal(results.length, 10);
  assert.deepEqual(results.map((recipe) => recipe.id), Array.from({ length: 10 }, (_, index) => `recipe-${index + 1}`));
  assert.deepEqual(results.map((recipe) => recipe.depth), Array.from({ length: 10 }, (_, index) => index + 1));
});
