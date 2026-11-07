import { NextResponse } from "next/server";

/** Only stable error codes leave the server; database diagnostics stay server-side. */
export function marketingError(error: { message?: string; code?: string }) {
  const match = error.message?.match(/\b[A-Z][A-Z_]{3,}\b/);
  let code = match?.[0] || "REQUEST_FAILED";
  if (error.code === "23505" && code === "REQUEST_FAILED")
    code = "IDENTITY_CONFLICT";
  const status =
    error.code === "42501"
      ? 403
      : ["23505", "40001", "55P03"].includes(error.code || "") ||
          code.endsWith("CONFLICT")
        ? 409
        : ["PGRST202", "42P01", "42883"].includes(error.code || "") ||
            code === "FEATURE_DISABLED"
          ? 503
          : 400;
  if (status === 503) code = "FEATURE_DISABLED";
  return NextResponse.json(
    { code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
