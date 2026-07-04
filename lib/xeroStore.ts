import type { TokenSet, TokenSetParameters } from "xero-node";

let tokenSet: TokenSet | TokenSetParameters | null = null;
let tenantId: string | null = null;
let tenantName: string | null = null;

export function saveXeroConnection(
  nextTokenSet: TokenSet | TokenSetParameters,
  nextTenantId: string,
  nextTenantName: string,
) {
  tokenSet = nextTokenSet;
  tenantId = nextTenantId;
  tenantName = nextTenantName;
}

export function getXeroConnection() {
  return {
    tokenSet,
    tenantId,
    tenantName,
    isConnected: Boolean(tokenSet && tenantId),
  };
}
