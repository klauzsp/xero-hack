# Kite — pitch deck

---

## 1 · The problem

**Small businesses don't die from bad products. They die from bad cash flow.**

- Late payments are endemic: UK SMEs alone chase tens of billions in overdue invoices at any moment, and owners spend hours a week on it.
- Accounting software *records* the problem beautifully — Xero knows exactly who owes what and for how long — but it doesn't *act* on it.
- The owner is the bottleneck: reading aged-receivables reports, deciding who to chase, writing awkward "just a friendly nudge" emails, and remembering to follow up. Most don't have a finance team; they have a Sunday evening.

> Alice runs a wholesale coffee roastery. Her books say £21,500 is owed to her and £8,700 of bills are due. What her books don't say is *what to do before Friday*.

---

## 2 · The solution

**Kite puts an AI finance agent — Bruno — on top of the ledger.**

Bruno connects to the business's live Xero data and closes the gap between *knowing* and *doing*:

1. **Sees** — a real-time dashboard: bank balance, receivables vs payables, P&L trend, overdue work.
2. **Thinks** — ask anything ("what cash is at risk this week?") and Bruno autonomously pulls the right reports and invoices, then answers with evidence and severity-rated insights.
3. **Acts** — ranked chase lists with ready-to-send emails (recipient looked up from Xero contacts, one click to Gmail), and cash-flow recommendations pushed straight into Slack.

Every number Bruno states comes from a live Xero tool call — no hallucinated finances. Every action keeps a human in the loop: Bruno drafts, Alice approves.

---

## 3 · How it works — the Xero tooling

**Built on the official Xero MCP server** (`@xeroapi/xero-mcp-server`) — Xero's own Model Context Protocol integration — so the agent uses the same vetted tool surface Xero publishes, not scraped endpoints.

- **OAuth 2.0, read-only, granular.** Kite requests only granular read scopes (`accounting.invoices.read`, `accounting.reports.profitandloss.read`, `accounting.reports.aged.read`, `accounting.banktransactions.read`, `accounting.payments.read`, ...). The session's bearer token is handed to the MCP server per request — no credentials stored in the agent.
- **18 Xero tools, scope-gated.** At question time Kite lists the MCP server's tools and offers the model only those the granted token covers: `list-invoices`, `list-contacts`, `list-payments`, `list-bank-transactions`, `list-profit-and-loss`, `list-report-balance-sheet`, `list-trial-balance`, `list-aged-receivables-by-contact`, `list-aged-payables-by-contact`, and more. Grant a scope → Bruno gains an ability.
- **A true agentic loop.** Gemini (native function calling) picks which Xero tools to call, in parallel batches; Kite executes them over MCP and streams every step to the UI live. Multi-turn memory means "now draft emails for those" needs no re-explaining.
- **Xero Reports API for the dashboard.** P&L (3-month comparison) and today's balance sheet render the income-vs-expenses chart, bank balances, and net assets — with batched fetching, 60-second caching, and snapshot fallback to respect Xero's rate limits.

```
Question → Gemini agent → Xero MCP tools → evidence → answer + insights + drafted actions
```

---

## 4 · Why now, why this

- **MCP makes it durable.** As Xero's MCP server grows (payments, write actions), Bruno inherits new abilities with near-zero integration work — the scope-gating already handles it.
- **Agent-native, not chatbot-bolted-on.** Bruno shows his working (live tool trace), grounds every figure, suggests the next action, and hands the final send to the human.
- **Distribution where owners live.** Insights land in the dashboard, chase emails in Gmail, recommendations in Slack (via Make) — Kite meets the owner instead of demanding another tab.

---

## 5 · The demo

1. **Connect Xero** → dashboard fills with Alice's live roastery numbers.
2. Click **"Owed to you £21,541"** → Bruno is asked who to chase; watch him page invoices and check aged receivables in real time.
3. Bruno returns a ranked chase list — **"Send via Gmail"** opens a finished nudge email, recipient pre-filled from Xero.
4. Follow-up chip: *"What cash is at risk this week?"* → severity-rated insights, then **one click pushes recommendations to Slack**.

**Kite: the books, finally doing something about themselves.**
