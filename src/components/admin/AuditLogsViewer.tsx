'use client';

import React, { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { createClient } from '@/lib/supabase/client';
import { RefreshCw, History, Filter, ChevronDown, ChevronRight, User } from 'lucide-react';

interface AuditLogEntry {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_values: any;
  new_values: any;
  created_at: string;
  user_profile?: { full_name: string; email: string };
}

export function AuditLogsViewer() {
  const supabase = createClient();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState('ALL');
  const [entityFilter, setEntityFilter] = useState('ALL');

  const loadAuditLogs = async () => {
    setLoading(true);
    try {
      const { data: logsData, error } = await supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      // Fetch profiles to map user_ids to names
      const userIds = Array.from(
        new Set((logsData || []).map((l) => l.user_id).filter(Boolean))
      );

      let profileMap: Record<string, any> = {};
      if (userIds.length > 0) {
        const { data: pData } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', userIds);
        (pData || []).forEach((p) => {
          profileMap[p.id] = p;
        });
      }

      const enriched = (logsData || []).map((l) => ({
        ...l,
        user_profile: l.user_id ? profileMap[l.user_id] : null,
      }));

      setLogs(enriched);
    } catch (err: any) {
      console.error('Error loading audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAuditLogs();
  }, []);

  const formatIST = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
    } catch {
      return isoString;
    }
  };

  const getActionBadgeVariant = (action: string) => {
    switch (action) {
      case 'CREATE':
        return 'success';
      case 'UPDATE':
        return 'info';
      case 'DELETE':
        return 'danger';
      case 'DAY_LOCK':
        return 'danger';
      case 'DAY_REOPEN':
        return 'warning';
      case 'STATUS_CHANGE':
        return 'warning';
      default:
        return 'outline';
    }
  };

  const filteredLogs = logs.filter((l) => {
    const matchesAction = actionFilter === 'ALL' || l.action === actionFilter;
    const matchesEntity = entityFilter === 'ALL' || l.entity_type === entityFilter;
    return matchesAction && matchesEntity;
  });

  const availableEntities = Array.from(new Set(logs.map((l) => l.entity_type)));

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5 text-amber-600" />
              Central System Audit Trail
            </CardTitle>
            <CardDescription>
              Immutable chronological record of administrative actions, master data mutations, and day status locks
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={loadAuditLogs} className="gap-1 text-xs">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh Trail
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 pt-3">
          <div className="flex items-center gap-1.5 text-xs text-stone-600 font-medium">
            <Filter className="h-3.5 w-3.5 text-stone-400" />
            <span>Action:</span>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="rounded-md border border-stone-300 p-1 text-xs bg-white text-stone-800"
            >
              <option value="ALL">All Actions</option>
              <option value="CREATE">CREATE</option>
              <option value="UPDATE">UPDATE</option>
              <option value="DELETE">DELETE</option>
              <option value="STATUS_CHANGE">STATUS_CHANGE</option>
              <option value="DAY_LOCK">DAY_LOCK</option>
              <option value="DAY_REOPEN">DAY_REOPEN</option>
              <option value="SALARY_PAYOUT">SALARY_PAYOUT</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-stone-600 font-medium ml-2">
            <span>Entity:</span>
            <select
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
              className="rounded-md border border-stone-300 p-1 text-xs bg-white text-stone-800"
            >
              <option value="ALL">All Entities</option>
              {availableEntities.map((ent) => (
                <option key={ent} value={ent}>
                  {ent}
                </option>
              ))}
            </select>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {loading ? (
          <div className="py-12 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin text-amber-600" /> Loading audit records...
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="py-12 text-center text-stone-400 text-xs">
            No audit logs recorded matching the criteria.
          </div>
        ) : (
          <div className="border border-stone-200 rounded-xl overflow-hidden divide-y divide-stone-100 text-xs bg-white">
            {filteredLogs.map((log) => {
              const isExpanded = expandedId === log.id;
              return (
                <div key={log.id} className="transition-colors hover:bg-stone-50/50">
                  <div
                    onClick={() => setExpandedId(isExpanded ? null : log.id)}
                    className="p-3 flex items-center justify-between gap-4 cursor-pointer"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <button className="text-stone-400 hover:text-stone-600">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-amber-600" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>

                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={getActionBadgeVariant(log.action) as any}>
                            {log.action}
                          </Badge>
                          <span className="font-mono font-bold text-stone-900">
                            {log.entity_type}
                          </span>
                          {log.entity_id && (
                            <span className="text-stone-400 text-[11px] font-mono truncate max-w-[120px]">
                              #{log.entity_id}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 text-[11px] text-stone-500 mt-0.5">
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3 text-stone-400" />
                            {log.user_profile?.full_name || 'System / Admin'}
                          </span>
                          <span>•</span>
                          <span>{formatIST(log.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Diff Viewer */}
                  {isExpanded && (
                    <div className="px-6 pb-4 pt-1 bg-stone-50/80 border-t border-stone-100 space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-[11px]">
                        {log.old_values && (
                          <div className="bg-white p-3 rounded-lg border border-red-200">
                            <div className="font-bold text-red-700 mb-1 font-sans text-xs">
                              Previous State (Before Mutation):
                            </div>
                            <pre className="overflow-x-auto text-stone-700 whitespace-pre-wrap max-h-48">
                              {JSON.stringify(log.old_values, null, 2)}
                            </pre>
                          </div>
                        )}

                        {log.new_values && (
                          <div className="bg-white p-3 rounded-lg border border-emerald-200">
                            <div className="font-bold text-emerald-700 mb-1 font-sans text-xs">
                              Applied State (After Mutation):
                            </div>
                            <pre className="overflow-x-auto text-stone-700 whitespace-pre-wrap max-h-48">
                              {JSON.stringify(log.new_values, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
