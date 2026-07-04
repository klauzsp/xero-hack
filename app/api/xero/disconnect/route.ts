import { createXeroClient } from "@/lib/xeroClient";
import { clearXeroInvoiceCache } from "@/lib/xeroInvoices";
import { clearXeroReportsCache } from "@/lib/xeroReports";
import {
  clearXeroConnection,
  getXeroConnection,
  saveXeroConnection,
} from "@/lib/xeroStore";

export const runtime = "nodejs";

type XeroTenantConnection = {
  id?: string;
  tenantId?: string;
};

function getErrorDetail(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

export async function POST() {
  const connection = getXeroConnection();

  if (!connection.isConnected || !connection.tokenSet) {
    clearXeroConnection();
    clearXeroInvoiceCache();
    clearXeroReportsCache();

    return Response.json({ isConnected: false });
  }

  try {
    const xero = createXeroClient();
    await xero.initialize();
    xero.setTokenSet(connection.tokenSet);

    const tokenSet = xero.readTokenSet();
    if (typeof tokenSet.expired === "function" && tokenSet.expired()) {
      const refreshedTokenSet = await xero.refreshToken();
      saveXeroConnection(
        refreshedTokenSet,
        connection.tenantId ?? "",
        connection.tenantName ?? connection.tenantId ?? "",
        connection.connectionId ?? undefined,
      );
    }

    let connectionId = connection.connectionId;

    if (!connectionId && connection.tenantId) {
      const tenants = (await xero.updateTenants(false)) as XeroTenantConnection[];
      const tenant = tenants.find(
        (nextTenant) => nextTenant.tenantId === connection.tenantId,
      );
      connectionId = tenant?.id ?? null;
    }

    if (!connectionId) {
      return Response.json(
        {
          error: "Unable to find Xero connection ID",
          detail:
            "Reconnect once, then try disconnect again so this app can store the Xero connection ID.",
        },
        { status: 400 },
      );
    }

    await xero.disconnect(connectionId);
    clearXeroConnection();
    clearXeroInvoiceCache();
    clearXeroReportsCache();

    return Response.json({ isConnected: false });
  } catch (error) {
    return Response.json(
      {
        error: "Unable to disconnect from Xero",
        detail: getErrorDetail(error),
      },
      { status: 500 },
    );
  }
}
