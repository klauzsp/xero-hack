import { fetchXeroInvoices, getErrorDetail } from "@/lib/xeroInvoices";

export const runtime = "nodejs";

export async function GET() {
  try {
    const result = await fetchXeroInvoices(50);

    return Response.json(result.body, { status: result.status });
  } catch (error) {
    return Response.json(
      {
        error: "Unable to retrieve Xero invoices",
        detail: getErrorDetail(error),
      },
      { status: 500 },
    );
  }
}
