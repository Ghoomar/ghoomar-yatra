/**
 * Dual-Track Forecasting & Intelligent Bill Classification Types
 */

export type BillClass = 'normal' | 'large_group' | 'high_value_anomaly' | 'data_anomaly' | 'cancelled' | 'excluded';
export type GroupType = 'standard_group' | 'school_group' | 'corporate' | 'tour_bus';
export type GroupTier = 'tier1_auto_explicit' | 'tier2_candidate_flag' | 'manual_manager';
export type DayMode = 'normal' | 'special_event' | 'group_booking' | 'hybrid_event_and_group';
export type Daypart = 'breakfast' | 'lunch' | 'dinner' | 'late_night';

export interface ClassificationThresholds {
  id?: string;
  effective_date?: string;
  dine_in_pax_p95: number;
  dine_in_pax_p99: number;
  dine_in_spp_p95: number;
  dine_in_spp_p99: number;
  pax_large_group_threshold: number;
  spend_per_pax_anomaly_threshold: number;
  bill_net_sales_anomaly_threshold: number;
  iqr_multiplier: number;
  trained_on_bills_count: number;
}

export interface BillClassificationResult {
  id?: string;
  sales_order_id: string;
  business_date: string;
  invoice_no?: string;
  primary_table_no: string | null;
  bill_status: string;
  bill_class: BillClass;
  is_group_member: boolean;
  group_cluster_id: string | null;
  group_type: GroupType | null;
  group_association_tier: GroupTier | null;
  is_manually_overridden?: boolean;
  manager_override_notes?: string | null;
  bill_net_amount: number;
  bill_pax: number;
  bill_apc: number;
  daypart: Daypart;
  outside_activities_net: number;
  outside_activities_qty: number;
  restaurant_food_net: number;
  restaurant_food_qty: number;
  classification_reason: string;
}

export interface GroupProfile {
  group_type: GroupType;
  sample_events_count: number;
  learned_apc: number;
  learned_units_per_guest: number;
  primary_daypart: Daypart | 'full_day';
  typical_dish_mix_json: Record<string, number>;
}

export interface EventType {
  id: string;
  code: string;
  name: string;
  name_hi: string;
  prior_revenue_multiplier: number;
  learned_revenue_multiplier: number;
  prior_volume_multiplier: number;
  learned_volume_multiplier: number;
  sample_count: number;
  is_active: boolean;
}

export interface DayContext {
  business_date: string;
  day_mode: DayMode;
  event_type_id?: string | null;
  expected_guests?: number;
  group_type?: GroupType | null;
  group_daypart?: 'breakfast' | 'lunch' | 'dinner' | 'full_day';
  group_notes?: string | null;
  custom_rev_multiplier_override?: number | null;
  custom_qty_multiplier_override?: number | null;
  tagged_retroactively?: boolean;
  updated_by?: string | null;
  updated_at?: string;
  event_type?: EventType | null;
}

export interface ModelStateRow {
  day_of_week: number;
  
  // Revenue Track State
  rev_baseline_net: number;
  rev_baseline_gross: number;
  rev_learned_discount_rate: number;
  rev_ewma_alpha: number;
  rev_smoothed_signed_error: number;
  rev_smoothed_abs_error: number;
  rev_tracking_signal: number;
  rev_signed_bias_pct: number;
  rev_applied_bias_pct: number;
  rev_recent_wape: number;
  rev_error_std: number;
  rev_confidence_score: number;
  
  // Quantity Track State
  qty_baseline_total_units: number;
  qty_baseline_orders: number;
  qty_baseline_covers: number;
  qty_ewma_alpha: number;
  qty_smoothed_signed_error: number;
  qty_smoothed_abs_error: number;
  qty_tracking_signal: number;
  qty_signed_bias_pct: number;
  qty_applied_bias_pct: number;
  qty_recent_wape: number;
  qty_error_std: number;
  qty_confidence_score: number;
  
  // Mixes
  category_volume_mix_json: Record<string, number>;
  category_revenue_mix_json: Record<string, number>;
  dish_volume_mix_json: Record<string, { share: number; avg_price: number; category?: string }>;
  sample_weeks_count: number;
  last_trained_date?: string | null;
  updated_at?: string;
}

export interface DishPredictionItem {
  dish_name: string;
  category: string;
  predicted_quantity: number;
  avg_price: number;
  implied_net_sales: number;
  volume_share_pct: number;
  qty_confidence_score: number;
}

export interface CategoryPredictionItem {
  category: string;
  predicted_units: number;
  predicted_net_sales: number;
  volume_share_pct: number;
  revenue_share_pct: number;
}

export interface DayForecastResult {
  business_date: string;
  day_of_week: number;
  day_mode: DayMode;
  context?: DayContext | null;
  
  // Revenue Track
  predicted_net_revenue: number;
  predicted_net_revenue_low: number;
  predicted_net_revenue_high: number;
  predicted_gross_revenue: number;
  predicted_discount_amount: number;
  rev_confidence_score: number;
  rev_confidence_tier: 'High' | 'Medium' | 'Low';
  rev_alpha_used: number;
  rev_applied_bias_pct: number;
  
  // Quantity Track
  predicted_total_units: number;
  predicted_orders: number;
  predicted_pax: number;
  qty_confidence_score: number;
  qty_confidence_tier: 'High' | 'Medium' | 'Low';
  qty_alpha_used: number;
  qty_applied_bias_pct: number;
  
  // Decomposition & Additive Group Demand
  event_rev_multiplier_used: number;
  event_qty_multiplier_used: number;
  additive_group_revenue: number;
  additive_group_units: number;
  implied_dish_net_revenue: number;
  revenue_reconciliation_delta: number;
  driver_summary: string;
  
  // Dish & Category Forecasts
  dishes: DishPredictionItem[];
  categories: CategoryPredictionItem[];
  
  // Model Training Health
  sample_weeks_count: number;
}

export interface GradedSnapshotRecord {
  id: string;
  business_date: string;
  day_of_week: number;
  frozen_at: string;
  snapshot_source: 'scheduled' | 'live_freeze' | 'backfill_replay';
  
  predicted_net_revenue: number;
  predicted_net_revenue_low: number;
  predicted_net_revenue_high: number;
  predicted_gross_revenue: number | null;
  predicted_discount_amount: number | null;
  implied_dish_net_revenue: number | null;
  revenue_reconciliation_delta: number | null;
  actual_net_revenue: number | null;
  actual_gross_revenue: number | null;
  actual_discount_amount: number | null;
  signed_rev_error: number | null;
  signed_rev_error_pct: number | null;
  abs_rev_error_pct: number | null;
  rev_confidence_score: number;
  rev_alpha_used: number;
  rev_bias_correction_used: number;
  was_rev_outlier_dampened: boolean;
  
  predicted_total_units: number;
  predicted_orders: number;
  predicted_pax: number | null;
  actual_total_units: number | null;
  actual_orders: number | null;
  actual_pax: number | null;
  signed_unit_error: number | null;
  signed_unit_error_pct: number | null;
  pax_signed_error: number | null;
  dish_wape: number | null;
  qty_confidence_score: number;
  qty_alpha_used: number;
  qty_bias_correction_used: number;
  was_qty_outlier_dampened: boolean;
  
  day_mode_at_prediction: string;
  event_type_id: string | null;
  event_rev_multiplier_used: number;
  event_qty_multiplier_used: number;
  expected_guests: number;
  additive_group_revenue: number;
  additive_group_units: number;
  driver_summary: string | null;
  
  decomp_normal_net: number;
  decomp_group_net: number;
  decomp_high_value_net: number;
  decomp_data_anomaly_net: number;
  decomp_outside_activities_net: number;
  decomp_normal_units: number;
  decomp_group_units: number;
  decomp_high_value_units: number;
  decomp_data_anomaly_units: number;
  decomp_complimentary_menu_value: number;
  daypart_breakdown_json: Record<string, any>;
  
  predicted_categories_json: CategoryPredictionItem[] | null;
  predicted_dishes_json: DishPredictionItem[] | null;
  actual_categories_json: any[] | null;
  actual_dishes_json: any[] | null;
  learning_summary_json: Record<string, any>;
  graded_at: string | null;
}
