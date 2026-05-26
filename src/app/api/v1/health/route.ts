import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    version: "v1",
    timestamp: new Date().toISOString(),
    endpoints: [
      { method: "POST", path: "/api/v1/diagnose", auth: "api_key", rateLimit: "100/h" },
      { method: "GET", path: "/api/v1/parts", auth: "api_key", rateLimit: "1000/h" },
      { method: "GET", path: "/api/v1/parts/{sku}", auth: "api_key", rateLimit: "1000/h" },
      { method: "GET", path: "/api/v1/errorcodes/{brand}/{code}", auth: "api_key", rateLimit: "1000/h" },
      { method: "GET", path: "/api/v1/health", auth: "none", rateLimit: "60/h" },
    ],
  });
}
