import { fetchXeroInvoices, getErrorDetail } from "@/lib/xeroInvoices";

export const runtime = "nodejs";

type GeminiInteractionResponse = {
  output_text?: string;
  steps?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
};

function extractGeminiText(response: GeminiInteractionResponse) {
  if (response.output_text) {
    return response.output_text;
  }

  return (
    response.steps
      ?.flatMap((step) => step.content ?? [])
      .filter((content) => content.type === "text" && content.text)
      .map((content) => content.text)
      .join("\n") ?? ""
  );
}

function parseJsonResponse(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced?.[1] ?? trimmed;

  return JSON.parse(jsonText);
}

export async function POST() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return Response.json(
      {
        error: "Missing Gemini API key",
        detail: "Add GEMINI_API_KEY to .env.local and restart the dev server.",
      },
      { status: 500 },
    );
  }

  try {
    const invoiceResult = await fetchXeroInvoices(100);

    if (!invoiceResult.ok) {
      return Response.json(invoiceResult.body, { status: invoiceResult.status });
    }

    const today = new Date().toISOString().slice(0, 10);
    const candidateInvoices = invoiceResult.body.invoices
      .filter((invoice) => (invoice.amountDue ?? 0) > 0 && invoice.dueDate)
      .map((invoice) => ({
        ...invoice,
        daysPastDue: invoice.dueDate
          ? Math.max(
              Math.floor(
                (Date.parse(today) - Date.parse(invoice.dueDate)) /
                  (1000 * 60 * 60 * 24),
              ),
              0,
            )
          : 0,
      }));

    if (candidateInvoices.length === 0) {
      return Response.json({
        generatedAt: new Date().toISOString(),
        tenantName: invoiceResult.body.tenantName,
        summary: "No outstanding invoices with due dates were found.",
        reviews: [],
      });
    }

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          model: process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
          system_instruction:
            "You are a careful accounts receivable agent. Rank overdue and risky invoices using payment urgency, amount due, days past due, customer context from invoice data, tone appropriateness, and practical next action. Do not invent facts. Draft concise, professional email copy that a human can review before sending.",
          input: `Today is ${today}. Analyse these Xero invoice summaries and return only valid JSON with this shape: {"summary":"string","reviews":[{"rank":number,"invoiceNumber":"string","contactName":"string","amountDue":number,"currencyCode":"string","daysPastDue":number,"priority":"high|medium|low","reason":"string","recommendedAction":"string","emailSubject":"string","emailBody":"string"}]}. Invoice data: ${JSON.stringify(candidateInvoices)}`,
          generation_config: {
            temperature: 0.35,
            thinking_level: "low",
          },
        }),
      },
    );

    const raw = (await response.json()) as GeminiInteractionResponse & {
      error?: { message?: string };
    };

    if (!response.ok) {
      return Response.json(
        {
          error: "Gemini invoice review failed",
          detail: raw.error?.message ?? "Gemini returned an error",
        },
        { status: response.status },
      );
    }

    const text = extractGeminiText(raw);
    const review = parseJsonResponse(text) as {
      summary: string;
      reviews: unknown[];
    };

    return Response.json({
      generatedAt: new Date().toISOString(),
      tenantName: invoiceResult.body.tenantName,
      ...review,
    });
  } catch (error) {
    return Response.json(
      {
        error: "Unable to generate invoice review",
        detail: getErrorDetail(error),
      },
      { status: 500 },
    );
  }
}
