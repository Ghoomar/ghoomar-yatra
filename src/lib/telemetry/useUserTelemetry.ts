'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

function getOrGenerateDeviceId(): string {
  if (typeof window === 'undefined') return 'unknown_device';
  try {
    let deviceId = localStorage.getItem('ghoomar_device_id');
    if (!deviceId) {
      deviceId = crypto.randomUUID();
      localStorage.setItem('ghoomar_device_id', deviceId);
    }
    return deviceId;
  } catch {
    return 'fallback_device_' + Math.random().toString(36).substring(2, 9);
  }
}

function detectEnvironment() {
  if (typeof window === 'undefined') return {};

  const ua = navigator.userAgent || '';
  let deviceType: 'desktop' | 'laptop' | 'tablet' | 'mobile' | 'unknown' = 'desktop';

  if (/tablet|ipad|playbook|silk/i.test(ua)) {
    deviceType = 'tablet';
  } else if (/mobile|iphone|ipod|android.*mobile|blackberry|iemobile/i.test(ua)) {
    deviceType = 'mobile';
  } else if (/android/i.test(ua)) {
    deviceType = 'tablet';
  }

  let osName = 'Unknown OS';
  let osVersion = '';
  if (/windows/i.test(ua)) {
    osName = 'Windows';
  } else if (/android/i.test(ua)) {
    osName = 'Android';
    const match = ua.match(/android\s+([\d\.]+)/i);
    if (match) osVersion = match[1];
  } else if (/iphone|ipad|ipod/i.test(ua)) {
    osName = 'iOS';
  } else if (/macintosh|mac os x/i.test(ua)) {
    osName = 'macOS';
  } else if (/linux/i.test(ua)) {
    osName = 'Linux';
  }

  let browserName = 'Unknown Browser';
  let browserVersion = '';
  if (/edg/i.test(ua)) {
    browserName = 'Edge';
    const match = ua.match(/edg\/([\d\.]+)/i);
    if (match) browserVersion = match[1];
  } else if (/chrome|crios/i.test(ua) && !/opr|opera/i.test(ua)) {
    browserName = 'Chrome';
    const match = ua.match(/chrome\/([\d\.]+)/i);
    if (match) browserVersion = match[1];
  } else if (/safari/i.test(ua) && !/chrome/i.test(ua)) {
    browserName = 'Safari';
    const match = ua.match(/version\/([\d\.]+)/i);
    if (match) browserVersion = match[1];
  } else if (/firefox/i.test(ua)) {
    browserName = 'Firefox';
    const match = ua.match(/firefox\/([\d\.]+)/i);
    if (match) browserVersion = match[1];
  }

  const deviceLabel = `${browserName} on ${osName} (${deviceType})`;
  const screenResolution = `${window.screen?.width || 0}x${window.screen?.height || 0}`;
  const devicePixelRatio = window.devicePixelRatio || 1;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
  const language = navigator.language || 'en';
  const pwaSupported = 'serviceWorker' in navigator;
  const standaloneMode =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as any).standalone === true;

  let notificationPermission = 'unsupported';
  if (typeof Notification !== 'undefined') {
    notificationPermission = Notification.permission;
  }

  return {
    deviceLabel,
    deviceType,
    osName,
    osVersion,
    browserName,
    browserVersion,
    screenResolution,
    devicePixelRatio,
    timezone,
    language,
    pwaSupported,
    standaloneMode,
    notificationPermission,
  };
}

export function useUserTelemetry(user: any | null, offlineGateMode: boolean = false) {
  const pathname = usePathname();
  const errorReportCount = useRef<number>(0);
  const lastHeartbeatTime = useRef<number>(0);

  useEffect(() => {
    // Strictly do NOT run telemetry if unauthenticated, offline, or in offline Gate mode
    if (!user || offlineGateMode || typeof window === 'undefined') return;
    if (pathname === '/login') return;

    const deviceId = getOrGenerateDeviceId();
    const envData = detectEnvironment();

    // 1. Send initial environment snapshot
    const sendHeartbeat = () => {
      // Avoid frequent duplicate posts (throttle to minimum 60s)
      const now = Date.now();
      if (now - lastHeartbeatTime.current < 60000) return;
      if (!navigator.onLine) return;

      lastHeartbeatTime.current = now;

      fetch('/api/admin/telemetry/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId,
          ...envData,
          visibilityState: document.visibilityState || 'visible',
        }),
        keepalive: true,
      }).catch(() => {});
    };

    // Initial report
    sendHeartbeat();

    // 2. Periodic lightweight heartbeat every 5 minutes (300,000ms)
    const interval = setInterval(sendHeartbeat, 300000);

    // 3. Tab visibility change listener (send heartbeat when tab becomes visible after being hidden)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        sendHeartbeat();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // 4. Global window error listener (Sanitized, max 3 reports per session to prevent flooding)
    const handleError = (e: ErrorEvent) => {
      if (errorReportCount.current >= 3 || !navigator.onLine) return;
      errorReportCount.current++;

      const errorMsg = e.message || 'Script error';
      fetch('/api/admin/telemetry/reliability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId,
          eventType: 'js_error',
          errorCategory: 'RUNTIME_ERROR',
          errorMessage: `${errorMsg} at ${e.filename || 'unknown'}:${e.lineno || 0}`,
          isOnline: navigator.onLine,
        }),
        keepalive: true,
      }).catch(() => {});
    };

    const handleRejection = (e: PromiseRejectionEvent) => {
      if (errorReportCount.current >= 3 || !navigator.onLine) return;
      errorReportCount.current++;

      const reason = typeof e.reason === 'string' ? e.reason : e.reason?.message || 'Unhandled Promise Rejection';
      fetch('/api/admin/telemetry/reliability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId,
          eventType: 'unhandled_rejection',
          errorCategory: 'PROMISE_REJECTION',
          errorMessage: String(reason).slice(0, 300),
          isOnline: navigator.onLine,
        }),
        keepalive: true,
      }).catch(() => {});
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, [user, pathname, offlineGateMode]);
}
