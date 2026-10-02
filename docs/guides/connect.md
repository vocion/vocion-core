# Connecting a source at the vendor

A source that reads a third-party system needs that system's credential. Until
now every one of them was pasted: a person made a token somewhere else and typed
it into the connect dialog. For the vendors that offer an authorization flow,
Vocion now sends the person there instead: they click **Connect with Slack**,
approve at the vendor, and come back with the credential stored. Nothing is
pasted and the token never crosses the browser.

The mechanism is one pair of routes and one descriptor per vendor. This guide
is the mechanism; each vendor's guide says what to create on its side.

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
- **Storage** is `storeCredentialForSource`: the bag is AES-256-GCM encrypted
  under the workspace's key and attached to the workspace's install of the
  **connector** (`config._connector`), the same row a pasted token lands in
  and the row sync resolves. One grant serves every source of that kind in
  the workspace: connect Slack once and every `slack` source reads with it.
  If the source that started the connect had been pointed at a pasted
  workspace credential, that link is cleared so the grant is what resolves.
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
| `slack` | the `slack` source | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | `/api/connect/slack/callback` |
| `atlassian` | the `jira` source | `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET` | `/api/connect/atlassian/callback` |
| `github` | the `github` source | `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY_BASE64` (plus `GITHUB_WEBHOOK_SECRET` for the app's webhook) | `/api/connect/github/callback` (the GitHub App's Setup URL) |

All of them are optional. A deployment that sets none keeps the paste forms
it had. The Atlassian and GitHub providers land in their own pull requests;
until then their entries answer "not configured".

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

- **Refresh.** A provider whose access tokens expire (Atlassian) stores what it
  needs to refresh; the connector reading it is what refreshes. Slack bot
  tokens do not expire unless token rotation is switched on for the app, which
  this flow does not request.
- **Revoke at the vendor.** Revoking a credential in Vocion stops Vocion using
  it; it does not uninstall the app at the vendor.
- **Workspace-level grants.** The credential lands on the connector's install,
  as Google's grant does today, not on the workspace credential list, so it
  is not rotated or revoked from API credentials.
