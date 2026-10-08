# Connecting a source at the vendor

A source that reads a third-party system needs that system's credential. Until
now every one of them was pasted: a person made a token somewhere else and typed
it into the connect dialog. For the vendors that offer an authorization flow,
Vocion now sends the person there instead: they click **Connect with Slack**,
approve at the vendor, and come back with the credential stored. Nothing is
pasted and the token never crosses the browser.

The mechanism is one pair of routes and one descriptor per vendor. This guide
is the mechanism; [login-apps.md](login-apps.md) says what to create at each
vendor and where its client ID and secret go.

## What a person sees

On `/dashboard/sources`, a source whose connector has a provider and whose
server is configured for it shows one button in its connect dialog, **Connect
with <vendor>**, in place of the paste form. When the server is not configured
for that vendor, the paste form stays and one line names the env vars the
server is missing, so the reason is never a mystery. After the vendor sends the
person back, the sources page says in one line whether it worked, and if not,
what to do.

Once connected, the connector's card says what the grant is on under
**Connected to**: the GitHub organization and the repositories the installation
covers, the Slack workspace, the Atlassian site. Where the source has its own
list (a `github` source's `repos`), each listed repository is marked against the
grant — read, or **not granted to the app** — and a repository the installation
covers that the source does not list is shown muted. A green card over a sync
that reads nothing was the failure this answers (Noco, 2026-09-30: the source
listed three repositories, the card said Connected, and nothing said which
repositories the installation actually held). Only names cross to the browser;
the token, installation id and secrets stay in the vault.

## How it works

```
person clicks Connect with Slack
  → GET /api/connect/slack/start?source=<slug>        (admin session)
      signs a state, 302 to the vendor's authorize URL
  → vendor: person approves
  → GET /api/connect/slack/callback?code=…&state=…
      verifies the state, exchanges the code, stores the credential on the
      source's install, forgets any pasted credential the source pointed at,
      303 to /dashboard/sources?connect=ok&source=<slug>
```

- **Start** is gated exactly like pasting a key: a signed-in workspace admin.
  It refuses a source the provider does not connect (a `strapi` source cannot
  start a Slack connect), and refuses with the env var names when the server
  is not configured. It also fails closed when `AUTH_SECRET` or
  `NEXT_PUBLIC_APP_URL` is unset: the callback URL is derived from the
  configured origin only, never from a request's Host header.
- **State** is `base64url(payload).hex(HMAC-SHA256(payload))`, keyed with
  `AUTH_SECRET`. The payload is `{ v: 1, provider, orgId, sourceSlug, userId,
  nonce, exp }` with a ten-minute expiry. The callback trusts nothing else:
  a state that fails its signature, is expired, names another provider, or
  names an org or a person other than the admin signed in is refused with a
  short code (`state_expired`, `wrong_workspace`, `wrong_person`, `not_admin`,
  `signed_out`), and no exchange is attempted.
- **Return path.** The start route also accepts `returnTo`, a `/dashboard`
  path (for example the chat the person was in). It is signed into the state,
  and the callback lands there with `connect`, `reason` and `source` appended
  to its own query. Anything that is not a plain `/dashboard` path (another
  host, a `//` or backslash, `..`, over 500 characters) is dropped at start and
  refused on verify, and the landing falls back to `/dashboard/sources`.
- **Exchange** is the provider's. It gets every query parameter but `state`
  and this deployment's callback URL, and returns either a credential bag
  with a display name, or a refusal reason.
- **Storage.** The bag is a row in the workspace credential store
  (`api_token`, `obtained_via = login`), encrypted under the workspace's key,
  with its account and a masked hint, so it shows on Developers and can be
  revoked there like a pasted key. The source points at it through
  `api_token_id`. One login serves every source of that connector.
- **PKCE.** A provider that asks for it (`pkce: true`, PostHog) gets a code
  challenge at start and the verifier at the callback. The verifier is
  derived from the signed state (`HMAC(AUTH_SECRET, 'pkce:' + state)`), so
  nothing is stored between the two.
- **Refresh.** A login whose tokens expire (`accessToken`, `refreshToken`,
  `expiresAt`) is refreshed by the sync that reads it, through
  `libs/connect/loginGrant.ts`. It refreshes from the refresh token stored
  now, not the one the run loaded, and saves compare-and-swap, so two syncs
  never fight over a rotated refresh token: the loser uses the winner's
  grant. A row shows Sync now or, for a connector that ingests nothing,
  Test connection. Apollo is the one such connector with a login, so
  re-testing a connected Apollo source renews an expiring login and saves it,
  like a sync (PostHog's inspect does the same when called with a
  `sourceId`). A renewal the test could not save fails the test. A test of
  values typed into a form has no row to save to, so it never refreshes,
  and says to save the connector and renew from its row. Jira's Atlassian
  grant is never refreshed by a test.
- **Only when set up.** The Connectors form and the chat card offer a login
  only when there is an app to run it on: the server's (its client ID in the
  env) or the workspace's own login app, saved on Developers. Otherwise they
  offer paste alone, rather than a button that can only fail.
- **Workspace login apps.** For Google, Slack, Atlassian, HubSpot, Notion, Zoom,
  Apollo, QuickBooks, Xero, Gusto, Dropbox and Box, a workspace admin can save the vendor's client ID and secret as
  a `<provider>-login-app` credential (`libs/connect/loginClient.ts`). A new
  login runs on it in preference to the server's. Each login records the
  client ID it ran on (`loginClientId`), and every refresh finds that same app
  again, since a refresh token only works with the client that issued it. A
  login whose app was replaced or removed asks for a new login
  (`login_app_changed`). Setup is in [login-apps.md](login-apps.md).
- **A login that lacks a connector's access is not reused for it.** One
  Google login can serve Gmail, Drive, Calendar and Analytics, but only for
  the scopes it was granted. Keeping a Drive login for Gmail is refused with a
  way to log in again, and the new login adds Gmail's scope to the old ones
  (`include_granted_scopes`).
- **After the login**, a connector that needs nothing more (Slack) gets its
  source from the callback (`createSourceWhenNoConfigNeeded`). One that needs
  picks (GitHub repos, a Jira site and project keys) lands back where the
  person started; in chat the agent asks for the picks and saves them with
  `source.connect`, on the Connectors page the form asks.
- **Landing** carries only `connect=ok|error`, a short `reason` code, and the
  source slug. A code, a token or free text from the vendor never reaches a
  URL or a log line; a vendor's refusal reaches the landing URL only as its
  short error code (`access_denied`, `invalid_code`), sanitized to
  `[a-z0-9_.-]`.

The callback URL a vendor must be told is:

```
https://<your-vocion-host>/api/connect/<provider>/callback
```

`<your-vocion-host>` comes from `NEXT_PUBLIC_APP_URL`, falling back to the
forwarded host of the request.

## Providers and their env

| Provider | Connects | Env vars | Callback to register |
|---|---|---|---|
| `slack` | `slack` | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | `/api/connect/slack/callback` |
| `atlassian` | `jira`, `confluence` | `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET` (one app; add the Confluence API's read scopes for Confluence) | `/api/connect/atlassian/callback` |
| `github` | `github` | `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY_BASE64` (plus `GITHUB_WEBHOOK_SECRET` for the app's webhook) | `/api/connect/github/callback` (the GitHub App's Setup URL) |
| `google` | `gmail`, `drive`, `google-calendar`, `ga4` | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | `/api/connect/google/callback` |
| `hubspot` | `hubspot` | `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET` | `/api/connect/hubspot/callback` |
| `notion` | `notion` | `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET` | `/api/connect/notion/callback` |
| `zoom` | `zoom` | `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` (a user-managed app; the server-to-server paste keeps working) | `/api/connect/zoom/callback` |
| `posthog` | `posthog` | None. `NEXT_PUBLIC_APP_URL` must be public `https`, because PostHog reads our client from `/api/connect-client/posthog` (CIMD). | `/api/connect/posthog/callback` |
| `apollo` | `apollo` | `APOLLO_CLIENT_ID`, `APOLLO_CLIENT_SECRET` | `/api/connect/apollo/callback` |
| `quickbooks` | `quickbooks` | `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET` | `/api/connect/quickbooks/callback` |
| `xero` | `xero` | `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET` | `/api/connect/xero/callback` |
| `gusto` | `gusto` | `GUSTO_CLIENT_ID`, `GUSTO_CLIENT_SECRET` | `/api/connect/gusto/callback` |
| `dropbox` | `dropbox` | `DROPBOX_CLIENT_ID`, `DROPBOX_CLIENT_SECRET` (a pasted refresh token with its app key and secret keeps working) | `/api/connect/dropbox/callback` |
| `box` | `box` | `BOX_CLIENT_ID`, `BOX_CLIENT_SECRET` (pasted Client Credentials Grant keeps working) | `/api/connect/box/callback` |

All of them are optional. A provider with no env set is not offered, and its
connector keeps its paste form. Step-by-step setup for each vendor's app is in
[login-apps.md](login-apps.md).

Before going live with each vendor:

- **Google.** Gmail and Drive read scopes are restricted: Google verifies the
  app, with a security assessment, before workspaces outside the app's own
  Google Workspace can use them. While the app's publishing status is
  "Testing", Google expires every refresh token it issues after 7 days, so each
  Google login stops working a week after it was made and the person sees "An
  admin needs to log in with Google again". Move the app to "In production"
  before customers use it.
- **Zoom.** Add the scopes listed on the Zoom connector to the Marketplace
  app, plus their `:admin` variants so admins can read every user's
  recordings. Zoom sends no scope in the login URL.
- **Apollo.** Apollo approves partner OAuth apps before issuing a client ID.
  Confirm the scopes (`read_user_profile`, `app_scopes`) against the app
  Apollo registers.
- **PostHog.** Local dev needs a public `https` tunnel set as
  `NEXT_PUBLIC_APP_URL`.
- **Notion.** Register a public integration with read content only.
- **QuickBooks.** Intuit reviews a production app before real companies can
  connect; a development app connects sandbox companies only. QuickBooks is
  login-only: Intuit has no API key and rotates the refresh token, so there
  is no paste form. Setup is in [quickbooks.md](quickbooks.md).
- **Xero.** Without an app, paste a custom connection's client ID and secret
  instead; it reads the one organisation it was authorised for. Setup is in
  [xero.md](xero.md).
- **Gusto.** Login-only, like QuickBooks: Gusto issues no API key and each
  refresh token works once. Setup is in [gusto.md](gusto.md).

Sentry has no login: its install redirect does not carry our signed `state`,
so the callback cannot tell which workspace and admin started it. Paste a
Sentry auth token instead.

## Adding a provider

One file under `packages/core/src/libs/connect/providers/`, exporting a
`ConnectProvider` (`libs/connect/provider.ts`): its id, the connector slugs it
serves, the env it needs, `authorizeUrl`, `exchange` and `summarize` — the
last reads the bag `exchange` stored and returns the account it is on and what
it granted, by name, for the card's **Connected to**; null for a bag it did not
store, never a token. Register it in `libs/connect/registry.ts`. The routes,
the state, the storage and the dialog need no change. A provider never logs the state, the code or a token, and its
refusal reasons are short codes a person can be shown.

## What it does not do, yet

- **Revoke at the vendor.** Revoking a credential in Vocion stops Vocion using
  it; it does not uninstall the app at the vendor.
- **Several accounts of one connector**, told apart by the vendor's username
  or email (#1173).

## Several systems at once

To connect several systems in one go, ranked from what the workspace already
uses and checked as they connect, see [Connect your systems](./connect-your-systems.md).
