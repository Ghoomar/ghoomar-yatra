import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export interface GateHourlyPoint {
  hour: number;
  hour_label: string;
  visitors: number;
  visitor_taps: number;
  cars: number;
  bikes: number;
  total_vehicles: number;
  prefixes: Record<string, number>;
  is_nighttime: boolean;
}

export interface GateAnalyticsResponse {
  business_date: string;
  night_window: {
    start_hour: number;
    end_hour: number;
    label: string;
  };
  summary: {
    total_visitors: number;
    total_cars: number;
    total_bikes: number;
    total_vehicles: number;
    peak_visitor_hour: { hour: number; label: string; count: number };
    peak_vehicle_hour: { hour: number; label: string; count: number };
    nighttime: {
      visitors: number;
      cars: number;
      bikes: number;
      total_vehicles: number;
      visitors_percent: number;
      vehicles_percent: number;
    };
    prefixes: { name: string; count: number; percent: number }[];
  };
  hourly_data: GateHourlyPoint[];
}

function formatHourLabel(h: number): string {
  const displayH = h % 12 === 0 ? 12 : h % 12;
  const meridiem = h >= 12 ? 'PM' : 'AM';
  return `${String(displayH).padStart(2, '0')}:00 ${meridiem}`;
}

function isWithinNightWindow(hour: number, start: number, end: number): boolean {
  if (start > end) {
    // Overnight window, e.g. 23:00 to 06:00 (hour >= 23 or hour < 6)
    return hour >= start || hour < end;
  }
  // Standard window, e.g. 01:00 to 05:00
  return hour >= start && hour < end;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const searchParams = request.nextUrl.searchParams;

    const date = searchParams.get('date') || new Date().toISOString().substring(0, 10);
    const nightStart = parseInt(searchParams.get('night_start') || '23', 10);
    const nightEnd = parseInt(searchParams.get('night_end') || '6', 10);

    // 1. Query raw visitor events for date
    const { data: vEvents, error: vErr } = await supabase
      .from('visitor_counter_events')
      .select('increment, timestamp')
      .eq('business_date', date);

    if (vErr) throw vErr;

    // 2. Query raw vehicle events for date joined with location
    const { data: cEvents, error: cErr } = await supabase
      .from('vehicle_counter_events')
      .select('increment, timestamp, location:vehicle_origin_locations(id, name)')
      .eq('business_date', date);

    if (cErr) throw cErr;

    // 3. Initialize 24 hourly buckets (0..23)
    const hourlyMap = new Map<number, GateHourlyPoint>();
    for (let h = 0; h < 24; h++) {
      hourlyMap.set(h, {
        hour: h,
        hour_label: formatHourLabel(h),
        visitors: 0,
        visitor_taps: 0,
        cars: 0,
        bikes: 0,
        total_vehicles: 0,
        prefixes: {},
        is_nighttime: isWithinNightWindow(h, nightStart, nightEnd),
      });
    }

    // 4. Populate Visitor Hourly Buckets using ORIGINAL tap timestamp in IST
    let totalVisitors = 0;
    (vEvents || []).forEach((ev: any) => {
      if (!ev.timestamp) return;
      // Convert timestamp to IST hour
      const utcDate = new Date(ev.timestamp);
      // IST is UTC+5:30 (330 minutes)
      const istMs = utcDate.getTime() + 330 * 60 * 1000;
      const istDate = new Date(istMs);
      const hour = istDate.getUTCHours();

      const point = hourlyMap.get(hour);
      if (point) {
        const inc = Number(ev.increment) || 0;
        point.visitors += inc;
        point.visitor_taps += 1;
        totalVisitors += inc;
      }
    });

    // 5. Populate Vehicle Hourly Buckets using ORIGINAL tap timestamp in IST
    let totalCars = 0;
    let totalBikes = 0;
    const prefixCountMap: Record<string, number> = {};

    (cEvents || []).forEach((ev: any) => {
      if (!ev.timestamp) return;
      const utcDate = new Date(ev.timestamp);
      const istMs = utcDate.getTime() + 330 * 60 * 1000;
      const istDate = new Date(istMs);
      const hour = istDate.getUTCHours();

      const point = hourlyMap.get(hour);
      if (point) {
        const inc = Number(ev.increment) || 1;
        const originName = ev.location?.name || 'Others';
        const isBike = originName.toLowerCase() === 'bike';

        if (isBike) {
          point.bikes += inc;
          totalBikes += inc;
        } else {
          point.cars += inc;
          totalCars += inc;
          point.prefixes[originName] = (point.prefixes[originName] || 0) + inc;
          prefixCountMap[originName] = (prefixCountMap[originName] || 0) + inc;
        }
        point.total_vehicles = point.cars + point.bikes;
      }
    });

    const hourlyArray = Array.from(hourlyMap.values());

    // 6. Compute Peaks and Nighttime Aggregates
    let peakVisitorHour = { hour: 12, label: '12:00 PM', count: 0 };
    let peakVehicleHour = { hour: 12, label: '12:00 PM', count: 0 };

    let nightVisitors = 0;
    let nightCars = 0;
    let nightBikes = 0;

    hourlyArray.forEach((p) => {
      if (p.visitors > peakVisitorHour.count) {
        peakVisitorHour = { hour: p.hour, label: p.hour_label, count: p.visitors };
      }
      if (p.total_vehicles > peakVehicleHour.count) {
        peakVehicleHour = { hour: p.hour, label: p.hour_label, count: p.total_vehicles };
      }
      if (p.is_nighttime) {
        nightVisitors += p.visitors;
        nightCars += p.cars;
        nightBikes += p.bikes;
      }
    });

    const totalVehicles = totalCars + totalBikes;
    const nightTotalVehicles = nightCars + nightBikes;

    // Format prefixes summary
    const PREFIX_LIST = ['DL', 'UP16', 'UP22', 'UP23', 'HR', 'UK', 'Others'];
    const prefixSummary = PREFIX_LIST.map((pref) => {
      const count = prefixCountMap[pref] || 0;
      const percent = totalCars > 0 ? Math.round((count / totalCars) * 1000) / 10 : 0;
      return { name: pref, count, percent };
    });

    const startFmt = `${String(nightStart).padStart(2, '0')}:00`;
    const endFmt = `${String(nightEnd).padStart(2, '0')}:00`;

    const responsePayload: GateAnalyticsResponse = {
      business_date: date,
      night_window: {
        start_hour: nightStart,
        end_hour: nightEnd,
        label: `${startFmt} – ${endFmt}`,
      },
      summary: {
        total_visitors: totalVisitors,
        total_cars: totalCars,
        total_bikes: totalBikes,
        total_vehicles: totalVehicles,
        peak_visitor_hour: peakVisitorHour,
        peak_vehicle_hour: peakVehicleHour,
        nighttime: {
          visitors: nightVisitors,
          cars: nightCars,
          bikes: nightBikes,
          total_vehicles: nightTotalVehicles,
          visitors_percent: totalVisitors > 0 ? Math.round((nightVisitors / totalVisitors) * 1000) / 10 : 0,
          vehicles_percent: totalVehicles > 0 ? Math.round((nightTotalVehicles / totalVehicles) * 1000) / 10 : 0,
        },
        prefixes: prefixSummary,
      },
      hourly_data: hourlyArray,
    };

    return NextResponse.json(responsePayload);
  } catch (err: any) {
    console.error('Error computing gate analytics:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to compute gate analytics.' },
      { status: 500 }
    );
  }
}
