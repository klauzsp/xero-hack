"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type AppView = "dashboard" | "review";

type Status = {
  isConfigured: boolean;
  missingConfig: string[];
  isConnected: boolean;
  tenantId: string | null;
  tenantName: string | null;
  canDisconnectFromXero: boolean;
  scopes: string[];
};

type Invoice = {
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

type InvoiceResponse = {
  count: number;
  invoices: Invoice[];
};

type DashboardMetrics = {
  totalInvoiced: number;
  amountDue: number;
  amountPaid: number;
  openInvoices: number;
  overdueInvoices: number;
};

type InvoiceReview = {
  rank: number;
  invoiceNumber: string;
  contactName: string;
  amountDue: number;
  currencyCode: string;
  daysPastDue: number;
  priority: "high" | "medium" | "low";
  reason: string;
  recommendedAction: string;
  emailSubject: string;
  emailBody: string;
};

type AgentInsight = {
  title: string;
  detail: string;
  severity?: "good" | "watch" | "risk";
};

type AgentResult = {
  answer?: string;
  summary?: string;
  insights?: AgentInsight[];
  reviews?: InvoiceReview[];
  followUps?: string[];
};

type AgentStreamEvent =
  | { type: "status"; message: string }
  | { type: "abilities"; tools: string[]; locked: string[] }
  | { type: "tool_call"; tool: string; args?: Record<string, unknown> }
  | { type: "tool_result"; tool: string; preview?: string }
  | { type: "answer"; result: AgentResult; interactionId?: string }
  | { type: "error"; message: string };

type AgentTurn = {
  id: number;
  question: string;
  steps: AgentTraceStep[];
  result: AgentResult | null;
};

type AgentTraceStep = {
  id: number;
  kind: "status" | "tool" | "error";
  tool?: string;
  label: string;
};

// Playful spinner copy while a tool runs; the plain-English source names
// below feed the sober "Checked: ..." summary once the turn finishes.
const agentToolLabels: Record<string, string> = {
  "list-invoices": "Shaking the invoice tree...",
  "list-contacts": "Flipping through the address book...",
  "list-contact-groups": "Sorting contacts into cliques...",
  "list-accounts": "Dusting off the chart of accounts...",
  "list-items": "Counting things in the stockroom...",
  "list-tax-rates": "Consulting the sacred tax tables...",
  "list-organisation-details": "Polishing the company nameplate...",
  "list-tracking-categories": "Untangling the tracking categories...",
  "list-payments": "Following the money...",
  "list-bank-transactions": "Snooping through the bank statement...",
  "list-credit-notes": "Counting the IOUs...",
  "list-quotes": "Digging up old quotes...",
  "list-manual-journals": "Deciphering the manual journals...",
  "list-profit-and-loss": "Peeking at the P&L (fingers crossed)...",
  "list-report-balance-sheet": "Making sure the balance sheet balances...",
  "list-trial-balance": "Giving the trial balance a stern look...",
  "list-aged-receivables-by-contact": "Working out who owes you money...",
  "list-aged-payables-by-contact": "Working out who you owe money to...",
};

const agentToolSources: Record<string, string> = {
  "list-invoices": "invoices",
  "list-contacts": "contacts",
  "list-contact-groups": "contact groups",
  "list-accounts": "chart of accounts",
  "list-items": "items",
  "list-tax-rates": "tax rates",
  "list-organisation-details": "organisation details",
  "list-tracking-categories": "tracking categories",
  "list-payments": "payments",
  "list-bank-transactions": "bank transactions",
  "list-credit-notes": "credit notes",
  "list-quotes": "quotes",
  "list-manual-journals": "manual journals",
  "list-profit-and-loss": "profit & loss",
  "list-report-balance-sheet": "balance sheet",
  "list-trial-balance": "trial balance",
  "list-aged-receivables-by-contact": "aged receivables",
  "list-aged-payables-by-contact": "aged payables",
};


const invoiceScopes = ["accounting.invoices.read", "accounting.invoices"];

const initialStatus: Status = {
  isConfigured: false,
  missingConfig: [],
  isConnected: false,
  tenantId: null,
  tenantName: null,
  canDisconnectFromXero: false,
  scopes: [],
};

export function XeroApp({ view }: { view: AppView }) {
  const [status, setStatus] = useState<Status>(initialStatus);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [message, setMessage] = useState("Checking local configuration...");
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [agentTurns, setAgentTurns] = useState<AgentTurn[]>([]);
  const [lockedTools, setLockedTools] = useState<string[]>([]);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [hasLoadedInvoices, setHasLoadedInvoices] = useState(false);
  const traceIdRef = useRef(0);
  const turnIdRef = useRef(0);
  const interactionIdRef = useRef<string | null>(null);

  const currency = invoices.find((invoice) => invoice.currencyCode)?.currencyCode ?? "GBP";
  const money = useMemo(
    () =>
      new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency,
      }),
    [currency],
  );

  const metrics = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return invoices.reduce<DashboardMetrics>(
      (nextMetrics, invoice) => {
        const total = invoice.total ?? 0;
        const due = invoice.amountDue ?? 0;
        const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : null;

        nextMetrics.totalInvoiced += total;
        nextMetrics.amountDue += due;
        nextMetrics.amountPaid += Math.max(total - due, 0);

        if (due > 0) {
          nextMetrics.openInvoices += 1;
        }

        if (due > 0 && dueDate && dueDate < today) {
          nextMetrics.overdueInvoices += 1;
        }

        return nextMetrics;
      },
      {
        totalInvoiced: 0,
        amountDue: 0,
        amountPaid: 0,
        openInvoices: 0,
        overdueInvoices: 0,
      },
    );
  }, [invoices]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const callbackError = params.get("error");

    async function loadStatus() {
      setIsLoadingStatus(true);
      const response = await fetch("/api/xero/status");
      const nextStatus = (await response.json()) as Status;

      setStatus(nextStatus);
      setMessage(
        callbackError ??
          (nextStatus.isConnected
            ? "Connected to Xero. Invoice data is ready to review."
            : "Ready to connect to your Xero demo company."),
      );
      setIsLoadingStatus(false);
    }

    loadStatus().catch((error) => {
      setMessage(error instanceof Error ? error.message : "Status check failed");
      setIsLoadingStatus(false);
    });
  }, []);

  useEffect(() => {
    if (!status.isConnected || hasLoadedInvoices || isLoadingInvoices) {
      return;
    }

    loadInvoices();
  }, [status.isConnected, hasLoadedInvoices, isLoadingInvoices]);

  async function loadInvoices() {
    setIsLoadingInvoices(true);
    setInvoiceError(null);
    setMessage("Requesting invoices from Xero...");

    try {
      const response = await fetch("/api/xero/invoices");
      const data = (await response.json()) as InvoiceResponse & {
        error?: string;
        detail?: string;
      };

      if (!response.ok) {
        throw new Error(data.detail ?? data.error ?? "Invoice request failed");
      }

      setInvoices(data.invoices);
      setHasLoadedInvoices(true);
      setMessage(`Xero returned ${data.count} invoice record(s).`);
    } catch (error) {
      const nextError =
        error instanceof Error ? error.message : "Invoice request failed";

      setInvoiceError(nextError);
      setHasLoadedInvoices(true);
      setMessage(nextError);
    } finally {
      setIsLoadingInvoices(false);
    }
  }

  async function disconnectXero() {
    setIsDisconnecting(true);
    setMessage("Disconnecting from Xero...");

    try {
      const response = await fetch("/api/xero/disconnect", {
        method: "POST",
      });

      if (!response.ok) {
        const data = (await response.json()) as { detail?: string; error?: string };
        throw new Error(data.detail ?? data.error ?? "Disconnect failed");
      }

      setStatus((currentStatus) => ({
        ...currentStatus,
        isConnected: false,
        tenantId: null,
        tenantName: null,
        canDisconnectFromXero: false,
      }));
      setInvoices([]);
      setInvoiceError(null);
      setHasLoadedInvoices(false);
      setMessage("Disconnected from Xero and cleared the local session.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Disconnect failed");
    } finally {
      setIsDisconnecting(false);
    }
  }

  function updateLastTurn(update: (turn: AgentTurn) => AgentTurn) {
    setAgentTurns((turns) =>
      turns.length === 0
        ? turns
        : [...turns.slice(0, -1), update(turns[turns.length - 1])],
    );
  }

  function appendTraceStep(step: Omit<AgentTraceStep, "id">) {
    traceIdRef.current += 1;
    const id = traceIdRef.current;

    updateLastTurn((turn) => ({
      ...turn,
      steps: [...turn.steps, { ...step, id }],
    }));
  }

  function handleAgentEvent(event: AgentStreamEvent) {
    switch (event.type) {
      case "status":
        appendTraceStep({ kind: "status", label: event.message });
        break;
      case "abilities":
        setLockedTools(event.locked);
        break;
      case "tool_call":
        appendTraceStep({
          kind: "tool",
          tool: event.tool,
          label: agentToolLabels[event.tool] ?? event.tool,
        });
        break;
      case "tool_result":
        break;
      case "answer": {
        const insightCount = event.result.insights?.length ?? 0;
        const reviewCount = event.result.reviews?.length ?? 0;

        if (event.interactionId) {
          interactionIdRef.current = event.interactionId;
        }

        updateLastTurn((turn) => ({ ...turn, result: event.result }));
        setMessage(
          `Agent finished with ${insightCount} insight(s) and ${reviewCount} follow-up(s).`,
        );
        break;
      }
      case "error":
        appendTraceStep({ kind: "error", label: event.message });
        setMessage(event.message);
        break;
    }
  }

  function resetConversation() {
    interactionIdRef.current = null;
    setAgentTurns([]);
    setMessage("Started a new conversation with the agent.");
  }

  async function runAgent(question = "Check invoices") {
    turnIdRef.current += 1;
    setAgentTurns((turns) => [
      ...turns,
      { id: turnIdRef.current, question, steps: [], result: null },
    ]);
    setIsAgentRunning(true);
    setMessage("Agent is planning which Xero data to pull...");

    try {
      const response = await fetch("/api/ai/agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question,
          previousInteractionId: interactionIdRef.current ?? undefined,
        }),
      });

      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };

        throw new Error(data.detail ?? data.error ?? "Agent request failed");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");

        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.trim()) {
            handleAgentEvent(JSON.parse(line) as AgentStreamEvent);
          }
        }
      }

      if (buffer.trim()) {
        handleAgentEvent(JSON.parse(buffer) as AgentStreamEvent);
      }
    } catch (error) {
      const nextMessage =
        error instanceof Error ? error.message : "Agent request failed";

      appendTraceStep({ kind: "error", label: nextMessage });
      setMessage(nextMessage);
    } finally {
      setIsAgentRunning(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f8f6] text-[#17211b]">
      <header className="sticky top-0 z-10 border-b border-[#d7ddd4] bg-white/95 backdrop-blur">
        <nav className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-8">
            <Link className="text-base font-semibold" href="/">
              Xero Review
            </Link>
            <div className="flex items-center gap-1">
              <NavLink active={view === "dashboard"} href="/">
                Dashboard
              </NavLink>
              <NavLink active={view === "review"} href="/review">
                Review
              </NavLink>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden max-w-44 truncate text-sm text-[#526157] sm:inline">
              {status.tenantName ?? "No company"}
            </span>
            {status.isConnected ? (
              <button
                className="inline-flex h-10 items-center justify-center rounded-md border border-[#d8bbb6] bg-white px-3 text-sm font-semibold text-[#7a2f25] transition hover:bg-[#fbefed] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isDisconnecting || isLoadingStatus}
                onClick={disconnectXero}
                type="button"
              >
                {isDisconnecting ? "Disconnecting..." : "Disconnect"}
              </button>
            ) : (
              <a
                className="inline-flex h-10 items-center justify-center rounded-md bg-[#0f6f4d] px-3 text-sm font-semibold text-white transition hover:bg-[#0b5d40]"
                href="/api/xero/connect"
              >
                Connect Xero
              </a>
            )}
          </div>
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-8 sm:px-8">
        <section className="flex flex-col gap-2">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#31795a]">
            {status.isConnected ? status.tenantName : "Xero developer demo"}
          </p>
          <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">
            {view === "dashboard" ? "Financial dashboard" : "Agent review"}
          </h1>
          <p className="max-w-2xl text-base leading-7 text-[#526157]">
            {view === "dashboard"
              ? "Track invoice totals, receivables, and overdue work from your connected Xero company."
              : "An autonomous agent with live Xero tools — it decides which data to pull, shows its working, and reports back."}
          </p>
        </section>

        <StatusBanner status={status} message={message} />

        {view === "dashboard" ? (
          <DashboardView
            invoices={invoices}
            isLoadingInvoices={isLoadingInvoices}
            invoiceError={invoiceError}
            loadInvoices={loadInvoices}
            metrics={metrics}
            money={money}
            status={status}
          />
        ) : (
          <ReviewView
            agentTurns={agentTurns}
            invoices={invoices}
            isAgentRunning={isAgentRunning}
            lockedTools={lockedTools}
            resetConversation={resetConversation}
            runAgent={runAgent}
            status={status}
          />
        )}
      </main>
    </div>
  );
}

function NavLink({
  active,
  children,
  href,
}: {
  active: boolean;
  children: React.ReactNode;
  href: string;
}) {
  return (
    <Link
      className={`rounded-md px-3 py-2 text-sm font-medium transition ${
        active
          ? "bg-[#e6eee9] text-[#0f6f4d]"
          : "text-[#526157] hover:bg-[#eef2ec] hover:text-[#17211b]"
      }`}
      href={href}
    >
      {children}
    </Link>
  );
}

function StatusBanner({ message, status }: { message: string; status: Status }) {
  const lacksInvoiceScope =
    status.isConnected &&
    !invoiceScopes.some((scope) => status.scopes.includes(scope));

  if (!status.isConfigured) {
    return (
      <section className="rounded-md border border-[#ead0a2] bg-[#fff8e8] p-4 text-sm text-[#6d4c16]">
        Missing env vars: {status.missingConfig.join(", ")}
      </section>
    );
  }

  if (lacksInvoiceScope) {
    return (
      <section className="rounded-md border border-[#ead0a2] bg-[#fff8e8] p-4 text-sm text-[#6d4c16]">
        This app is configured without invoice scope. Add
        `accounting.invoices.read` to `XERO_SCOPES`, restart the dev server, and
        reconnect to Xero.
      </section>
    );
  }

  return (
    <section className="rounded-md border border-[#d7ddd4] bg-white px-4 py-3 text-sm text-[#526157]">
      {message}
    </section>
  );
}

function DashboardView({
  invoices,
  isLoadingInvoices,
  invoiceError,
  loadInvoices,
  metrics,
  money,
  status,
}: {
  invoices: Invoice[];
  isLoadingInvoices: boolean;
  invoiceError: string | null;
  loadInvoices: () => void;
  metrics: DashboardMetrics;
  money: Intl.NumberFormat;
  status: Status;
}) {
  return (
    <>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total invoiced" value={money.format(metrics.totalInvoiced)} />
        <MetricCard label="Amount due" value={money.format(metrics.amountDue)} />
        <MetricCard label="Paid" value={money.format(metrics.amountPaid)} />
        <MetricCard label="Overdue invoices" value={String(metrics.overdueInvoices)} />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <InvoiceTable
          invoiceError={invoiceError}
          invoices={invoices}
          isLoadingInvoices={isLoadingInvoices}
          money={money}
        />
        <aside className="rounded-md border border-[#d7ddd4] bg-white p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Connection</h2>
              <p className="mt-1 text-sm leading-6 text-[#526157]">
                {status.isConnected
                  ? "Invoice data is available for the connected company."
                  : "Connect Xero to load dashboard metrics."}
              </p>
            </div>
            <span
              className={`rounded-md px-2 py-1 text-xs font-semibold ${
                status.isConnected
                  ? "bg-[#e6eee9] text-[#0f6f4d]"
                  : "bg-[#f1e9e7] text-[#7a2f25]"
              }`}
            >
              {status.isConnected ? "Live" : "Offline"}
            </span>
          </div>
          <dl className="mt-5 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-[#526157]">Company</dt>
              <dd className="truncate font-medium">{status.tenantName ?? "None"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[#526157]">Open invoices</dt>
              <dd className="font-medium">{metrics.openInvoices}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[#526157]">Invoices loaded</dt>
              <dd className="font-medium">{invoices.length}</dd>
            </div>
          </dl>
          <button
            className="mt-5 inline-flex h-10 w-full items-center justify-center rounded-md border border-[#b9c3b7] bg-white px-3 text-sm font-semibold text-[#17211b] transition hover:bg-[#eef2ec] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!status.isConnected || isLoadingInvoices}
            onClick={loadInvoices}
            type="button"
          >
            {isLoadingInvoices ? "Refreshing..." : "Refresh invoices"}
          </button>
        </aside>
      </section>
    </>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#d7ddd4] bg-white p-4">
      <p className="text-sm text-[#526157]">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function InvoiceTable({
  invoiceError,
  invoices,
  isLoadingInvoices,
  money,
}: {
  invoiceError: string | null;
  invoices: Invoice[];
  isLoadingInvoices: boolean;
  money: Intl.NumberFormat;
}) {
  return (
    <section className="rounded-md border border-[#d7ddd4] bg-white">
      <div className="border-b border-[#d7ddd4] px-4 py-3">
        <h2 className="text-lg font-semibold">Recent invoices</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead className="bg-[#eef2ec] text-[#526157]">
            <tr>
              <th className="px-4 py-3 font-semibold">Invoice</th>
              <th className="px-4 py-3 font-semibold">Contact</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Due date</th>
              <th className="px-4 py-3 text-right font-semibold">Total</th>
              <th className="px-4 py-3 text-right font-semibold">Due</th>
            </tr>
          </thead>
          <tbody>
            {invoiceError ? (
              <tr>
                <td className="px-4 py-8 text-center text-[#7a2f25]" colSpan={6}>
                  {invoiceError}
                </td>
              </tr>
            ) : isLoadingInvoices ? (
              <tr>
                <td className="px-4 py-8 text-center text-[#526157]" colSpan={6}>
                  Loading invoices...
                </td>
              </tr>
            ) : invoices.length === 0 ? (
              <tr>
                <td className="px-4 py-8 text-center text-[#526157]" colSpan={6}>
                  No invoices loaded yet.
                </td>
              </tr>
            ) : (
              invoices.map((invoice) => (
                <tr
                  className="border-t border-[#edf0eb]"
                  key={invoice.invoiceID ?? invoice.invoiceNumber}
                >
                  <td className="px-4 py-3 font-medium">
                    {invoice.invoiceNumber ?? "No number"}
                  </td>
                  <td className="px-4 py-3">{invoice.contactName ?? "Unknown"}</td>
                  <td className="px-4 py-3">{invoice.status ?? "-"}</td>
                  <td className="px-4 py-3">{invoice.dueDate ?? "-"}</td>
                  <td className="px-4 py-3 text-right">
                    {typeof invoice.total === "number"
                      ? money.format(invoice.total)
                      : "-"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {typeof invoice.amountDue === "number"
                      ? money.format(invoice.amountDue)
                      : "-"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReviewView({
  agentTurns,
  invoices,
  isAgentRunning,
  lockedTools,
  resetConversation,
  runAgent,
  status,
}: {
  agentTurns: AgentTurn[];
  invoices: Invoice[];
  isAgentRunning: boolean;
  lockedTools: string[];
  resetConversation: () => void;
  runAgent: (question?: string) => Promise<void>;
  status: Status;
}) {
  const [question, setQuestion] = useState("");
  const suggestionButtons = [
    "Chase overdue invoices",
    "Analyse our cash flow position",
    "How is the business performing?",
    "Which customers are the biggest credit risk?",
  ];
  const lastTurn =
    agentTurns.length > 0 ? agentTurns[agentTurns.length - 1] : null;
  const findingCount =
    (lastTurn?.result?.insights?.length ?? 0) +
    (lastTurn?.result?.reviews?.length ?? 0);

  async function submitQuestion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextQuestion = question.trim();

    if (!nextQuestion) {
      return;
    }

    setQuestion("");
    await runAgent(nextQuestion);
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="rounded-md border border-[#d7ddd4] bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Ask the agent</h2>
            <p className="mt-1 text-sm text-[#526157]">
              The agent has live read-only tools over your Xero data — invoices,
              reports, payments, contacts — and remembers this conversation, so
              you can follow up on its findings.
            </p>
          </div>
          {agentTurns.length > 0 ? (
            <button
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-[#b9c3b7] bg-white px-3 text-sm font-medium text-[#17211b] transition hover:bg-[#eef2ec] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isAgentRunning}
              onClick={resetConversation}
              type="button"
            >
              New conversation
            </button>
          ) : null}
        </div>

        <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={submitQuestion}>
          <input
            className="h-12 min-w-0 flex-1 rounded-md border border-[#b9c3b7] bg-white px-4 text-sm outline-none transition placeholder:text-[#8b978e] focus:border-[#0f6f4d] focus:ring-2 focus:ring-[#cfe4da]"
            disabled={!status.isConnected || isAgentRunning}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={
              agentTurns.length > 0
                ? "Ask a follow-up — the agent remembers this conversation"
                : "Ask about cash flow, overdue invoices, spending, or customer risk"
            }
            type="text"
            value={question}
          />
          <button
            className="inline-flex h-12 items-center justify-center rounded-md bg-[#0f6f4d] px-5 text-sm font-semibold text-white transition hover:bg-[#0b5d40] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!status.isConnected || isAgentRunning || !question.trim()}
            type="submit"
          >
            {isAgentRunning ? "Working..." : "Ask"}
          </button>
        </form>

        {agentTurns.length === 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {suggestionButtons.map((suggestion) => (
              <button
                className="inline-flex h-9 items-center justify-center rounded-md border border-[#b9c3b7] bg-white px-3 text-sm font-medium text-[#17211b] transition hover:bg-[#eef2ec] disabled:cursor-not-allowed disabled:border-[#d7ddd4] disabled:text-[#9aa49d]"
                disabled={!status.isConnected || isAgentRunning}
                key={suggestion}
                onClick={() => void runAgent(suggestion)}
                type="button"
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}

        {lockedTools.length > 0 ? (
          <p className="mt-3 rounded-md border border-[#ead0a2] bg-[#fff8e8] px-3 py-2 text-xs text-[#6d4c16]">
            {lockedTools.length} abilities are not covered by your current Xero
            token. Disconnecting and reconnecting unlocks any that your Xero app
            configuration allows.
          </p>
        ) : null}

        <div className="mt-5 grid gap-3 border-t border-[#edf0eb] pt-4 text-sm sm:grid-cols-4">
          <ReviewContextItem label="Invoices" value={String(invoices.length)} />
          <ReviewContextItem
            label="Agent"
            value={isAgentRunning ? "Running" : lastTurn ? "Ready" : "Idle"}
          />
          <ReviewContextItem
            label="Turns"
            value={String(agentTurns.length)}
          />
          <ReviewContextItem label="Findings" value={String(findingCount)} />
        </div>
      </div>

      {agentTurns.length === 0 ? (
        <div className="rounded-md border border-[#d7ddd4] bg-white px-5 py-14 text-center text-sm text-[#526157]">
          Ask a question or pick a suggestion. The agent chooses which Xero
          tools to call, shows its working, and suggests follow-up actions you
          can run with one click.
        </div>
      ) : null}

      {agentTurns.map((turn, turnIndex) => {
        const isLastTurn = turnIndex === agentTurns.length - 1;
        const turnInsights = turn.result?.insights ?? [];
        const turnReviews = turn.result?.reviews ?? [];
        const followUps = turn.result?.followUps ?? [];

        return (
          <div className="flex flex-col gap-4" key={turn.id}>
            <div className="max-w-xl self-end rounded-md bg-[#0f6f4d] px-4 py-2.5 text-sm font-medium leading-6 text-white">
              {turn.question}
            </div>

            <AgentProgress
              isRunning={isAgentRunning && isLastTurn && !turn.result}
              steps={turn.steps}
            />

            {turn.result ? (
              <div className="rounded-md border border-[#d7ddd4] bg-white">
                <div className="border-b border-[#edf0eb] px-5 py-4">
                  {turn.result.answer ? (
                    <div className="max-w-4xl rounded-md bg-[#eef2ec] px-4 py-3 text-sm font-medium leading-6 text-[#17211b]">
                      {turn.result.answer}
                    </div>
                  ) : null}
                  {turn.result.summary ? (
                    <p className="mt-3 max-w-4xl text-sm leading-6 text-[#526157]">
                      {turn.result.summary}
                    </p>
                  ) : null}
                </div>
                {turnInsights.length > 0 ? (
                  <div className="grid gap-3 border-b border-[#edf0eb] px-5 py-4 sm:grid-cols-2">
                    {turnInsights.map((insight) => (
                      <InsightCard
                        insight={insight}
                        key={`${insight.title}-${insight.severity ?? "none"}`}
                      />
                    ))}
                  </div>
                ) : null}
                <div className="divide-y divide-[#edf0eb]">
                  {turnReviews.map((item) => (
                <article className="px-5 py-5" key={`${item.rank}-${item.invoiceNumber}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-[#526157]">
                        #{item.rank}
                      </span>
                      <h3 className="text-lg font-semibold">
                        {item.invoiceNumber} · {item.contactName}
                      </h3>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[#526157]">
                      {item.reason}
                    </p>
                  </div>
                  <span
                    className={`rounded-md px-2 py-1 text-xs font-semibold capitalize ${
                      item.priority === "high"
                        ? "bg-[#f7dfdc] text-[#7a2f25]"
                        : item.priority === "medium"
                          ? "bg-[#fff0c2] text-[#6d4c16]"
                          : "bg-[#e6eee9] text-[#0f6f4d]"
                    }`}
                  >
                    {item.priority}
                  </span>
                </div>

                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-[#526157]">Amount due</dt>
                    <dd className="font-semibold">
                      {new Intl.NumberFormat("en-GB", {
                        style: "currency",
                        currency: item.currencyCode || "GBP",
                      }).format(item.amountDue)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#526157]">Days past due</dt>
                    <dd className="font-semibold">{item.daysPastDue}</dd>
                  </div>
                  <div>
                    <dt className="text-[#526157]">Action</dt>
                    <dd className="font-semibold">{item.recommendedAction}</dd>
                  </div>
                </dl>

                <EditableEmailDraft item={item} />
              </article>
                  ))}
                </div>
                {isLastTurn ? (
                  <div className="border-t border-[#edf0eb] px-5 py-4">
                    {followUps.length > 0 ? (
                      <>
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8b978e]">
                          Suggested next steps
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {followUps.map((followUp) => (
                            <button
                              className="inline-flex min-h-9 items-center justify-center rounded-md border border-[#cfe4da] bg-[#f4f9f6] px-3 py-1.5 text-left text-sm font-medium text-[#0f6f4d] transition hover:bg-[#e6eee9] disabled:cursor-not-allowed disabled:opacity-50"
                              disabled={isAgentRunning}
                              key={followUp}
                              onClick={() => void runAgent(followUp)}
                              type="button"
                            >
                              {followUp}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : null}
                    <FollowUpForm disabled={isAgentRunning} runAgent={runAgent} />
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

function FollowUpForm({
  disabled,
  runAgent,
}: {
  disabled: boolean;
  runAgent: (question?: string) => Promise<void>;
}) {
  const [followUp, setFollowUp] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = followUp.trim();

    if (!next) {
      return;
    }

    setFollowUp("");
    await runAgent(next);
  }

  return (
    <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
      <input
        className="h-10 min-w-0 flex-1 rounded-md border border-[#b9c3b7] bg-white px-3 text-sm outline-none transition placeholder:text-[#8b978e] focus:border-[#0f6f4d] focus:ring-2 focus:ring-[#cfe4da]"
        disabled={disabled}
        onChange={(event) => setFollowUp(event.target.value)}
        placeholder="Or type your own follow-up..."
        type="text"
        value={followUp}
      />
      <button
        className="inline-flex h-10 items-center justify-center rounded-md bg-[#0f6f4d] px-4 text-sm font-semibold text-white transition hover:bg-[#0b5d40] disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled || !followUp.trim()}
        type="submit"
      >
        Ask
      </button>
    </form>
  );
}

function AgentProgress({
  isRunning,
  steps,
}: {
  isRunning: boolean;
  steps: AgentTraceStep[];
}) {
  const errors = steps.filter((step) => step.kind === "error");
  const checkedSources = Array.from(
    new Set(
      steps
        .filter((step) => step.kind === "tool")
        .map((step) =>
          step.tool ? agentToolSources[step.tool] ?? step.tool : step.label,
        ),
    ),
  );

  if (isRunning) {
    const current = steps.length > 0 ? steps[steps.length - 1] : null;

    return (
      <div className="flex items-center gap-3 rounded-md border border-[#d7ddd4] bg-white px-4 py-3.5">
        <span
          aria-hidden
          className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-[#cfe4da] border-t-[#0f6f4d]"
        />
        <p className="text-sm font-medium text-[#17211b]">
          {current?.label ?? "Pondering the numbers..."}
        </p>
      </div>
    );
  }

  if (errors.length > 0) {
    return (
      <div className="rounded-md border border-[#d8bbb6] bg-[#fbefed] px-4 py-3 text-sm text-[#7a2f25]">
        {errors[errors.length - 1].label}
      </div>
    );
  }

  if (checkedSources.length === 0) {
    return null;
  }

  return (
    <p className="px-1 text-xs text-[#8b978e]">
      Checked: {checkedSources.join(" · ")}
    </p>
  );
}

function InsightCard({ insight }: { insight: AgentInsight }) {
  const severity = insight.severity ?? "watch";

  return (
    <div className="rounded-md border border-[#d7ddd4] bg-[#fbfcfa] p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold">{insight.title}</h3>
        <span
          className={`rounded-md px-2 py-1 text-xs font-semibold capitalize ${
            severity === "risk"
              ? "bg-[#f7dfdc] text-[#7a2f25]"
              : severity === "watch"
                ? "bg-[#fff0c2] text-[#6d4c16]"
                : "bg-[#e6eee9] text-[#0f6f4d]"
          }`}
        >
          {severity}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-[#526157]">{insight.detail}</p>
    </div>
  );
}

function EditableEmailDraft({ item }: { item: InvoiceReview }) {
  const [subject, setSubject] = useState(item.emailSubject);
  const [body, setBody] = useState(item.emailBody);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  async function copyDraft() {
    const draft = `Subject: ${subject}\n\n${body}`;

    try {
      await navigator.clipboard.writeText(draft);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1600);
    } catch {
      setCopyState("failed");
      window.setTimeout(() => setCopyState("idle"), 2200);
    }
  }

  return (
    <div className="mt-4 rounded-md border border-[#d7ddd4] bg-[#fbfcfa] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-semibold">Draft email</p>
        <button
          className="inline-flex h-9 items-center justify-center rounded-md border border-[#b9c3b7] bg-white px-3 text-sm font-semibold text-[#17211b] transition hover:bg-[#eef2ec]"
          onClick={copyDraft}
          type="button"
        >
          {copyState === "copied"
            ? "Copied"
            : copyState === "failed"
              ? "Copy failed"
              : "Copy email"}
        </button>
      </div>

      <label className="mt-4 block text-sm font-medium" htmlFor={`subject-${item.rank}`}>
        Subject
      </label>
      <input
        className="mt-2 h-10 w-full rounded-md border border-[#b9c3b7] bg-white px-3 text-sm outline-none transition focus:border-[#0f6f4d] focus:ring-2 focus:ring-[#cfe4da]"
        id={`subject-${item.rank}`}
        onChange={(event) => setSubject(event.target.value)}
        value={subject}
      />

      <label className="mt-4 block text-sm font-medium" htmlFor={`body-${item.rank}`}>
        Body
      </label>
      <textarea
        className="mt-2 min-h-56 w-full resize-y rounded-md border border-[#b9c3b7] bg-white px-3 py-3 text-sm leading-6 outline-none transition focus:border-[#0f6f4d] focus:ring-2 focus:ring-[#cfe4da]"
        id={`body-${item.rank}`}
        onChange={(event) => setBody(event.target.value)}
        value={body}
      />
    </div>
  );
}

function ReviewContextItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[#526157]">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}
