import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api-response";
import { rateLimit, getClientKey } from "@/lib/ratelimit";
import { logger } from "@/lib/logger";

const Schema = z.object({ kvkNumber: z.string().regex(/^\d{8}$/, "KvK-nummer is 8 cijfers") });

// KvK API lookup — requires KVK_API_KEY env var.
// Without key, returns 503 with helpful message.
// Real API: https://developers.kvk.nl/documentation/zoeken-api
export async function POST(req: NextRequest) {
  if (!(await rateLimit(`kvk:${getClientKey(req)}`, 20, 60 * 60 * 1000))) {
    return apiError("Te veel KvK-lookups — probeer over een uur opnieuw.", 429);
  }

  const body = await req.json().catch(() => null);
  if (!body) return apiError("Ongeldige JSON", 400);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError("Ongeldig KvK-nummer", 400);

  const { kvkNumber } = parsed.data;
  const apiKey = process.env.KVK_API_KEY;

  if (!apiKey) {
    // Mock response for demo — returns a fake company so the form works in dev
    logger.info("[kvk-lookup] no API key — returning mock", { kvkNumber });
    return apiSuccess({
      mock: true,
      kvkNumber,
      companyName: `Demo Monteur ${kvkNumber.slice(-4)}`,
      legalForm: "Eenmanszaak",
      address: { street: "Hoofdstraat", houseNumber: "1", postalCode: "1234 AB", city: "Amsterdam" },
      sbiCodes: ["95220"], // Repair of household appliances
    });
  }

  try {
    const res = await fetch(`https://api.kvk.nl/api/v1/zoeken?kvkNummer=${kvkNumber}`, {
      headers: { apikey: apiKey },
    });
    if (!res.ok) {
      logger.warn("[kvk-lookup] upstream failed", { status: res.status });
      return apiError("KvK-lookup mislukt — probeer opnieuw", 502);
    }
    const data = await res.json();
    const item = data?.resultaten?.[0];
    if (!item) return apiError("KvK-nummer niet gevonden", 404);

    return apiSuccess({
      kvkNumber,
      companyName: item.handelsnaam,
      legalForm: item.type,
      address: item.adres,
    });
  } catch (err) {
    logger.error("[kvk-lookup] error", err);
    return apiError("KvK-service tijdelijk onbereikbaar", 502);
  }
}
