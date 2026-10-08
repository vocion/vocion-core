# BILL

**TL;DR.** Paste a BILL (bill.com) **API user's sign-in and organization ID**
on the Connectors page (or tap the card an agent offers in chat). Agents given
the source read bills — with their approval and payment status — vendors,
invoices and customers live. Read-only. Works today: no OAuth app needed.

## What it reads

Read live, never synced: whether a bill is approved, scheduled or paid is
only true as of the moment it is asked.

| Record (`kind`) | BILL object | Notes |
|---|---|---|
| `bill` | Bill (payables), lines on `finance_get` | `status` is the payment status; `details.approvalStatus` the approval |
| `vendor` | Vendor | balance, email |
| `invoice` | Invoice (receivables), lines on `finance_get` | total and amount still due |
| `customer` | Customer | balance, email |

Amounts are in major units. BILL documents no stable per-record link, so
records have no `url`. Filters are not applied on BILL's side yet: every
one asked for is listed as `ignored`, so the agent knows the list is wider.

## Tools and actions

- `finance_list`, `finance_get` — the finance family's reads
  ([agent tools](agent-tools.md)), present for an agent whose sources
  include the BILL source.
- No actions. Vocion never pays, approves or sends anything.

## Connecting it

1. In BILL, make a dedicated API user with a read-only role that can see
   bills, vendors, invoices and customers.
2. Settings → Sync & Integrations → **Manage Developer Keys**: copy the
   organization ID, and the developer key unless this server sets
   `BILL_DEV_KEY`.
3. Paste the user's email, password, organization ID (and developer key).
   **Test connection** signs in and reads one record of each kind.

Vocion signs in once per call (`POST /login`) and sends `devKey` and
`sessionId` on each read; no session is kept or shared. A BILL sandbox
organization: turn on **BILL sandbox** (advanced). The developer key is the
workspace's own when its credential has one, else the server's
`BILL_DEV_KEY`. One BILL organization per workspace for now.

## Personal data

Vendor and customer names and emails reach the agent when it asks for them,
and stay in BILL otherwise: nothing is stored or embedded. Bank details are
never requested.

## Where it lives

| | |
|---|---|
| Provider | `packages/core/src/services/finance/providers/bill.ts` |
| Connector (Test connection) | `packages/core/src/libs/sources/bill.ts` |
| Credential | `bill` in `packages/core/src/libs/platforms/registry.ts` |
| Server developer key | `BILL_DEV_KEY` in `packages/core/src/libs/Env.ts` |
