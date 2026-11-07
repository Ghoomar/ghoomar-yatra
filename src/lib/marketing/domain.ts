/** Shared, side-effect-free contracts. Money crosses HTTP as decimal strings. */
export const MARKETING_CLIENT_VERSION = 1;
export const VEHICLE_CATEGORIES = [
  "CAR_5",
  "CAR_7",
  "TRAVELLER",
  "BUS",
] as const;
export type VehicleCategory = (typeof VEHICLE_CATEGORIES)[number];
export type Money = string;
export type BillState =
  | "PENDING_IMPORT"
  | "UNMATCHED"
  | "AMBIGUOUS"
  | "MATCHED"
  | "NON_SUCCESS"
  | "CONFLICT"
  | "SOURCE_REMOVED"
  | "VOID";
export function normalizeRegistration(value: string): string {
  return value.normalize("NFKC").trim().toUpperCase().replace(/[\s-]/g, "");
}
export function validRegistration(value: string): boolean {
  return /^[A-Z0-9]{5,16}$/.test(normalizeRegistration(value));
}
export function normalizePhone(value: string): string {
  let phone = value.normalize("NFKC").replace(/[\s()+-]/g, "");
  if (/^0[6-9]\d{9}$/.test(phone)) phone = phone.slice(1);
  if (/^[6-9]\d{9}$/.test(phone)) phone = `91${phone}`;
  if (!/^91[6-9]\d{9}$/.test(phone)) throw new Error("INVALID_PHONE");
  return `+${phone}`;
}
export const normalizeInvoice = (value: string): string =>
  value.trim().toUpperCase();
export function moneyToPaise(value: string): bigint {
  if (!/^-?\d{1,10}(\.\d{1,2})?$/.test(value))
    throw new Error("INVALID_AMOUNT");
  const negative = value.startsWith("-");
  const [whole, decimal = ""] = value.replace("-", "").split(".");
  const amount = BigInt(whole) * BigInt(100) + BigInt(decimal.padEnd(2, "0"));
  return negative ? -amount : amount;
}
export function classifyVehicle(event: {
  vehicle_category?: string | null;
  vehicle_prefix?: string | null;
  location?: { name?: string } | null;
}): "cars" | "bikes" | "travellers" | "buses" {
  if (event.vehicle_category === "TRAVELLER") return "travellers";
  if (event.vehicle_category === "BUS") return "buses";
  if (
    event.vehicle_category === "BIKE" ||
    (!event.vehicle_category &&
      (event.vehicle_prefix?.toLowerCase() === "bike" ||
        event.location?.name?.toLowerCase() === "bike"))
  )
    return "bikes";
  return "cars";
}
export interface Driver {
  id: string;
  name: string;
  phone: string;
  phone_normalized: string;
  is_active: boolean;
  version: number;
  redemption_exception?: boolean;
}
export interface Vehicle {
  id: string;
  registration: string;
  registration_normalized: string;
  make_model: string;
  category_code: VehicleCategory;
  is_active: boolean;
  version: number;
  drivers?: Driver[];
  effective_to?: string | null;
}
export interface Visit {
  id: string;
  driver_id: string;
  vehicle_id: string;
  driver_name_snapshot: string;
  registration_snapshot: string;
  category_code: VehicleCategory;
  business_date: string;
  arrived_at: string;
  brought_guests: boolean;
  eligible_amount: Money;
  actual_amount: Money;
  collection_status: string;
  reconciliation_state: string;
  version: number;
  guests: number;
  unresolved: number;
  confirmed_revenue: Money;
  voided_at: string | null;
  finalized_at: string | null;
  created_by: string;
}
export interface Bill {
  id: string;
  invoice_no: string;
  business_date: string;
  allocated_guests: number;
  state: BillState;
  last_amount: Money | null;
  voided_at: string | null;
  candidates: {
    id: string;
    invoice_no: string;
    status: string;
    net_sales: Money;
  }[];
}
export interface Punch {
  version: number;
  id: string;
  card_id: string;
  visit_id: string | null;
  source: string;
  status: string;
  review_reason: string | null;
  created_at: string;
}
export interface Card {
  id: string;
  cycle: number;
  credits: number;
  held: number;
  completed_at: string | null;
  redeemed: boolean;
}
export interface Reward {
  code: string;
  name: string;
  name_hi: string;
  cards_required: number;
}
export interface MarketingConfig {
  enabled: boolean;
  client_version: number;
  permissions: Record<string, boolean>;
  categories: { code: VehicleCategory; name: string; name_hi: string }[];
  rates: {
    category_code: VehicleCategory;
    valid_from: string;
    valid_to: string | null;
    amount: Money;
  }[];
  rewards: Reward[];
}
export interface OperatingMetrics {
  from: string;
  to: string;
  expected_days: number;
  imported_days: number;
  complete: boolean;
  live: boolean;
  net_sales: Money;
  bills: number;
  covers: number;
  cars: number;
  bikes: number;
  travellers: number;
  buses: number;
  spend_per_cover: Money | null;
  spend_per_bill: Money | null;
  covers_per_bill: string | null;
  covers_per_car: string | null;
  spend_per_car: Money | null;
}
