import { NextResponse } from "next/server";
import { PLAN_API_HOURLY_BURST, PLAN_API_MONTHLY_CALLS } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// "API" is an internal legacy plan and is not listed. The limits are read from the same constants api-auth.ts enforces (and
// /api-docs prints), so this answer cannot drift from the behaviour.
export async function GET() {
  const limits = Object.fromEntries(
    Object.keys(PLAN_API_MONTHLY_CALLS).filter((plan) => plan !== "API").map((plan) => [plan, { callsPerMonth: PLAN_API_MONTHLY_CALLS[plan], callsPerHour: PLAN_API_HOURLY_BURST[plan] }]),
  );
  return NextResponse.json({
    status: "ok",
    version: "v1",
    timestamp: new Date().toISOString(),
    endpoints: [
      { method: "POST", path: "/api/v1/diagnose", auth: "api_key" },
      { method: "GET", path: "/api/v1/parts/{sku}", auth: "api_key" },
      { method: "GET", path: "/api/v1/errorcodes/{brand}/{code}", auth: "api_key" },
      { method: "GET", path: "/api/v1/health", auth: "none" },
    ],
    // One hourly limit per key across all endpoints, plus the monthly allowance of the plan.
    limits,
  });
}
