import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Bypass static assets, service worker, and manifest
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/icons') ||
    pathname.startsWith('/favicon') ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/sw.js'
  ) {
    return NextResponse.next();
  }

  // 2. Initialize Supabase SSR Client for cookie and bearer session checking
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://zklzzfsxibewekkvslzg.supabase.co';
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprbHp6ZnN4aWJld2Vra3ZzbHpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzNzMxMDAsImV4cCI6MjEwMTk0OTEwMH0.ONCDNeDbmvLNhR97LFxucqYAOd6ByiNPpC7UDKgp9pg';

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const authHeader = request.headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
  const { data: { user } } = await supabase.auth.getUser(bearerToken);

  // 3. Unauthenticated access enforcement
  if (!user) {
    // If accessing /login, allow
    if (pathname === '/login') {
      return response;
    }

    // If accessing an API route, return 401 Unauthorized JSON instead of HTML redirect
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Authentication required. Please log in.' }, { status: 401 });
    }

    // Redirect all protected browser routes directly to /login
    const redirectUrl = new URL('/login', request.url);
    return NextResponse.redirect(redirectUrl);
  }

  // 4. Authenticated user accessing /login or root / -> route to dashboard
  if (pathname === '/login' || pathname === '/') {
    const dashboardUrl = new URL('/dashboard', request.url);
    return NextResponse.redirect(dashboardUrl);
  }

  // 5. Invalidate back-button caching for protected views
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('Expires', '0');

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files with extensions (.svg, .png, .jpg, .jpeg, .gif, .webp)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
