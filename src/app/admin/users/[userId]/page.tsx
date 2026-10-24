'use client';

import React, { useState, useEffect, useCallback, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useI18n } from '@/lib/i18n/context';
import {
  ArrowLeft,
  ShieldCheck,
  ShieldAlert,
  Laptop,
  Smartphone,
  Tablet,
  Monitor,
  Globe,
  Wifi,
  WifiOff,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Activity,
  Clock,
  Calendar,
  RefreshCw,
  LogOut,
  UserX,
  UserCheck,
  HardDrive,
  Cpu,
  Layers,
  Lock,
  Bell,
  ChevronDown,
  ChevronUp,
  Info,
  SlidersHorizontal,
  Mail,
  Phone,
  Radio,
  Fingerprint,
} from 'lucide-react';

interface UserDetailPageProps {
  params: Promise<{ userId: string }>;
}

export default function UserDetailPage({ params }: UserDetailPageProps) {
  const resolvedParams = use(params);
  const userId = resolvedParams.userId;
  const router = useRouter();
  const { t, locale, formatDate, formatTime } = useI18n();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | 'all'>('30d');
  const [activeTab, setActiveTab] = useState<'overview' | 'auth' | 'devices' | 'network' | 'reliability' | 'security'>('overview');
  const [authFilter, setAuthFilter] = useState<string>('all');
  const [expandedDevices, setExpandedDevices] = useState<Record<string, boolean>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadIntelligence = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/intelligence?timeRange=${timeRange}&eventType=${authFilter}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load user intelligence');
      setData(json);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  }, [userId, timeRange, authFilter]);

  useEffect(() => {
    loadIntelligence();
  }, [loadIntelligence]);

  const toggleDeviceExpanded = (id: string) => {
    setExpandedDevices((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleAction = async (action: 'toggle_status' | 'force_logout' | 'deregister_device', extraPayload?: any) => {
    let confirmMsg = '';
    if (action === 'toggle_status') {
      confirmMsg = data?.profile?.is_active
        ? t('people.intelligence.actions.confirmDeactivate')
        : (locale === 'hi' ? 'क्या आप इस यूजर को पुनः सक्रिय करना चाहते हैं?' : 'Are you sure you want to activate this user account?');
    } else if (action === 'force_logout') {
      confirmMsg = t('people.intelligence.actions.confirmForceLogout');
    } else if (action === 'deregister_device') {
      confirmMsg = t('people.intelligence.actions.confirmDeregisterDevice');
    }

    if (confirmMsg && !window.confirm(confirmMsg)) return;

    setActionLoading(action);
    try {
      const res = await fetch(`/api/admin/users/${userId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          isActive: action === 'toggle_status' ? !data?.profile?.is_active : undefined,
          ...extraPayload,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Action failed');
      await loadIntelligence();
    } catch (err: any) {
      alert(err.message || 'Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading && !data) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center gap-3">
        <RefreshCw className="h-8 w-8 animate-spin text-amber-600" />
        <p className="text-xs text-stone-500 font-medium tracking-wide">
          {locale === 'hi' ? 'यूजर इंटेलीजेंस लोड हो रहा है...' : 'Loading User Intelligence & Diagnostics...'}
        </p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-4">
        <div className="bg-white border border-stone-200 rounded-2xl shadow-xl p-6 max-w-md w-full text-center space-y-4">
          <AlertCircle className="h-10 w-10 text-rose-600 mx-auto" />
          <div>
            <h2 className="text-base font-bold text-stone-900">
              {locale === 'hi' ? 'डेटा लोड करने में त्रुटि' : 'Unable to Load User Intelligence'}
            </h2>
            <p className="text-xs text-stone-500 mt-1">{error}</p>
          </div>
          <div className="pt-2 flex justify-center gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push('/admin')}>
              <ArrowLeft className="h-4 w-4 mr-1.5" /> {t('people.intelligence.backToUsers')}
            </Button>
            <Button variant="amber" size="sm" onClick={loadIntelligence}>
              <RefreshCw className="h-4 w-4 mr-1.5" /> {t('common.actions.refresh')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const { profile, summary, presenceStatus, lastSeenTime, auth_events, devices, network, reliability, security_signals } = data;
  const isActive = profile.is_active !== false;

  const getDeviceIcon = (type?: string) => {
    switch (type) {
      case 'mobile':
        return <Smartphone className="h-4 w-4" />;
      case 'tablet':
        return <Tablet className="h-4 w-4" />;
      case 'laptop':
        return <Laptop className="h-4 w-4" />;
      default:
        return <Monitor className="h-4 w-4" />;
    }
  };

  const getPresenceBadge = (status: string) => {
    const hint = t('people.intelligence.presence.inferredHint');
    switch (status) {
      case 'active':
        return (
          <span
            title={hint}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs cursor-help"
          >
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            {t('people.intelligence.presence.active')}
          </span>
        );
      case 'idle':
        return (
          <span
            title={hint}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 cursor-help"
          >
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            {t('people.intelligence.presence.idle')}
          </span>
        );
      case 'offline':
        return (
          <span
            title={hint}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-stone-100 text-stone-600 border border-stone-200 cursor-help"
          >
            <span className="h-2 w-2 rounded-full bg-stone-400" />
            {t('people.intelligence.presence.offline')}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-stone-50 text-stone-500 border border-stone-200">
            <span className="h-2 w-2 rounded-full bg-stone-300" />
            {t('people.intelligence.presence.unknown')}
          </span>
        );
    }
  };

  const initials = (profile.full_name || 'User')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((s: string) => s[0].toUpperCase())
    .join('');

  return (
    <div className="space-y-6 pb-12">
      {/* Top Breadcrumb Navigation */}
      <div className="flex items-center justify-between">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-600 hover:text-stone-900 transition-colors group"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          <span>{t('people.intelligence.backToUsers')}</span>
        </Link>
        <div className="flex items-center gap-1 text-[11px] text-stone-400 font-mono">
          <span>UID: {profile.id}</span>
        </div>
      </div>

      {/* Header Profile Identity Card */}
      <Card className="border-stone-200 shadow-sm overflow-hidden bg-white">
        <div className="p-4 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-start sm:items-center gap-4">
            <div className="relative">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-amber-500/10 border-2 border-amber-500/20 flex items-center justify-center text-amber-700 font-black text-xl sm:text-2xl shadow-xs shrink-0">
                {initials}
              </div>
              <span
                className={`absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-white ${
                  isActive ? 'bg-emerald-500' : 'bg-rose-500'
                }`}
                title={isActive ? 'Active User' : 'Deactivated'}
              />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black text-stone-900 tracking-tight">
                  {profile.full_name}
                </h1>
                <Badge variant="outline" className="font-semibold text-stone-800 bg-stone-50 border-stone-200">
                  {profile.role?.name || 'Staff'}
                </Badge>
                {getPresenceBadge(presenceStatus)}
                {isActive ? (
                  <Badge variant="success">{t('statuses.active')}</Badge>
                ) : (
                  <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 font-bold">
                    {t('statuses.inactive')}
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-y-1 gap-x-4 text-xs text-stone-500 font-mono">
                <span className="flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5 text-stone-400" /> {profile.email}
                </span>
                <span className="flex items-center gap-1">
                  <Phone className="h-3.5 w-3.5 text-stone-400" /> {profile.phone || '—'}
                </span>
                <span className="flex items-center gap-1 text-stone-400">
                  <Calendar className="h-3.5 w-3.5" />
                  {locale === 'hi' ? 'निर्मित:' : 'Created:'} {formatDate(profile.created_at, 'short')}
                </span>
              </div>
            </div>
          </div>

          {/* Administrative Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 pt-2 md:pt-0 border-t md:border-t-0 border-stone-100">
            <Button
              variant={isActive ? 'outline' : 'amber'}
              size="sm"
              disabled={Boolean(actionLoading)}
              onClick={() => handleAction('toggle_status')}
              className={`h-8 px-3 text-xs gap-1.5 font-semibold ${
                isActive ? 'text-stone-700 border-stone-200 hover:bg-stone-50' : 'bg-amber-600 text-white'
              }`}
            >
              {actionLoading === 'toggle_status' ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : isActive ? (
                <UserX className="h-3.5 w-3.5 text-stone-500" />
              ) : (
                <UserCheck className="h-3.5 w-3.5 text-white" />
              )}
              <span>{isActive ? t('people.intelligence.actions.deactivate') : t('people.intelligence.actions.activate')}</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              disabled={Boolean(actionLoading)}
              onClick={() => handleAction('force_logout')}
              className="h-8 px-3 text-xs gap-1.5 text-stone-700 border-stone-200 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 transition-colors font-semibold"
              title="Invalidate all active sessions"
            >
              {actionLoading === 'force_logout' ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <LogOut className="h-3.5 w-3.5 text-rose-500" />
              )}
              <span>{t('people.intelligence.actions.forceLogout')}</span>
            </Button>
          </div>
        </div>

        {/* Time Window Selector Bar */}
        <div className="px-4 sm:px-6 py-2.5 bg-stone-50/80 border-t border-stone-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-stone-500 font-medium">
            <SlidersHorizontal className="h-3.5 w-3.5 text-stone-400" />
            <span>{locale === 'hi' ? 'एनालिटिक्स समय विंडो:' : 'Analytics Time Window:'}</span>
          </div>
          <div className="flex items-center gap-1 bg-white p-0.5 rounded-lg border border-stone-200 shadow-2xs">
            <button
              onClick={() => setTimeRange('7d')}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                timeRange === '7d'
                  ? 'bg-amber-600 text-white shadow-2xs'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              {t('people.intelligence.kpi.sevenDays')}
            </button>
            <button
              onClick={() => setTimeRange('30d')}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                timeRange === '30d'
                  ? 'bg-amber-600 text-white shadow-2xs'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              {t('people.intelligence.kpi.thirtyDays')}
            </button>
            <button
              onClick={() => setTimeRange('all')}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                timeRange === 'all'
                  ? 'bg-amber-600 text-white shadow-2xs'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              {t('people.intelligence.kpi.allTime')}
            </button>
          </div>
        </div>
      </Card>

      {/* Summary KPI Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* KPI 1: Last Successful Login */}
        <Card className="p-3 border-stone-200 shadow-2xs bg-white">
          <div className="flex items-center gap-2 text-[11px] font-bold text-stone-500 uppercase tracking-wider">
            <Clock className="h-3.5 w-3.5 text-amber-600" />
            <span className="truncate">{t('people.intelligence.kpi.lastLogin')}</span>
          </div>
          <div className="mt-2 text-xs font-black text-stone-900">
            {summary.last_successful_login ? formatDate(summary.last_successful_login, 'short') : t('people.intelligence.kpi.never')}
          </div>
          <div className="text-[10px] text-stone-400 mt-0.5">
            {summary.last_successful_login ? formatTime(summary.last_successful_login) : 'No login recorded'}
          </div>
        </Card>

        {/* KPI 2: Total Logins All-Time */}
        <Card className="p-3 border-stone-200 shadow-2xs bg-white">
          <div className="flex items-center gap-2 text-[11px] font-bold text-stone-500 uppercase tracking-wider">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            <span className="truncate">{t('people.intelligence.kpi.totalLogins')}</span>
          </div>
          <div className="mt-2 text-xl font-black text-stone-900">
            {summary.total_successful_logins}
          </div>
          <div className="text-[10px] text-stone-400 mt-0.5">
            {summary.successful_logins_period} in selected {timeRange}
          </div>
        </Card>

        {/* KPI 3: Failed Login Attempts */}
        <Card className="p-3 border-stone-200 shadow-2xs bg-white">
          <div className="flex items-center gap-2 text-[11px] font-bold text-stone-500 uppercase tracking-wider">
            <AlertTriangle className={`h-3.5 w-3.5 ${summary.failed_logins_period > 0 ? 'text-rose-600' : 'text-stone-400'}`} />
            <span className="truncate">{t('people.intelligence.kpi.failedAttempts', { range: timeRange })}</span>
          </div>
          <div className={`mt-2 text-xl font-black ${summary.failed_logins_period > 0 ? 'text-rose-600' : 'text-stone-900'}`}>
            {summary.failed_logins_period}
          </div>
          <div className="text-[10px] text-stone-400 mt-0.5">
            {summary.failed_logins_period > 0 ? 'Authentication failures' : 'Clean auth period'}
          </div>
        </Card>

        {/* KPI 4: Registered Devices */}
        <Card className="p-3 border-stone-200 shadow-2xs bg-white">
          <div className="flex items-center gap-2 text-[11px] font-bold text-stone-500 uppercase tracking-wider">
            <Fingerprint className="h-3.5 w-3.5 text-amber-600" />
            <span className="truncate">{t('people.intelligence.kpi.devicesCount')}</span>
          </div>
          <div className="mt-2 text-xl font-black text-stone-900">
            {summary.registered_devices_count}
          </div>
          <div className="text-[10px] text-stone-400 mt-0.5">
            {devices.filter((d: any) => d.is_gate_device).length} Gate Terminals
          </div>
        </Card>

        {/* KPI 5: Most Recent Device */}
        <Card className="p-3 border-stone-200 shadow-2xs bg-white">
          <div className="flex items-center gap-2 text-[11px] font-bold text-stone-500 uppercase tracking-wider">
            <HardDrive className="h-3.5 w-3.5 text-stone-600" />
            <span className="truncate">{t('people.intelligence.kpi.recentDevice')}</span>
          </div>
          <div className="mt-2 text-xs font-bold text-stone-900 truncate" title={summary.most_recent_device?.device_label || '—'}>
            {summary.most_recent_device?.browser_name ? `${summary.most_recent_device.browser_name} (${summary.most_recent_device.os_name || 'OS'})` : (summary.most_recent_device?.device_label || '—')}
          </div>
          <div className="text-[10px] text-stone-400 mt-0.5">
            {summary.most_recent_device?.screen_resolution || 'Resolution unavailable'}
          </div>
        </Card>

        {/* KPI 6: App Reliability Health */}
        <Card className="p-3 border-stone-200 shadow-2xs bg-white">
          <div className="flex items-center gap-2 text-[11px] font-bold text-stone-500 uppercase tracking-wider">
            <Activity className="h-3.5 w-3.5 text-emerald-600" />
            <span className="truncate">{t('people.intelligence.kpi.reliabilityStatus')}</span>
          </div>
          <div className="mt-2 text-xs font-bold text-stone-900">
            {reliability.summary.total_errors === 0
              ? '100% Healthy'
              : `${reliability.summary.total_errors} Technical Events`}
          </div>
          <div className="text-[10px] text-stone-400 mt-0.5 truncate">
            {reliability.summary.api_failures > 0 ? `${reliability.summary.api_failures} API timeouts` : 'Zero API failures'}
          </div>
        </Card>
      </div>

      {/* Tabs Navigation */}
      <div className="flex overflow-x-auto border-b border-stone-200 gap-2 sm:gap-6 text-xs font-bold text-stone-600">
        <button
          onClick={() => setActiveTab('overview')}
          className={`pb-3 border-b-2 transition-colors cursor-pointer shrink-0 ${
            activeTab === 'overview'
              ? 'border-amber-600 text-amber-600'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          {t('people.intelligence.tabs.overview')}
        </button>
        <button
          onClick={() => setActiveTab('auth')}
          className={`pb-3 border-b-2 transition-colors cursor-pointer shrink-0 flex items-center gap-1.5 ${
            activeTab === 'auth'
              ? 'border-amber-600 text-amber-600'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          <span>{t('people.intelligence.tabs.auth')}</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-stone-100 text-stone-600 font-mono">
            {auth_events.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('devices')}
          className={`pb-3 border-b-2 transition-colors cursor-pointer shrink-0 flex items-center gap-1.5 ${
            activeTab === 'devices'
              ? 'border-amber-600 text-amber-600'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          <span>{t('people.intelligence.tabs.devices')}</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-stone-100 text-stone-600 font-mono">
            {devices.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('network')}
          className={`pb-3 border-b-2 transition-colors cursor-pointer shrink-0 ${
            activeTab === 'network'
              ? 'border-amber-600 text-amber-600'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          {t('people.intelligence.tabs.network')}
        </button>
        <button
          onClick={() => setActiveTab('reliability')}
          className={`pb-3 border-b-2 transition-colors cursor-pointer shrink-0 flex items-center gap-1.5 ${
            activeTab === 'reliability'
              ? 'border-amber-600 text-amber-600'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          <span>{t('people.intelligence.tabs.reliability')}</span>
          {reliability.summary.total_errors > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-100 text-rose-700 font-mono font-bold">
              {reliability.summary.total_errors}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('security')}
          className={`pb-3 border-b-2 transition-colors cursor-pointer shrink-0 flex items-center gap-1.5 ${
            activeTab === 'security'
              ? 'border-amber-600 text-amber-600'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          <span>{t('people.intelligence.tabs.security')}</span>
          {security_signals.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-100 text-amber-800 font-mono font-bold">
              {security_signals.length}
            </span>
          )}
        </button>
      </div>

      {/* TAB 1: OVERVIEW & IDENTITY */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Identity & Account Specs */}
            <Card className="border-stone-200 bg-white">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-amber-600" />
                  {locale === 'hi' ? 'पहचान व सुरक्षा स्थिति' : 'Identity & Security Profile'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-stone-50 border border-stone-200">
                  <span className="text-stone-500">Auth Identity UUID</span>
                  <span className="font-mono text-[11px] text-stone-900 font-bold truncate">{profile.id}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-stone-50 border border-stone-200">
                  <span className="text-stone-500">Primary Email</span>
                  <span className="font-mono text-stone-900 font-semibold">{profile.email}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-stone-50 border border-stone-200">
                  <span className="text-stone-500">Registered Mobile</span>
                  <span className="font-mono text-stone-900 font-semibold">{profile.phone || 'None linked'}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-stone-50 border border-stone-200">
                  <span className="text-stone-500">Assigned RBAC Role</span>
                  <span className="font-bold text-stone-900">{profile.role?.name}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-stone-50 border border-stone-200">
                  <span className="text-stone-500">Preferred Locale</span>
                  <span className="font-semibold text-stone-900">{profile.locale === 'hi' ? 'Hindi (हिन्दी)' : 'English (en)'}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-stone-50 border border-stone-200">
                  <span className="text-stone-500">Account Enrolled</span>
                  <span className="text-stone-700">{formatDate(profile.created_at, 'long')}</span>
                </div>
              </CardContent>
            </Card>

            {/* Latest Observed Client Snapshot */}
            <Card className="border-stone-200 bg-white">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Monitor className="h-4 w-4 text-amber-600" />
                  {locale === 'hi' ? 'नवीनतम क्लाइंट वातावरण' : 'Latest Environment Snapshot'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                {summary.most_recent_device ? (
                  <>
                    <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-stone-50 border border-stone-200">
                      <span className="text-stone-500">Operating System</span>
                      <span className="font-bold text-stone-900">
                        {summary.most_recent_device.os_name || 'Unknown'} {summary.most_recent_device.os_version || ''}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-stone-50 border border-stone-200">
                      <span className="text-stone-500">Browser</span>
                      <span className="font-bold text-stone-900">
                        {summary.most_recent_device.browser_name || 'Unknown'} {summary.most_recent_device.browser_version || ''}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-stone-50 border border-stone-200">
                      <span className="text-stone-500">Display Resolution</span>
                      <span className="font-mono text-stone-900 font-semibold">
                        {summary.most_recent_device.screen_resolution || '—'} (DPR {summary.most_recent_device.device_pixel_ratio || 1})
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-stone-50 border border-stone-200">
                      <span className="text-stone-500">Client Timezone</span>
                      <span className="font-mono text-stone-900">{summary.most_recent_device.timezone || 'Asia/Kolkata'}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-stone-50 border border-stone-200">
                      <span className="text-stone-500">PWA Installed Mode</span>
                      <span className="font-semibold text-stone-900">
                        {summary.most_recent_device.standalone_mode ? 'Standalone App' : 'Browser View'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-stone-50 border border-stone-200">
                      <span className="text-stone-500">Last Observation</span>
                      <span className="text-stone-700">
                        {summary.most_recent_device.last_seen_at ? formatDate(summary.most_recent_device.last_seen_at, 'short') : '—'}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="py-8 text-center text-stone-400">
                    {locale === 'hi' ? 'अभी तक कोई वातावरण डेटा दर्ज नहीं हुआ है।' : 'No device snapshots recorded yet. Telemetry is captured on user login.'}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* TAB 2: AUTHENTICATION TIMELINE */}
      {activeTab === 'auth' && (
        <Card className="border-stone-200 bg-white">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3">
            <div>
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-600" />
                {t('people.intelligence.timeline.title')}
              </CardTitle>
              <CardDescription className="text-xs">
                Chronological ledger of user logins, failed attempts, and administrative session events.
              </CardDescription>
            </div>
            {/* Filter Pills */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <button
                onClick={() => setAuthFilter('all')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                  authFilter === 'all' ? 'bg-amber-600 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                }`}
              >
                {t('people.intelligence.timeline.filterAll')}
              </button>
              <button
                onClick={() => setAuthFilter('login_success')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                  authFilter === 'login_success' ? 'bg-emerald-600 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                }`}
              >
                {t('people.intelligence.timeline.filterSuccess')}
              </button>
              <button
                onClick={() => setAuthFilter('login_failure')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                  authFilter === 'login_failure' ? 'bg-rose-600 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                }`}
              >
                {t('people.intelligence.timeline.filterFailure')}
              </button>
              <button
                onClick={() => setAuthFilter('logout')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                  authFilter === 'logout' ? 'bg-stone-800 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                }`}
              >
                {t('people.intelligence.timeline.filterLogout')}
              </button>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {auth_events.length === 0 ? (
              <div className="py-12 text-center text-stone-400 text-xs">
                {t('people.intelligence.timeline.noEvents')}
              </div>
            ) : (
              <div className="overflow-x-auto text-xs">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                      <th className="py-2.5 px-3">Timestamp</th>
                      <th className="py-2.5 px-3">Event Type</th>
                      <th className="py-2.5 px-3">Identifier Used</th>
                      <th className="py-2.5 px-3">Status / Diagnostics</th>
                      <th className="py-2.5 px-3">IP Address</th>
                      <th className="py-2.5 px-3">Client Environment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {auth_events.map((ev: any) => {
                      const isSuccess = ev.status === 'success';
                      return (
                        <tr key={ev.id} className="hover:bg-stone-50/70 transition-colors">
                          <td className="py-2.5 px-3 font-mono text-stone-700 whitespace-nowrap">
                            {formatDate(ev.created_at, 'short')} {formatTime(ev.created_at)}
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${
                                isSuccess
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : 'bg-rose-50 text-rose-700 border border-rose-200'
                              }`}
                            >
                              {isSuccess ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                              <span>{t(`people.intelligence.timeline.eventTypes.${ev.event_type}`) || ev.event_type}</span>
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-stone-900 font-semibold">
                            {ev.identifier}
                          </td>
                          <td className="py-2.5 px-3 text-stone-600">
                            {ev.failure_reason ? (
                              <span className="text-rose-600 font-medium">{ev.failure_reason}</span>
                            ) : (
                              <span className="text-emerald-700 font-medium">Session Authenticated</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-stone-600">
                            {ev.ip_address || '—'}
                          </td>
                          <td className="py-2.5 px-3 text-stone-500 text-[11px] max-w-[200px] truncate" title={ev.user_agent}>
                            {ev.user_agent || 'Unknown'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* TAB 3: REGISTERED DEVICES */}
      {activeTab === 'devices' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-stone-900 flex items-center gap-2">
                <Fingerprint className="h-4 w-4 text-amber-600" />
                {t('people.intelligence.deviceLabels.title')} ({devices.length})
              </h2>
              <p className="text-xs text-stone-500 mt-0.5">
                {t('people.intelligence.deviceLabels.subtitle')}
              </p>
            </div>
          </div>

          {devices.length === 0 ? (
            <Card className="p-8 text-center text-stone-400 text-xs border-stone-200 bg-white">
              {t('people.intelligence.deviceLabels.noDevices')}
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {devices.map((d: any) => {
                const isExpanded = Boolean(expandedDevices[d.device_id]);
                return (
                  <Card key={d.device_id} className="border-stone-200 shadow-2xs bg-white overflow-hidden">
                    <div className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700 shrink-0">
                            {getDeviceIcon(d.device_type)}
                          </div>
                          <div>
                            <h3 className="text-xs font-bold text-stone-900">
                              {d.device_label || d.device_name || 'Client Device'}
                            </h3>
                            <div className="text-[11px] text-stone-500 font-mono">
                              ID: {d.device_id.slice(0, 16)}...
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {d.is_gate_device ? (
                            <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-300 font-bold">
                              Gate Terminal
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-stone-600 border-stone-200">
                              Standard Web
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Device Quick Attributes */}
                      <div className="grid grid-cols-2 gap-2 text-[11px] text-stone-600 pt-1">
                        <div>
                          <span className="text-stone-400 block text-[10px] uppercase font-bold tracking-wider">
                            {t('people.intelligence.deviceLabels.lastSeen')}
                          </span>
                          <span className="font-medium text-stone-800">
                            {d.last_seen_at ? formatDate(d.last_seen_at, 'short') : '—'}
                          </span>
                        </div>
                        <div>
                          <span className="text-stone-400 block text-[10px] uppercase font-bold tracking-wider">
                            PWA Display Mode
                          </span>
                          <span className="font-semibold text-stone-800">
                            {d.standalone_mode ? 'Installed Standalone' : 'Browser View'}
                          </span>
                        </div>
                      </div>

                      {/* Expandable Technical Metadata */}
                      {isExpanded && (
                        <div className="pt-3 border-t border-stone-100 space-y-2 text-[11px]">
                          <div className="grid grid-cols-2 gap-1 py-1 px-2 rounded bg-stone-50 text-stone-600">
                            <span className="text-stone-400">OS Version</span>
                            <span className="font-semibold text-stone-900">{d.os_name} {d.os_version || ''}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-1 py-1 px-2 rounded bg-stone-50 text-stone-600">
                            <span className="text-stone-400">Browser Version</span>
                            <span className="font-semibold text-stone-900">{d.browser_name} {d.browser_version || ''}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-1 py-1 px-2 rounded bg-stone-50 text-stone-600">
                            <span className="text-stone-400">Screen Resolution</span>
                            <span className="font-mono text-stone-900">{d.screen_resolution || '—'} (DPR {d.device_pixel_ratio || 1})</span>
                          </div>
                          <div className="grid grid-cols-2 gap-1 py-1 px-2 rounded bg-stone-50 text-stone-600">
                            <span className="text-stone-400">Timezone / Locale</span>
                            <span className="text-stone-900">{d.timezone || '—'} / {d.language || '—'}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-1 py-1 px-2 rounded bg-stone-50 text-stone-600">
                            <span className="text-stone-400">Last Observed IP</span>
                            <span className="font-mono text-stone-900">{d.last_ip || '—'}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-1 py-1 px-2 rounded bg-stone-50 text-stone-600">
                            <span className="text-stone-400">Notifications</span>
                            <span className="capitalize text-stone-900 font-semibold">{d.notification_permission || 'default'}</span>
                          </div>
                        </div>
                      )}

                      {/* Footer Actions */}
                      <div className="pt-2 flex items-center justify-between border-t border-stone-100 text-xs">
                        <button
                          onClick={() => toggleDeviceExpanded(d.device_id)}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:text-amber-800 cursor-pointer"
                        >
                          <span>{isExpanded ? 'Hide Details' : 'View Full Specs'}</span>
                          {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </button>

                        <button
                          onClick={() => handleAction('deregister_device', { deviceId: d.device_id })}
                          disabled={Boolean(actionLoading)}
                          className="text-[11px] font-medium text-rose-600 hover:text-rose-800 cursor-pointer transition-colors"
                        >
                          {t('people.intelligence.deviceLabels.deregister')}
                        </button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: NETWORK DIAGNOSTICS */}
      {activeTab === 'network' && (
        <Card className="border-stone-200 bg-white">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Globe className="h-4 w-4 text-amber-600" />
              {t('people.intelligence.networkLabels.title')}
            </CardTitle>
            <CardDescription className="text-xs">
              {t('people.intelligence.networkLabels.ipDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            {network.recent_ips.length === 0 ? (
              <div className="py-8 text-center text-stone-400 text-xs">
                {t('people.intelligence.networkLabels.noIps')}
              </div>
            ) : (
              <div className="overflow-x-auto text-xs">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                      <th className="py-2.5 px-3">IP Address</th>
                      <th className="py-2.5 px-3">Activity Events</th>
                      <th className="py-2.5 px-3">First Seen</th>
                      <th className="py-2.5 px-3">Last Seen</th>
                      <th className="py-2.5 px-3">Associated Device</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {network.recent_ips.map((item: any) => (
                      <tr key={item.ip} className="hover:bg-stone-50/70 transition-colors">
                        <td className="py-2.5 px-3 font-mono font-bold text-stone-900">
                          <div className="flex flex-wrap items-center gap-2">
                            <span>{item.ip}</span>
                            {item.isLocal && (
                              <span className="text-[10px] font-sans font-medium px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 border border-stone-200">
                                {locale === 'hi' ? 'लोकल / टेस्ट रनर' : 'Local / Test Runner'}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <Badge variant="outline" className="font-semibold text-stone-700">
                            {item.count} events
                          </Badge>
                        </td>
                        <td className="py-2.5 px-3 text-stone-600 font-mono">
                          {formatDate(item.firstSeen, 'short')} {formatTime(item.firstSeen)}
                        </td>
                        <td className="py-2.5 px-3 text-stone-600 font-mono">
                          {formatDate(item.lastSeen, 'short')} {formatTime(item.lastSeen)}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-stone-500 text-[11px]">
                          {item.deviceId ? item.deviceId.slice(0, 16) + '...' : '—'}
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

      {/* TAB 5: APP PERFORMANCE & RELIABILITY */}
      {activeTab === 'reliability' && (
        <Card className="border-stone-200 bg-white">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Activity className="h-4 w-4 text-amber-600" />
              {t('people.intelligence.reliabilityLabels.title')}
            </CardTitle>
            <CardDescription className="text-xs">
              {t('people.intelligence.reliabilityLabels.subtitle')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            {reliability.events.length === 0 ? (
              <div className="py-12 text-center text-stone-400 text-xs flex flex-col items-center justify-center gap-2">
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                <p className="font-semibold text-stone-700">{t('people.intelligence.reliabilityLabels.noErrors')}</p>
                <p className="text-[11px] text-stone-400">Zero client crashes, unhandled promises, or failed API calls recorded.</p>
              </div>
            ) : (
              <div className="overflow-x-auto text-xs">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                      <th className="py-2.5 px-3">{t('people.intelligence.reliabilityLabels.table.time')}</th>
                      <th className="py-2.5 px-3">{t('people.intelligence.reliabilityLabels.table.type')}</th>
                      <th className="py-2.5 px-3">{t('people.intelligence.reliabilityLabels.table.category')}</th>
                      <th className="py-2.5 px-3">{t('people.intelligence.reliabilityLabels.table.message')}</th>
                      <th className="py-2.5 px-3">{t('people.intelligence.reliabilityLabels.table.endpoint')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {reliability.events.map((err: any) => (
                      <tr key={err.id} className="hover:bg-stone-50/70 transition-colors">
                        <td className="py-2.5 px-3 font-mono text-stone-600 whitespace-nowrap">
                          {formatDate(err.created_at, 'short')} {formatTime(err.created_at)}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-stone-900">
                          {err.event_type}
                        </td>
                        <td className="py-2.5 px-3">
                          <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 text-[10px]">
                            {err.error_category}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-stone-700 max-w-sm truncate" title={err.error_message}>
                          {err.error_message || '—'}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-stone-500 text-[11px]">
                          {err.endpoint || '—'}
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

      {/* TAB 6: SECURITY SIGNALS */}
      {activeTab === 'security' && (
        <Card className="border-stone-200 bg-white">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Lock className="h-4 w-4 text-amber-600" />
              {t('people.intelligence.securityLabels.title')}
            </CardTitle>
            <CardDescription className="text-xs">
              {t('people.intelligence.securityLabels.subtitle')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {security_signals.length === 0 ? (
              <div className="py-12 text-center text-stone-400 text-xs flex flex-col items-center justify-center gap-2">
                <ShieldCheck className="h-8 w-8 text-emerald-500" />
                <p className="font-semibold text-stone-700">{t('people.intelligence.securityLabels.noSignals')}</p>
                <p className="text-[11px] text-stone-400">All authentication requests follow expected behavioral patterns.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {security_signals.map((sig: any, idx: number) => {
                  const isAlert = sig.level === 'alert';
                  const isWarning = sig.level === 'warning';
                  return (
                    <div
                      key={idx}
                      className={`p-4 rounded-xl border transition-colors flex items-start gap-3.5 ${
                        isAlert
                          ? 'bg-rose-50/70 border-rose-200 text-rose-950'
                          : isWarning
                          ? 'bg-amber-50/70 border-amber-200 text-amber-950'
                          : 'bg-stone-50 border-stone-200 text-stone-900'
                      }`}
                    >
                      <div
                        className={`p-2 rounded-lg shrink-0 ${
                          isAlert
                            ? 'bg-rose-100 text-rose-700'
                            : isWarning
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-stone-200 text-stone-700'
                        }`}
                      >
                        {isAlert ? (
                          <AlertCircle className="h-4 w-4" />
                        ) : isWarning ? (
                          <AlertTriangle className="h-4 w-4" />
                        ) : (
                          <Info className="h-4 w-4" />
                        )}
                      </div>
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <h4 className="text-xs font-bold">{sig.title}</h4>
                            {sig.inferred && (
                              <span className="text-[9px] font-sans font-medium px-1.5 py-0.2 rounded bg-stone-100 text-stone-500 border border-stone-200">
                                {locale === 'hi' ? 'अनुमानित' : 'Inferred'}
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-stone-400 font-mono">
                            {formatDate(sig.timestamp, 'short')} {formatTime(sig.timestamp)}
                          </span>
                        </div>
                        <p className="text-xs text-stone-600 leading-relaxed">{sig.description}</p>
                        {sig.evidence && (
                          <div className="text-[11px] font-mono text-stone-500 pt-1">
                            <span className="font-bold">Evidence:</span> {sig.evidence}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
