/** Server-only opt-in for local production-build profiling. Never enabled on Vercel. */
export function suppressProfilingTelemetry(
  requestUrl: string,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (env.YATRA_LOCAL_PERF_NO_TELEMETRY !== '1' || env.VERCEL || env.VERCEL_ENV) return false;
  try {
    const url = new URL(requestUrl);
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}
