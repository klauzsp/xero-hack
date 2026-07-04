import { createXeroClient } from "@/lib/xeroClient";
import { getXeroConnection, saveXeroConnection } from "@/lib/xeroStore";

export type XeroInvoiceSummary = {
  invoiceID?: string;
  invoiceNumber?: string;
  contactName?: string;
  status?: string;
  date?: string;
  dueDate?: string;
  total?: number;
  amountDue?: number;
  currencyCode?: string;
};

export function getGrantedScopes(tokenSet: unknown) {
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

export function getErrorDetail(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

export async function fetchXeroInvoices(pageSize = 50) {
  const connection = getXeroConnection();

  if (!connection.isConnected || !connection.tokenSet || !connection.tenantId) {
    return {
      ok: false as const,
      status: 401,
      body: { error: "Connect to Xero before requesting invoices" },
    };
  }

  const xero = createXeroClient();
  xero.setTokenSet(connection.tokenSet);

  const tokenSet = xero.readTokenSet();
  const grantedScopes = getGrantedScopes(tokenSet);
  const hasInvoiceScope =
    grantedScopes.includes("accounting.invoices.read") ||
    grantedScopes.includes("accounting.invoices");

  if (!hasInvoiceScope) {
    return {
      ok: false as const,
      status: 403,
      body: {
        error: "Reconnect to Xero with invoice access",
        detail:
          "Your current token does not include accounting.invoices.read. Click Connect Xero again and approve the new invoice scope.",
        grantedScopes,
      },
    };
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
    false,
    pageSize,
  );

  const invoices: XeroInvoiceSummary[] = (response.body.invoices ?? []).map(
    (invoice) => ({
      invoiceID: invoice.invoiceID,
      invoiceNumber: invoice.invoiceNumber,
      contactName: invoice.contact?.name,
      status: invoice.status ? String(invoice.status) : undefined,
      date: invoice.date,
      dueDate: invoice.dueDate,
      total: invoice.total,
      amountDue: invoice.amountDue,
      currencyCode: invoice.currencyCode ? String(invoice.currencyCode) : undefined,
    }),
  );

  return {
    ok: true as const,
    status: 200,
    body: {
      tenantId: connection.tenantId,
      tenantName: connection.tenantName,
      count: invoices.length,
      invoices,
    },
  };
}
