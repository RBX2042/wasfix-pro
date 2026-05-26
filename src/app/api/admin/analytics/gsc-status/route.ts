import { NextResponse } from "next/server";

// Returns whether Google Search Console is OAuth-connected.
// Scaffold — real implementation requires GSC_OAUTH_REFRESH_TOKEN env var
// + token-refresh flow.
export async function GET() {
  const connected = !!process.env.GSC_REFRESH_TOKEN && !!process.env.GSC_OAUTH_CLIENT_ID;
  return NextResponse.json({ connected, providerUrl: "https://search.google.com/search-console" });
}
