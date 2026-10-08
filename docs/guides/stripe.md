# Stripe

**TL;DR.** Paste a Stripe **restricted key** on the Connectors page (or tap
the card an agent offers in chat). Agents given the source can read
customers, invoices, subscriptions, payments and payouts live, and can
prepare a **draft** invoice that is never sent or charged. Works today: no
OAuth app needed.

## What it reads

Read live, never synced: what a customer owes or whether a payout landed is
only true as of the moment it is asked, and a mirror would copy customers'
contact details into the index for nothing.

| Record (`kind`) | Stripe object | Filters that apply |
|---|---|---|
| `customer` | Customer | text (name or email, Search API), dates |
| `invoice` | Invoice, with lines on `finance_get` | text (invoice number), status, customer, dates |
| `subscription` | Subscription (customer expanded) | status (all by default), customer, dates |
| `payment` | Charge | customer, dates |
| `payout` | Payout | status, dates |

Amounts come back in major units (dollars, not cents; zero-decimal
currencies as they are). Every record links to the Stripe dashboard (the
test dashboard for a test-mode key). A filter Stripe cannot apply to a kind
is listed as `ignored`, so the agent knows the list is wider than asked.

## Tools and actions

- `finance_list`, `finance_get` — the finance family's reads
  ([agent tools](agent-tools.md)); present for an agent whose sources
  include the Stripe source.
- `finance.draft_invoice` — creates the invoice with `auto_advance: false`
  and `collection_method: send_invoice`, one invoice item per line; nobody
  is sent anything. **Undo** deletes the draft; if someone has since
  finalized it, Undo leaves it alone and says to void it in Stripe.
  Needs Invoices: Write on the key; without it the action fails with
  Stripe's 403 sentence and nothing is left behind.

## Connecting it

1. Stripe dashboard → Developers → API keys → **Create restricted key**.
2. Read on Customers, Invoices, Subscriptions, Payouts, Charges and
   PaymentIntents. Add Invoices: Write only for draft invoices.
3. Paste the `rk_live_…` key. **Test connection** reads one record of each
   kind and says which the key may and may not see.

A secret key (`sk_…`) is accepted but reads and changes everything; Test
connection says so. One Stripe account per workspace for now.

## Personal data

Customer names and emails reach the agent when it asks for them, and stay
in Stripe otherwise: nothing is stored or embedded. Card numbers and bank
details are not returned by Stripe's API to a key like this one.

## Where it lives

| | |
|---|---|
| Provider | `packages/core/src/services/finance/providers/stripe.ts` |
| Connector (Test connection) | `packages/core/src/libs/sources/stripe.ts` |
| Draft invoice | `packages/core/src/libs/actions/finance-draft-invoice.ts` |
| Credential | `stripe` in `packages/core/src/libs/platforms/registry.ts` |
