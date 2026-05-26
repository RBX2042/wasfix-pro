import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { apiError, apiSuccess } from "@/lib/api-response";
import { rateLimit, getClientKey } from "@/lib/ratelimit";

const Schema = z.object({ email: z.string().email() });

// Note: Production newsletter signup requires RESEND_API_KEY + RESEND_AUDIENCE_ID.
// Without those it logs to console and returns success so the form works in demo.
export async function POST(req: NextRequest) {
  if (!rateLimit(`newsletter:${getClientKey(req)}`, 5, 60 * 60 * 1000)) {
    return apiError("Te veel pogingen — probeer over een uur opnieuw.", 429);
  }

  let email = "";

  // Accept JSON or form-encoded
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => null);
    if (!body) return apiError("Ongeldige JSON", 400);
    const parsed = Schema.safeParse(body);
    if (!parsed.success) return apiError("Ongeldig e-mailadres", 400);
    email = parsed.data.email;
  } else {
    const fd = await req.formData();
    email = String(fd.get("email") ?? "");
    if (!Schema.safeParse({ email }).success) {
      // For form posts, redirect back with error param
      return NextResponse.redirect(new URL("/blog?newsletter=error", req.url), 303);
    }
  }

  // Try Resend audience add
  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (apiKey && audienceId) {
    try {
      const res = await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email, unsubscribed: false }),
      });
      if (!res.ok) logger.warn("Resend audience add failed", { status: res.status });
    } catch (err) {
      logger.warn("Resend audience add error", err);
    }
  } else {
    logger.info("Newsletter signup (Resend not configured)", { email });
  }

  // Form submission → redirect to thanks page; JSON → JSON response
  if (!contentType.includes("application/json")) {
    return NextResponse.redirect(new URL("/blog?newsletter=ok", req.url), 303);
  }
  return apiSuccess({ message: "Bedankt — check je inbox voor de bevestiging." });
}
