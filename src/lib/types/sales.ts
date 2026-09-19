export type PetpoojaReportType =
  | 'HOURLY_ITEM_SALES'
  | 'ORDERS_MASTER'
  | 'EXECUTIVE_SUMMARY'
  | 'MENU_MASTER';

export interface PosMenuItem {
  id: string;
  name: string;
  online_name?: string | null;
  parent_category: string;
  category: string;
  category_online_display?: string | null;
  price: number;
  gst_percent: number;
  tax_type: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface SalesImportBatch {
  id: string;
  report_type: PetpoojaReportType;
  business_date: string;
  file_name: string;
  file_checksum: string;
  record_count: number;
  total_net_sales: number;
  total_gross_sales: number;
  raw_metadata?: any;
  imported_by?: string | null;
  created_at: string;
}

export interface SalesOrder {
  id: string;
  batch_id?: string;
  business_date: string;
  invoice_no: string;
  order_timestamp: string;
  hour_of_day: number;
  biller?: string | null;
  kot_numbers?: string | null;
  payment_type?: string | null;
  order_type?: string | null;
  status: string;
  area?: string | null;
  captain_name?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  covers_pax: number;
  gross_amount: number;
  discount_amount: number;
  net_sales: number;
  tax_amount: number;
  round_off: number;
  waived_off: number;
  grand_total: number;
  created_at?: string;
}

export interface SalesHourlyItem {
  id: string;
  batch_id?: string;
  business_date: string;
  hour_of_day: number;
  hour_label: string;
  item_name: string;
  parent_category: string;
  category: string;
  unit_price: number;
  quantity: number;
  net_amount: number;
  discount_amount: number;
  tax_amount: number;
  total_sales: number;
  net_sales: number;
  created_at?: string;
}

export interface SalesExecutiveSummary {
  id: string;
  batch_id?: string;
  business_date: string;
  successful_bills_count: number;
  invoice_range?: string | null;
  sub_total: number;
  discount: number;
  delivery_charges: number;
  container_charges: number;
  service_charges: number;
  cgst: number;
  sgst: number;
  total_tax: number;
  round_off: number;
  waived_off: number;
  grand_total: number;
  net_sales: number;
  cancelled_bills_count: number;
  cancelled_amount: number;
  order_type_breakdown?: any;
  payment_mode_breakdown?: any;
  raw_metadata?: any;
  created_at?: string;
}

export interface DailySalesReconciliationRow {
  business_date: string;
  exec_net_sales: number | null;
  exec_grand_total: number | null;
  exec_bills_count: number | null;
  orders_net_sales: number | null;
  orders_grand_total: number | null;
  orders_count: number | null;
  hourly_net_sales: number | null;
  hourly_items_sold: number | null;
  orders_exec_diff: number | null;
  hourly_exec_diff: number | null;
  reconciliation_status:
    | 'Reconciled'
    | 'Difference Found'
    | 'Missing Executive Summary'
    | 'Only Executive Summary Imported';
}

export interface HourlyCategoryDataPoint {
  hour: number;
  hour_label: string;
  total_sales: number;
  total_quantity: number;
  categories: Record<string, { amount: number; quantity: number }>;
}

export interface SalesAnalyticsResponse {
  dateRange: { start: string; end: string };
  kpis: {
    netSales: number;
    grossSales: number;
    totalBills: number;
    totalItemsSold: number;
    totalTax: number;
    totalDiscounts: number;
    averageOrderValue: number;
  };
  hourly: HourlyCategoryDataPoint[];
  parentCategoriesList: string[];
  breakdowns: {
    byParentCategory: { name: string; amount: number; quantity: number; sharePercent: number }[];
    byCategory: { name: string; parent: string; amount: number; quantity: number }[];
    byTopItems: { name: string; parentCategory: string; amount: number; quantity: number }[];
    byPaymentMode: { name: string; amount: number; sharePercent: number }[];
    byCaptain: { name: string; ordersCount: number; coversPax: number; netSales: number; avgOrder: number }[];
    byOrderType: { name: string; count: number; netSales: number; sharePercent: number }[];
  };
  reconciliation: DailySalesReconciliationRow | null;
  activeFilterOptions: {
    parentCategories: string[];
    categories: string[];
    items: string[];
    captains: string[];
    paymentTypes: string[];
    orderTypes: string[];
  };
}
