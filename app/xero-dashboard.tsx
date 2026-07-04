"use client";

import { useEffect, useMemo, useState } from "react";

type Status = {
  isConfigured: boolean;
  missingConfig: string[];
  isConnected: boolean;
  tenantId: string | null;
  tenantName: string | null;
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

const initialStatus: Status = {
  isConfigured: false,
  missingConfig: [],
  isConnected: false,
  tenantId: null,
  tenantName: null,
  scopes: [],
};

export function XeroDashboard() {
  const [status, setStatus] = useState<Status>(initialStatus);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [message, setMessage] = useState("Checking local configuration...");
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(false);

  const formatter = useMemo(
    () =>
      new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
      }),
    [],
  );

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
            ? "Connected to Xero. Fetch invoices to test the accounting API."
            : "Ready to connect to your Xero demo company."),
      );
      setIsLoadingStatus(false);
    }

    loadStatus().catch((error) => {
      setMessage(error instanceof Error ? error.message : "Status check failed");
      setIsLoadingStatus(false);
    });
  }, []);

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

  return (
    <main className="min-h-screen bg-[#f7f8f6] px-6 py-10 text-[#17211b] sm:px-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <section className="flex flex-col gap-5 border-b border-[#d7ddd4] pb-8">
          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#31795a]">
              Xero developer demo
            </p>
            <h1 className="max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl">
              Connect your demo company and test invoice retrieval.
            </h1>
            <p className="max-w-2xl text-base leading-7 text-[#526157]">
              This local app uses your `.env.local` credentials server-side,
              stores the OAuth token in memory, and calls the Xero invoices API.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <a
              className="inline-flex h-11 items-center justify-center rounded-md bg-[#0f6f4d] px-4 text-sm font-semibold text-white transition hover:bg-[#0b5d40]"
              href="/api/xero/connect"
            >
              Connect Xero
            </a>
            <button
              className="inline-flex h-11 items-center justify-center rounded-md border border-[#b9c3b7] bg-white px-4 text-sm font-semibold text-[#17211b] transition hover:bg-[#eef2ec] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={
                !status.isConnected || isLoadingInvoices || isLoadingStatus
              }
              onClick={loadInvoices}
              type="button"
            >
              {isLoadingInvoices ? "Fetching..." : "Fetch invoices"}
            </button>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-md border border-[#d7ddd4] bg-white p-4">
            <p className="text-sm text-[#526157]">Configuration</p>
            <p className="mt-2 text-lg font-semibold">
              {status.isConfigured ? "Ready" : "Missing keys"}
            </p>
          </div>
          <div className="rounded-md border border-[#d7ddd4] bg-white p-4">
            <p className="text-sm text-[#526157]">Connection</p>
            <p className="mt-2 text-lg font-semibold">
              {status.isConnected ? "Connected" : "Not connected"}
            </p>
          </div>
          <div className="rounded-md border border-[#d7ddd4] bg-white p-4">
            <p className="text-sm text-[#526157]">Tenant</p>
            <p className="mt-2 truncate text-lg font-semibold">
              {status.tenantName ?? "None"}
            </p>
          </div>
        </section>

        {status.isConnected &&
        !status.scopes.includes("accounting.transactions.read") &&
        !status.scopes.includes("accounting.transactions") ? (
          <section className="rounded-md border border-[#ead0a2] bg-[#fff8e8] p-4 text-sm text-[#6d4c16]">
            Connected with contacts access. Invoice retrieval needs Xero to
            accept `accounting.transactions.read` for this app.
          </section>
        ) : null}

        {!status.isConfigured ? (
          <section className="rounded-md border border-[#ead0a2] bg-[#fff8e8] p-4 text-sm text-[#6d4c16]">
            Missing env vars: {status.missingConfig.join(", ")}
          </section>
        ) : null}

        <section className="rounded-md border border-[#d7ddd4] bg-white">
          <div className="border-b border-[#d7ddd4] px-4 py-3">
            <p className="text-sm font-medium text-[#526157]">{message}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead className="bg-[#eef2ec] text-[#526157]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Invoice</th>
                  <th className="px-4 py-3 font-semibold">Contact</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Date</th>
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
                  invoices.map((invoice) => {
                    const currency = invoice.currencyCode ?? "GBP";
                    const money = new Intl.NumberFormat("en-GB", {
                      style: "currency",
                      currency,
                    });

                    return (
                      <tr
                        className="border-t border-[#edf0eb]"
                        key={invoice.invoiceID ?? invoice.invoiceNumber}
                      >
                        <td className="px-4 py-3 font-medium">
                          {invoice.invoiceNumber ?? "No number"}
                        </td>
                        <td className="px-4 py-3">
                          {invoice.contactName ?? "Unknown"}
                        </td>
                        <td className="px-4 py-3">{invoice.status ?? "-"}</td>
                        <td className="px-4 py-3">{invoice.date ?? "-"}</td>
                        <td className="px-4 py-3 text-right">
                          {typeof invoice.total === "number"
                            ? money.format(invoice.total)
                            : formatter.format(0)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {typeof invoice.amountDue === "number"
                            ? money.format(invoice.amountDue)
                            : "-"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
