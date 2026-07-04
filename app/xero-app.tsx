"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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
    if (!status.isConnected || invoices.length > 0 || isLoadingInvoices) {
      return;
    }

    loadInvoices();
  }, [status.isConnected, invoices.length, isLoadingInvoices]);

  async function loadInvoices() {
    setIsLoadingInvoices(true);
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
      setMessage(`Xero returned ${data.count} invoice record(s).`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Invoice request failed",
      );
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
      setMessage("Disconnected from Xero and cleared the local session.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Disconnect failed");
    } finally {
      setIsDisconnecting(false);
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
              : "A workspace for future agentic suggestions based on Xero accounting signals."}
          </p>
        </section>

        <StatusBanner status={status} message={message} />

        {view === "dashboard" ? (
          <DashboardView
            invoices={invoices}
            isLoadingInvoices={isLoadingInvoices}
            loadInvoices={loadInvoices}
            metrics={metrics}
            money={money}
            status={status}
          />
        ) : (
          <ReviewView invoices={invoices} isLoadingInvoices={isLoadingInvoices} />
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
  loadInvoices,
  metrics,
  money,
  status,
}: {
  invoices: Invoice[];
  isLoadingInvoices: boolean;
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
        <InvoiceTable invoices={invoices} money={money} />
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
  invoices,
  money,
}: {
  invoices: Invoice[];
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
            {invoices.length === 0 ? (
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
  invoices,
  isLoadingInvoices,
}: {
  invoices: Invoice[];
  isLoadingInvoices: boolean;
}) {
  const suggestedChecks = [
    "Overdue invoice follow-up",
    "Unusual invoice values",
    "Customer payment concentration",
    "Draft invoice cleanup",
  ];

  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="rounded-md border border-[#d7ddd4] bg-white">
        <div className="border-b border-[#d7ddd4] px-4 py-3">
          <h2 className="text-lg font-semibold">Suggestion queue</h2>
        </div>
        <div className="divide-y divide-[#edf0eb]">
          {suggestedChecks.map((check) => (
            <div className="flex items-center justify-between gap-4 px-4 py-4" key={check}>
              <div>
                <p className="font-medium">{check}</p>
                <p className="mt-1 text-sm text-[#526157]">
                  Waiting for agent analysis.
                </p>
              </div>
              <span className="rounded-md bg-[#eef2ec] px-2 py-1 text-xs font-semibold text-[#526157]">
                Planned
              </span>
            </div>
          ))}
        </div>
      </div>

      <aside className="rounded-md border border-[#d7ddd4] bg-white p-4">
        <h2 className="text-lg font-semibold">Review context</h2>
        <dl className="mt-5 space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-[#526157]">Invoices available</dt>
            <dd className="font-medium">{invoices.length}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-[#526157]">Agent status</dt>
            <dd className="font-medium">Not configured</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-[#526157]">Data refresh</dt>
            <dd className="font-medium">{isLoadingInvoices ? "Loading" : "Ready"}</dd>
          </div>
        </dl>
      </aside>
    </section>
  );
}
