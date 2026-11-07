import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getBusinessDateRange } from "@/lib/business-date-ranges";
import { marketingError } from "@/lib/marketing/http";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const from = request.nextUrl.searchParams.get("from") || "";
  const to = request.nextUrl.searchParams.get("to") || "";
  if (getBusinessDateRange("custom", new Date(), from, to).status !== "ready")
    return NextResponse.json({ code: "INVALID_RANGE" }, { status: 400 });
  const db = await createServerSupabaseClient();
  const { data, error } = await db.rpc("operating_metrics", {
    p_from: from,
    p_to: to,
  });
  return error
    ? marketingError(error)
    : NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
