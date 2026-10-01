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

## The tracker family: what an agent reads and writes

Jira is the first provider of the **tracker family** (`packages/core/src/services/tracker/provider.ts`):
the issue tracker as the software factory sees it. An agent's tools and actions are named for the
constructs every tracker has — an issue, a status transition, a comment, an attachment, a remote
issue link — never for the vendor, so a skill written against them reads the same on Linear or
Azure Boards when those providers exist. The sync above mirrors one document per issue, an hour
old and without comments or attachments; these read the tracker live.

**Which source answers.** An issue key names its project (`NOCO-123` → `NOCO`), and the tracker
source whose `projectKeys` include that project is the one that reads and writes it. A call with
no key goes to the workspace's only tracker source; with several, it names one. A key outside every
configured project is refused with the list of what is connected — a project is added on the
source, not in a prompt.

**Reads** (present for any agent whose `connectorSources` include a tracker source):

| Tool | What it returns |
|---|---|
| `tracker_read_issue` (`key`) | The issue live: summary, description as text, status and its category, type, priority, labels, assignee, reporter, dates, fix versions, every comment, the attachments with their ids, linked issues, and the transitions available from its status. |
| `tracker_search_issues` (`query`, `limit`, `source`) | A search in the tracker's own language (JQL here), always wrapped in `project in (<configured keys>)` so it never leaves the source's projects. Key, summary, status, assignee, updated and link per row. |
| `tracker_read_attachment` (`attachment_id`, `issue_key`) | An image is stored in the workspace and its url returned; a text, markdown, CSV or JSON file comes back as text; anything else as its name, type and size. |

**Writes** (through `propose_action`; each rides the trust ladder and has an Undo):

| Action | What it changes | Undo | Default tier |
|---|---|---|---|
| `tracker.create_issue` | Files an issue from a request in the asker's words, the Vocion request linked in the description. One per request. | deletes the issue | medium |
| `tracker.transition_issue` | Moves an issue to a status through a transition its workflow allows; records where it came from. | moves it back, when the workflow allows | low |
| `tracker.update_issue` | Priority, labels, a fix version, a remote issue link; returns the previous values. | restores them, removes the link | low |
| `tracker.comment` | A comment on the issue, keyed `tracker.comment.<kind>` (completion, sensitive, update) so a routine completion can earn its way out while a decline stays a person's; editable on the card. | deletes the comment | medium |
| `tracker.attach_file` | An image or PDF from a workspace artifact or a URL — the mockup, the after-shot. | deletes the attachment | low |

Writes use the same credential as the sync (the Atlassian grant or the pasted token), so a
token that only reads fails the write with Jira's own message on the run, never silently.
