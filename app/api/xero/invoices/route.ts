import { createXeroClient } from "@/lib/xeroClient";
import { getXeroConnection, saveXeroConnection } from "@/lib/xeroStore";

export const runtime = "nodejs";

function getGrantedScopes(tokenSet: unknown) {
  if (!tokenSet || typeof tokenSet !== "object" || !("scope" in tokenSet)) {
    return [];
  }

  const scope = (tokenSet as { scope?: unknown }).scope;

  if (Array.isArray(scope)) {
    return scope.filter((value): value is string => typeof value === "string");
  }

  if (typeof scope === "string") {
    return scope.split(" ").filter(Boolean);
  }

  return [];
}

function getErrorDetail(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

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
    const grantedScopes = getGrantedScopes(tokenSet);
    const hasInvoiceScope =
      grantedScopes.includes("accounting.invoices.read") ||
      grantedScopes.includes("accounting.invoices");

    if (!hasInvoiceScope) {
      return Response.json(
        {
          error: "Reconnect to Xero with invoice access",
          detail:
            "Your current token does not include accounting.invoices.read. Click Connect Xero again and approve the new invoice scope.",
          grantedScopes,
        },
        { status: 403 },
      );
    }

    if (typeof tokenSet.expired === "function" && tokenSet.expired()) {
      const refreshedTokenSet = await xero.refreshToken();
      saveXeroConnection(
        refreshedTokenSet,
        connection.tenantId,
        connection.tenantName ?? connection.tenantId,
        connection.connectionId ?? undefined,
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
        detail: getErrorDetail(error),
      },
      { status: 500 },
    );
  }
}
