# QuickBooks Online as a knowledge source

**TL;DR.** Add the **QuickBooks Online** connector and log in with QuickBooks.
The company's chart of accounts, invoices, bills, payments received, bill
payments and journal entries become documents an agent can search and cite:
one per record, written the way a bookkeeper reads it, with the numbers on
metadata. It is read-only. To try it before anyone has an Intuit app, turn on
**Use sample data**: a fictional company, no login, every document labelled
as sample.

## What lands in search

One document per record, keyed `quickbooks:<company id>:<type>:<QuickBooks id>`.

| QuickBooks entity | Document type | What its text says |
|---|---|---|
| Account | `account` | Number, name, classification and type, balance with the date QuickBooks last changed it |
| Invoice | `invoice` | Number, customer, date and due date, total, what is still owed (paid in full, partly paid, unpaid), each line, the customer message and private note |
| Bill | `bill` | The same, from the vendor's side |
| Payment | `payment` | Who paid, when, how much, the reference, the account it went into, and the invoices it settled |
| BillPayment | `bill-payment` | Who was paid, when, from which account, and the bills it settled |
| JournalEntry | `journal-entry` | Number, date, memo, and each debit and credit by account |

Every document's text starts with the company (`QuickBooks · Larkfield
Systems`), so an answer drawn from it names whose books it came from. A
document links back to the record in QuickBooks (`uri`), so a claim is checked
in one click. The fields an agent sums or filters on are on metadata:
`objectType`, `quickbooksId`, `realmId`, `company`, `docNumber`, `txnDate`,
`dueDate`, `customer` / `vendor`, `total`, `balance`, `status`, `currency`,
`appliedTo` (on a payment: `[{ type, id, docNumber? }]`) and `lastUpdatedAt`.

"Overdue" is never written into a document: it depends on today, and a
document is read later than it was written. The due date and the balance are
there; the agent compares them with the date it is told on every turn.

A payment names the invoice or bill it settled by number when the same sync
read that invoice or bill. An incremental sync that read only the payment
names it by QuickBooks id instead; the link on metadata is the same either
way, and the next full sync fills the number in.

## Connecting it

QuickBooks connects by login only. Intuit issues no API key, and it rotates
the refresh token a login holds (a new one replaces the old one, which stops
working), so a token pasted by hand would be dead within a day. The login keeps
the newest token itself.

1. **Set up an Intuit app** once per deployment (below).
2. On `/dashboard/connectors`, add **QuickBooks Online** and press **Log in
   with QuickBooks**. On Intuit's page, pick the company and approve read
   access to its books (`com.intuit.quickbooks.accounting`).
3. That is all: the login makes the source and the first sync starts.

**One login is one company.** A firm that keeps its books in several companies
(one per legal entity) logs in once per company; each login is its own
credential, named `<company> (company <id>)`, and each source reads the
company it is linked to. Logging in again to the same company refreshes that
login in place.

**Sandbox or production** is worked out at login: Vocion asks the production
API for the company first and the sandbox API second, and records which one
answered. A development app on Intuit connects sandbox companies only; a
production app connects real ones.

### The Intuit app

- **Create it** at the [Intuit Developer portal](https://developer.intuit.com/app/developer/dashboard)
  with the **Accounting** scope.
- **Redirect URI.** `<NEXT_PUBLIC_APP_URL>/api/connect/quickbooks/callback`,
  on the Development keys for a sandbox and on the Production keys for real
  companies. Intuit only accepts `https` redirect URIs on Production keys.
- **Save it.** The server's env as `QUICKBOOKS_CLIENT_ID` and
  `QUICKBOOKS_CLIENT_SECRET`, or a workspace's own **QuickBooks login app** on
  the Developers page (no redeploy; see [login-apps.md](login-apps.md)).
- **Before real companies connect**, Intuit reviews a production app
  (questionnaire, privacy policy and EULA URLs, and its "Connect to
  QuickBooks" button guidelines). Start that early.

Access tokens last an hour; each sync refreshes an expiring one and saves the
new pair, compare-and-swap, so two syncs never fight over a rotated token (the
mechanism is in [connect.md](connect.md#how-it-works)). Intuit caps a refresh
token's life at five years; a refused one tells an admin to log in with
QuickBooks again.

## Sample data

Turn on **Use sample data** on the source (`sample: true`) and it reads a
fictional company, Larkfield Systems, held in Vocion itself: eight accounts,
five invoices (paid, partly paid and unpaid), three bills, payments both ways
and two journal entries, dated August to October 2026. No login, no Intuit
app, no outbound call.

The sample goes through exactly the mapping real books do, so what an agent
does with it is what it will do with the real company. Every sample document
says what it is three times: the title starts `Sample ·`, the text starts
`… · sample data, not real books`, and metadata carries `sample: true` and
`realmId: sample`. None of them links into QuickBooks.

Turning sample data off and logging in moves the source to the real books; the
sample documents are pruned by the next full sync, since the real company
never yields them.

## Syncing

- **Incremental** syncs ask QuickBooks only for records whose
  `Metadata.LastUpdatedTime` is at or after the last sync.
- **A daily full sync** (03:30, the connector's reconcile schedule) re-reads
  everything, which is how a deleted or merged record leaves search; an
  incremental query never sees a deletion.
- **Pages** of 1,000 rows, QuickBooks' own ceiling.
- **Failures say who fixes them.** A refused login (401) or a rate limit
  (429) ends the run with that sentence. An entity this login may not read
  (403, for example a QuickBooks user without access to bills) is reported and
  the rest of the books still sync, and a run that reported an error never
  prunes documents.

## Configuration

| Field | Default | What it does |
|---|---|---|
| `sample` | `false` | Read the fictional sample company, with no login. |
| `baseUrl` | the login's environment | Override the API host. Leave it unset. |

```yaml
# sources/books.yaml
slug: books
name: QuickBooks — Larkfield Systems
kind: quickbooks
config:
  sample: true # until the Intuit app is approved; then remove and log in
```

## What it does not do, yet

- **Write.** Nothing is created or changed in QuickBooks. Writes would be
  actions on the review queue, like every other connector write.
- **Reports.** Profit and loss, balance sheet and aged receivables are
  QuickBooks reports, not entities; they are not synced. An agent can sum the
  invoice and bill documents' metadata, which is what those reports are made of.
- **Customers, vendors and items** as documents of their own. They appear by
  name on every transaction that mentions them.
- **QuickBooks Desktop.** Online only.

## Where it lives

| | |
|---|---|
| Connector and mapping | `packages/core/src/libs/sources/quickbooks.ts` |
| The query client | `packages/core/src/libs/quickbooks/client.ts` |
| The sample company | `packages/core/src/libs/quickbooks/sampleCompany.ts` |
| The login | `packages/core/src/libs/connect/providers/quickbooks.ts` |
| The credential platform | `quickbooks` and `quickbooks-login-app` in `packages/core/src/libs/platforms/registry.ts` |
| Tests | `quickbooks.test.ts` beside each of the above |
