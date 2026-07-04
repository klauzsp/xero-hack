import { runXeroAgent, type AgentEvent } from "@/lib/xeroAgent";
import { getErrorDetail } from "@/lib/xeroInvoices";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    question?: string;
    previousInteractionId?: string;
  };
  const question = body.question?.trim() || "Check invoices";
  const previousInteractionId =
    typeof body.previousInteractionId === "string"
      ? body.previousInteractionId
      : null;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: AgentEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        await runXeroAgent(question, emit, previousInteractionId);
      } catch (error) {
        emit({ type: "error", message: getErrorDetail(error) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
