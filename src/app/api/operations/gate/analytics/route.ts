import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  buildPrefixLookupMap,
  resolveSinglePrefix,
} from "@/lib/gate/prefix-resolver";
import { fetchGateVehicleEvents } from "@/lib/gate/vehicle-events";
import { classifyVehicle } from "@/lib/marketing/domain";
import { getBusinessDateRange } from "@/lib/business-date-ranges";
export interface GateHourlyPoint {
  hour: number;
  hour_label: string;
  cars: number;
  bikes: number;
  travellers: number;
  buses: number;
  total_vehicles: number;
  prefixes: Record<string, number>;
  is_nighttime: boolean;
}
export interface GateAnalyticsResponse {
  business_date: string;
  start_date: string;
  end_date: string;
  is_range: boolean;
  night_window: { start_hour: number; end_hour: number; label: string };
  summary: {
    total_cars: number;
    total_bikes: number;
    total_travellers: number;
    total_buses: number;
    total_vehicles: number;
    peak_vehicle_hour: { hour: number; label: string; count: number };
    nighttime: {
      cars: number;
      bikes: number;
      travellers: number;
      buses: number;
      total_vehicles: number;
      vehicles_percent: number;
    };
    prefixes: { name: string; count: number; percent: number }[];
  };
  hourly_data: GateHourlyPoint[];
}
export async function GET(request: NextRequest) {
  try {
    const db = await createServerSupabaseClient();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user)
      return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: 401 });
    const params = request.nextUrl.searchParams;
    const today = getBusinessDateRange("today").from!;
    const from = params.get("start_date") || params.get("date") || today,
      to = params.get("end_date") || from;
    if (getBusinessDateRange("custom", new Date(), from, to).status !== "ready")
      return NextResponse.json({ code: "INVALID_RANGE" }, { status: 400 });
    const nightStart = Number(params.get("night_start") || 23),
      nightEnd = Number(params.get("night_end") || 6);
    if (
      ![nightStart, nightEnd].every(
        (n) => Number.isInteger(n) && n >= 0 && n <= 23,
      )
    )
      return NextResponse.json({ code: "INVALID_RANGE" }, { status: 400 });
    const [events, prefixes] = await Promise.all([
      fetchGateVehicleEvents(db, from, to),
      db
        .from("vehicle_registration_prefixes")
        .select("*")
        .eq("is_active", true),
    ]);
    if (prefixes.error) throw prefixes.error;
    const map = buildPrefixLookupMap(prefixes.data || []),
      originCounts: Record<string, number> = {};
    const hours: GateHourlyPoint[] = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      hour_label: `${String(hour).padStart(2, "0")}:00`,
      cars: 0,
      bikes: 0,
      travellers: 0,
      buses: 0,
      total_vehicles: 0,
      prefixes: {},
      is_nighttime:
        nightStart > nightEnd
          ? hour >= nightStart || hour < nightEnd
          : hour >= nightStart && hour < nightEnd,
    }));
    for (const event of events.data) {
      const hour = new Date(
        new Date(event.timestamp).getTime() + 330 * 60000,
      ).getUTCHours();
      const bucket = hours[hour];
      if (!bucket) continue;
      const category = classifyVehicle(event);
      const increment = Number(event.increment) || 0;
      bucket[category] += increment;
      bucket.total_vehicles += increment;
      if (category === "cars") {
        const raw = event.vehicle_prefix || event.location?.name || "Unknown";
        const name =
          raw === "Unknown"
            ? params.get("locale") === "hi"
              ? "अज्ञात"
              : "Unknown"
            : resolveSinglePrefix(raw, map, params.get("locale") || "en")
                .locationName;
        bucket.prefixes[name] = (bucket.prefixes[name] || 0) + increment;
        originCounts[name] = (originCounts[name] || 0) + increment;
      }
    }
    const total = (
      key: "cars" | "bikes" | "travellers" | "buses" | "total_vehicles",
      night = false,
    ) =>
      hours
        .filter((h) => !night || h.is_nighttime)
        .reduce((sum, h) => sum + h[key], 0);
    const vehicles = total("total_vehicles"),
      nightVehicles = total("total_vehicles", true);
    const peak = hours.reduce(
      (p, h) => (h.total_vehicles > p.total_vehicles ? h : p),
      hours[0],
    );
    const result: GateAnalyticsResponse = {
      business_date: from,
      start_date: from,
      end_date: to,
      is_range: from !== to,
      night_window: {
        start_hour: nightStart,
        end_hour: nightEnd,
        label: `${nightStart}:00–${nightEnd}:00`,
      },
      hourly_data: hours,
      summary: {
        total_cars: total("cars"),
        total_bikes: total("bikes"),
        total_travellers: total("travellers"),
        total_buses: total("buses"),
        total_vehicles: vehicles,
        peak_vehicle_hour: {
          hour: peak.hour,
          label: peak.hour_label,
          count: peak.total_vehicles,
        },
        nighttime: {
          cars: total("cars", true),
          bikes: total("bikes", true),
          travellers: total("travellers", true),
          buses: total("buses", true),
          total_vehicles: nightVehicles,
          vehicles_percent: vehicles
            ? Math.round((nightVehicles / vehicles) * 1000) / 10
            : 0,
        },
        prefixes: Object.entries(originCounts)
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([name, count]) => ({
            name,
            count,
            percent: total("cars")
              ? Math.round((count / total("cars")) * 1000) / 10
              : 0,
          })),
      },
    };
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error(
      "Vehicle analytics failed",
      error instanceof Error ? error.message : "query failed",
    );
    return NextResponse.json({ code: "REQUEST_FAILED" }, { status: 500 });
  }
}
