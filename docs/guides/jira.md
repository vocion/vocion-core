# Jira

The `jira` source mirrors the projects and issues of a Jira Cloud site into
the knowledge index: key, summary, status and description, hourly by default,
opt-in per project key. Two ways to connect it.

## Connect with Atlassian

On the source's page, **Connect with Atlassian** sends the person to
`auth.atlassian.com`. They sign in to their Atlassian account, see the three
scopes below, and consent once. They come back to the source with the grant
stored in the workspace's vault; connecting clears any pasted-credential link
the source had, so the grant is what the next sync uses.

| Scope | For |
|---|---|
| `read:jira-work` | projects and issues |
| `read:jira-user` | the assignee on an issue |
| `offline_access` | the refresh token, so the grant outlives the hour |

What is stored: the access token, the refresh token, when the access token
expires, and every Jira Cloud site the account reaches. The person's Atlassian
password is never seen; the token goes out as `Authorization: Bearer` to
`api.atlassian.com`, nowhere else.

**One consent, several sites.** An Atlassian account can be a member of more
than one site. The grant keeps all of them, and at sync time the connector
uses the site whose URL is the source's `baseUrl`. A grant that reaches none of
them fails naming the sites it does reach, so the fix is either the `baseUrl`
or the account, and the message says which.

**The refresh token rotates.** Atlassian issues a new refresh token on every
refresh and retires the old one. The connector treats the access token as
expired five minutes before Atlassian does, refreshes then (or once, when a
request answers 401), and saves what comes back before it does anything else.

Every Jira source in a workspace shares one stored grant, so two sources
syncing at once could both refresh from the same token. The connector refreshes
from whatever is stored at that moment rather than what it loaded at the start,
and saves the result only if the stored token is still the one it refreshed
from; when it is not, the other sync's (or a fresh consent's) token wins and
this run adopts it. Atlassian's ten-minute reuse window for a retired refresh
token is the safety net behind that, not the design. A refresh that could not
be saved is reported on the run (the sync still finishes on the fresh token)
and means the next run needs a reconnect.

**Test connection never refreshes.** It has nowhere to save a rotated token,
so an expired grant reports "run Sync now" instead of silently invalidating
the stored refresh token. A sync refreshes and saves; test afterwards.

The deployment needs an Atlassian OAuth 2.0 (3LO) app with the callback
`https://<host>/api/connect/atlassian/callback` and the three scopes above,
and its client id and secret as `ATLASSIAN_CLIENT_ID` and
`ATLASSIAN_CLIENT_SECRET`. Without them the button is not offered and the
pasted-token form below is what the source shows.

## A pasted API token

The fallback, and the only way on a deployment without the OAuth app: an
Atlassian API token from `id.atlassian.com` → Security → API tokens, pasted
with the email it was issued to. It is sent as Basic auth against the site's
own URL. Tokens created since December 2024 carry a mandatory expiry (1 to 365
days), and a 401 from Jira surfaces as a reconnect message, not a retry loop.

A person's token reads every project on the site the person can see; only the
source's `projectKeys` narrows what syncs. Prefer the Atlassian grant, which
is scoped, revocable from the Atlassian account, and refreshes itself.

## Configuration

```yaml
slug: jira
name: Jira — NOCO
kind: jira
config:
  baseUrl: https://acme.atlassian.net # the site; with a grant, the site to pick
  projectKeys: [NOCO] # opt-in; nothing outside this list syncs
  doneWindowDays: 90 # done issues older than this age out
  includeDescription: true
  notDoneStatuses: [] # done-category statuses to keep open, e.g. ["Won't Do"]
schedule: '17 * * * *'
enabled: true
```
