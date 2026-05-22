import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/api-response";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const decoded = decodeURIComponent(code).toUpperCase();
    const errorCode = await prisma.errorCode.findFirst({
      where: { code: decoded },
      include: {
        machine: true,
        parts: { include: { part: true } },
        guides: { include: { guide: true } },
      },
    });
    if (!errorCode) return apiError("Foutcode niet gevonden", 404);
    return apiSuccess({ errorCode });
  } catch {
    return apiError("Fout bij ophalen foutcode", 500);
  }
}
