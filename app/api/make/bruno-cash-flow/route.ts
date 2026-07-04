export const runtime = "nodejs";

function getErrorDetail(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

export async function POST(request: Request) {
  const brunoSearch =
    process.env.MAKE_BRUNO_SEARCH_API ?? process.env.MAKE_BRUNO_SEARCH;
  const brunoSearchIsUrl = brunoSearch?.startsWith("http");
  const webhookUrl =
    process.env.MAKE_BRUNO_URL ??
    (brunoSearchIsUrl ? brunoSearch : undefined) ??
    process.env.MAKE_WEBHOOK_URL;
  const apiKey =
    (!brunoSearchIsUrl ? brunoSearch : undefined) ??
    process.env.MAKE_BRUNO_RADAR_API_KEY;

  if (!webhookUrl) {
    return Response.json(
      { error: "Missing MAKE_BRUNO_URL" },
      { status: 500 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers["x-make-apikey"] = apiKey;
  }

  try {
    const makeResponse = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        daysBack: 90,
        focus: "cash-flow",
        source: "xero-hack-dashboard",
        triggeredAt: new Date().toISOString(),
        ...body,
      }),
    });

    const text = await makeResponse.text();

    if (!makeResponse.ok) {
      return Response.json(
        {
          error: "Make webhook failed",
          detail: text,
        },
        { status: makeResponse.status },
      );
    }

    return Response.json({
      ok: true,
      makeResponse: text,
    });
  } catch (error) {
    return Response.json(
      {
        error: "Unable to trigger Make automation",
        detail: getErrorDetail(error),
      },
      { status: 500 },
    );
  }
}
