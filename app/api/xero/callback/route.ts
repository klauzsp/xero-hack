import { NextRequest, NextResponse } from "next/server";
import { createXeroClient } from "@/lib/xeroClient";
import { saveXeroConnection } from "@/lib/xeroStore";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const callbackUrl = new URL(request.url);
  const callbackError = callbackUrl.searchParams.get("error");

  if (callbackError) {
    const url = new URL("/", request.url);
    const description = callbackUrl.searchParams.get("error_description");
    url.searchParams.set("error", description ?? callbackError);

    return NextResponse.redirect(url);
  }

  try {
    const xero = createXeroClient();
    const tokenSet = await xero.apiCallback(request.url);
    const tenants = await xero.updateTenants(false);
    const tenant = tenants[0];

    if (!tenant?.tenantId) {
      return Response.json(
        { error: "Xero connected, but no tenant was returned" },
        { status: 400 },
      );
    }

    saveXeroConnection(
      tokenSet,
      tenant.tenantId,
      tenant.tenantName ?? tenant.tenantId,
    );

    return NextResponse.redirect(new URL("/?connected=1", request.url));
  } catch (error) {
    const url = new URL("/", request.url);
    url.searchParams.set(
      "error",
      error instanceof Error ? error.message : "Xero callback failed",
    );

    return NextResponse.redirect(url);
  }
}
