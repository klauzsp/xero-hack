# Kite ☕

**Kite** is an AI-native accounting platform built on Xero. Its finance agent, **Bruno**, connects to a business's live Xero data, works out where cash is stuck, and helps get it moving — chasing late invoices, analysing cash flow, and pushing recommendations to where the owner already works (email, Slack).

The demo is themed for **Alice**, who runs a wholesale coffee roastery: warm café styling, Bruno as her "finance barista", and every insight grounded in her real Xero demo-company data.

## What it does

**Dashboard** (`/`) — a live financial overview pulled from Xero:

- Bank balance, receivables, payables, and overdue-invoice counts
- Profit & loss for the last 3 months (income vs expenses chart with net-profit delta)
- Bank account balances and net assets from today's balance sheet
- Recent invoices
- Every metric card is clickable and pre-fills a question for Bruno
- One-click **"Send Slack cash-flow recommendations"** via a Make automation

**Ask Bruno** (`/review`) — a conversational finance agent:

- Bruno decides for himself which Xero data to pull for each question, live, with a friendly progress trace ("Bruno is grinding through the invoices...")
- Multi-turn: he remembers the conversation, so "draft emails for those" just works
- Structured results: a direct answer, severity-rated insights, and ranked invoice follow-ups
- Follow-up chips: Bruno suggests the next 2–4 actions after every answer
- Chase emails come pre-drafted and editable, with the recipient's address looked up from Xero contacts and a **Send via Gmail** button that opens a pre-filled compose window

## How the agent works

```
Browser ──POST /api/ai/agent──▶ Next.js route (streams NDJSON events)
                                   │
                                   ▼
                          Gemini (interactions API,
                          native function calling)
                                   │  requests tools, batched in parallel
                                   ▼
                          Xero MCP server (official
                          @xeroapi/xero-mcp-server, stdio)
                                   │  bearer token from the OAuth session
                                   ▼
                                 Xero API
```

1. On each question, the server spawns the **official Xero MCP server** and lists its tools.
2. **Gemini** receives the question plus those tool schemas and runs an agentic loop: it requests tools, the server executes them over MCP, and results stream back.
3. Conversation state is carried by the interaction API's `previous_interaction_id`, so follow-ups keep full context without resending history.
4. Every event (tool call, result, status, final answer) streams to the browser as NDJSON, which powers the live progress UI.

Structured answers follow a fixed JSON contract: `answer`, `summary`, `insights[]` (with `good | watch | risk` severity), `reviews[]` (ranked invoice follow-ups with drafted emails and `contactEmail` looked up via `list-contacts`), and `followUps[]`.

## Xero products used

Kite deliberately exercises as much of the Xero developer platform as possible:

| Xero product                                                                        | How Kite uses it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Xero MCP server** (`@xeroapi/xero-mcp-server`) — Xero's official AI-agent tooling | The heart of the project. Bruno's entire tool surface is the official MCP server, spawned per request over stdio and authenticated with the session's OAuth bearer token. 18 read-only tools are exposed to the model: `list-invoices`, `list-contacts`, `list-contact-groups`, `list-payments`, `list-bank-transactions`, `list-credit-notes`, `list-quotes`, `list-manual-journals`, `list-profit-and-loss`, `list-report-balance-sheet`, `list-trial-balance`, `list-aged-receivables-by-contact`, `list-aged-payables-by-contact`, `list-accounts`, `list-items`, `list-tax-rates`, `list-organisation-details`, `list-tracking-categories` |
| **Xero Accounting API — Reports**                                                   | `getReportProfitAndLoss` (3-month comparison) and `getReportBalanceSheet` power the dashboard's P&L chart, bank balances, and net assets                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Xero Accounting API — Invoices**                                                  | Drives the dashboard metrics and invoice table (via the MCP `list-invoices` tool by default; direct `getInvoices` as a fallback path)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Xero OAuth 2.0 with granular scopes**                                             | Full authorization-code flow with refresh-token handling. Only granular _read_ scopes are requested (`accounting.invoices.read`, `accounting.reports.profitandloss.read`, `accounting.reports.aged.read`, ...), and the agent's abilities are gated at runtime by what the token actually grants                                                                                                                                                                                                                                                                                                                                                |
| **Xero Connections API**                                                            | Tenant discovery after consent and programmatic disconnect (`DELETE /connections/{id}`) from the navbar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **xero-node SDK**                                                                   | Xero's official TypeScript SDK underpins the OAuth client, token refresh, and all direct API calls                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Xero Demo Company**                                                               | All demo data — Alice's invoices, contacts, reports — is a live Xero demo organisation, not fixtures                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## Xero integration details

- **OAuth 2.0** via `xero-node` with granular read-only scopes: `accounting.invoices.read`, `accounting.contacts.read`, `accounting.settings.read`, `accounting.banktransactions.read`, `accounting.payments.read`, `accounting.manualjournals.read`, and the per-report scopes (`accounting.reports.{aged,balancesheet,profitandloss,trialbalance}.read`).
- **MCP** for all agent data access and the invoice list (`XERO_CLIENT_BEARER_TOKEN` passes the session's access token to the MCP server). Set `XERO_USE_MCP=false` to fall back to direct `xero-node` calls.
- **Reports API** (`getReportProfitAndLoss`, `getReportBalanceSheet`) powers the dashboard chart and bank card.

## Slack recommendations (Make)

`POST /api/make/bruno-cash-flow` triggers a [Make](https://www.make.com) scenario (authenticated with `x-make-apikey`) that generates cash-flow recommendations and posts them to Slack — wired to the dashboard button.

## Getting started

```bash
pnpm install
pnpm dev
```

Create `.env.local`:

```bash
XERO_CLIENT_ID=...            # Xero developer app (OAuth 2.0, http://localhost:3000/api/xero/callback)
XERO_CLIENT_SECRET=...
XERO_REDIRECT_URI=http://localhost:3000/api/xero/callback
GEMINI_API_KEY=...            # Google AI Studio
# GEMINI_MODEL=gemini-3.5-flash   # optional override
MAKE_BRUNO_URL=...            # Make webhook URL (Slack recommendations)
MAKE_BRUNO_SEARCH_API=...     # Make webhook API key
```

Open [http://localhost:3000](http://localhost:3000), click **Connect Xero**, approve the scopes against a Xero **demo company**, and the dashboard fills itself. Then ask Bruno something — _"Bruno, who should Alice chase first today?"_

## Stack

Next.js 16 (App Router) · React 19 · Tailwind CSS 4 · TypeScript · `@xeroapi/xero-mcp-server` + `@modelcontextprotocol/sdk` · `xero-node` · Gemini · Make + Slack
