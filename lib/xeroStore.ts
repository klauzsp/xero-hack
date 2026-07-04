import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TokenSet, TokenSetParameters } from "xero-node";

type StoredXeroConnection = {
  tokenSet: TokenSetParameters;
  tenantId: string;
  tenantName: string;
  connectionId?: string;
};

const connectionFilePath = join(process.cwd(), ".xero-connection.json");

let tokenSet: TokenSet | TokenSetParameters | null = null;
let tenantId: string | null = null;
let tenantName: string | null = null;
let connectionId: string | null = null;

function loadStoredConnection() {
  if (tokenSet || !existsSync(connectionFilePath)) {
    return;
  }

  try {
    const storedConnection = JSON.parse(
      readFileSync(connectionFilePath, "utf8"),
    ) as StoredXeroConnection;

    tokenSet = storedConnection.tokenSet;
    tenantId = storedConnection.tenantId;
    tenantName = storedConnection.tenantName;
    connectionId = storedConnection.connectionId ?? null;
  } catch {
    tokenSet = null;
    tenantId = null;
    tenantName = null;
    connectionId = null;
  }
}

export function saveXeroConnection(
  nextTokenSet: TokenSet | TokenSetParameters,
  nextTenantId: string,
  nextTenantName: string,
  nextConnectionId?: string,
) {
  tokenSet = nextTokenSet;
  tenantId = nextTenantId;
  tenantName = nextTenantName;
  connectionId = nextConnectionId ?? null;

  writeFileSync(
    connectionFilePath,
    JSON.stringify(
      {
        tokenSet: nextTokenSet,
        tenantId: nextTenantId,
        tenantName: nextTenantName,
        connectionId: nextConnectionId,
      },
      null,
      2,
    ),
  );
}

export function getXeroConnection() {
  loadStoredConnection();

  return {
    tokenSet,
    tenantId,
    tenantName,
    connectionId,
    isConnected: Boolean(tokenSet && tenantId),
  };
}

export function clearXeroConnection() {
  tokenSet = null;
  tenantId = null;
  tenantName = null;
  connectionId = null;

  if (existsSync(connectionFilePath)) {
    unlinkSync(connectionFilePath);
  }
}
