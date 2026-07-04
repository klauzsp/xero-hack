import { createXeroClient } from "@/lib/xeroClient";
import { getXeroConnection, saveXeroConnection } from "@/lib/xeroStore";

export const runtime = "nodejs";

export async function GET() {
  const connection = getXeroConnection();

  if (!connection.isConnected || !connection.tokenSet || !connection.tenantId) {
    return Response.json(
      { error: "Connect to Xero before requesting invoices" },
      { status: 401 },
    );
  }

  try {
    const xero = createXeroClient();
    xero.setTokenSet(connection.tokenSet);

    const tokenSet = xero.readTokenSet();
    if (typeof tokenSet.expired === "function" && tokenSet.expired()) {
      const refreshedTokenSet = await xero.refreshToken();
      saveXeroConnection(
        refreshedTokenSet,
        connection.tenantId,
        connection.tenantName ?? connection.tenantId,
      );
    }

    const response = await xero.accountingApi.getInvoices(
      connection.tenantId,
      undefined,
      undefined,
      "Date DESC",
      undefined,
      undefined,
      undefined,
      undefined,
      1,
      undefined,
      undefined,
      undefined,
      true,
      10,
    );

    const invoices = (response.body.invoices ?? []).map((invoice) => ({
      invoiceID: invoice.invoiceID,
      invoiceNumber: invoice.invoiceNumber,
      contactName: invoice.contact?.name,
      status: invoice.status,
      date: invoice.date,
      dueDate: invoice.dueDate,
      total: invoice.total,
      amountDue: invoice.amountDue,
      currencyCode: invoice.currencyCode,
    }));

    return Response.json({
      tenantId: connection.tenantId,
      tenantName: connection.tenantName,
      count: invoices.length,
      invoices,
    });
  } catch (error) {
    return Response.json(
      {
        error: "Unable to retrieve Xero invoices",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
