import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { marketingError } from "@/lib/marketing/http";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const db = await createServerSupabaseClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user)
    return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const filter = Object.fromEntries(
    [...params].filter(([key]) => key !== "mode"),
  );
  const { data, error } = await db.rpc("marketing_read", {
    p_mode: params.get("mode") || "config",
    p_filter: filter,
  });
  return error
    ? marketingError(error)
    : NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: NextRequest) {
  const db = await createServerSupabaseClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user)
    return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: 401 });
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "INVALID_REQUEST" }, { status: 400 });
  }
  if (
    !body ||
    typeof body.action !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(body.request_id || "") ||
    !body.data ||
    typeof body.data !== "object" ||
    Array.isArray(body.data)
  )
    return NextResponse.json({ code: "INVALID_REQUEST" }, { status: 400 });
  const { data, error } = await db.rpc("marketing_mutate", {
    p_action: body.action,
    p_request: body.request_id,
    p_data: body.data,
    p_client_version: body.client_version || 0,
  });
  return error
    ? marketingError(error)
    : NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
