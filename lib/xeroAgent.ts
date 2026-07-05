import {
  getFreshAccessToken,
  getTextContent,
  openXeroMcpSession,
  type XeroMcpSession,
} from "@/lib/xeroMcp";
import { getErrorDetail } from "@/lib/xeroInvoices";

export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "abilities"; tools: string[]; locked: string[] }
  | { type: "tool_call"; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; tool: string; preview: string }
  | { type: "answer"; result: AgentResult; interactionId?: string }
  | { type: "error"; message: string };

export type AgentInsight = {
  title: string;
  detail: string;
  severity?: "good" | "watch" | "risk";
};

export type AgentReview = {
  rank: number;
  invoiceNumber: string;
  contactName: string;
  contactEmail?: string;
  amountDue: number;
  currencyCode: string;
  daysPastDue: number;
  priority: "high" | "medium" | "low";
  reason: string;
  recommendedAction: string;
  emailSubject: string;
  emailBody: string;
};

export type AgentResult = {
  answer?: string;
  summary?: string;
  insights?: AgentInsight[];
  reviews?: AgentReview[];
  followUps?: string[];
};

type GeminiStep = {
  type?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  content?: Array<{ type?: string; text?: string }>;
};

type GeminiInteraction = {
  id?: string;
  status?: string;
  steps?: GeminiStep[];
  error?: { message?: string };
};

const INTERACTIONS_URL =
  "https://generativelanguage.googleapis.com/v1beta/interactions";
const MAX_ITERATIONS = 24;
const MAX_TOOL_RESULT_CHARS = 20000;

// Read-only tools the agent may use, mapped to the Xero scopes (any of which)
// unlock them. Covers both the broad legacy scopes (accounting.transactions,
// accounting.reports.read) and the granular per-resource scopes newer Xero
// apps are limited to (accounting.banktransactions, accounting.reports.*.read).
const agentToolScopes: Record<string, string[]> = {
  "list-invoices": ["accounting.invoices", "accounting.transactions"],
  "list-contacts": ["accounting.contacts"],
  "list-contact-groups": ["accounting.contacts"],
  "list-accounts": ["accounting.settings"],
  "list-items": ["accounting.settings"],
  "list-tax-rates": ["accounting.settings"],
  "list-organisation-details": ["accounting.settings"],
  "list-tracking-categories": ["accounting.settings"],
  "list-payments": ["accounting.payments", "accounting.transactions"],
  "list-bank-transactions": [
    "accounting.banktransactions",
    "accounting.transactions",
  ],
  "list-credit-notes": ["accounting.transactions"],
  "list-quotes": ["accounting.transactions"],
  "list-manual-journals": [
    "accounting.manualjournals",
    "accounting.transactions",
  ],
  "list-profit-and-loss": [
    "accounting.reports.profitandloss.read",
    "accounting.reports.read",
  ],
  "list-report-balance-sheet": [
    "accounting.reports.balancesheet.read",
    "accounting.reports.read",
  ],
  "list-trial-balance": [
    "accounting.reports.trialbalance.read",
    "accounting.reports.read",
  ],
  "list-aged-receivables-by-contact": [
    "accounting.reports.aged.read",
    "accounting.reports.read",
  ],
  "list-aged-payables-by-contact": [
    "accounting.reports.aged.read",
    "accounting.reports.read",
  ],
};

function hasScope(granted: string[], requirements: string[]) {
  return requirements.some(
    (requirement) =>
      granted.includes(requirement) || granted.includes(`${requirement}.read`),
  );
}

// The Gemini interactions API rejects unknown JSON-schema keywords (like the
// $schema field zod emits), so keep only the portable subset.
const schemaKeys = new Set([
  "type",
  "description",
  "properties",
  "required",
  "enum",
  "items",
  "format",
  "minimum",
  "maximum",
]);

function sanitizeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map(sanitizeSchema);
  }

  if (!schema || typeof schema !== "object") {
    return schema;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (key === "properties" && value && typeof value === "object") {
      result.properties = Object.fromEntries(
        Object.entries(value).map(([name, propSchema]) => [
          name,
          sanitizeSchema(propSchema),
        ]),
      );
    } else if (key === "items") {
      result.items = sanitizeSchema(value);
    } else if (schemaKeys.has(key)) {
      result[key] = value;
    }
  }

  return result;
}

type McpToolInfo = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

function selectAgentTools(available: McpToolInfo[], grantedScopes: string[]) {
  const tools: McpToolInfo[] = [];
  const locked: string[] = [];

  for (const tool of available) {
    const requirements = agentToolScopes[tool.name];

    if (!requirements) {
      continue;
    }

    if (hasScope(grantedScopes, requirements)) {
      tools.push(tool);
    } else {
      locked.push(tool.name);
    }
  }

  return { tools, locked };
}

function toGeminiTools(tools: McpToolInfo[]) {
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description?.slice(0, 1000) ?? tool.name,
    parameters: sanitizeSchema(tool.inputSchema) ?? {
      type: "object",
      properties: {},
    },
  }));
}

function buildSystemInstruction(today: string, tenantName: string) {
  return [
    `You are Ledger, an autonomous finance agent embedded in a dashboard connected to the Xero organisation "${tenantName}". Today is ${today}.`,
    "You have live read-only tools over the organisation's Xero data. Before answering, call the tools you need: list-invoices for chasing debtors; list-profit-and-loss, list-report-balance-sheet, list-trial-balance, list-bank-transactions, and list-payments for cash flow, spending, and performance questions; list-contacts plus list-aged-receivables-by-contact for customer credit risk. Call as few tools as necessary and stop once you have enough evidence.",
    "IMPORTANT: batch your tool calls. When you need several pages or several different reports, request them all in ONE turn as parallel function calls (e.g. list-invoices pages 1-6 together, or the P&L and balance sheet together) instead of one call per turn. You have a limited number of turns.",
    "Every figure in your answer must come from tool results. Never invent data. If a tool errors because of missing permissions, say so plainly and answer with what you have.",
    "You may be in an ongoing conversation: earlier turns, their tool results, and your previous findings are context. When the user gives a follow-up instruction such as \"draft emails for those\", act on the entities you identified earlier without re-asking, and only call tools again if you are missing details.",
    'When you are finished, reply with ONLY valid JSON in this shape: {"answer":"direct answer to the user","summary":"short analytical summary of what you examined","insights":[{"title":"string","detail":"string","severity":"good|watch|risk"}],"reviews":[{"rank":1,"invoiceNumber":"string","contactName":"string","contactEmail":"string","amountDue":0,"currencyCode":"string","daysPastDue":0,"priority":"high|medium|low","reason":"string","recommendedAction":"string","emailSubject":"string","emailBody":"string"}],"followUps":["string"]}.',
    "Before returning reviews, look up each contact's email address with the list-contacts tool (use searchTerm with the contact's name) and set contactEmail from the result. Use an empty string when the contact has no email on file — never invent an address.",
    "Rank reviews by actionability as well as urgency: a contact with no email on file must rank BELOW otherwise-similar contacts that can be emailed right now. For those contacts, say in reason that there is no email on file, and make recommendedAction an alternative channel (phone them, check the contact record in Xero). Your answer and summary must describe the same priority order as the ranked reviews — never call someone the top priority unless they are rank 1.",
    "Use insights (2-6 items) for analysis questions such as cash flow, performance, trends, or risk; leave it empty otherwise. Use reviews with ranked follow-ups and concise professional email drafts whenever the user wants to chase, collect, or draft emails about invoices; leave it empty otherwise.",
    'followUps is REQUIRED and must never be empty: give 2-4 short, concrete next actions the user might ask for, phrased as requests and grounded in what you just found, e.g. ["Draft chase emails for the three late payers","Compare this quarter\'s P&L with last quarter","Check which suppliers we owe money to"].',
  ].join("\n");
}

function extractOutputText(interaction: GeminiInteraction) {
  return (
    interaction.steps
      ?.flatMap((step) => step.content ?? [])
      .filter((content) => content.type === "text" && content.text)
      .map((content) => content.text)
      .join("\n") ?? ""
  );
}

function parseAgentResult(text: string): AgentResult {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced?.[1] ?? trimmed;

  try {
    const parsed = JSON.parse(jsonText) as AgentResult;

    return {
      answer: parsed.answer,
      summary: parsed.summary,
      insights: Array.isArray(parsed.insights) ? parsed.insights : [],
      reviews: Array.isArray(parsed.reviews) ? parsed.reviews : [],
      followUps: Array.isArray(parsed.followUps)
        ? parsed.followUps.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
    };
  } catch {
    return {
      answer: trimmed,
      summary: "",
      insights: [],
      reviews: [],
      followUps: [],
    };
  }
}

async function callAgentTool(
  session: XeroMcpSession,
  name: string,
  args: Record<string, unknown>,
) {
  try {
    const result = await session.client.callTool({
      name,
      arguments: args ?? {},
    });
    const text = getTextContent(result.content)
      .map((item) => item.text)
      .join("\n");

    return text || "The tool returned no data.";
  } catch (error) {
    return `Error calling ${name}: ${getErrorDetail(error)}`;
  }
}

async function callGemini(apiKey: string, payload: Record<string, unknown>) {
  const response = await fetch(INTERACTIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });
  const interaction = (await response.json()) as GeminiInteraction;

  if (!response.ok) {
    throw new Error(interaction.error?.message ?? "Gemini returned an error");
  }

  return interaction;
}

export async function runXeroAgent(
  question: string,
  emit: (event: AgentEvent) => void,
  previousInteractionId?: string | null,
) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    emit({
      type: "error",
      message:
        "Missing Gemini API key. Add GEMINI_API_KEY to .env.local and restart the dev server.",
    });
    return;
  }

  const tokenResult = await getFreshAccessToken();

  if (!tokenResult.ok) {
    const detail = (tokenResult.body as { detail?: string }).detail;

    emit({
      type: "error",
      message: detail ?? tokenResult.body.error,
    });
    return;
  }

  emit({ type: "status", message: "Cracking open the books..." });

  const session = await openXeroMcpSession(tokenResult.accessToken);

  try {
    const listed = await session.client.listTools();
    const { tools, locked } = selectAgentTools(
      listed.tools as McpToolInfo[],
      tokenResult.grantedScopes,
    );

    emit({
      type: "abilities",
      tools: tools.map((tool) => tool.name),
      locked,
    });

    const geminiTools = toGeminiTools(tools);
    const model = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
    const today = new Date().toISOString().slice(0, 10);
    const generationConfig = { temperature: 0.2, thinking_level: "low" };
    // Resent on every turn: the interactions API does not carry the system
    // instruction across previous_interaction_id continuations.
    const systemInstruction = buildSystemInstruction(
      today,
      tokenResult.connection.tenantName ?? "the connected company",
    );
    let payload: Record<string, unknown> = {
      model,
      system_instruction: systemInstruction,
      input: question,
      tools: geminiTools,
      generation_config: generationConfig,
      // Continue the stored server-side conversation so follow-up requests
      // ("draft emails for those") keep the context of earlier turns.
      ...(previousInteractionId
        ? { previous_interaction_id: previousInteractionId }
        : {}),
    };

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      const interaction = await callGemini(apiKey, payload);
      const functionCalls = (interaction.steps ?? []).filter(
        (step): step is GeminiStep & { id: string; name: string } =>
          step.type === "function_call" &&
          typeof step.id === "string" &&
          typeof step.name === "string",
      );

      if (interaction.status === "requires_action" && functionCalls.length > 0) {
        const results: Array<Record<string, unknown>> = [];

        for (const call of functionCalls) {
          const args = call.arguments ?? {};

          emit({ type: "tool_call", tool: call.name, args });

          const resultText = await callAgentTool(session, call.name, args);

          emit({
            type: "tool_result",
            tool: call.name,
            preview: resultText.slice(0, 200),
          });
          results.push({
            type: "function_result",
            call_id: call.id,
            name: call.name,
            result: resultText.slice(0, MAX_TOOL_RESULT_CHARS),
          });
        }

        // Last round: return the tool results without offering tools again
        // and demand the final answer, so the turn degrades gracefully
        // instead of erroring out at the budget.
        const isFinalRound = iteration === MAX_ITERATIONS - 2;

        payload = {
          model,
          previous_interaction_id: interaction.id,
          system_instruction: systemInstruction,
          input: isFinalRound
            ? [
                ...results,
                {
                  type: "text",
                  text: "Your tool budget is used up. Do not request more tools. Reply NOW with ONLY the final JSON answer in the required shape, using the evidence you have gathered. If some data is missing, say so in the answer.",
                },
              ]
            : results,
          ...(isFinalRound ? {} : { tools: geminiTools }),
          generation_config: generationConfig,
        };
        continue;
      }

      emit({
        type: "status",
        message: "Adding it all up (carrying the one)...",
      });
      emit({
        type: "answer",
        result: parseAgentResult(extractOutputText(interaction)),
        interactionId: interaction.id,
      });
      return;
    }

    emit({
      type: "error",
      message: "The agent hit its tool-call limit before finishing an answer.",
    });
  } catch (error) {
    const stderr = session.stderrText();
    const message = getErrorDetail(error);

    emit({
      type: "error",
      message: stderr ? `${message}: ${stderr}` : message,
    });
  } finally {
    await session.close();
  }
}
