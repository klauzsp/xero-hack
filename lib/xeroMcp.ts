import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "node:path";
import { createXeroClient } from "@/lib/xeroClient";
import { getXeroConnection, saveXeroConnection } from "@/lib/xeroStore";
import type { XeroInvoiceSummary } from "@/lib/xeroInvoices";

type TextContent = {
  type: "text";
  text: string;
};

function getAccessToken(tokenSet: unknown) {
  if (!tokenSet || typeof tokenSet !== "object") {
    return null;
  }

  const accessToken = (tokenSet as { access_token?: unknown }).access_token;

  return typeof accessToken === "string" ? accessToken : null;
}

function getGrantedScopes(tokenSet: unknown) {
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

function hasRequiredMcpScopes(scopes: string[]) {
  const hasInvoices =
    scopes.includes("accounting.invoices.read") ||
    scopes.includes("accounting.invoices");
  const hasSettings =
    scopes.includes("accounting.settings.read") ||
    scopes.includes("accounting.settings");

  return hasInvoices && hasSettings;
}

async function getFreshAccessToken() {
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
  let nextTokenSet = tokenSet;

  if (typeof tokenSet.expired === "function" && tokenSet.expired()) {
    nextTokenSet = await xero.refreshToken();
    saveXeroConnection(
      nextTokenSet,
      connection.tenantId,
      connection.tenantName ?? connection.tenantId,
      connection.connectionId ?? undefined,
    );
  }

  const accessToken = getAccessToken(nextTokenSet);
  const grantedScopes = getGrantedScopes(nextTokenSet);

  if (!hasRequiredMcpScopes(grantedScopes)) {
    return {
      ok: false as const,
      status: 403,
      body: {
        error: "Reconnect to Xero with MCP scopes",
        detail:
          "The official Xero MCP server needs accounting.invoices.read and accounting.settings.read. Click Connect Xero again and approve the new scope request.",
        grantedScopes,
      },
    };
  }

  if (!accessToken) {
    return {
      ok: false as const,
      status: 401,
      body: { error: "Unable to read Xero access token" },
    };
  }

  return {
    ok: true as const,
    accessToken,
    connection,
  };
}

function getTextContent(content: unknown) {
  if (!Array.isArray(content)) {
    return [];
  }

  return content.filter(
    (item): item is TextContent =>
      Boolean(item) &&
      typeof item === "object" &&
      (item as { type?: unknown }).type === "text" &&
      typeof (item as { text?: unknown }).text === "string",
  );
}

function parseInvoiceText(text: string): XeroInvoiceSummary {
  const lines = text.split("\n");
  const getValue = (label: string) =>
    lines
      .find((line) => line.startsWith(`${label}: `))
      ?.slice(label.length + 2)
      .trim();
  const amountDue = getValue("Amount Due");
  const total = getValue("Total");

  return {
    invoiceID: getValue("Invoice ID"),
    invoiceNumber: getValue("Invoice"),
    contactName: getValue("Contact")?.replace(/\s+\([^)]+\)$/, ""),
    status: getValue("Status"),
    date: getValue("Date"),
    dueDate: getValue("Due Date"),
    total: total ? Number(total) : undefined,
    amountDue: amountDue ? Number(amountDue) : 0,
    currencyCode: getValue("Currency"),
  };
}

export async function fetchXeroInvoicesViaMcp(pageSize = 50) {
  const tokenResult = await getFreshAccessToken();

  if (!tokenResult.ok) {
    return tokenResult;
  }

  const serverPath = join(
    process.cwd(),
    "node_modules",
    "@xeroapi",
    "xero-mcp-server",
    "dist",
    "index.js",
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
      XERO_CLIENT_BEARER_TOKEN: tokenResult.accessToken,
    },
    stderr: "pipe",
  });
  const stderrChunks: string[] = [];
  transport.stderr?.on("data", (chunk: Buffer) => {
    stderrChunks.push(chunk.toString("utf8"));
  });
  const client = new Client({
    name: "xero-hack-app",
    version: "0.1.0",
  });

  try {
    await client.connect(transport);

    const invoices: XeroInvoiceSummary[] = [];
    let page = 1;

    while (invoices.length < pageSize) {
      const result = await client.callTool({
        name: "list-invoices",
        arguments: { page },
      });
      const textContent = getTextContent(result.content);
      const toolError = textContent.find((item) =>
        item.text.startsWith("Error listing invoices:"),
      );

      if (toolError) {
        throw new Error(toolError.text);
      }

      const pageInvoices = textContent
        .map((item) => item.text)
        .filter((text) => text.startsWith("Invoice ID: "))
        .map(parseInvoiceText);

      invoices.push(...pageInvoices);

      if (pageInvoices.length < 10) {
        break;
      }

      page += 1;
    }

    const trimmedInvoices = invoices.slice(0, pageSize);

    return {
      ok: true as const,
      status: 200,
      body: {
        tenantId: tokenResult.connection.tenantId,
        tenantName: tokenResult.connection.tenantName,
        count: trimmedInvoices.length,
        invoices: trimmedInvoices,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown MCP error";
    const stderr = stderrChunks.join("").trim();

    throw new Error(stderr ? `${message}: ${stderr}` : message);
  } finally {
    await client.close();
  }
}
