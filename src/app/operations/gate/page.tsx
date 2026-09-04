'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { createClient } from '@/lib/supabase/client';
import { getTodayBusinessDate, formatNumber, formatTimeAgo } from '@/lib/utils';
import { Users, Car, Undo2, RefreshCw, Clock } from 'lucide-react';

interface VehicleLocation {
  id: string;
  name: string;
  count: number;
}

export default function GateCounterPage() {
  const supabase = createClient();
  const [businessDate, setBusinessDate] = useState(getTodayBusinessDate());
  const [totalVisitors, setTotalVisitors] = useState<number>(0);
  const [totalCars, setTotalCars] = useState<number>(0);
  const [locations, setLocations] = useState<VehicleLocation[]>([]);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [lastEventId, setLastEventId] = useState<string | null>(null);
  const [lastEventType, setLastEventType] = useState<'visitor' | 'vehicle' | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Fetch vehicle locations master
      const { data: locData } = await supabase
        .from('vehicle_origin_locations')
        .select('*')
        .eq('is_active', true)
        .order('display_order');

      // 2. Fetch today's visitor count events
      const { data: vEvents } = await supabase
        .from('visitor_counter_events')
        .select('id, increment, timestamp')
        .eq('business_date', businessDate)
        .order('timestamp', { ascending: false });

      const vTotal = (vEvents || []).reduce((sum, e) => sum + (e.increment || 0), 0);
      setTotalVisitors(vTotal);

      // 3. Fetch today's vehicle events
      const { data: cEvents } = await supabase
        .from('vehicle_counter_events')
        .select('id, location_id, increment, timestamp')
        .eq('business_date', businessDate)
        .order('timestamp', { ascending: false });

      const cTotal = (cEvents || []).reduce((sum, e) => sum + (e.increment || 0), 0);
      setTotalCars(cTotal);

      // Calculate location counts
      setLocations(
        (locData || []).map((loc) => {
          const locEvents = (cEvents || []).filter((e) => e.location_id === loc.id);
          const count = locEvents.reduce((s, e) => s + (e.increment || 0), 0);
          return {
            id: loc.id,
            name: loc.name,
            count,
          };
        })
      );

      // Set last update time
      const latestVTime = vEvents?.[0]?.timestamp;
      const latestCTime = cEvents?.[0]?.timestamp;
      const latest = [latestVTime, latestCTime].filter(Boolean).sort().reverse()[0];
      setLastUpdatedAt(latest || null);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [businessDate]);

  const handleAddVisitors = async (increment: number) => {
    try {
      const { data, error } = await supabase
        .from('visitor_counter_events')
        .insert({
          business_date: businessDate,
          increment,
        })
        .select()
        .single();

      if (error) throw error;

      setTotalVisitors((prev) => prev + increment);
      setLastAction(`+${increment} Visitors`);
      setLastEventId(data.id);
      setLastEventType('visitor');
      setLastUpdatedAt(new Date().toISOString());
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleAddVehicle = async (locationId: string, locationName: string) => {
    try {
      const { data, error } = await supabase
        .from('vehicle_counter_events')
        .insert({
          business_date: businessDate,
          location_id: locationId,
          increment: 1,
        })
        .select()
        .single();

      if (error) throw error;

      setTotalCars((prev) => prev + 1);
      setLocations((prev) =>
        prev.map((l) => (l.id === locationId ? { ...l, count: l.count + 1 } : l))
      );
      setLastAction(`+1 Car from ${locationName}`);
      setLastEventId(data.id);
      setLastEventType('vehicle');
      setLastUpdatedAt(new Date().toISOString());
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleUndo = async () => {
    if (!lastEventId || !lastEventType) return;

    try {
      if (lastEventType === 'visitor') {
        await supabase.from('visitor_counter_events').delete().eq('id', lastEventId);
      } else {
        await supabase.from('vehicle_counter_events').delete().eq('id', lastEventId);
      }
      setLastAction('Undone last tap');
      setLastEventId(null);
      setLastEventType(null);
      loadData();
    } catch (err: any) {
      console.error(err);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-stone-900 text-white p-4 rounded-2xl shadow-md">
        <div>
          <div className="text-xs text-amber-400 font-bold uppercase tracking-wider">Highway Gate & Footfall Console</div>
          <h1 className="text-xl font-extrabold tracking-tight mt-0.5">Fast Touch Counter</h1>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <div className="bg-stone-800 border border-stone-700 rounded-lg px-3 py-1.5">
            <span className="text-stone-400">Date: </span>
            <strong className="text-white">{businessDate}</strong>
          </div>
          {lastUpdatedAt && (
            <div className="flex items-center gap-1.5 text-stone-300">
              <Clock className="h-3.5 w-3.5 text-amber-400" />
              <span>{formatTimeAgo(lastUpdatedAt)}</span>
            </div>
          )}
          <button onClick={loadData} className="p-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white border-2 border-stone-200/80 rounded-2xl p-5 text-center shadow-xs">
          <div className="flex items-center justify-center gap-1.5 text-xs font-semibold text-stone-500 uppercase tracking-wider">
            <Users className="h-4 w-4 text-amber-600" /> Today's Visitors
          </div>
          <div className="text-4xl md:text-5xl font-black text-stone-900 mt-2 tracking-tight">
            {formatNumber(totalVisitors)}
          </div>
          <div className="text-[11px] text-stone-400 mt-1">Cumulative footfall</div>
        </div>

        <div className="bg-white border-2 border-stone-200/80 rounded-2xl p-5 text-center shadow-xs">
          <div className="flex items-center justify-center gap-1.5 text-xs font-semibold text-stone-500 uppercase tracking-wider">
            <Car className="h-4 w-4 text-sky-600" /> Today's Vehicles
          </div>
          <div className="text-4xl md:text-5xl font-black text-stone-900 mt-2 tracking-tight">
            {formatNumber(totalCars)}
          </div>
          <div className="text-[11px] text-stone-400 mt-1">Total cars logged</div>
        </div>
      </div>

      {/* Undo Action Bar */}
      <div className="flex items-center justify-between bg-stone-100 border border-stone-200 p-3 rounded-xl text-xs">
        <span className="text-stone-600">
          {lastAction ? <span>Last Action: <strong className="text-stone-900">{lastAction}</strong></span> : 'No recent action'}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={handleUndo}
          disabled={!lastEventId}
          className="gap-1 text-xs border-stone-300 hover:bg-stone-200"
        >
          <Undo2 className="h-3.5 w-3.5" /> Undo Last Tap
        </Button>
      </div>

      {/* SECTION 1: VISITOR COUNTER BUTTONS */}
      <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-stone-900 uppercase tracking-wider flex items-center gap-2">
            <Users className="h-4 w-4 text-amber-600" /> Record Entering Visitors
          </h2>
          <span className="text-[11px] text-stone-400">Tap to increment instantly</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1, 2, 5, 10].map((inc) => (
            <button
              key={inc}
              onClick={() => handleAddVisitors(inc)}
              className="h-24 sm:h-28 rounded-2xl bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-stone-950 font-black text-3xl sm:text-4xl shadow-md shadow-amber-500/20 flex flex-col items-center justify-center transition-transform active:scale-95 cursor-pointer"
            >
              <span>+{inc}</span>
              <span className="text-xs font-bold uppercase tracking-wider text-amber-950/70 mt-1">
                {inc === 1 ? 'Person' : 'Group'}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* SECTION 2: VEHICLE ORIGIN COUNTER */}
      <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-stone-900 uppercase tracking-wider flex items-center gap-2">
            <Car className="h-4 w-4 text-sky-600" /> Record Vehicle by Origin
          </h2>
          <span className="text-[11px] text-stone-400">No registration plate stored</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {locations.map((loc) => (
            <button
              key={loc.id}
              onClick={() => handleAddVehicle(loc.id, loc.name)}
              className="h-20 sm:h-24 rounded-2xl bg-stone-900 hover:bg-stone-800 active:bg-stone-950 text-white p-3 flex flex-col items-center justify-center transition-transform active:scale-95 cursor-pointer shadow-sm"
            >
              <div className="text-xs sm:text-sm font-bold tracking-tight text-amber-400 uppercase">
                {loc.name}
              </div>
              <div className="text-lg sm:text-xl font-extrabold text-white mt-0.5">+1 Car</div>
              <div className="text-[10px] text-stone-400">Today: {loc.count}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
