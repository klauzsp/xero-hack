import { getXeroConnection } from "@/lib/xeroStore";
import { xeroScopes } from "@/lib/xeroClient";

export const runtime = "nodejs";

export async function GET() {
  const connection = getXeroConnection();
  const missingConfig = [
    "XERO_CLIENT_ID",
    "XERO_CLIENT_SECRET",
    "XERO_REDIRECT_URI",
  ].filter((key) => !process.env[key]);

  return Response.json({
    isConfigured: missingConfig.length === 0,
    missingConfig,
    isConnected: connection.isConnected,
    tenantId: connection.tenantId,
    tenantName: connection.tenantName,
    scopes: xeroScopes,
  });
}
