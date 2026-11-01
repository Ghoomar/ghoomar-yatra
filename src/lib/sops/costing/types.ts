/**
 * Native Culinary & Menu Engineering Types
 */

export type CostingStatus = 'COSTED_ELIGIBLE' | 'UNCOSTED' | 'COSTING_INCOMPLETE' | 'INELIGIBLE';
export type RecipeCategory = 'PREPARATION' | 'FINAL_DISH' | 'COMBO_PORTION' | 'BULK_CATERING';
export type IngredientType = 'RAW_MATERIAL' | 'PREPARATION';
export type ComboThaliProductType = 'COMBO' | 'THALI';
export type ServiceChannel = 'DINE_IN' | 'TAKEAWAY';
export type MenuMatrixQuadrant = 'STAR' | 'PLOWHORSE' | 'PUZZLE' | 'DOG' | 'UNCOSTED' | 'COSTING_INCOMPLETE' | 'INELIGIBLE';

export interface GroupWacResolution {
  groupId: string;
  wac: number | null; // Cost per group's base unit (e.g. per g or per ml or per pcs)
  baseUnitSymbol: string;
  isCosted: boolean;
  tier: 1 | 2 | 3; // 1: In-Stock Weighted, 2: Retained Snapshot / Zero-Stock Average, 3: Uncosted
  reason?: string;
  childVariantsCount: number;
  inStockVariantsCount: number;
  costedVariantsCount: number;
  conversionFactor?: number | null;
  secondaryUnitSymbol?: string | null;
}

export interface YatraRecipeIngredient {
  id?: string;
  recipe_id?: string;
  ingredient_type: IngredientType;
  ingredient_group_id?: string | null;
  inventory_item_id?: string | null;
  sub_recipe_id?: string | null;
  quantity: number;
  unit: string;
  sort_order?: number;
  notes?: string | null;

  // Joined metadata
  ingredient_group?: {
    id: string;
    group_code: string;
    name: string;
    name_hi?: string | null;
    inventory_class: string;
    base_unit?: { symbol: string; name: string };
  } | null;
  inventory_item?: {
    id: string;
    item_code: string;
    name: string;
    brand_name?: string | null;
    unit?: { symbol: string; name: string };
    current_weighted_average_cost?: number;
    is_costed?: boolean;
    conversion_factor?: number | string | null;
  } | null;
  sub_recipe?: YatraRecipe | null;

  // Computed line costing metrics
  line_cost?: number | null;
  unit_rate?: number | null;
  rate_unit?: string | null;
  status?: CostingStatus;
  error?: string | null;
}

export interface YatraMenuItemVariant {
  id?: string;
  menu_item_id: string;
  recipe_id: string;
  variant_name: string;
  is_default: boolean;
  serving_quantity?: number | null;
  serving_unit?: string | null;
  gas_cost?: number;
  other_operating_cost?: number;
  packaging_cost_dine_in?: number;
  packaging_cost_takeaway?: number;
  default_service_channel: ServiceChannel;
  is_active?: boolean;
  notes?: string | null;

  // Joined
  recipe?: YatraRecipe | null;
  menu_item?: {
    id: string;
    name: string;
    online_name?: string | null;
    price: number;
    parent_category?: string;
    category?: string;
    is_active?: boolean;
  } | null;

  // Computed variant-specific metrics
  food_cost?: number | null;
  food_cost_pct?: number | null;
  margin_amount?: number | null;
  operating_cost?: number | null;
  packaging_cost?: number | null;
  total_cost?: number | null;
  contribution_amount?: number | null;
  contribution_pct?: number | null;
  costing_status?: CostingStatus;
  incomplete_reasons?: string[];
}

export interface YatraRecipe {
  id: string;
  name: string;
  name_hi?: string | null;
  category: RecipeCategory;
  batch_yield_quantity: number | null;
  batch_yield_unit: string | null;
  portion_size_quantity: number | null;
  portion_size_unit: string | null;
  instructions?: string | null;
  notes?: string | null;
  is_active: boolean;
  legacy_recipe_id?: string | null;
  created_at?: string;
  updated_at?: string;

  ingredients?: YatraRecipeIngredient[];
  variants?: YatraMenuItemVariant[];

  // Computed metrics
  total_batch_cost?: number | null;
  cost_per_output_unit?: number | null; // For PREPARATION & COMBO_PORTION
  cost_per_serving?: number | null;     // For FINAL_DISH using default portion
  servings_per_batch?: number | null;
  status?: CostingStatus;
  incomplete_reasons?: string[];
}

export interface YatraComboComponent {
  id?: string;
  combo_thali_id?: string;
  component_name: string;
  recipe_id: string;
  variant_id?: string | null;
  portion_quantity: number;
  portion_unit: string;
  sort_order?: number;
  notes?: string | null;

  recipe?: YatraRecipe | null;
  variant?: YatraMenuItemVariant | null;

  // Computed metrics
  food_cost?: number | null;
  unit_rate?: number | null;
  rate_unit?: string | null;
  error?: string | null;
}

export interface YatraComboThali {
  id: string;
  name: string;
  name_hi?: string | null;
  product_type: ComboThaliProductType;
  menu_item_id?: string | null;
  selling_price?: number | null;
  gas_cost?: number;
  other_operating_cost?: number;
  packaging_cost_dine_in?: number;
  packaging_cost_takeaway?: number;
  default_service_channel: ServiceChannel;
  notes?: string | null;
  is_active: boolean;
  legacy_combo_id?: string | null;
  created_at?: string;
  updated_at?: string;

  components?: YatraComboComponent[];
  menu_item?: {
    id: string;
    name: string;
    price: number;
    parent_category?: string;
    category?: string;
  } | null;

  // Computed live metrics
  total_food_cost?: number | null;
  food_cost?: number | null;
  operating_cost?: number | null;
  packaging_cost?: number | null;
  total_cost?: number | null;
  food_cost_pct?: number | null;
  margin_amount?: number | null;
  contribution_amount?: number | null;
  contribution_pct?: number | null;
  status?: CostingStatus;
  costing_status?: CostingStatus;
  incomplete_reasons?: string[];
}

export interface CostCalculationResult {
  recipe: YatraRecipe;
  totalBatchCost: number | null;
  costPerOutputUnit: number | null;
  output_unit: string | null;
  costPerServing: number | null;
  serving_unit: string | null;
  servingsPerBatch: number | null;
  status: CostingStatus;
  reasons: string[];
  ingredientLineCosts: Array<{
    id?: string;
    lineCost: number | null;
    error: string | null;
    unitRate?: number | null;
    rateUnit?: string | null;
    status: CostingStatus;
  }>;
}

export type MatrixState = 'ACTIVE' | 'NO_SALES_DATA' | 'NO_ELIGIBLE_COSTED_SALES';

export interface MenuEngineeringMatrixResult {
  items: MenuEngineeringItemMetrics[];
  totalUnitsSold: number;
  totalNetRevenue: number;
  popularityThresholdPct: number;
  salesWeightedContributionThreshold: number | null;
  eligibleItemsCount: number;
  totalItemsCount: number;
  state: MatrixState;
}

export interface MenuEngineeringItemMetrics {
  menuItemId: string;
  name: string;
  nameHi?: string | null;
  category: string;
  parentCategory?: string;
  sellingPrice: number;
  costingStatus: CostingStatus;
  
  // Costing
  defaultVariantName?: string;
  foodCost: number | null;
  foodCostPct: number | null;
  unitContributionMargin: number | null;

  // Sales Volume & Mix
  unitsSold: number;
  netRevenue: number;
  salesMixPct: number; // Volume share %
  
  // Matrix Evaluation
  isEligibleForMatrix: boolean;
  quadrant: MenuMatrixQuadrant | null;
  popularityThresholdPct: number;
  contributionThreshold: number | null;
}
