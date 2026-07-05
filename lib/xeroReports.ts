import { createXeroClient } from "@/lib/xeroClient";
import { getXeroConnection, saveXeroConnection } from "@/lib/xeroStore";

export type PnlMonth = {
  label: string;
  income: number;
  expenses: number;
  netProfit: number;
};

export type BankAccountBalance = {
  name: string;
  balance: number;
};

export type XeroDashboardReports = {
  pnl: { months: PnlMonth[] } | null;
  bank: { accounts: BankAccountBalance[]; total: number } | null;
  netAssets: number | null;
};

type ReportRowLike = {
  rowType?: string;
  title?: string;
  cells?: Array<{ value?: unknown }>;
  rows?: ReportRowLike[];
};

type ReportLike = {
  rows?: ReportRowLike[];
};

function cellText(row: ReportRowLike, index: number) {
  const value = row.cells?.[index]?.value;

  return typeof value === "string" ? value : "";
}

function rowValues(row: ReportRowLike) {
  return (row.cells ?? []).slice(1).map((cell) => {
    const parsed = Number.parseFloat(String(cell.value ?? ""));

    return Number.isFinite(parsed) ? parsed : 0;
  });
}

// Xero reports nest data rows inside sections; collect every labelled row so
// callers can look up lines like "Total Income" or "Net Profit" by name.
function collectValuesByLabel(report: ReportLike) {
  const byLabel = new Map<string, number[]>();
  const walk = (rows: ReportRowLike[] | undefined) => {
    for (const row of rows ?? []) {
      if (row.rowType === "Row" || row.rowType === "SummaryRow") {
        const label = cellText(row, 0);

        if (label && !byLabel.has(label)) {
          byLabel.set(label, rowValues(row));
        }
      }

      walk(row.rows);
    }
  };

  walk(report.rows);

  return byLabel;
}

function headerLabels(report: ReportLike) {
  const header = (report.rows ?? []).find((row) => row.rowType === "Header");

  return (header?.cells ?? [])
    .slice(1)
    .map((cell) => (typeof cell.value === "string" ? cell.value : ""));
}

// Xero header cells look like "30 Jun 26"; keep just the month name.
function shortMonthLabel(label: string) {
  const parts = label.split(" ");

  return parts.length === 3 ? parts[1] : label;
}

async function getConnectedXeroClient() {
  const connection = getXeroConnection();

  if (!connection.isConnected || !connection.tokenSet || !connection.tenantId) {
    return null;
  }

  const xero = createXeroClient();
  await xero.initialize();
  xero.setTokenSet(connection.tokenSet);

  const tokenSet = xero.readTokenSet();

  if (typeof tokenSet.expired === "function" && tokenSet.expired()) {
    const refreshedTokenSet = await xero.refreshToken();
    saveXeroConnection(
      refreshedTokenSet,
      connection.tenantId,
      connection.tenantName ?? connection.tenantId,
      connection.connectionId ?? undefined,
    );
  }

  return { xero, tenantId: connection.tenantId };
}

type DashboardReportsResult = {
  ok: boolean;
  status: number;
  body: XeroDashboardReports | { error: string };
};

// Same rationale as the invoice cache: keep repeat dashboard loads off
// Xero's per-minute rate limits.
const reportsCacheTtlMs = 60_000;
let reportsCache: { at: number; result: DashboardReportsResult } | null = null;

export function clearXeroReportsCache() {
  reportsCache = null;
}

export async function fetchXeroDashboardReports(): Promise<DashboardReportsResult> {
  if (reportsCache && Date.now() - reportsCache.at < reportsCacheTtlMs) {
    return reportsCache.result;
  }

  const result = await fetchXeroDashboardReportsUncached();

  if (result.ok) {
    reportsCache = { at: Date.now(), result };
  }

  return result;
}

async function fetchXeroDashboardReportsUncached(): Promise<DashboardReportsResult> {
  const connected = await getConnectedXeroClient();

  if (!connected) {
    return {
      ok: false,
      status: 401,
      body: { error: "Connect to Xero before requesting dashboard reports" },
    };
  }

  const { xero, tenantId } = connected;
  const reports: XeroDashboardReports = {
    pnl: null,
    bank: null,
    netAssets: null,
  };

  // Each report degrades independently, so fetch both in parallel.
  const loadPnl = async () => {
    try {
      const response = await xero.accountingApi.getReportProfitAndLoss(
        tenantId,
        undefined,
        undefined,
        2,
        "MONTH",
        undefined,
        undefined,
        undefined,
        undefined,
        true,
      );
      const report = (response.body.reports ?? [])[0] as ReportLike | undefined;

      if (report) {
        const byLabel = collectValuesByLabel(report);
        const labels = headerLabels(report);
        const income = byLabel.get("Total Income") ?? [];
        const costOfSales = byLabel.get("Total Cost of Sales") ?? [];
        const operatingExpenses = byLabel.get("Total Operating Expenses") ?? [];
        const netProfit = byLabel.get("Net Profit") ?? [];
        // Xero returns the newest period first; the chart wants oldest → newest.
        const months = labels
          .map((label, index) => ({
            label: shortMonthLabel(label),
            income: income[index] ?? 0,
            expenses:
              (costOfSales[index] ?? 0) + (operatingExpenses[index] ?? 0),
            netProfit: netProfit[index] ?? 0,
          }))
          .reverse();

        if (months.length > 0) {
          reports.pnl = { months };
        }
      }
    } catch {
      // Missing report scope or API hiccup: the dashboard renders without P&L.
    }
  };

  const loadBalanceSheet = async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const response = await xero.accountingApi.getReportBalanceSheet(
        tenantId,
        today,
        undefined,
        undefined,
        undefined,
        undefined,
        true,
      );
      const report = (response.body.reports ?? [])[0] as ReportLike | undefined;

      if (report) {
        const bankSection = (report.rows ?? []).find(
          (row) => row.rowType === "Section" && row.title === "Bank",
        );

        if (bankSection) {
          const accounts = (bankSection.rows ?? [])
            .filter((row) => row.rowType === "Row")
            .map((row) => ({
              name: cellText(row, 0),
              balance: rowValues(row)[0] ?? 0,
            }));
          const totalRow = (bankSection.rows ?? []).find(
            (row) => row.rowType === "SummaryRow",
          );
          const total = totalRow
            ? rowValues(totalRow)[0] ?? 0
            : accounts.reduce((sum, account) => sum + account.balance, 0);

          reports.bank = { accounts, total };
        }

        const netAssets = collectValuesByLabel(report).get("Net Assets");

        if (netAssets && netAssets.length > 0) {
          reports.netAssets = netAssets[0];
        }
      }
    } catch {
      // Same graceful degradation as the P&L block.
    }
  };

  await Promise.all([loadPnl(), loadBalanceSheet()]);

  return { ok: true, status: 200, body: reports };
}
