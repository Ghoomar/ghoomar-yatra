import type { SupabaseClient } from "@supabase/supabase-js";
export interface VehicleEvent {
  id: string;
  location_id: string;
  increment: number;
  timestamp: string;
  vehicle_prefix: string | null;
  vehicle_category: string | null;
  taxi_visit_id: string | null;
  location: { id: string; name: string } | null;
}
/** Stable pagination: callers must not silently truncate a busy day at 1,000. */
export async function fetchGateVehicleEvents(
  db: SupabaseClient,
  from: string,
  to: string,
): Promise<{ data: VehicleEvent[] }> {
  const data: VehicleEvent[] = [];
  let lastId: string | null = null;
  for (;;) {
    let query = db
      .from("vehicle_counter_events")
      .select(
        "id,location_id,increment,timestamp,vehicle_prefix,vehicle_category,taxi_visit_id,location:vehicle_origin_locations(id,name)",
      )
      .gte("business_date", from)
      .lte("business_date", to)
      .is("voided_at", null)
      .order("id")
      .limit(1000);
    if (lastId) query = query.gt("id", lastId);
    const result = await query;
    if (result.error) throw result.error;
    const rows = (result.data || []).map((row) => ({
      ...row,
      location: Array.isArray(row.location)
        ? row.location[0] || null
        : row.location,
    })) as VehicleEvent[];
    data.push(...rows);
    if (rows.length < 1000) break;
    lastId = rows[rows.length - 1].id;
  }
  return { data };
}
