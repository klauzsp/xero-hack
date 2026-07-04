import { fetchXeroInvoices, getErrorDetail } from "@/lib/xeroInvoices";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const fresh =
      new URL(request.url).searchParams.get("refresh") === "1";
    const result = await fetchXeroInvoices(100, { fresh });

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
