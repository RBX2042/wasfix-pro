import { apiError, apiSuccess } from "@/lib/api-response";
import { dbStats, dbMachineBrands } from "@/lib/static-db";

export const revalidate = 60;

export async function GET() {
  try {
    const [stats, brands] = await Promise.all([dbStats(), dbMachineBrands()]);
    return apiSuccess({
      totals: {
        diagnoses: 0,
        orders: 0,
        revenue: 0,
        parts: stats.partsCount,
        errorCodes: stats.errorCodesCount,
        guides: stats.guidesCount,
        machines: stats.machinesCount,
        brands: brands.length,
      },
      thisMonth: {
        diagnoses: 0,
      },
      topParts: [],
      user: null,
    });
  } catch {
    return apiError("Failed to load stats", 500);
  }
}
