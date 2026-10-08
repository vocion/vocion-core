# Finance and HR systems

**TL;DR.** Two connector families, named for what they are rather than who
sells them. An agent given a **finance** source reads customers, invoices,
bills, payments and spend with `finance_list` / `finance_get`; one given an
**HR** source reads workers, departments, time off and pay-run totals with
`people_list` / `people_get`. Everything is read live with the workspace's own
credential, nothing moves money, and personal data never reaches an agent.

| Family | Vendors | Tools | Writes |
|---|---|---|---|
| `finance` | [Stripe](stripe.md), [QuickBooks](quickbooks.md), [Xero](xero.md), [NetSuite](netsuite.md), [Ramp](ramp.md), [BILL](bill.md) | `finance_list`, `finance_get` | `finance.draft_invoice` (Stripe), Undo deletes the draft |
| `people` | [Gusto](gusto.md), [Rippling](rippling.md), [Workday](workday.md) | `people_list`, `people_get` | none |

## Turning one on from chat

Ask an agent ("connect our Stripe"); it calls `offer_connection`, which puts
the connector's own card in chat — a login button for Xero, Gusto and
QuickBooks when an OAuth app is set up, otherwise the paste form for the
vendor's key — and the person lands back in the conversation. Nothing in
chat or the UI names a vendor: the card is built from the platform's
descriptor in `libs/platforms/registry.ts`. The agent's reads appear once the
source is in its `connectorSources` (and the person's source access allows it).

## Which works today, and which needs an OAuth app

| Vendor | Credential | Works without an OAuth app? | Env for its OAuth app |
|---|---|---|---|
| Stripe | restricted key | yes | — |
| Xero | login, or a custom connection's client ID and secret | yes (custom connection) | `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET` |
| NetSuite | token-based auth (5 values) | yes | — |
| Ramp | developer app client ID and secret (client credentials) | yes | — |
| BILL | API user, organization ID, developer key | yes (`BILL_DEV_KEY` or the org's own key) | — |
| QuickBooks | login only | no | `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET` |
| Gusto | login only | no | `GUSTO_CLIENT_ID`, `GUSTO_CLIENT_SECRET` |
| Rippling | API token | yes | — |
| Workday | integration system user + RaaS reports | yes | — |

Redirect URIs are `<NEXT_PUBLIC_APP_URL>/api/connect/<xero|gusto|quickbooks>/callback`.
A workspace can bring its own app as a `<vendor>-login-app` credential instead
of the server's env ([login-apps.md](login-apps.md)).

Each platform is **one credential per workspace** for now (`one-live`):
holding two Stripe accounts or two Xero organisations needs the credential
index widened by a migration, which no workspace has needed yet.

## Whose key a call spends

Every read resolves the source's own credential per call
(`services/finance/provider.ts`, `services/people/provider.ts`): the stored
credential the source names, else its install's login, decrypted under that
org's key. No client or token is cached between calls, so a second org never
sees the first org's key — `provider.test.ts` runs two orgs in sequence and
checks each sent its own. A login whose access token is expiring is renewed
and saved back to the source's row (compare-and-swap on the refresh token).

## Records

A finance record is one shape from every vendor: `kind`, `id`, `number`,
`title`, `party` (the customer or vendor), `status` (the vendor's own word),
`amount`, `currency`, `balance` (still owed), `date`, `dueDate`, `url` (into
the vendor, when it has a stable link), and on `finance_get` the `lines`.
Amounts are in major units. A filter a vendor cannot apply is returned as
`ignored`, so the agent knows the list is wider than it asked.

Xero, NetSuite and QuickBooks also **sync** invoices, bills and payments into
search (incremental on the vendor's last-modified time, a daily full pass to
prune deletions), through one mapping (`services/finance/documents.ts`) that
never writes "overdue" into text. Stripe, Ramp and BILL are read live only.

## Personal data

- **HR systems are never synced or embedded.** Worker data is read live and
  returned only through an allowlist (`services/people/types.ts`): name, job
  title, department, manager, work email, employment type, work location as a
  city or site name, start and end dates, status. Government ids, dates of
  birth, home addresses, personal emails and phones, bank accounts and any one
  person's pay have no field to land in, and `people.test.ts` feeds every
  provider a vendor answer that carries them and checks none comes out.
  Pay runs come back as company-wide totals only.
- **Ask for least access at the vendor too.** Each connector's credential help
  says which read scopes to grant (Rippling: untick personal fields; Workday:
  put only work fields in the report), so the data is not even sent.
- **Finance records** carry business contacts (a customer's name and billing
  email) when an agent asks; card numbers and bank details are not returned by
  these APIs to read-only credentials, and nothing here asks for them.
- **No writes to HR systems, and no money moves.** The only write in either
  family is a Stripe draft invoice, which is never sent or charged and which
  Undo deletes.

## Where it lives

| | |
|---|---|
| Families | `packages/core/src/libs/connectors/families.ts` |
| Finance shape, resolution, sync | `packages/core/src/services/finance/` |
| People shape and resolution | `packages/core/src/services/people/` |
| Tools | `services/agents/tools/financeTools.ts`, `peopleTools.ts` |
| Action | `libs/actions/finance-draft-invoice.ts` |
| HTTP and Test connection helpers | `libs/connectors/vendorHttp.ts`, `inspectByListing.ts` |
