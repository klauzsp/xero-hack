import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createXeroClient } from "@/lib/xeroClient";
import { fetchXeroInvoicesViaMcp } from "@/lib/xeroMcp";
import { getXeroConnection, saveXeroConnection } from "@/lib/xeroStore";

export type XeroInvoiceSummary = {
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

export function getGrantedScopes(tokenSet: unknown) {
  if (!tokenSet || typeof tokenSet !== "object" || !("scope" in tokenSet)) {
    return [];
  }

  const scope = (tokenSet as { scope?: unknown }).scope;

  if (Array.isArray(scope)) {
    return scope.filter((value): value is string => typeof value === "string");
  }

  if (typeof scope === "string") {
    return scope.split(" ").filter(Boolean);
  }

  return [];
}

export function getErrorDetail(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    try {
      const parsed = JSON.parse(error) as {
        response?: {
          statusCode?: number;
          headers?: Record<string, string>;
        };
      };
      const statusCode = parsed.response?.statusCode;
      const headers = parsed.response?.headers;

      if (
        statusCode === 429 &&
        headers?.["x-rate-limit-problem"] === "day"
      ) {
        return `Xero daily API limit reached. Try again after ${headers["retry-after"] ?? "the retry window"} seconds.`;
      }
    } catch {
      return error;
    }

    return error;
  }

  if (error && typeof error === "object") {
    const responseBody = (error as { response?: { body?: unknown } }).response
      ?.body;

    if (responseBody) {
      return JSON.stringify(responseBody);
    }

    const body = (error as { body?: unknown }).body;

    if (body) {
      return JSON.stringify(body);
    }
  }

  return "Unknown error";
}

export function getErrorStatus(error: unknown) {
  if (typeof error === "string") {
    try {
      const parsed = JSON.parse(error) as {
        response?: {
          statusCode?: number;
        };
      };

      if (parsed.response?.statusCode) {
        return parsed.response.statusCode;
      }
    } catch {
      return 500;
    }
  }

  if (error && typeof error === "object") {
    const statusCode = (error as { response?: { statusCode?: unknown } })
      .response?.statusCode;

    if (typeof statusCode === "number") {
      return statusCode;
    }
  }

  return 500;
}

type InvoiceFetchResult = Awaited<ReturnType<typeof fetchXeroInvoicesUncached>>;
type SuccessfulInvoiceFetchResult = Extract<InvoiceFetchResult, { ok: true }>;

type InvoiceSnapshot = {
  savedAt: string;
  result: SuccessfulInvoiceFetchResult;
};

// Short-lived cache: the dashboard, review, and agent flows all want the same
// invoice list, and Xero enforces per-minute and concurrency rate limits.
const invoiceCacheTtlMs = 60_000;
const invoiceSnapshotPath = join(process.cwd(), ".xero-invoices-snapshot.json");
let invoiceCache: {
  at: number;
  pageSize: number;
  result: InvoiceFetchResult;
} | null = null;

export function clearXeroInvoiceCache() {
  invoiceCache = null;
}

export async function fetchXeroInvoices(
  pageSize = 50,
  options?: { fresh?: boolean },
) {
  if (
    !options?.fresh &&
    invoiceCache &&
    invoiceCache.pageSize >= pageSize &&
    Date.now() - invoiceCache.at < invoiceCacheTtlMs
  ) {
    return invoiceCache.result;
  }

  let result: InvoiceFetchResult;

  try {
    result = await fetchXeroInvoicesUncached(pageSize);
  } catch (error) {
    const connection = getXeroConnection();
    const snapshot = readInvoiceSnapshot(pageSize, connection.tenantId);

    if (snapshot) {
      return {
        ...snapshot.result,
        body: {
          ...snapshot.result.body,
          stale: true,
          snapshotSavedAt: snapshot.savedAt,
          staleReason: getErrorDetail(error),
        },
      };
    }

    throw error;
  }

  if (result.ok) {
    invoiceCache = { at: Date.now(), pageSize, result };
    writeInvoiceSnapshot(result);
  }

  return result;
}

function readInvoiceSnapshot(pageSize: number, tenantId?: string | null) {
  if (!existsSync(invoiceSnapshotPath)) {
    return null;
  }

  try {
    const snapshot = JSON.parse(
      readFileSync(invoiceSnapshotPath, "utf8"),
    ) as InvoiceSnapshot;

    if (
      !snapshot.result.ok ||
      snapshot.result.body.invoices.length === 0 ||
      !tenantId ||
      snapshot.result.body.tenantId !== tenantId
    ) {
      return null;
    }

    if (snapshot.result.body.invoices.length > pageSize) {
      return {
        ...snapshot,
        result: {
          ...snapshot.result,
          body: {
            ...snapshot.result.body,
            count: pageSize,
            invoices: snapshot.result.body.invoices.slice(0, pageSize),
          },
        },
      };
    }

    return snapshot;
  } catch {
    return null;
  }
}

function writeInvoiceSnapshot(result: SuccessfulInvoiceFetchResult) {
  try {
    writeFileSync(
      invoiceSnapshotPath,
      JSON.stringify(
        {
          savedAt: new Date().toISOString(),
          result,
        } satisfies InvoiceSnapshot,
        null,
        2,
      ),
    );
  } catch (error) {
    console.warn("[Xero] Unable to write invoice snapshot", error);
  }
}

async function fetchXeroInvoicesUncached(pageSize: number) {
  if (process.env.XERO_USE_MCP !== "false") {
    console.log("[Xero] Using MCP path");
    return fetchXeroInvoicesViaMcp(pageSize);
  }
  console.log("[Xero] Using xero-node fallback path");

  const connection = getXeroConnection();

  if (!connection.isConnected || !connection.tokenSet || !connection.tenantId) {
    return {
      ok: false as const,
      status: 401,
      body: { error: "Connect to Xero before requesting invoices" },
    };
  }

  const xero = createXeroClient();
  await xero.initialize();
  xero.setTokenSet(connection.tokenSet);

  const tokenSet = xero.readTokenSet();
  const grantedScopes = getGrantedScopes(tokenSet);
  const hasInvoiceScope =
    grantedScopes.includes("accounting.invoices.read") ||
    grantedScopes.includes("accounting.invoices");

  if (!hasInvoiceScope) {
    return {
      ok: false as const,
      status: 403,
      body: {
        error: "Reconnect to Xero with invoice access",
        detail:
          "Your current token does not include accounting.invoices.read. Click Connect Xero again and approve the new invoice scope.",
        grantedScopes,
      },
    };
  }

  if (typeof tokenSet.expired === "function" && tokenSet.expired()) {
    const refreshedTokenSet = await xero.refreshToken();
    saveXeroConnection(
      refreshedTokenSet,
      connection.tenantId,
      connection.tenantName ?? connection.tenantId,
      connection.connectionId ?? undefined,
    );
  }

  const response = await xero.accountingApi.getInvoices(
    connection.tenantId,
    undefined,
    undefined,
    "Date DESC",
    undefined,
    undefined,
    undefined,
    undefined,
    1,
    undefined,
    undefined,
    undefined,
    false,
    pageSize,
  );

  const invoices: XeroInvoiceSummary[] = (response.body.invoices ?? []).map(
    (invoice) => ({
      invoiceID: invoice.invoiceID,
      invoiceNumber: invoice.invoiceNumber,
      contactName: invoice.contact?.name,
      type: invoice.type ? String(invoice.type) : undefined,
      status: invoice.status ? String(invoice.status) : undefined,
      date: invoice.date,
      dueDate: invoice.dueDate,
      total: invoice.total,
      amountDue: invoice.amountDue,
      currencyCode: invoice.currencyCode
        ? String(invoice.currencyCode)
        : undefined,
    }),
  );

  return {
    ok: true as const,
    status: 200,
    body: {
      tenantId: connection.tenantId,
      tenantName: connection.tenantName,
      count: invoices.length,
      invoices,
    },
  };
}
