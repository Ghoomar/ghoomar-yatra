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
  role?: { id: string; name: RoleName };
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface InventoryItemPosition {
  item_id: string;
  item_code: string;
  name: string;
  category_id: string;
  category_name?: string;
  inventory_class: 'Food Raw Material' | 'Non-Food Consumable' | 'Physical Asset' | 'Uniform';
  unit_id: string;
  unit_symbol?: string;
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

export interface VendorCategory {
  id: string;
  name: string;
  description?: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface Unit {
  id: string;
  name: string;
  symbol: string;
  is_active: boolean;
  created_at?: string;
}

export interface InventoryCategory {
  id: string;
  name: string;
  inventory_class: 'Food Raw Material' | 'Non-Food Consumable' | 'Physical Asset' | 'Uniform';
  is_active: boolean;
  created_at?: string;
}

export interface Department {
  id: string;
  name: string;
  code?: string | null;
  is_active: boolean;
  created_at?: string;
}

export interface Team {
  id: string;
  department_id: string;
  name: string;
  code?: string | null;
  is_active: boolean;
  created_at?: string;
  department?: { id: string; name: string };
}

export interface EmployeeRole {
  id: string;
  team_id: string;
  name: string;
  can_receive_store_issues?: boolean;
  is_active: boolean;
  created_at?: string;
  team?: { id: string; name: string; department_id: string; department?: { id: string; name: string } };
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
