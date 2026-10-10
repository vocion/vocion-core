# QuickBooks Online as a knowledge source

**TL;DR.** Add the **QuickBooks Online** connector and log in with QuickBooks.
The company's chart of accounts, invoices, bills, payments received, bill
payments, card and bank expenses and journal entries become documents an agent
can search and cite: one per record, written the way a bookkeeper reads it,
with the numbers on metadata. Agents also run its profit and loss and balance
sheet live, and can propose two changes to the books (move an expense line to
another account, post a journal entry), each waiting for a person's approval
and each with Undo; neither moves money. To try it before anyone has an
Intuit app, turn on **Use sample data**: a fictional company, no login, every
document labelled as sample, and nothing written.

## What lands in search

One document per record, keyed `quickbooks:<company id>:<type>:<QuickBooks id>`.

| QuickBooks entity | Document type | What its text says |
|---|---|---|
| Account | `account` | Number, name, classification and type, balance with the date QuickBooks last changed it |
| Invoice | `invoice` | Number, customer, date and due date, total, what is still owed (paid in full, partly paid, unpaid), each line, the customer message and private note |
| Bill | `bill` | The same, from the vendor's side |
| Payment | `payment` | Who paid, when, how much, the reference, the account it went into, and the invoices it settled |
| BillPayment | `bill-payment` | Who was paid, when, from which account, and the bills it settled |
| Purchase | `purchase` | A card charge, check or bank expense: the payee, the date, the amount, the account it was paid from, and each line with the account it is coded to |
| JournalEntry | `journal-entry` | Number, date, memo, and each debit and credit by account |

Every document's text starts with the company (`QuickBooks · Larkfield
Systems`), so an answer drawn from it names whose books it came from. A
document links back to the record in QuickBooks (`uri`), so a claim is checked
in one click. The fields an agent sums or filters on are on metadata:
`objectType`, `quickbooksId`, `realmId`, `company`, `docNumber`, `txnDate`,
`dueDate`, `customer` / `vendor`, `total`, `balance`, `status`, `currency`,
`appliedTo` (on a payment: `[{ type, id, docNumber? }]`), on a purchase
`paymentType` (`CreditCard`, `Check`, `Cash`), `account` (paid from) and
`accounts` (the accounts its lines are coded to), and `lastUpdatedAt`.

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
   with QuickBooks**. On Intuit's page, pick the company and approve access
   to its books (`com.intuit.quickbooks.accounting`). Intuit has one scope
   for reading and writing the books; Vocion writes only through the two
   approved actions below.
3. That is all: the login makes the source and the first sync starts.

**One login is one company, and one company per workspace for now.** The
`quickbooks` credential is one-live: logging in to a second company replaces
the first login. Holding several companies (one per legal entity) needs the
credential index widened by a migration, which PR #1224 carries. Logging in
again to the same company refreshes that login in place.

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
fictional company, Larkfield Systems, held in Vocion itself: eleven accounts
(a company card among them), five invoices (paid, partly paid and unpaid),
three bills, payments both ways, four card charges (Anthropic, Loom, Apple,
Google; the Apple laptop is coded to Marketing, a miscoding left in on
purpose) and two journal entries, dated August to October 2026. No login, no
Intuit app, no outbound call.

Its statements are summed from those same rows, so they agree with what it
lists: the profit and loss adds the invoices, bills, card charges and journal
lines dated in the period (by total or by month), and the balance sheet is the
accounts' balances on 2026-10-01, whatever date is asked, with equity as
assets less liabilities. The report says both in its `notes`.

The sample is read-only. Both writes refuse on it with a sentence that says
so; nothing is pretended.

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

## Agent tools

Agents given the source also read the books live through the finance
family's tools, with the source's own login:

- `finance_list`: customers, vendors, invoices, bills, payments received,
  card and bank expenses (`kind=transaction`) and accounts, filtered by text
  (name, or an invoice or bill number), status (`open`, `paid`, `active`,
  `inactive`), customer or vendor id and dates; each record with its link
  into QuickBooks.
- `finance_get`: one record whole. An invoice or bill with its lines; an
  expense with each line's id and the account it is coded to (`accountId`,
  `accountName`), which is what a recategorization names.
- `finance_report`: the profit and loss (`start`, `end`) or the balance sheet
  (as of `end`), run by QuickBooks itself (`/reports/ProfitAndLoss`,
  `/reports/BalanceSheet`), by total or split by month, class or customer,
  accrual or cash. It comes back as sections, account lines with an amount
  per column, section totals and the bottom lines (Net Income, Total Assets),
  and leads with how many sections, lines and columns it holds.

With sample data on, they read the sample company's invoices, bills,
payments, card charges and accounts, and its statements.

## Changes to the books

Two writes, both actions on the review queue. An agent proposes; a person
approves (`approvalRequired`, at any autonomy); Undo puts the books back.
Neither moves money: no payment is made, nothing is sent to a customer or a
vendor. They change what the books say, which is why a person approves each one.

- `finance.recategorize_expense` moves one line of a card or bank expense to
  another account (`expenseId`, `lineId`, `toAccountId`, `reason`). Vocion reads
  the expense for its current `SyncToken` and sends a sparse update with every
  line back as it was and that one line recoded, since QuickBooks replaces the
  line array whole. A line coded to an item rather than an account is refused.
  The run records the account the line came from; Undo re-reads the expense and
  moves the line back, and only if it is still on the account this run put it
  on, so a later correction by a person is left alone. Risk tier `medium`.
- `finance.post_journal_entry` posts a journal entry (`date`, `memo`, `lines`
  of `accountId` with a `debit` or a `credit`, optional `description`,
  `className`, `customerId`, and a `reason`). It is refused before anything is
  queued unless every line is a debit or a credit above zero, never both, and
  debits equal credits to the cent. A class is named as it reads in the books
  and looked up before posting. Undo deletes the entry at its current
  `SyncToken`. Risk tier `high`.

QuickBooks has no draft state for an invoice, so `finance.draft_invoice` is
not offered here. A write that QuickBooks refuses (a stale `SyncToken`, a
closed period) fails with Intuit's own reason and writes nothing; a write is
never retried.

## What it does not do, yet

- **Other writes.** Invoices, bills, payments and anything that moves money
  are not created or changed. The two writes above are the whole list.
- **Statements in search.** Profit and loss and balance sheet are run live by
  `finance_report`, never synced; aged receivables is not offered yet.
- **Customers, vendors and items** as documents of their own. They appear by
  name on every transaction that mentions them.
- **QuickBooks Desktop.** Online only.

## Where it lives

| | |
|---|---|
| Connector and mapping | `packages/core/src/libs/sources/quickbooks.ts` |
| The query client | `packages/core/src/libs/quickbooks/client.ts` |
| The sample company and its statements | `packages/core/src/libs/quickbooks/sampleCompany.ts` |
| Live reads, statements and writes | `packages/core/src/services/finance/providers/quickbooks.ts` |
| The two actions | `packages/core/src/libs/actions/finance-recategorize-expense.ts`, `finance-post-journal-entry.ts` |
| The login | `packages/core/src/libs/connect/providers/quickbooks.ts` |
| The credential platform | `quickbooks` and `quickbooks-login-app` in `packages/core/src/libs/platforms/registry.ts` |
| Tests | `quickbooks.test.ts` beside each of the above |
