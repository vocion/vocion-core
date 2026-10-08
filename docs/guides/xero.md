# Xero

**TL;DR.** Log in with Xero, or paste a Xero **custom connection** (client ID
and secret), on the Connectors page or from the card an agent offers in
chat. Invoices, bills and payments become searchable documents; agents given
the source also read customers, vendors and accounts live. Read-only.

## What it reads

| Record (`kind`) | Xero | Synced as documents | Filters that apply |
|---|---|---|---|
| `invoice` | Invoices, `Type` ACCREC | yes | text (number, reference), status, contact, dates |
| `bill` | Invoices, `Type` ACCPAY | yes | text, status, contact, dates |
| `payment` | Payments | yes | status, dates |
| `customer` | Contacts with `IsCustomer` | no, live | text, status |
| `vendor` | Contacts with `IsSupplier` | no, live | text, status |
| `account` | Chart of accounts | no, live | text (name or code), status |

Amounts are in the organisation's currency, as Xero states them. Invoices,
bills and contacts link to `go.xero.com`, which opens them in the
organisation the person is signed into. A filter Xero cannot apply to a kind
comes back as `ignored`.

**Syncing.** Incremental syncs send `If-Modified-Since` with the last
watermark; a daily full sync (03:45) prunes deleted and voided records,
which an incremental read never sees. A kind the login may not read is
reported and the rest still sync.

## Tools and actions

- `finance_list`, `finance_get` — the finance family's reads, for an agent
  whose sources include the Xero source.
- No write actions. The login asks for read-only scopes, so nothing can be
  created, approved or paid.

## Connecting it

**Log in with Xero** (needs an OAuth app):

1. Create a Web app at [developer.xero.com](https://developer.xero.com/app/manage).
2. Redirect URI: `<NEXT_PUBLIC_APP_URL>/api/connect/xero/callback`.
3. Save its client ID and secret as `XERO_CLIENT_ID` and
   `XERO_CLIENT_SECRET` in the server's env, or as the workspace's own
   **Xero login app** on the Developers page (no redeploy; see
   [login-apps.md](login-apps.md)).
4. The login asks for `openid profile email offline_access
   accounting.transactions.read accounting.contacts.read
   accounting.reports.read accounting.settings.read`, and keeps the first
   organisation the person picked (`tenantId`; override with the source's
   advanced **Organisation ID**). Xero rotates the refresh token on every
   renewal; each renewal is saved compare-and-swap.

**Paste a custom connection** (no OAuth app, works today): a Xero custom
connection (developer.xero.com → New app → Custom connection) with the read
scopes, authorised by the organisation's admin. Paste its client ID and
secret; Vocion mints a 30-minute token per call with the client-credentials
grant and stores nothing else. Custom connections are a paid Xero feature in
some regions.

One Xero organisation per workspace for now.

## Personal data

Contact names and email addresses are synced only as they appear on
invoices, bills and payments (the party's name); contacts themselves are
read live and not stored.

## Where it lives

| | |
|---|---|
| Provider | `packages/core/src/services/finance/providers/xero.ts` |
| Connector (sync, Test connection) | `packages/core/src/libs/sources/xero.ts` |
| Login | `packages/core/src/libs/connect/providers/xero.ts` |
| Credential | `xero` and `xero-login-app` in `packages/core/src/libs/platforms/registry.ts` |
