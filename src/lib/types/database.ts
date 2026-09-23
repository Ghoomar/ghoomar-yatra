export type RoleName = 
  | 'Admin'
  | 'Owner'
  | 'General Manager'
  | 'Accountant'
  | 'Cashier'
  | 'Storekeeper'
  | 'Department Head'
  | 'Gate Staff'
  | 'Viewer';

export interface UserProfile {
  id: string;
  full_name: string;
  email: string;
  phone?: string | null;
  role_id: string;
  role?: { id: string; name: RoleName; name_hi?: string };
  locale?: 'en' | 'hi';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface InventoryItemPosition {
  item_id: string;
  item_code: string;
  name: string;
  name_hi?: string | null;
  category_id: string;
  category_name?: string;
  category_name_hi?: string | null;
  inventory_class: 'Food Raw Material' | 'Non-Food Consumable' | 'Physical Asset' | 'Uniform';
  unit_id: string;
  unit_symbol?: string;
  unit_symbol_hi?: string | null;
  minimum_stock: number;
  preferred_stock: number;
  replenishment_frequency: string;
  storage_type: string;
  current_quantity: number;
  wac_cost: number;
  current_stock_value: number;
  last_movement_at?: string;
  is_active?: boolean;
}

export interface InventoryItem {
  id: string;
  item_code: string;
  name: string;
  name_hi?: string | null;
  category_id: string;
  inventory_class: 'Food Raw Material' | 'Non-Food Consumable' | 'Physical Asset' | 'Uniform';
  unit_id: string;
  secondary_unit_id?: string | null;
  conversion_factor?: number | null;
  shelf_life_days?: number | null;
  minimum_stock: number;
  preferred_stock: number;
  replenishment_frequency: string;
  storage_type: string;
  notes?: string | null;
  is_active: boolean;
  current_stock?: number;
  current_weighted_average_cost?: number;
  created_at?: string;
  updated_at?: string;
}

export interface VendorCategory {
  id: string;
  name: string;
  name_hi?: string | null;
  description?: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface Unit {
  id: string;
  name: string;
  name_hi?: string | null;
  symbol: string;
  symbol_hi?: string | null;
  is_active: boolean;
  created_at?: string;
}

export interface InventoryCategory {
  id: string;
  name: string;
  name_hi?: string | null;
  inventory_class: 'Food Raw Material' | 'Non-Food Consumable' | 'Physical Asset' | 'Uniform';
  is_active: boolean;
  created_at?: string;
}

export interface Department {
  id: string;
  name: string;
  name_hi?: string | null;
  code?: string | null;
  is_active: boolean;
  created_at?: string;
}

export interface Team {
  id: string;
  department_id: string;
  name: string;
  name_hi?: string | null;
  code?: string | null;
  is_active: boolean;
  created_at?: string;
  department?: { id: string; name: string; name_hi?: string | null };
}

export interface EmployeeRole {
  id: string;
  team_id: string;
  name: string;
  name_hi?: string | null;
  can_receive_store_issues?: boolean;
  is_active: boolean;
  created_at?: string;
  team?: { id: string; name: string; name_hi?: string | null; department_id: string; department?: { id: string; name: string; name_hi?: string | null } };
}

export interface InventoryItemMaster {
  id: string;
  item_code: string;
  name: string;
  category_id?: string | null;
  inventory_class: 'Food Raw Material' | 'Non-Food Consumable' | 'Physical Asset' | 'Uniform';
  unit_id?: string | null;
  secondary_unit_id?: string | null;
  minimum_stock: number;
  preferred_stock: number;
  replenishment_frequency?: string | null;
  storage_type?: string | null;
  shelf_life_days?: number | null;
  current_stock: number;
  current_weighted_average_cost: number;
  is_active: boolean;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
  unit?: { symbol: string; name: string };
  category?: { name: string };
}

export interface Vendor {
  id: string;
  vendor_code: string;
  name: string;
  contact_person?: string | null;
  phone?: string | null;
  alternate_phone?: string | null;
  address?: string | null;
  payment_terms?: string | null;
  payment_frequency?: string | null;
  preferred_payment_method_id?: string | null;
  supplier_categories?: string[] | null;
  is_active: boolean;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface VendorOutstandingSummary {
  vendor_id: string;
  vendor_code: string;
  vendor_name: string;
  contact_person?: string;
  phone?: string;
  alternate_phone?: string;
  total_purchased: number;
  total_paid: number;
  outstanding_balance: number;
  last_purchase_date?: string;
  is_active?: boolean;
  payment_terms?: string;
  payment_frequency?: string;
  supplier_categories?: string[];
}

export interface VendorLedgerEntry {
  id: string;
  date: string;
  type: 'purchase' | 'payment';
  reference_number: string;
  invoice_number?: string;
  description: string;
  debit: number;   // payment reduces liability
  credit: number;  // purchase increases liability
  running_balance: number;
}

export interface DailySalesSummary {
  sales_report_id: string;
  business_date: string;
  is_reported: boolean;
  gross_sales: number;
  discounts: number;
  tax_amount: number;
  net_sales: number;
  bill_count: number;
  customer_count: number;
  avg_spend_per_customer: number;
  total_payment_commissions: number;
  net_revenue_after_commission: number;
  last_updated_at: string;
}

export interface DailyFinancialSummary {
  business_date: string;
  closing_status: 'open' | 'closed' | 'reopened';
  revenue: number;
  sales_reported: boolean;
  revenue_last_updated?: string;
  customer_food_consumption: number;
  staff_food_consumption: number;
  wastage_cost: number;
  total_material_consumption: number;
  variable_expenses: number;
  payment_commissions: number;
  gross_operating_surplus: number;
}

export interface DailyTargetProgress {
  business_date: string;
  revenue_achieved: number;
  day_of_week: number;
  daily_target: number;
  target_achievement_percent: number;
  remaining_revenue_to_target: number;
  total_visitors: number;
  revenue_per_visitor: number;
  revenue_updated_at?: string;
  last_visitor_at?: string;
}

export type SalaryPeriodStatus = 'draft' | 'closed';
export type SalaryPaymentType = 'Salary Payment' | 'Advance Salary' | 'Settlement';
export type SalaryPaymentMethod = 'Bank Transfer' | 'Cash' | 'UPI' | 'Cheque';

export interface EmployeeSalaryPeriod {
  id: string;
  employee_id: string;
  salary_month: string; // 'YYYY-MM'
  monthly_salary: number;
  days_in_month: number;
  present_days: number;
  allotted_weekly_off: number;
  pay_days: number;
  per_day_salary: number;
  gross_earned_salary: number;
  attendance_penalties: number;
  manual_deductions: number;
  total_deductions: number;
  net_earned_salary: number;
  previous_pending_salary: number;
  total_salary_due: number;
  closing_pending_salary: number | null;
  status: SalaryPeriodStatus;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface EmployeeSalaryPayment {
  id: string;
  employee_id: string;
  salary_period_id?: string | null;
  salary_month: string;
  payment_date: string;
  amount: number;
  payment_method: SalaryPaymentMethod;
  reference_number?: string | null;
  payment_type: SalaryPaymentType;
  notes?: string | null;
  recorded_by?: string | null;
  created_at?: string;
}

export interface EmployeeSalarySummaryRow {
  period_id: string;
  employee_id: string;
  employee_code?: string | null;
  employee_name: string;
  employment_status: string;
  department_name?: string | null;
  role_name?: string | null;
  contractor_name?: string | null;
  salary_month: string;
  monthly_salary: number;
  days_in_month: number;
  present_days: number;
  allotted_weekly_off: number;
  pay_days: number;
  per_day_salary: number;
  gross_earned_salary: number;
  attendance_penalties: number;
  manual_deductions: number;
  total_deductions: number;
  net_earned_salary: number;
  previous_pending_salary: number;
  total_salary_due: number;
  total_salary_given: number;
  pending_salary_balance: number;
  payments_count: number;
  last_payment_date?: string | null;
  period_status: SalaryPeriodStatus;
  notes?: string | null;
  updated_at?: string;
}

export interface EmployeeFinancialBalance {
  employee_id: string;
  employee_code?: string;
  employee_name: string;
  employment_status: string;
  monthly_salary: number;
  department_name?: string;
  role_name?: string;
  outstanding_advance_balance: number;
  last_transaction_at?: string;
}

export type BreakEvenStatus = 'Healthy' | 'At Risk' | 'Below Break-Even';

export interface MTDFinancialSummary {
  month_start_date: string;
  selected_date: string;
  days_in_month: number;
  day_of_month: number;
  days_elapsed: number;
  days_remaining: number;
  mtd_net_sales: number;
  mtd_gross_sales: number;
  mtd_discounts: number;
  mtd_customer_food_cost: number;
  mtd_staff_food_cost: number;
  mtd_wastage_cost: number;
  mtd_total_material_consumption: number;
  mtd_variable_expenses: number;
  mtd_payment_commissions: number;
  mtd_gross_operating_surplus: number;
  days_reported: number;
  mtd_property_rent?: number;
  mtd_investor_share?: number;
}

export type EmploymentStatus = 'Active' | 'On Leave' | 'Resigned' | 'Terminated';

export type InventoryStorageType = 'Ambient' | 'Refrigerated' | 'Frozen' | 'Fresh' | 'Other';

export type ReplenishmentFrequency = 'Daily' | 'Periodic' | 'Monthly' | 'As Required';

export type InventoryClass = 'Food Raw Material' | 'Non-Food Consumable' | 'Physical Asset' | 'Uniform';

export interface FinancialCostRule {
  id: string;
  cost_name: string;
  category: string;
  calculation_method: 'fixed_monthly' | 'percentage_of_revenue' | 'actual_variable' | 'meter_based' | 'monthly_estimated' | string;
  amount_or_rate: number;
  start_date: string;
  end_date?: string | null;
  is_active: boolean;
  cost_classification: 'Fixed' | 'Variable';
  include_in_daily_profit: boolean;
  include_in_break_even: boolean;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface MeterReadingLedger {
  id: string;
  meter_id: string;
  business_date: string;
  reading_timestamp: string;
  reading_value: number;
  is_reset: boolean;
  notes?: string | null;
  recorded_by?: string | null;
  created_at?: string;
  previous_reading_value?: number | null;
  previous_reading_timestamp?: string | null;
  previous_is_reset?: boolean | null;
  delta_consumption: number;
  meter?: {
    id: string;
    meter_name: string;
    meter_number?: string | null;
    unit?: string;
  };
}

