'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { createClient } from '@/lib/supabase/client';
import { getTodayBusinessDate } from '@/lib/utils';
import { Zap, Flame, Fuel, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import { ElectricityTab } from '@/components/utilities/ElectricityTab';
import { LpgTab } from '@/components/utilities/LpgTab';
import { DieselTab } from '@/components/utilities/DieselTab';

export default function UtilitiesPage() {
  const supabase = createClient();
  const [businessDate, setBusinessDate] = useState(getTodayBusinessDate());
  const [activeTab, setActiveTab] = useState<'electricity' | 'lpg' | 'diesel'>('electricity');

  const [meters, setMeters] = useState<any[]>([]);
  const [readings, setReadings] = useState<any[]>([]);
  const [selectedMeterId, setSelectedMeterId] = useState('');
  const [lpgTransactions, setLpgTransactions] = useState<any[]>([]);
  const [dieselTransactions, setDieselTransactions] = useState<any[]>([]);

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const { data: mData } = await supabase.from('meters').select('*').order('meter_name');
      const { data: rData } = await supabase
        .from('meter_readings')
        .select('*, meter:meters(meter_name)')
        .eq('business_date', businessDate)
        .order('reading_timestamp', { ascending: true });

      setMeters(mData || []);
      setReadings(rData || []);
      if (mData && mData.length > 0 && !selectedMeterId) {
        setSelectedMeterId(mData[0].id);
      }

      const { data: lpgData } = await supabase
        .from('lpg_transactions')
        .select('*')
        .order('transaction_date', { ascending: false });
      setLpgTransactions(lpgData || []);

      const { data: dData } = await supabase
        .from('diesel_transactions')
        .select('*')
        .order('transaction_date', { ascending: false });
      setDieselTransactions(dData || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [businessDate]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <Zap className="h-6 w-6 text-amber-600" />
            Utilities & Fuel Management
          </h1>
          <p className="text-sm text-stone-500">
            Electricity meter delta ledger, commercial LPG cylinder inventory, and diesel generator tracking.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-white border border-stone-200 rounded-lg px-3 py-1.5 shadow-2xs text-xs font-medium">
            <span className="text-stone-500">Date:</span>
            <input
              type="date"
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
              className="bg-transparent font-semibold text-stone-900 focus:outline-none cursor-pointer"
            />
          </div>
          <Button variant="outline" size="sm" onClick={loadData}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {message && (
        <div className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 ${message.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
          {message.type === 'success' ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {message.text}
        </div>
      )}

      {/* Tabs Header */}
      <div className="flex border-b border-stone-200 gap-6 text-sm font-semibold">
        <button
          onClick={() => setActiveTab('electricity')}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'electricity'
              ? 'border-amber-600 text-amber-700 font-bold'
              : 'border-transparent text-stone-500 hover:text-stone-800'
          }`}
        >
          <Zap className="h-4 w-4" /> Electricity Meter Readings
        </button>
        <button
          onClick={() => setActiveTab('lpg')}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'lpg'
              ? 'border-amber-600 text-amber-700 font-bold'
              : 'border-transparent text-stone-500 hover:text-stone-800'
          }`}
        >
          <Flame className="h-4 w-4" /> Commercial LPG Cylinders
        </button>
        <button
          onClick={() => setActiveTab('diesel')}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'diesel'
              ? 'border-amber-600 text-amber-700 font-bold'
              : 'border-transparent text-stone-500 hover:text-stone-800'
          }`}
        >
          <Fuel className="h-4 w-4" /> Diesel & Generator
        </button>
      </div>

      {activeTab === 'electricity' && (
        <ElectricityTab
          businessDate={businessDate}
          meters={meters}
          readings={readings}
          selectedMeterId={selectedMeterId}
          setSelectedMeterId={setSelectedMeterId}
          onRefresh={loadData}
          setMessage={setMessage}
        />
      )}

      {activeTab === 'lpg' && (
        <LpgTab
          businessDate={businessDate}
          transactions={lpgTransactions}
          onRefresh={loadData}
          setMessage={setMessage}
        />
      )}

      {activeTab === 'diesel' && (
        <DieselTab
          businessDate={businessDate}
          transactions={dieselTransactions}
          onRefresh={loadData}
          setMessage={setMessage}
        />
      )}
    </div>
  );
}
