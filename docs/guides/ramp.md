# Ramp

**TL;DR.** Paste a Ramp developer app's **client ID and secret** on the
Connectors page (or tap the card an agent offers in chat). Agents given the
source read card transactions, reimbursements, bills and vendors live.
Read-only. Works today: no OAuth redirect needed.

## What it reads

Read live, never synced: spend changes by the minute, and a mirror would
copy cardholders' names into the index for nothing.

| Record (`kind`) | Ramp object | Filters that apply |
|---|---|---|
| `transaction` | Card transaction (merchant, cardholder, department, category, memo) | dates |
| `reimbursement` | Reimbursement (merchant, employee, memo) | dates |
| `bill` | Bill, with approval and payment status | vendor |
| `vendor` | Vendor | — |

Transactions and reimbursements carry amounts in major units; bills carry
an amount object in cents, converted to major units. Ramp documents no
stable per-record link, so records have no `url`. A filter Ramp cannot
apply to a kind is listed as `ignored`. Paging follows Ramp's own
`page.next`, only on the API host the credential belongs to.

## Tools and actions

- `finance_list`, `finance_get` — the finance family's reads
  ([agent tools](agent-tools.md)), present for an agent whose sources
  include the Ramp source.
- No actions. Vocion never issues a card, approves, or pays.

## Connecting it

1. Ramp → Settings → Ramp Developer → **Create new app**.
2. Grant the **client credentials** grant and these read scopes only:
   `transactions:read reimbursements:read bills:read vendors:read users:read business:read`.
3. Paste the client ID and secret. **Test connection** gets a token and reads
   one record of each kind, saying which the app may and may not see.

A Ramp sandbox: set the source's API base URL (advanced) to
`https://demo-api.ramp.com`. A token is fetched per call and never cached
across workspaces. One Ramp account per workspace for now.

## Personal data

Cardholder and employee names, departments and memos reach the agent when it
asks for them, and stay in Ramp otherwise: nothing is stored or embedded.
Card numbers are never requested.

## Where it lives

| | |
|---|---|
| Provider | `packages/core/src/services/finance/providers/ramp.ts` |
| Connector (Test connection) | `packages/core/src/libs/sources/ramp.ts` |
| Credential | `ramp` in `packages/core/src/libs/platforms/registry.ts` |
