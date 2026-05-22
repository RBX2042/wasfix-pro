import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/api-response";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guide = await prisma.repairGuide.findFirst({
      where: { OR: [{ id }, { slug: id }] },
      include: { parts: { include: { part: true } } },
    });
    if (!guide) return apiError("Gids niet gevonden", 404);
    return apiSuccess({ guide });
  } catch {
    return apiError("Fout bij ophalen gids", 500);
  }
}
