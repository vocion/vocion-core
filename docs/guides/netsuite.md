# NetSuite

**TL;DR.** Paste NetSuite **token-based authentication** — the account ID,
an integration's consumer key and secret, an access token's ID and secret —
on the Connectors page or from the card an agent offers in chat. Invoices,
bills and customer payments become searchable documents; agents given the
source also read customers, vendors and accounts live. Read-only. Works
today: no OAuth app needed.

## What it reads

Every read is one SuiteQL query (`POST /services/rest/query/v1/suiteql`).

| Record (`kind`) | NetSuite | Synced as documents | Filters that apply |
|---|---|---|---|
| `invoice` | `transaction` type `CustInvc`, lines from `transactionline` | yes | text (number or customer), status, customer id, dates |
| `bill` | `transaction` type `VendBill` | yes | text, status, vendor id, dates |
| `payment` | `transaction` type `CustPymt` | yes | text, status, customer id, dates |
| `customer` | `customer` | no, live | text (name, entity id, email), active/inactive |
| `vendor` | `vendor` | no, live | text, active/inactive |
| `account` | `account` | no, live | text (name or number), active/inactive |

Amounts are in the transaction's currency (`foreigntotal`,
`foreignamountremaining`). Every record links to its page on
`<account>.app.netsuite.com`. Queries are built only from values Vocion
controls: text is escaped, dates must be ISO, ids must be digits.

**Syncing.** Incremental on `lastmodifieddate`; a daily full sync (04:00)
prunes deleted transactions.

## Tools and actions

- `finance_list`, `finance_get` — the finance family's reads, for an agent
  whose sources include the NetSuite source.
- No write actions.

## Connecting it

1. Enable **Token-Based Authentication**, **REST Web Services** and
   **SuiteAnalytics Workbook** (Setup → Company → Enable Features →
   SuiteCloud).
2. Make a role with read-only (View) permissions on customers, vendors,
   transactions and accounts, plus REST Web Services and Log in using Access
   Tokens. Give it to a dedicated integration user.
3. Setup → Integration → Manage Integrations → New, Token-Based
   Authentication on: copy the **consumer key and secret**.
4. Setup → Users/Roles → Access Tokens → New, for that user, role and
   integration: copy the **token ID and secret**.
5. Paste them with the **account ID** (Setup → Company → Company
   Information; a sandbox looks like `1234567_SB1`). **Test connection**
   runs one read of each kind.

Every request is signed with OAuth 1.0a HMAC-SHA256; nothing expires on
Vocion's side. One NetSuite account per workspace for now.

## Personal data

Customer and vendor names and emails are read live; transactions carry the
party's name. Nothing beyond what the role can view is ever asked for.

## Where it lives

| | |
|---|---|
| Provider and signer | `packages/core/src/services/finance/providers/netsuite.ts` |
| Connector (sync, Test connection) | `packages/core/src/libs/sources/netsuite.ts` |
| Credential | `netsuite` in `packages/core/src/libs/platforms/registry.ts` |
