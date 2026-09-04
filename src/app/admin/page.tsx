'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR } from '@/lib/utils';
import { Settings, Shield, Plus, RefreshCw, CheckCircle, AlertCircle, Database, Award, DollarSign } from 'lucide-react';

export default function AdminSettingsPage() {
  const supabase = createClient();
  const [activeTab, setActiveTab] = useState<'masters' | 'cost_rules' | 'targets' | 'users'>('masters');

  const [departments, setDepartments] = useState<any[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [costRules, setCostRules] = useState<any[]>([]);
  const [targets, setTargets] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const [
        { data: dData },
        { data: pmData },
        { data: crData },
        { data: tgData },
        { data: rData },
      ] = await Promise.all([
        supabase.from('departments').select('*').order('name'),
        supabase.from('payment_methods').select('*').order('name'),
        supabase.from('financial_cost_rules').select('*').order('cost_name'),
        supabase.from('financial_targets').select('*').order('weekday'),
        supabase.from('roles').select('*').order('name'),
      ]);

      setDepartments(dData || []);
      setPaymentMethods(pmData || []);
      setCostRules(crData || []);
      setTargets(tgData || []);
      setRoles(rData || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <Settings className="h-6 w-6 text-amber-600" />
            System Administration &amp; Master Configuration
          </h1>
          <p className="text-sm text-stone-500">
            Configure operational master data, cost rules, targets, roles, and business structures without code changes.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadData}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-stone-200 gap-6 text-sm font-semibold">
        <button
          onClick={() => setActiveTab('masters')}
          className={`pb-3 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'masters'
              ? 'border-amber-600 text-amber-600'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          Operational Masters
        </button>
        <button
          onClick={() => setActiveTab('cost_rules')}
          className={`pb-3 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'cost_rules'
              ? 'border-amber-600 text-amber-600'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          Financial Cost Rules
        </button>
        <button
          onClick={() => setActiveTab('targets')}
          className={`pb-3 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'targets'
              ? 'border-amber-600 text-amber-600'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          Daily &amp; Break-Even Targets
        </button>
        <button
          onClick={() => setActiveTab('users')}
          className={`pb-3 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'users'
              ? 'border-amber-600 text-amber-600'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          RBAC Roles &amp; Permissions
        </button>
      </div>

      {/* TAB 1: OPERATIONAL MASTERS */}
      {activeTab === 'masters' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Departments &amp; Divisions</CardTitle>
              <CardDescription>Organizational hierarchy roots</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {loading ? (
                <div className="py-8 text-center text-stone-400 text-xs">Loading departments...</div>
              ) : (
                <div className="divide-y divide-stone-100 text-xs">
                  {departments.map((d) => (
                    <div key={d.id} className="py-2.5 flex items-center justify-between">
                      <span className="font-semibold text-stone-900">{d.name}</span>
                      <Badge variant="outline">Code: {d.code || 'N/A'}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payment Methods &amp; Commissions</CardTitle>
              <CardDescription>Gateway and card merchant discount rates (MDR)</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {loading ? (
                <div className="py-8 text-center text-stone-400 text-xs">Loading payment methods...</div>
              ) : (
                <div className="divide-y divide-stone-100 text-xs">
                  {paymentMethods.map((pm) => (
                    <div key={pm.id} className="py-2.5 flex items-center justify-between">
                      <span className="font-semibold text-stone-900">{pm.name}</span>
                      <span className="text-stone-600 font-mono">Commission: {pm.commission_percent}%</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 2: COST RULES */}
      {activeTab === 'cost_rules' && (
        <Card>
          <CardHeader>
            <CardTitle>Financial Cost Rule Master</CardTitle>
            <CardDescription>Configurable calculation methods (Fixed, % Revenue, Variable, Metered)</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="py-12 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-amber-600" /> Loading cost rules...
              </div>
            ) : (
              <div className="overflow-x-auto text-xs">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                      <th className="py-2.5 px-3">Cost Name</th>
                      <th className="py-2.5 px-3">Category</th>
                      <th className="py-2.5 px-3">Method</th>
                      <th className="py-2.5 px-3 text-right">Amount / Rate</th>
                      <th className="py-2.5 px-3 text-center">Class</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {costRules.map((cr) => (
                      <tr key={cr.id} className="hover:bg-stone-50/80">
                        <td className="py-3 px-3 font-semibold text-stone-900">{cr.cost_name}</td>
                        <td className="py-3 px-3 text-stone-600">{cr.category}</td>
                        <td className="py-3 px-3 text-stone-700 font-mono">{cr.calculation_method}</td>
                        <td className="py-3 px-3 text-right font-bold text-stone-900">
                          {cr.calculation_method === 'percentage_of_revenue'
                            ? `${(Number(cr.amount_or_rate || 0) * 100).toFixed(1)}%`
                            : formatINR(Number(cr.amount_or_rate || 0))}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <Badge variant={cr.cost_classification === 'Fixed' ? 'info' : 'warning'}>
                            {cr.cost_classification}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* TAB 3: TARGETS */}
      {activeTab === 'targets' && (
        <Card>
          <CardHeader>
            <CardTitle>Operational Daily &amp; Planning Targets</CardTitle>
            <CardDescription>Configured by day of the week to align highway rush expectations</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="py-12 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-amber-600" /> Loading targets...
              </div>
            ) : (
              <div className="overflow-x-auto text-xs">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                      <th className="py-2.5 px-3">Target Scope</th>
                      <th className="py-2.5 px-3">Day / Type</th>
                      <th className="py-2.5 px-3 text-right">Configured Target Value</th>
                      <th className="py-2.5 px-3">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {targets.map((tg) => (
                      <tr key={tg.id} className="hover:bg-stone-50/80">
                        <td className="py-3 px-3 font-semibold text-stone-900 font-mono">{tg.target_type}</td>
                        <td className="py-3 px-3 text-stone-700 font-medium">
                          {tg.weekday !== null ? weekdayNames[tg.weekday] : 'Facility Level'}
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-amber-700 text-sm">
                          {tg.target_type === 'visitor_spend'
                            ? `${formatINR(Number(tg.target_value))} / visitor`
                            : formatINR(Number(tg.target_value))}
                        </td>
                        <td className="py-3 px-3 text-stone-500">{tg.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* TAB 4: RBAC ROLES */}
      {activeTab === 'users' && (
        <Card>
          <CardHeader>
            <CardTitle>Role-Based Access Control (RBAC)</CardTitle>
            <CardDescription>Granular permission boundaries for 9 operational roles</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="py-12 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-amber-600" /> Loading roles...
              </div>
            ) : (
              <div className="divide-y divide-stone-100 text-xs">
                {roles.map((r) => (
                  <div key={r.id} className="py-3 flex items-start justify-between gap-4">
                    <div>
                      <div className="font-bold text-stone-900 flex items-center gap-2">
                        <Shield className="h-4 w-4 text-amber-600" />
                        <span>{r.name}</span>
                        {r.is_system && <Badge variant="outline">System Core</Badge>}
                      </div>
                      <div className="text-stone-500 text-[11px] mt-0.5">{r.description}</div>
                    </div>
                    <Badge variant="success">Active</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

