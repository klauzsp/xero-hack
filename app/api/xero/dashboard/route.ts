import { fetchXeroDashboardReports } from "@/lib/xeroReports";
import { getErrorDetail } from "@/lib/xeroInvoices";

export const runtime = "nodejs";

export async function GET() {
  try {
    const result = await fetchXeroDashboardReports();

    return Response.json(result.body, { status: result.status });
  } catch (error) {
    return Response.json(
      {
        error: "Unable to load dashboard reports",
        detail: getErrorDetail(error),
      },
      { status: 500 },
    );
  }
}
