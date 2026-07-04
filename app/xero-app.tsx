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
  type?: string;
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
  stale?: boolean;
  snapshotSavedAt?: string;
  staleReason?: string;
};

type DashboardMetrics = {
  totalInvoiced: number;
  receivablesDue: number;
  payablesDue: number;
  amountPaid: number;
  openInvoices: number;
  overdueInvoices: number;
};

type PnlMonth = {
  label: string;
  income: number;
  expenses: number;
  netProfit: number;
};

type BankAccountBalance = {
  name: string;
  balance: number;
};

type DashboardReports = {
  pnl: { months: PnlMonth[] } | null;
  bank: { accounts: BankAccountBalance[]; total: number } | null;
  netAssets: number | null;
};

type InvoiceReview = {
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

const persona = {
  owner: "Alice",
  business: "Alice & Co. Coffee Roasters",
  agent: "Bruno",
  shortBusiness: "Alice’s roastery",
  description:
    "Alice runs a wholesale coffee roastery supplying cafés, offices, and local retailers.",
  goal: "Bruno helps Alice keep cash moving without damaging customer relationships.",
};

const agentToolLabels: Record<string, string> = {
  "list-invoices": "Bruno is checking the unpaid café tabs...",
  "list-contacts": "Bruno is looking through Alice’s customer book...",
  "list-contact-groups": "Bruno is sorting wholesale customers...",
  "list-accounts": "Bruno is checking the ledgers behind the counter...",
  "list-items": "Bruno is counting beans, blends, and line items...",
  "list-tax-rates": "Bruno is checking the tax notes...",
  "list-organisation-details": "Bruno is reading the roastery details...",
  "list-tracking-categories": "Bruno is sorting the labels on the shelves...",
  "list-payments": "Bruno is following the money trail...",
  "list-bank-transactions": "Bruno is checking the bank statement...",
  "list-credit-notes": "Bruno is checking credits and adjustments...",
  "list-quotes": "Bruno is checking old quotes...",
  "list-manual-journals": "Bruno is reading the manual journals...",
  "list-profit-and-loss": "Bruno is brewing the profit & loss...",
  "list-report-balance-sheet": "Bruno is weighing the balance sheet...",
  "list-trial-balance": "Bruno is giving the trial balance a stern look...",
  "list-aged-receivables-by-contact":
    "Bruno is checking which customers are overdue...",
  "list-aged-payables-by-contact":
    "Bruno is checking what Alice still needs to pay...",
};

const agentStatusLabels: Record<string, string> = {
  "Cracking open the books...": "Bruno is opening the roastery books...",
  "Adding it all up (carrying the one)...":
    "Bruno is adding it all up, one espresso at a time...",
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

function formatInvoiceDate(value: string) {
  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}

const initialStatus: Status = {
  isConfigured: false,
  missingConfig: [],
  isConnected: false,
  tenantId: null,
  tenantName: null,
  canDisconnectFromXero: false,
  scopes: [],
};

export function XeroApp({
  initialQuestion = "",
  view,
}: {
  initialQuestion?: string;
  view: AppView;
}) {
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
  const [invoiceWarning, setInvoiceWarning] = useState<string | null>(null);
  const [hasLoadedInvoices, setHasLoadedInvoices] = useState(false);
  const [reports, setReports] = useState<DashboardReports | null>(null);
  const [isLoadingReports, setIsLoadingReports] = useState(false);
  const [hasLoadedReports, setHasLoadedReports] = useState(false);
  const [isTriggeringCashFlow, setIsTriggeringCashFlow] = useState(false);
  const [cashFlowAutomationMessage, setCashFlowAutomationMessage] = useState<
    string | null
  >(null);
  const traceIdRef = useRef(0);
  const turnIdRef = useRef(0);
  const interactionIdRef = useRef<string | null>(null);

  const currency =
    invoices.find((invoice) => invoice.currencyCode)?.currencyCode ?? "GBP";

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
        const isPayable = invoice.type === "ACCPAY";

        if (isPayable) {
          nextMetrics.payablesDue += due;

          return nextMetrics;
        }

        nextMetrics.totalInvoiced += total;
        nextMetrics.receivablesDue += due;
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
        receivablesDue: 0,
        payablesDue: 0,
        amountPaid: 0,
        openInvoices: 0,
        overdueInvoices: 0,
      },
    );
  }, [invoices]);

  async function loadReports() {
    setIsLoadingReports(true);

    try {
      const response = await fetch("/api/xero/dashboard");

      if (response.ok) {
        setReports((await response.json()) as DashboardReports);
      }
    } catch {
      // The dashboard still renders invoice metrics without reports.
    } finally {
      setHasLoadedReports(true);
      setIsLoadingReports(false);
    }
  }

  async function loadInvoices(fresh = false) {
    setIsLoadingInvoices(true);
    setInvoiceError(null);
    setInvoiceWarning(null);
    setMessage(`${persona.agent} is requesting invoice data from Xero...`);

    try {
      const response = await fetch(
        fresh ? "/api/xero/invoices?refresh=1" : "/api/xero/invoices",
      );
      const data = (await response.json()) as InvoiceResponse & {
        error?: string;
        detail?: string;
      };

      if (!response.ok) {
        throw new Error(data.detail ?? data.error ?? "Invoice request failed");
      }

      setInvoices(data.invoices);
      setHasLoadedInvoices(true);

      if (data.stale) {
        const savedAt = data.snapshotSavedAt
          ? new Intl.DateTimeFormat("en-GB", {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(data.snapshotSavedAt))
          : "an earlier successful sync";
        const warning = `Xero is unavailable right now, so this table is using the local invoice snapshot from ${savedAt}. ${data.staleReason ?? ""}`.trim();

        setInvoiceWarning(warning);
        setMessage(`Showing cached invoice data for ${data.count} record(s).`);
      } else {
        setMessage(
          `${persona.agent} found ${data.count} invoice record(s) in Xero.`,
        );
      }
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
            ? `Connected to Xero. ${persona.agent} can review Alice’s coffee accounts.`
            : "Ready to connect Alice’s Xero demo company."),
      );
      setIsLoadingStatus(false);
    }

    loadStatus().catch((error) => {
      setMessage(
        error instanceof Error ? error.message : "Status check failed",
      );
      setIsLoadingStatus(false);
    });
  }, []);

  useEffect(() => {
    if (!status.isConnected || hasLoadedInvoices || isLoadingInvoices) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void loadInvoices();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [status.isConnected, hasLoadedInvoices, isLoadingInvoices]);

  useEffect(() => {
    if (!status.isConnected || hasLoadedReports || isLoadingReports) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void loadReports();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [status.isConnected, hasLoadedReports, isLoadingReports]);

  async function disconnectXero() {
    setIsDisconnecting(true);
    setMessage("Disconnecting from Xero...");

    try {
      const response = await fetch("/api/xero/disconnect", {
        method: "POST",
      });

      if (!response.ok) {
        const data = (await response.json()) as {
          detail?: string;
          error?: string;
        };
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
      setInvoiceWarning(null);
      setHasLoadedInvoices(false);
      setReports(null);
      setHasLoadedReports(false);
      setMessage("Disconnected from Xero and cleared the local session.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Disconnect failed");
    } finally {
      setIsDisconnecting(false);
    }
  }

  async function triggerCashFlowAutomation() {
    setIsTriggeringCashFlow(true);
    setCashFlowAutomationMessage(null);
    setMessage("Sending cash-flow recommendation request to Make...");

    try {
      const response = await fetch("/api/make/bruno-cash-flow", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          business: persona.business,
          tenantName: status.tenantName,
          metrics: {
            bankBalance: reports?.bank?.total ?? null,
            receivablesDue: metrics.receivablesDue,
            payablesDue: metrics.payablesDue,
            overdueInvoices: metrics.overdueInvoices,
            openInvoices: metrics.openInvoices,
          },
        }),
      });
      const data = (await response.json()) as {
        detail?: string;
        error?: string;
        ok?: boolean;
      };

      if (!response.ok) {
        throw new Error(data.detail ?? data.error ?? "Make automation failed");
      }

      setCashFlowAutomationMessage(
        "Cash-flow recommendations sent to Slack.",
      );
      setMessage("Make automation triggered successfully.");
    } catch (error) {
      const nextMessage =
        error instanceof Error ? error.message : "Make automation failed";

      setCashFlowAutomationMessage(nextMessage);
      setMessage(nextMessage);
    } finally {
      setIsTriggeringCashFlow(false);
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
        appendTraceStep({
          kind: "status",
          label: agentStatusLabels[event.message] ?? event.message,
        });
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
          `${persona.agent} finished with ${insightCount} insight(s) and ${reviewCount} follow-up(s).`,
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
    setMessage(`Started a new conversation with ${persona.agent}.`);
  }

  async function runAgent(question = "Check invoices") {
    turnIdRef.current += 1;
    setAgentTurns((turns) => [
      ...turns,
      { id: turnIdRef.current, question, steps: [], result: null },
    ]);
    setIsAgentRunning(true);
    setMessage(`${persona.agent} is planning which Xero data to pull...`);

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
    <div className="min-h-screen bg-[#f7efe5] text-[#2f2417]">
      <header className="sticky top-0 z-10 border-b border-[#e4d2b8] bg-[#fffaf4]/95 backdrop-blur">
        <nav className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-8">
            <Link className="flex items-center gap-3" href="/">
              <div className="flex h-10 w-10 flex-col items-center justify-center gap-[3px] rounded-2xl bg-[#6f2f1f] shadow-sm">
                <span className="h-[3px] w-4 rounded-full bg-[#fff7ec]" />
                <span className="h-[3px] w-4 rounded-full bg-[#fff7ec]" />
                <span className="h-[3px] w-4 rounded-full bg-[#fff7ec]" />
              </div>

              <div className="leading-tight">
                <p className="font-[family-name:var(--font-fraunces)] text-lg font-semibold tracking-[-0.02em] text-[#2f2417]">
                  Steady Books
                </p>
              </div>
            </Link>

            <div className="flex items-center gap-1">
              <NavLink active={view === "dashboard"} href="/">
                Dashboard
              </NavLink>
              <NavLink active={view === "review"} href="/review">
                Ask Bruno
              </NavLink>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {status.isConnected ? (
              <button
                className="inline-flex h-10 items-center justify-center rounded-full border border-[#d8b8ad] bg-[#fffaf4] px-4 text-sm font-semibold text-[#7a2f25] transition hover:bg-[#fbefed] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isDisconnecting || isLoadingStatus}
                onClick={disconnectXero}
                type="button"
              >
                {isDisconnecting ? "Disconnecting..." : "Disconnect"}
              </button>
            ) : (
              <a
                className="inline-flex h-10 items-center justify-center rounded-full bg-[#6f2f1f] px-4 text-sm font-semibold text-white transition hover:bg-[#572417]"
                href="/api/xero/connect"
              >
                Connect Xero
              </a>
            )}
          </div>
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-8 sm:px-8">
        {view === "dashboard" ? (
          <section className="overflow-hidden rounded-3xl border border-[#e4d2b8] bg-[#fffaf4] px-5 py-4 shadow-sm sm:px-6 sm:py-5">
            <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#9a6b3f]">
                  {status.isConnected ? status.tenantName : persona.business}
                </p>

                <h1 className="mt-2 text-2xl font-semibold leading-tight sm:text-3xl">
                  Alice’s roastery books.
                </h1>

                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6f5f4b]">
                  Bruno turns Alice’s Xero data into a simple cash-flow view.
                </p>
              </div>

              <div className="flex items-center gap-4 lg:justify-end">
                <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#eadbc3] bg-[#f7efe5] shadow-sm sm:h-28 sm:w-28">
                  <img
                    alt="Bruno, Alice’s AI cash-flow assistant"
                    className="h-full w-full object-cover"
                    src="/bruno.png"
                  />
                </div>

                <div className="text-left">
                  <p className="font-[family-name:var(--font-fraunces)] text-lg font-semibold tracking-[-0.02em] text-[#2f2417]">
                    Welcome back, Alice.
                  </p>
                  <p className="mt-0.5 text-xs leading-5 text-[#6f5f4b]">
                    Bruno has the books ready.
                  </p>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {view === "dashboard" ? (
          <DashboardView
            invoices={invoices}
            isLoadingInvoices={isLoadingInvoices}
            isLoadingReports={isLoadingReports}
            invoiceError={invoiceError}
            invoiceWarning={invoiceWarning}
            isTriggeringCashFlow={isTriggeringCashFlow}
            metrics={metrics}
            money={money}
            reports={reports}
            cashFlowAutomationMessage={cashFlowAutomationMessage}
            triggerCashFlowAutomation={triggerCashFlowAutomation}
            status={status}
          />
        ) : (
          <ReviewView
            agentTurns={agentTurns}
            initialQuestion={initialQuestion}
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
      className={`rounded-full px-4 py-2 text-sm font-medium transition ${
        active
          ? "bg-[#eadbc3] text-[#6f2f1f]"
          : "text-[#6f5f4b] hover:bg-[#f3ead9] hover:text-[#2f2417]"
      }`}
      href={href}
    >
      {children}
    </Link>
  );
}

function StatusBanner({
  message,
  status,
}: {
  message: string;
  status: Status;
}) {
  const lacksInvoiceScope =
    status.isConnected &&
    !invoiceScopes.some((scope) => status.scopes.includes(scope));

  if (!status.isConfigured) {
    return (
      <section className="rounded-2xl border border-[#ead0a2] bg-[#fff8e8] p-4 text-sm text-[#6d4c16]">
        Missing env vars: {status.missingConfig.join(", ")}
      </section>
    );
  }

  if (lacksInvoiceScope) {
    return (
      <section className="rounded-2xl border border-[#ead0a2] bg-[#fff8e8] p-4 text-sm text-[#6d4c16]">
        This app is configured without invoice scope. Add
        `accounting.invoices.read` to `XERO_SCOPES`, restart the dev server, and
        reconnect to Xero.
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[#e4d2b8] bg-[#fffaf4] px-4 py-3 text-sm text-[#6f5f4b]">
      {message}
    </section>
  );
}

function DashboardView({
  invoices,
  isLoadingInvoices,
  isLoadingReports,
  invoiceError,
  invoiceWarning,
  isTriggeringCashFlow,
  metrics,
  money,
  reports,
  cashFlowAutomationMessage,
  triggerCashFlowAutomation,
  status,
}: {
  invoices: Invoice[];
  isLoadingInvoices: boolean;
  isLoadingReports: boolean;
  invoiceError: string | null;
  invoiceWarning: string | null;
  isTriggeringCashFlow: boolean;
  metrics: DashboardMetrics;
  money: Intl.NumberFormat;
  reports: DashboardReports | null;
  cashFlowAutomationMessage: string | null;
  triggerCashFlowAutomation: () => void;
  status: Status;
}) {
  return (
    <>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Bank balance"
          question="Bruno, is Alice’s bank balance healthy given upcoming bills?"
          value={
            reports?.bank
              ? money.format(reports.bank.total)
              : isLoadingReports
                ? "..."
                : "—"
          }
        />
        <MetricCard
          label="Recievables"
          question="Bruno, who owes Alice money and who should she chase first?"
          value={money.format(metrics.receivablesDue)}
        />
        <MetricCard
          label="Payables"
          question="Bruno, which bills should Alice be aware of?"
          value={money.format(metrics.payablesDue)}
        />
        <MetricCard
          label="Overdue invoices"
          question="Bruno, draft payment nudges for overdue café invoices"
          value={String(metrics.overdueInvoices)}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <PnlCard
          isLoadingReports={isLoadingReports}
          money={money}
          pnl={reports?.pnl ?? null}
        />
        <BankCard
          bank={reports?.bank ?? null}
          isLoadingReports={isLoadingReports}
          money={money}
          netAssets={reports?.netAssets ?? null}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <InvoiceTable
          invoiceError={invoiceError}
          invoiceWarning={invoiceWarning}
          invoices={invoices}
          isLoadingInvoices={isLoadingInvoices}
          money={money}
        />
        <aside className="rounded-2xl border border-[#e4d2b8] bg-[#fffaf4] p-4">
          <h2 className="text-lg font-semibold">
            Want a cash flow recommendation?
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#6f5f4b]">
            Send Bruno the latest invoice and dashboard context, then post the
            recommendation straight into Slack.
          </p>
          <button
            className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[#6f2f1f] px-4 py-2 text-center text-sm font-semibold leading-5 text-white transition hover:bg-[#572417] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!status.isConnected || isTriggeringCashFlow}
            onClick={triggerCashFlowAutomation}
            type="button"
          >
            {isTriggeringCashFlow
              ? "Sending to Slack..."
              : "Send Slack cash-flow recommendations"}
          </button>
          {cashFlowAutomationMessage ? (
            <p className="mt-3 rounded-2xl bg-[#f3ead9] px-3 py-2 text-xs leading-5 text-[#6f5f4b]">
              {cashFlowAutomationMessage}
            </p>
          ) : !status.isConnected ? (
            <p className="mt-3 rounded-2xl bg-[#fff8e8] px-3 py-2 text-xs leading-5 text-[#6d4c16]">
              Connect Xero before sending a recommendation.
            </p>
          ) : null}
        </aside>
      </section>
    </>
  );
}

function MetricCard({
  label,
  question,
  value,
}: {
  label: string;
  question?: string;
  value: string;
}) {
  const body = (
    <>
      <p className="flex items-center justify-between gap-2 text-sm text-[#6f5f4b]">
        {label}
        {question ? (
          <span aria-hidden className="text-xs text-[#a3907a]">
            Ask Bruno →
          </span>
        ) : null}
      </p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </>
  );

  if (!question) {
    return (
      <div className="rounded-2xl border border-[#e4d2b8] bg-[#fffaf4] p-4">
        {body}
      </div>
    );
  }

  return (
    <Link
      className="rounded-2xl border border-[#e4d2b8] bg-[#fffaf4] p-4 transition hover:border-[#6f2f1f] hover:shadow-sm"
      href={`/review?q=${encodeURIComponent(question)}`}
    >
      {body}
    </Link>
  );
}

const pnlSeriesColors = {
  income: "#6f2f1f",
  expenses: "#c7773a",
};

function PnlCard({
  isLoadingReports,
  money,
  pnl,
}: {
  isLoadingReports: boolean;
  money: Intl.NumberFormat;
  pnl: { months: PnlMonth[] } | null;
}) {
  const latest = pnl?.months[pnl.months.length - 1];
  const previous =
    pnl && pnl.months.length > 1 ? pnl.months[pnl.months.length - 2] : null;
  const delta =
    latest && previous ? latest.netProfit - previous.netProfit : null;

  return (
    <div className="rounded-2xl border border-[#e4d2b8] bg-[#fffaf4] p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Roastery profit &amp; loss</h2>
          <p className="mt-1 text-sm text-[#6f5f4b]">Last 3 months</p>
        </div>
        {latest ? (
          <div className="text-right">
            <p className="text-sm text-[#6f5f4b]">
              Net profit ({latest.label})
            </p>
            <p className="text-xl font-semibold">
              {money.format(latest.netProfit)}
            </p>
            {delta !== null ? (
              <p
                className={`text-xs font-semibold ${
                  delta >= 0 ? "text-[#6f2f1f]" : "text-[#7a2f25]"
                }`}
              >
                {delta >= 0 ? "▲" : "▼"} {money.format(Math.abs(delta))} vs{" "}
                {previous?.label}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {pnl && pnl.months.length > 0 ? (
        <PnlChart money={money} months={pnl.months} />
      ) : (
        <p className="mt-8 text-sm text-[#6f5f4b]">
          {isLoadingReports
            ? "Loading profit & loss..."
            : "Profit & loss is unavailable. Reconnect to Xero to grant report access."}
        </p>
      )}
    </div>
  );
}

function PnlChart({
  money,
  months,
}: {
  money: Intl.NumberFormat;
  months: PnlMonth[];
}) {
  const max = Math.max(
    ...months.flatMap((month) => [month.income, month.expenses]),
    1,
  );
  const barHeight = (value: number) =>
    value > 0 ? Math.max(Math.round((value / max) * 120), 3) : 0;

  return (
    <div className="mt-5">
      <div className="flex items-end gap-6 border-b border-[#dccbb1] px-2">
        {months.map((month) => (
          <div
            className="group relative flex flex-1 flex-col items-center"
            key={month.label}
          >
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden w-max -translate-x-1/2 rounded-2xl border border-[#e4d2b8] bg-[#fffaf4] px-3 py-2 text-xs shadow-md group-hover:block">
              <p className="font-semibold text-[#2f2417]">{month.label}</p>
              <p className="mt-1 flex items-center gap-1.5 text-[#6f5f4b]">
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: pnlSeriesColors.income }}
                />
                Income {money.format(month.income)}
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[#6f5f4b]">
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: pnlSeriesColors.expenses }}
                />
                Expenses {money.format(month.expenses)}
              </p>
              <p className="mt-0.5 text-[#6f5f4b]">
                Net {money.format(month.netProfit)}
              </p>
            </div>
            <div className="flex h-[120px] w-full items-end justify-center gap-[2px]">
              <div
                className="w-5 rounded-t-[6px]"
                style={{
                  backgroundColor: pnlSeriesColors.income,
                  height: barHeight(month.income),
                }}
              />
              <div
                className="w-5 rounded-t-[6px]"
                style={{
                  backgroundColor: pnlSeriesColors.expenses,
                  height: barHeight(month.expenses),
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-6 px-2">
        {months.map((month) => (
          <p
            className="flex-1 pt-2 text-center text-xs text-[#a3907a]"
            key={month.label}
          >
            {month.label}
          </p>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-4 text-xs text-[#6f5f4b]">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: pnlSeriesColors.income }}
          />
          Income
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: pnlSeriesColors.expenses }}
          />
          Expenses
        </span>
      </div>
    </div>
  );
}

function BankCard({
  bank,
  isLoadingReports,
  money,
  netAssets,
}: {
  bank: { accounts: BankAccountBalance[]; total: number } | null;
  isLoadingReports: boolean;
  money: Intl.NumberFormat;
  netAssets: number | null;
}) {
  return (
    <div className="rounded-2xl border border-[#e4d2b8] bg-[#fffaf4] p-4">
      <h2 className="text-lg font-semibold">Roastery bank accounts</h2>
      <p className="mt-1 text-sm text-[#6f5f4b]">
        Balances from today&apos;s balance sheet
      </p>

      {bank ? (
        <div className="mt-4">
          <ul className="divide-y divide-[#f0e7d6]">
            {bank.accounts.map((account) => (
              <li
                className="flex items-center justify-between gap-4 py-3 text-sm"
                key={account.name}
              >
                <span className="truncate text-[#2f2417]">{account.name}</span>
                <span className="font-semibold">
                  {money.format(account.balance)}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-4 border-t border-[#e4d2b8] py-3 text-sm">
            <span className="font-semibold text-[#2f2417]">Total</span>
            <span className="font-semibold">{money.format(bank.total)}</span>
          </div>
          {netAssets !== null ? (
            <div className="flex items-center justify-between gap-4 rounded-2xl bg-[#f3ead9] px-3 py-2.5 text-sm">
              <span className="text-[#6f5f4b]">Net assets</span>
              <span className="font-semibold text-[#6f2f1f]">
                {money.format(netAssets)}
              </span>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-8 text-sm text-[#6f5f4b]">
          {isLoadingReports
            ? "Loading bank balances..."
            : "Bank balances are unavailable. Reconnect to Xero to grant report access."}
        </p>
      )}
    </div>
  );
}

const invoiceTableRowLimit = 5;

function InvoiceTable({
  invoiceError,
  invoiceWarning,
  invoices,
  isLoadingInvoices,
  money,
}: {
  invoiceError: string | null;
  invoiceWarning: string | null;
  invoices: Invoice[];
  isLoadingInvoices: boolean;
  money: Intl.NumberFormat;
}) {
  const visibleInvoices = invoices.slice(0, invoiceTableRowLimit);

  return (
    <section className="overflow-hidden rounded-2xl border border-[#e4d2b8] bg-[#fffaf4]">
      <div className="flex items-baseline justify-between gap-4 border-b border-[#e4d2b8] px-4 py-3">
        <h2 className="text-lg font-semibold">Recent wholesale invoices</h2>
        {invoices.length > invoiceTableRowLimit ? (
          <p className="text-xs text-[#a3907a]">
            Showing {invoiceTableRowLimit} of {invoices.length}
          </p>
        ) : null}
      </div>
      {invoiceWarning ? (
        <div className="border-b border-[#ead0a2] bg-[#fff8e8] px-4 py-3 text-sm leading-6 text-[#6d4c16]">
          {invoiceWarning}
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead className="bg-[#f3ead9] text-[#6f5f4b]">
            <tr>
              <th className="px-4 py-3 font-semibold">Invoice</th>
              <th className="px-4 py-3 font-semibold">Customer</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Due date</th>
              <th className="px-4 py-3 text-right font-semibold">Total</th>
              <th className="px-4 py-3 text-right font-semibold">Due</th>
            </tr>
          </thead>
          <tbody>
            {invoiceError ? (
              <tr>
                <td
                  className="px-4 py-8 text-center text-[#7a2f25]"
                  colSpan={6}
                >
                  {invoiceError}
                </td>
              </tr>
            ) : isLoadingInvoices ? (
              <tr>
                <td
                  className="px-4 py-8 text-center text-[#6f5f4b]"
                  colSpan={6}
                >
                  Bruno is loading invoices...
                </td>
              </tr>
            ) : invoices.length === 0 ? (
              <tr>
                <td
                  className="px-4 py-8 text-center text-[#6f5f4b]"
                  colSpan={6}
                >
                  No invoices loaded yet.
                </td>
              </tr>
            ) : (
              visibleInvoices.map((invoice) => (
                <tr
                  className="border-t border-[#f0e7d6]"
                  key={invoice.invoiceID ?? invoice.invoiceNumber}
                >
                  <td className="px-4 py-3 font-medium">
                    {invoice.invoiceNumber ?? "No number"}
                  </td>
                  <td className="px-4 py-3">
                    {invoice.contactName ?? "Unknown"}
                  </td>
                  <td className="px-4 py-3">{invoice.status ?? "-"}</td>
                  <td className="px-4 py-3">
                    {invoice.dueDate ? formatInvoiceDate(invoice.dueDate) : "-"}
                  </td>
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
  initialQuestion,
  invoices,
  isAgentRunning,
  lockedTools,
  resetConversation,
  runAgent,
  status,
}: {
  agentTurns: AgentTurn[];
  initialQuestion: string;
  invoices: Invoice[];
  isAgentRunning: boolean;
  lockedTools: string[];
  resetConversation: () => void;
  runAgent: (question?: string) => Promise<void>;
  status: Status;
}) {
  const [question, setQuestion] = useState(initialQuestion);
  const suggestionButtons = [
    "Bruno, who should Alice chase first today?",
    "Bruno, what cash is at risk this week?",
    "Bruno, how is the roastery performing?",
    "Bruno, which café customers are the biggest credit risk?",
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
      <div className="rounded-2xl border border-[#e4d2b8] bg-[#fffaf4] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Ask Bruno</h2>
            <p className="mt-1 text-sm leading-6 text-[#6f5f4b]">
              Bruno has live read-only tools over Alice&apos;s Xero data:
              invoices, reports, payments, contacts, and customer risk signals.
              He remembers this conversation, so you can follow up on his
              findings.
            </p>
          </div>
          {agentTurns.length > 0 ? (
            <button
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-full border border-[#cdbba1] bg-[#fffaf4] px-3 text-sm font-medium text-[#2f2417] transition hover:bg-[#f3ead9] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isAgentRunning}
              onClick={resetConversation}
              type="button"
            >
              New conversation
            </button>
          ) : null}
        </div>

        <form
          className="mt-4 flex flex-col gap-3 sm:flex-row"
          onSubmit={submitQuestion}
        >
          <input
            className="h-12 min-w-0 flex-1 rounded-full border border-[#cdbba1] bg-[#fffaf4] px-4 text-sm outline-none transition placeholder:text-[#a3907a] focus:border-[#6f2f1f] focus:ring-2 focus:ring-[#eadbc3]"
            disabled={!status.isConnected || isAgentRunning}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={
              agentTurns.length > 0
                ? "Ask a follow-up — Bruno remembers this conversation"
                : "Ask Bruno about overdue café invoices, cash flow, spending, or customer risk"
            }
            type="text"
            value={question}
          />
          <button
            className="inline-flex h-12 items-center justify-center rounded-full bg-[#6f2f1f] px-5 text-sm font-semibold text-white transition hover:bg-[#572417] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!status.isConnected || isAgentRunning || !question.trim()}
            type="submit"
          >
            {isAgentRunning ? "Brewing..." : "Ask Bruno"}
          </button>
        </form>

        {agentTurns.length === 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {suggestionButtons.map((suggestion) => (
              <button
                className="inline-flex min-h-9 items-center justify-center rounded-full border border-[#cdbba1] bg-[#fffaf4] px-3 py-1.5 text-sm font-medium text-[#2f2417] transition hover:bg-[#f3ead9] disabled:cursor-not-allowed disabled:border-[#e4d2b8] disabled:text-[#bcab94]"
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
          <p className="mt-3 rounded-2xl border border-[#ead0a2] bg-[#fff8e8] px-3 py-2 text-xs text-[#6d4c16]">
            {lockedTools.length} Bruno abilities are not covered by your current
            Xero token. Disconnecting and reconnecting unlocks any that your
            Xero app configuration allows.
          </p>
        ) : null}

        <div className="mt-5 grid gap-3 border-t border-[#f0e7d6] pt-4 text-sm sm:grid-cols-4">
          <ReviewContextItem label="Invoices" value={String(invoices.length)} />
          <ReviewContextItem
            label="Bruno"
            value={isAgentRunning ? "Working" : lastTurn ? "Ready" : "Idle"}
          />
          <ReviewContextItem label="Turns" value={String(agentTurns.length)} />
          <ReviewContextItem label="Findings" value={String(findingCount)} />
        </div>
      </div>

      {agentTurns.length === 0 ? (
        <div className="rounded-2xl border border-[#e4d2b8] bg-[#fffaf4] px-5 py-14 text-center text-sm text-[#6f5f4b]">
          Ask Bruno a question or pick a suggestion. Bruno chooses which Xero
          MCP tools to call, shows his working, and suggests follow-up actions
          Alice can take.
        </div>
      ) : null}

      {agentTurns.map((turn, turnIndex) => {
        const isLastTurn = turnIndex === agentTurns.length - 1;
        const turnInsights = turn.result?.insights ?? [];
        const turnReviews = turn.result?.reviews ?? [];
        const followUps = turn.result?.followUps ?? [];

        return (
          <div className="flex flex-col gap-4" key={turn.id}>
            <div className="max-w-xl self-end rounded-2xl bg-[#6f2f1f] px-4 py-2.5 text-sm font-medium leading-6 text-white">
              {turn.question}
            </div>

            <AgentProgress
              isRunning={isAgentRunning && isLastTurn && !turn.result}
              steps={turn.steps}
            />

            {turn.result ? (
              <div className="overflow-hidden rounded-2xl border border-[#e4d2b8] bg-[#fffaf4]">
                <div className="border-b border-[#f0e7d6] px-5 py-4">
                  {turn.result.answer ? (
                    <div className="max-w-4xl rounded-2xl bg-[#f3ead9] px-4 py-3 text-sm font-medium leading-6 text-[#2f2417]">
                      {turn.result.answer}
                    </div>
                  ) : null}
                  {turn.result.summary ? (
                    <p className="mt-3 max-w-4xl text-sm leading-6 text-[#6f5f4b]">
                      {turn.result.summary}
                    </p>
                  ) : null}
                </div>
                {turnInsights.length > 0 ? (
                  <div className="grid gap-3 border-b border-[#f0e7d6] px-5 py-4 sm:grid-cols-2">
                    {turnInsights.map((insight) => (
                      <InsightCard
                        insight={insight}
                        key={`${insight.title}-${insight.severity ?? "none"}`}
                      />
                    ))}
                  </div>
                ) : null}
                <div className="divide-y divide-[#f0e7d6]">
                  {turnReviews.map((item) => (
                    <article
                      className="px-5 py-5"
                      key={`${item.rank}-${item.invoiceNumber}`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-[#6f5f4b]">
                              #{item.rank}
                            </span>
                            <h3 className="text-lg font-semibold">
                              {item.invoiceNumber} · {item.contactName}
                            </h3>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-[#6f5f4b]">
                            {item.reason}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${
                            item.priority === "high"
                              ? "bg-[#f7dfdc] text-[#7a2f25]"
                              : item.priority === "medium"
                                ? "bg-[#fff0c2] text-[#6d4c16]"
                                : "bg-[#eadbc3] text-[#6f2f1f]"
                          }`}
                        >
                          {item.priority}
                        </span>
                      </div>

                      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                        <div>
                          <dt className="text-[#6f5f4b]">Amount due</dt>
                          <dd className="font-semibold">
                            {new Intl.NumberFormat("en-GB", {
                              style: "currency",
                              currency: item.currencyCode || "GBP",
                            }).format(item.amountDue)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[#6f5f4b]">Days past due</dt>
                          <dd className="font-semibold">{item.daysPastDue}</dd>
                        </div>
                        <div>
                          <dt className="text-[#6f5f4b]">Bruno’s action</dt>
                          <dd className="font-semibold">
                            {item.recommendedAction}
                          </dd>
                        </div>
                      </dl>

                      <EditableEmailDraft item={item} />
                    </article>
                  ))}
                </div>
                {isLastTurn ? (
                  <div className="border-t border-[#f0e7d6] px-5 py-4">
                    {followUps.length > 0 ? (
                      <>
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#a3907a]">
                          Suggested next pours
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {followUps.map((followUp) => (
                            <button
                              className="inline-flex min-h-9 items-center justify-center rounded-full border border-[#eadbc3] bg-[#f6efe0] px-3 py-1.5 text-left text-sm font-medium text-[#6f2f1f] transition hover:bg-[#eadbc3] disabled:cursor-not-allowed disabled:opacity-50"
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
                    <FollowUpForm
                      disabled={isAgentRunning}
                      runAgent={runAgent}
                    />
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
        className="h-10 min-w-0 flex-1 rounded-full border border-[#cdbba1] bg-[#fffaf4] px-3 text-sm outline-none transition placeholder:text-[#a3907a] focus:border-[#6f2f1f] focus:ring-2 focus:ring-[#eadbc3]"
        disabled={disabled}
        onChange={(event) => setFollowUp(event.target.value)}
        placeholder="Or ask Bruno a follow-up..."
        type="text"
        value={followUp}
      />
      <button
        className="inline-flex h-10 items-center justify-center rounded-full bg-[#6f2f1f] px-4 text-sm font-semibold text-white transition hover:bg-[#572417] disabled:cursor-not-allowed disabled:opacity-50"
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
          step.tool ? (agentToolSources[step.tool] ?? step.tool) : step.label,
        ),
    ),
  );

  if (isRunning) {
    const current = steps.length > 0 ? steps[steps.length - 1] : null;

    return (
      <div className="flex items-center gap-3 rounded-2xl border border-[#e4d2b8] bg-[#fffaf4] px-4 py-3.5">
        <span
          aria-hidden
          className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-[#eadbc3] border-t-[#6f2f1f]"
        />
        <p className="text-sm font-medium text-[#2f2417]">
          {current?.label ?? "Bruno is thinking over the numbers..."}
        </p>
      </div>
    );
  }

  if (errors.length > 0) {
    return (
      <div className="rounded-2xl border border-[#d8bbb6] bg-[#fbefed] px-4 py-3 text-sm text-[#7a2f25]">
        {errors[errors.length - 1].label}
      </div>
    );
  }

  if (checkedSources.length === 0) {
    return null;
  }

  return (
    <p className="px-1 text-xs text-[#a3907a]">
      Bruno checked: {checkedSources.join(" · ")}
    </p>
  );
}

function InsightCard({ insight }: { insight: AgentInsight }) {
  const severity = insight.severity ?? "watch";

  return (
    <div className="rounded-2xl border border-[#e4d2b8] bg-[#fbf6ec] p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold">{insight.title}</h3>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${
            severity === "risk"
              ? "bg-[#f7dfdc] text-[#7a2f25]"
              : severity === "watch"
                ? "bg-[#fff0c2] text-[#6d4c16]"
                : "bg-[#eadbc3] text-[#6f2f1f]"
          }`}
        >
          {severity}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-[#6f5f4b]">{insight.detail}</p>
    </div>
  );
}

function gmailComposeUrl(to: string, subject: string, body: string) {
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    su: subject,
    body,
  });

  if (to.trim()) {
    params.set("to", to.trim());
  }

  return `https://mail.google.com/mail/?${params.toString()}`;
}

function EditableEmailDraft({ item }: { item: InvoiceReview }) {
  const [recipient, setRecipient] = useState(item.contactEmail ?? "");
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
    <div className="mt-4 rounded-2xl border border-[#e4d2b8] bg-[#fbf6ec] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-semibold">Bruno’s draft nudge</p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="inline-flex h-9 items-center justify-center rounded-full border border-[#cdbba1] bg-[#fffaf4] px-3 text-sm font-semibold text-[#2f2417] transition hover:bg-[#f3ead9]"
            onClick={copyDraft}
            type="button"
          >
            {copyState === "copied"
              ? "Copied"
              : copyState === "failed"
                ? "Copy failed"
                : "Copy email"}
          </button>
          <a
            className="inline-flex h-9 items-center justify-center rounded-full bg-[#6f2f1f] px-4 text-sm font-semibold text-white transition hover:bg-[#572417]"
            href={gmailComposeUrl(recipient, subject, body)}
            rel="noreferrer"
            target="_blank"
          >
            Send via Gmail
          </a>
        </div>
      </div>

      <label
        className="mt-4 block text-sm font-medium"
        htmlFor={`recipient-${item.rank}`}
      >
        To
      </label>
      <input
        className="mt-2 h-10 w-full rounded-full border border-[#cdbba1] bg-[#fffaf4] px-3 text-sm outline-none transition placeholder:text-[#a3907a] focus:border-[#6f2f1f] focus:ring-2 focus:ring-[#eadbc3]"
        id={`recipient-${item.rank}`}
        onChange={(event) => setRecipient(event.target.value)}
        placeholder={`${item.contactName}'s email address`}
        type="email"
        value={recipient}
      />

      <label
        className="mt-4 block text-sm font-medium"
        htmlFor={`subject-${item.rank}`}
      >
        Subject
      </label>
      <input
        className="mt-2 h-10 w-full rounded-full border border-[#cdbba1] bg-[#fffaf4] px-3 text-sm outline-none transition focus:border-[#6f2f1f] focus:ring-2 focus:ring-[#eadbc3]"
        id={`subject-${item.rank}`}
        onChange={(event) => setSubject(event.target.value)}
        value={subject}
      />

      <label
        className="mt-4 block text-sm font-medium"
        htmlFor={`body-${item.rank}`}
      >
        Body
      </label>
      <textarea
        className="mt-2 min-h-56 w-full resize-y rounded-2xl border border-[#cdbba1] bg-[#fffaf4] px-3 py-3 text-sm leading-6 outline-none transition focus:border-[#6f2f1f] focus:ring-2 focus:ring-[#eadbc3]"
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
      <p className="text-[#6f5f4b]">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}
