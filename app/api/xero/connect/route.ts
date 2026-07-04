import { NextResponse } from "next/server";
import { createXeroClient } from "@/lib/xeroClient";

export const runtime = "nodejs";

export async function GET() {
  try {
    const xero = createXeroClient();
    const consentUrl = await xero.buildConsentUrl();

    return NextResponse.redirect(consentUrl);
  } catch (error) {
    return Response.json(
      {
        error: "Unable to start Xero connection",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
