import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

async function verifyAdminCaller(request: Request) {
  const authHeader = request.headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
  
  let user: any = null;
  let serverSupabase: any = null;

  try {
    serverSupabase = await createServerSupabaseClient();
    const { data: authData, error: authErr } = await serverSupabase.auth.getUser(bearerToken);
    if (!authErr) user = authData?.user;
  } catch {
    const admin = createAdminClient();
    if (bearerToken) {
      const { data: authData } = await admin.auth.getUser(bearerToken);
      user = authData?.user;
    }
    serverSupabase = admin;
  }

  if (!user) {
    return { authorized: false, status: 401, error: 'Authentication required. Please log in.' };
  }

  const { data: profile, error: profErr } = await serverSupabase
    .from('profiles')
    .select('*, role:roles(id, name)')
    .eq('id', user.id)
    .single();

  if (profErr || !profile || !profile.is_active) {
    return { authorized: false, status: 403, error: 'Access denied. Account is inactive or unverified.' };
  }

  const { data: permCheck } = await serverSupabase
    .from('role_permissions')
    .select('permissions(code)')
    .eq('role_id', profile.role_id);

  const hasAdminPerm =
    permCheck?.some((rp: any) => rp.permissions?.code === 'admin.manage') ||
    profile.role?.name === 'Admin';

  if (!hasAdminPerm) {
    return { authorized: false, status: 403, error: 'Access denied. System Administrator privilege required.' };
  }

  return { authorized: true, caller: profile, serverSupabase };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ userId: string }> }
) {
  const auth = await verifyAdminCaller(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { userId } = await context.params;
  if (!userId) {
    return NextResponse.json({ error: 'Target user ID is required.' }, { status: 400 });
  }

  const url = new URL(request.url);
  const timeRange = url.searchParams.get('timeRange') || '30d'; // '7d' | '30d' | 'all'
  const eventType = url.searchParams.get('eventType') || 'all';

  const adminClient = createAdminClient();

  try {
    // 1. Fetch Target Profile & Role
    const { data: targetProfile, error: profErr } = await adminClient
      .from('profiles')
      .select('*, role:roles(id, name, name_hi)')
      .eq('id', userId)
      .maybeSingle();

    if (profErr || !targetProfile) {
      return NextResponse.json({ error: 'User profile not found.' }, { status: 404 });
    }

    // 2. Fetch Supabase Auth Record for last_sign_in_at & created_at
    let authUserRecord: any = null;
    try {
      const { data: authUserData } = await adminClient.auth.admin.getUserById(userId);
      if (authUserData?.user) {
        authUserRecord = {
          created_at: authUserData.user.created_at,
          last_sign_in_at: authUserData.user.last_sign_in_at,
          email_confirmed_at: authUserData.user.email_confirmed_at,
          banned_until: authUserData.user.banned_until,
        };
      }
    } catch {}

    // 3. Compute Time Range Boundary
    let rangeDate: Date | null = null;
    const now = new Date();
    if (timeRange === '7d') {
      rangeDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (timeRange === '30d') {
      rangeDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // 4. Fetch Authentication Events
    let authEventsQuery = adminClient
      .from('user_auth_events')
      .select('*')
      .or(`user_id.eq.${userId},identifier.eq.${targetProfile.email}${targetProfile.phone ? ',identifier.eq.' + targetProfile.phone : ''}`)
      .order('created_at', { ascending: false });

    if (rangeDate) {
      authEventsQuery = authEventsQuery.gte('created_at', rangeDate.toISOString());
    }
    if (eventType !== 'all') {
      authEventsQuery = authEventsQuery.eq('event_type', eventType);
    }

    const { data: authEvents } = await authEventsQuery.limit(100);

    // 5. Total all-time login counts
    const { count: totalLoginsAllTime } = await adminClient
      .from('user_auth_events')
      .select('id', { count: 'exact', head: true })
      .or(`user_id.eq.${userId},identifier.eq.${targetProfile.email}${targetProfile.phone ? ',identifier.eq.' + targetProfile.phone : ''}`)
      .eq('event_type', 'login_success');

    // Period specific login counts
    const successfulInPeriod = (authEvents || []).filter((e) => e.event_type === 'login_success').length;
    const failedInPeriod = (authEvents || []).filter((e) => e.event_type === 'login_failure').length;

    // 6. Registered Devices & Gate Devices
    const { data: devices } = await adminClient
      .from('user_devices')
      .select('*')
      .eq('user_id', userId)
      .order('last_seen_at', { ascending: false });

    const { data: gateDevices } = await adminClient
      .from('gate_device_authorizations')
      .select('*')
      .eq('user_id', userId)
      .order('enrolled_at', { ascending: false });

    // Merge gate devices into devices list if not already present
    const combinedDevices: any[] = [...(devices || [])];
    (gateDevices || []).forEach((gd) => {
      const existing = combinedDevices.find((d) => d.device_id === gd.device_id || d.gate_device_id === gd.device_id);
      if (existing) {
        existing.is_gate_device = true;
        existing.gate_device_id = gd.device_id;
        existing.gate_status = gd.is_active ? 'active' : 'revoked';
        existing.enrolled_at = gd.enrolled_at;
      } else {
        combinedDevices.push({
          id: gd.id,
          user_id: gd.user_id,
          device_id: gd.device_id,
          device_label: gd.device_name || 'Gate Mobile Device',
          device_type: 'mobile',
          is_gate_device: true,
          gate_device_id: gd.device_id,
          gate_status: gd.is_active ? 'active' : 'revoked',
          pwa_supported: true,
          standalone_mode: true,
          last_seen_at: gd.last_sync_at || gd.enrolled_at,
          first_seen_at: gd.enrolled_at,
          created_at: gd.enrolled_at,
        });
      }
    });

    // 7. Reliability Events
    let reliabilityQuery = adminClient
      .from('user_reliability_events')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (rangeDate) {
      reliabilityQuery = reliabilityQuery.gte('created_at', rangeDate.toISOString());
    }
    const { data: reliabilityEvents } = await reliabilityQuery.limit(100);

    // 8. Aggregate Network Diagnostics & IP History
    const isLoopbackOrLocal = (ip: string) => {
      return (
        ip === '127.0.0.1' ||
        ip === '::1' ||
        ip === 'localhost' ||
        ip.startsWith('127.') ||
        ip.startsWith('10.') ||
        ip.startsWith('192.168.') ||
        ip.startsWith('172.16.')
      );
    };

    const ipMap = new Map<string, { firstSeen: string; lastSeen: string; count: number; deviceId?: string }>();
    (authEvents || []).forEach((ev) => {
      if (ev.ip_address && ev.ip_address !== 'Unknown') {
        const existing = ipMap.get(ev.ip_address);
        if (!existing) {
          ipMap.set(ev.ip_address, { firstSeen: ev.created_at, lastSeen: ev.created_at, count: 1, deviceId: ev.device_id });
        } else {
          existing.count++;
          if (new Date(ev.created_at) > new Date(existing.lastSeen)) existing.lastSeen = ev.created_at;
          if (new Date(ev.created_at) < new Date(existing.firstSeen)) existing.firstSeen = ev.created_at;
        }
      }
    });
    combinedDevices.forEach((d) => {
      if (d.last_ip && d.last_ip !== 'Unknown') {
        const existing = ipMap.get(d.last_ip);
        if (!existing) {
          ipMap.set(d.last_ip, { firstSeen: d.last_seen_at, lastSeen: d.last_seen_at, count: 1, deviceId: d.device_id });
        } else {
          existing.count++;
        }
      }
    });

    const recentIps = Array.from(ipMap.entries()).map(([ip, details]) => {
      const isLocal = isLoopbackOrLocal(ip);
      return {
        ip,
        isLocal,
        network_classification: isLocal ? 'Localhost / Test Runner' : 'Public Network',
        ...details,
      };
    }).sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());

    // 9. Compute Security Signals (Automated Heuristics with Inferred Disclaimers)
    const securitySignals: Array<{
      type: string;
      level: 'info' | 'warning' | 'alert';
      title: string;
      description: string;
      timestamp: string;
      evidence: string;
      inferred: boolean;
    }> = [];

    // Signal: Repeated failed login attempts (>= 3 in window)
    if (failedInPeriod >= 3) {
      securitySignals.push({
        type: 'repeated_login_failures',
        level: 'warning',
        title: 'Observed Pattern: Repeated Login Failures',
        description: `${failedInPeriod} failed authentication attempts recorded in the selected ${timeRange} window. Inferred pattern based on auth event logs.`,
        timestamp: authEvents?.find((e) => e.event_type === 'login_failure')?.created_at || now.toISOString(),
        evidence: `Count: ${failedInPeriod} failures recorded.`,
        inferred: true,
      });
    }

    // Signal: Inactive account login attempts
    const inactiveAttempts = (authEvents || []).filter((e) => e.failure_reason === 'account_inactive').length;
    if (inactiveAttempts > 0) {
      securitySignals.push({
        type: 'inactive_account_attempt',
        level: 'alert',
        title: 'Enforced Security: Deactivated Account Login Blocked',
        description: `Authentication attempt on a deactivated account was intercepted and blocked by account-status checks.`,
        timestamp: authEvents?.find((e) => e.failure_reason === 'account_inactive')?.created_at || now.toISOString(),
        evidence: `${inactiveAttempts} attempt(s) blocked by system enforcement.`,
        inferred: false,
      });
    }

    // Signal: Multiple distinct external IPs observed recently (excluding local test runner IPs)
    const routableIps = recentIps.filter((i) => !i.isLocal);
    if (routableIps.length > 2) {
      securitySignals.push({
        type: 'multiple_ips_observed',
        level: 'info',
        title: 'Inferred Signal: Multiple Network Locations',
        description: `User authenticated from ${routableIps.length} different external IP addresses. Inferred from request headers.`,
        timestamp: routableIps[0]?.lastSeen || now.toISOString(),
        evidence: routableIps.map((i) => i.ip).slice(0, 3).join(', '),
        inferred: true,
      });
    }

    // Signal: New device observed in last 7 days
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const newDevices = combinedDevices.filter((d) => d.first_seen_at && new Date(d.first_seen_at) >= sevenDaysAgo);
    if (newDevices.length > 0) {
      securitySignals.push({
        type: 'new_device_observed',
        level: 'info',
        title: 'Inferred Signal: New Device Observed',
        description: `${newDevices.length} device installation(s) first observed within the last 7 days.`,
        timestamp: newDevices[0]?.first_seen_at || now.toISOString(),
        evidence: newDevices.map((d) => d.device_label || d.device_name || d.device_id).join(', '),
        inferred: true,
      });
    }

    // 10. Presence & Activity Classification
    const mostRecentDevice = combinedDevices[0] || null;
    const lastSeenTime = mostRecentDevice?.last_seen_at || authUserRecord?.last_sign_in_at || null;
    let presenceStatus: 'active' | 'idle' | 'offline' | 'unknown' = 'unknown';

    if (lastSeenTime) {
      const minutesAgo = (now.getTime() - new Date(lastSeenTime).getTime()) / (1000 * 60);
      if (minutesAgo <= 10) {
        presenceStatus = mostRecentDevice?.last_visibility_state === 'hidden' ? 'idle' : 'active';
      } else if (minutesAgo <= 60) {
        presenceStatus = 'idle';
      } else {
        presenceStatus = 'offline';
      }
    }

    const lastSuccessfulLogin =
      authEvents?.find((e) => e.event_type === 'login_success')?.created_at ||
      authUserRecord?.last_sign_in_at ||
      null;

    const mostRecentError = reliabilityEvents?.[0] || null;

    return NextResponse.json({
      success: true,
      profile: targetProfile,
      auth: authUserRecord,
      presenceStatus,
      lastSeenTime,
      summary: {
        last_successful_login: lastSuccessfulLogin,
        total_successful_logins: totalLoginsAllTime || (authUserRecord?.last_sign_in_at ? 1 : 0),
        successful_logins_period: successfulInPeriod,
        failed_logins_period: failedInPeriod,
        registered_devices_count: combinedDevices.length,
        most_recent_device: mostRecentDevice,
        most_recent_error: mostRecentError,
        tracking_started_at: '2026-10-24T19:00:00Z',
      },
      auth_events: authEvents || [],
      devices: combinedDevices,
      network: {
        latest_ip: recentIps[0]?.ip || null,
        recent_ips: recentIps,
      },
      reliability: {
        summary: {
          total_errors: (reliabilityEvents || []).length,
          api_failures: (reliabilityEvents || []).filter((e) => e.event_type === 'api_failure').length,
          runtime_errors: (reliabilityEvents || []).filter((e) => e.event_type === 'js_error' || e.event_type === 'unhandled_rejection').length,
        },
        events: reliabilityEvents || [],
      },
      security_signals: securitySignals,
    });
  } catch (err: any) {
    console.error('[user-intelligence] Error fetching intelligence:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch user intelligence' }, { status: 500 });
  }
}
