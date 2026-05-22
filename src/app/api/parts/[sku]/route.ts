import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/api-response";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ sku: string }> }) {
  try {
    const { sku } = await params;
    const part = await prisma.part.findUnique({
      where: { sku },
      include: {
        machines: { include: { machine: true } },
        guides: { include: { guide: true } },
      },
    });
    if (!part) return apiError("Onderdeel niet gevonden", 404);
    return apiSuccess({ part });
  } catch {
    return apiError("Fout bij ophalen onderdeel", 500);
  }
}
