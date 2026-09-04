'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { getTodayBusinessDate } from '@/lib/utils';
import { CalendarClock, Plus, RefreshCw, CheckCircle, AlertCircle, Music, Sparkles, Users, HeartHandshake } from 'lucide-react';

interface Performance {
  id: string;
  performance_date: string;
  start_time: string;
  end_time: string;
  performance_name: string;
  performance_type?: string;
  artist_name?: string;
  performer_count?: number;
  status: 'Scheduled' | 'Ongoing' | 'Completed' | 'Cancelled';
  notes?: string;
}

export default function StageSchedulePage() {
  const supabase = createClient();
  const [businessDate, setBusinessDate] = useState(getTodayBusinessDate());
  const [performances, setPerformances] = useState<Performance[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form
  const [name, setName] = useState('Ghoomar & Chari Dance');
  const [startTime, setStartTime] = useState('17:00');
  const [endTime, setEndTime] = useState('17:30');
  const [type, setType] = useState('Rajasthani Folk Dance');
  const [artist, setArtist] = useState('Padmawati Folk Troupe');
  const [performerCount, setPerformerCount] = useState<number>(6);
  const [notes, setNotes] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('stage_performances')
        .select('*')
        .eq('performance_date', businessDate)
        .order('start_time', { ascending: true });

      if (error) throw error;
      setPerformances(data || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [businessDate]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;
    setSaving(true);

    try {
      const { error } = await supabase.from('stage_performances').insert({
        performance_date: businessDate,
        start_time: startTime,
        end_time: endTime,
        performance_name: name,
        performance_type: type,
        artist_name: artist,
        performer_count: performerCount,
        status: 'Scheduled',
        notes: notes || null,
      });

      if (error) throw error;
      setMessage({ type: 'success', text: 'Stage performance scheduled successfully.' });
      setShowModal(false);
      setName('');
      setNotes('');
      loadData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Error creating schedule.' });
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateStatus = async (id: string, newStatus: Performance['status']) => {
    try {
      const { error } = await supabase.from('stage_performances').update({ status: newStatus }).eq('id', id);
      if (error) throw error;
      setPerformances(performances.map((p) => (p.id === id ? { ...p, status: newStatus } : p)));
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: 'Failed to update status.' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <CalendarClock className="h-6 w-6 text-amber-600" />
            Stage Entertainment & Cultural Schedule
          </h1>
          <p className="text-sm text-stone-500">
            Free live entertainment programming for highway visitors (5:00 PM – 11:00 PM in 30-min intervals).
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-white border border-stone-200 rounded-lg px-3 py-1.5 shadow-xs text-xs font-medium">
            <span className="text-stone-500">Date:</span>
            <input
              type="date"
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
              className="bg-transparent font-semibold text-stone-900 focus:outline-none cursor-pointer"
            />
          </div>
          <Button variant="primary" size="sm" onClick={() => setShowModal(true)} className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white">
            <Plus className="h-4 w-4" /> Add Performance
          </Button>
          <Button variant="outline" size="sm" onClick={loadData}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {message && (
        <div
          className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 ${
            message.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {message.type === 'success' ? <CheckCircle className="h-4 w-4 text-emerald-600" /> : <AlertCircle className="h-4 w-4 text-red-600" />}
          {message.text}
        </div>
      )}

      {/* Artists & Fiduciary Notice */}
      <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-xs">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-amber-100 rounded-lg text-amber-800 mt-0.5">
            <HeartHandshake className="h-5 w-5" />
          </div>
          <div>
            <span className="font-bold text-stone-900 block text-sm">Fiduciary Trust & Cultural Integrity</span>
            <p className="text-stone-600 mt-0.5">
              Stage artists receive standard contracted performance wages. Any monetary appreciation from visitors in stage tip boxes is held strictly in fiduciary trust and distributed 100% to performing artists. Never book as restaurant revenue.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 bg-white px-3 py-1.5 rounded-lg border border-amber-200">
          <Sparkles className="h-4 w-4 text-amber-600" />
          <span className="font-semibold text-stone-800">Prime Stage Hours:</span>
          <span className="text-amber-700 font-bold">17:00 – 23:00 IST</span>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Daily Stage Programming</CardTitle>
              <CardDescription>Performances sequence for {businessDate}</CardDescription>
            </div>
            <div className="flex items-center gap-2 text-xs text-stone-500">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
              {performances.filter((p) => p.status === 'Completed').length} / {performances.length} Completed
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="py-12 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin text-amber-600" /> Loading stage schedule...
            </div>
          ) : performances.length === 0 ? (
            <div className="py-12 text-center text-stone-400 text-xs">
              No stage performances scheduled for {businessDate}. Click &quot;Add Performance&quot; to program the evening stage.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                    <th className="py-2.5 px-3">Time Slot</th>
                    <th className="py-2.5 px-3">Performance Name</th>
                    <th className="py-2.5 px-3">Genre / Type</th>
                    <th className="py-2.5 px-3">Artist / Troupe</th>
                    <th className="py-2.5 px-3 text-center">Artists</th>
                    <th className="py-2.5 px-3 text-center">Status</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {performances.map((p) => (
                    <tr key={p.id} className="hover:bg-stone-50/80">
                      <td className="py-3 px-3 font-semibold text-stone-900 whitespace-nowrap">
                        {p.start_time.slice(0, 5)} – {p.end_time.slice(0, 5)}
                      </td>
                      <td className="py-3 px-3 font-bold text-stone-900">
                        <div className="flex items-center gap-2">
                          <Music className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                          <span>{p.performance_name}</span>
                        </div>
                        {p.notes && <p className="text-[11px] font-normal text-stone-500 mt-0.5">{p.notes}</p>}
                      </td>
                      <td className="py-3 px-3 text-stone-600">{p.performance_type || 'Cultural'}</td>
                      <td className="py-3 px-3 text-stone-700 font-medium">{p.artist_name || 'In-house Troupe'}</td>
                      <td className="py-3 px-3 text-center text-stone-600">
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3 w-3 text-stone-400" />
                          {p.performer_count ?? 1}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <Badge
                          variant={
                            p.status === 'Completed' ? 'success' : p.status === 'Ongoing' ? 'warning' : p.status === 'Cancelled' ? 'danger' : 'outline'
                          }
                        >
                          {p.status}
                        </Badge>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <select
                          value={p.status}
                          onChange={(e) => handleUpdateStatus(p.id, e.target.value as Performance['status'])}
                          className="rounded border border-stone-300 p-1 text-[11px] text-stone-800 bg-white cursor-pointer"
                        >
                          <option value="Scheduled">Scheduled</option>
                          <option value="Ongoing">Ongoing</option>
                          <option value="Completed">Completed</option>
                          <option value="Cancelled">Cancelled</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl text-xs">
            <div className="flex items-center justify-between border-b pb-3">
              <h2 className="text-base font-bold text-stone-900 flex items-center gap-2">
                <Music className="h-4 w-4 text-amber-600" /> Schedule Stage Performance
              </h2>
              <button onClick={() => setShowModal(false)} className="text-stone-400 hover:text-stone-700 text-lg">✕</button>
            </div>

            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="block font-medium text-stone-700 mb-1">Performance Title</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Kalbelia Folk Dance & Fire Acrobatics"
                  required
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-medium text-stone-700 mb-1">Start Time</label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    required
                    className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-medium text-stone-700 mb-1">End Time</label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    required
                    className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-medium text-stone-700 mb-1">Performance Genre</label>
                  <input
                    type="text"
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    placeholder="e.g. Rajasthani Folk Dance, Kathputli Puppet Show"
                    className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-medium text-stone-700 mb-1">Performer Count</label>
                  <input
                    type="number"
                    min="1"
                    value={performerCount}
                    onChange={(e) => setPerformerCount(parseInt(e.target.value) || 1)}
                    className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Artist / Troupe Name</label>
                <input
                  type="text"
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  placeholder="e.g. Jodhpur Cultural Troupe"
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Special Notes (Optional)</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Special fire props approved, live dholak accompaniment"
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button type="button" variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={saving} className="bg-amber-600 hover:bg-amber-700 text-white">
                  {saving ? 'Scheduling...' : 'Confirm Performance'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

