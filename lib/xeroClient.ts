import { XeroClient } from "xero-node";

export const xeroScopes = (
  process.env.XERO_SCOPES ??
  "openid profile email accounting.contacts.read offline_access"
).split(" ");

export function createXeroClient() {
  return new XeroClient({
    clientId: process.env.XERO_CLIENT_ID!,
    clientSecret: process.env.XERO_CLIENT_SECRET!,
    redirectUris: [process.env.XERO_REDIRECT_URI!],
    scopes: xeroScopes,
  });
}
