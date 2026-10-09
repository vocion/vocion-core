# Personal connectors

Connectors come in two kinds, named the same everywhere
(`libs/connect/connectorKinds.ts`):

- **Team connectors** are shared. The workspace's agents use them, and an
  Org or workspace admin connects and manages them, on Manage workspace →
  Team connectors.
- **Personal connectors** are yours only: your Gmail, Calendar, Drive, Slack
  DMs and GitHub, read only by your personal assistant, on Personal →
  Personal connectors.

Each page has one line linking to the other. An agent asked for the other
kind than its workspace holds answers in one line with that link, never with
a connect card (`services/connect/connectorKindRouting.ts`): a lead never
asks someone to connect their own inbox as a team connector, and a personal
assistant never offers to connect a team system.

Any member can connect their **own** Gmail, Google Calendar, Google Drive,
Slack direct messages and GitHub for their own assistant. They do it from
**Personal connectors**, and no admin is needed. The assistant then reads
those systems live, for that person alone. Nothing from them reaches a shared
workspace.

Calendar and Gmail are also read on a schedule, for the person's own
[morning brief and evening wrap](morning-brief.md): today's (or tomorrow's)
calendar, and recent mail with a meeting's outside attendees. The person can
retime or turn either off, and an admin can turn daily briefs off for the
Org.

This is the other half of [Connect](connect.md):

| | A team connector | A personal connector |
|---|---|---|
| Who connects | A workspace admin | Any member, for themselves |
| Whose grant | The workspace's | The person's |
| Where it is stored | `api_token` in the shared workspace | `api_token` in the person's Personal workspace |
| Who reads it | The workspace's agents, through a source that syncs | The person's own assistant, live, through tools and their daily brief |
| Synced, embedded, searchable by others | Yes | Never |

## What a person sees

Personal connectors lists five rows: Gmail, Google Calendar, Google Drive,
Slack DMs and GitHub. Each row has:

- what connecting it lets the assistant do;
- one move, **Connect** or **Disconnect**;
- once connected, the account it is connected as and the date.

Connect sends the person to the vendor and back. The page then says in one
line whether it worked. A row whose vendor has no app on this server says
"Not set up on this server yet" instead of offering a button that can only
fail.

Google's three rows share one Google login. Connecting Calendar after Gmail
adds Calendar's scope to the same login (`include_granted_scopes`).
Disconnecting any of the three disconnects Google, and the row says so.

An Org admin also sees **Let members connect their own accounts**, the Org's
switch, beside the list it governs.

## What the assistant can do with them

| Connection | Tools | Notes |
|---|---|---|
| Gmail | `mail_search`, `mail_read`, `mail_draft_reply` | Drafts only. A reply lands in the person's Gmail Drafts, threaded under the mail it answers. Nothing is ever sent. |
| Google Calendar | `calendar_today`, `calendar_range` | Live, split into "still ahead" and "already happened", in the person's zone. |
| Google Drive | `drive_search`, `drive_read` | Docs, Sheets, Slides and text files as text. Anything else is returned as its link. |
| Slack DMs | `slack_dm_search` | Direct and group-direct messages only. Channel matches are dropped. |
| GitHub | `github_my_work`, `github_read` | Reviews asked of the person, their open pull requests and their assigned issues. Also one issue or PR with its latest comments. GET only. |

The tools exist only in a Personal workspace, and only with a person in the
turn (`services/agents/tools/personalConnections.ts`). If the person has not
connected a system, the tool says so and says where to connect it. It never
answers from another source instead.

## The rules, and where each is enforced

- **Credentials are the person's.** A personal grant is a login row in
  `api_token` under the person's Personal workspace (`project.kind =
  'personal'`). There is one Personal workspace per person per Org, and only
  its owner can open it; Org admins cannot. The vault seals each grant under
  that workspace's own data key. No new credential store was needed.
- **One read path.** Every tool reads its credential through
  `personalCredential` (`services/personal/connections.ts`). It refuses in any
  of these cases:
  - the workspace is not the caller's own Personal workspace;
  - the Org has personal connections turned off;
  - the person has not made that connection.

  It never falls back to a workspace source, another person's login or a
  server key.
- **Proven with two people.** `personalConnections.test.ts` runs two people
  through the same tools and records the token every vendor call carried. It
  asserts these four things:
  - each person's turn spends only their own grant;
  - a turn naming the other person's workspace reaches no vendor;
  - a shared workspace has no personal tools;
  - an Org that turned personal connections off spends nothing.
- **Never shared.** No personal grant becomes a source:
  - the connect callback makes no source for a personal login;
  - shared workspaces get no personal tools.

  There is no "share this connection" yet. A system a team needs is connected
  in the shared workspace by its admin, as before.
- **Drafts, never send.** Gmail has no drafts-only scope; `gmail.compose`
  also permits sending. The guarantee is therefore in code:
  - `libs/personal/google.ts` has no send path;
  - `google.test.ts` fails if one appears.
- **Gone when the person goes.**
  - Disconnect withdraws the grant at Google or Slack (best effort) and
    deletes the row.
  - Leaving the Org (`removeMember`) does the same for every credential in
    their Personal workspace.
  - Deleting the person deletes them in the database (the
    `personal_project_forget_credentials` trigger, migration 0202).

## Who may connect

The start and callback routes (`app/api/connect/[provider]/…`) take the
personal path when the session's workspace is the person's own Personal
workspace. `personalConnectGate` then checks two things:

- the connector is on the personal list (`libs/personal/connections.ts`);
- the Org allows personal connections.

The admin check does not apply there. Everywhere else the route is unchanged:
admins only.

## The Org's switch

`tenant_account.personal_connections` (migration 0202) is on by default. An
Org admin turns it off from Personal connectors (`personal.setPolicy`).

When it is off:

- no personal connection can start or finish;
- every stored one stops being read, and tools answer with that sentence;
- the rows stay until their owner disconnects them or leaves the Org.

Turning it back on restores them.

## Scopes

Every scope is in one place: `libs/personal/connections.ts`. That file's
header says which tier Google puts each scope in, and why it is needed.

| Vendor | Asked for | Google tier |
|---|---|---|
| Google, Gmail | `gmail.readonly`, `gmail.compose` | restricted, restricted |
| Google, Calendar | `calendar.events.readonly` | sensitive |
| Google, Drive | `drive.readonly` | restricted |
| Google, every login | `openid`, `email` | non-sensitive |
| Slack | user scopes `im:read`, `im:history`, `mpim:read`, `mpim:history`, `search:read`, `users:read` | — |
| GitHub | `read:user`, `repo` (OAuth app); none with a GitHub App's client, which its read-only permissions bound | — |

How Google data is handled, for OAuth verification and CASA, is in
[`docs/security/google-api-data-handling.md`](../security/google-api-data-handling.md).

## Setting up the apps

Personal connections run on their own vendor apps, separate from sign-in and
from workspace connectors. This lets an install keep personal mail on an
**Internal**-type Google app, used by people in its own Google Workspace
only, while Cloud uses a verified External app later.

Each pair falls back when it is unset (`libs/connect/serverClients.ts`):

| Vendor | First choice | Then | Then |
|---|---|---|---|
| Google | `GOOGLE_PERSONAL_CLIENT_ID` / `_SECRET` | the sign-in client, `AUTH_GOOGLE_ID` / `_SECRET` | `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` |
| Slack | `SLACK_PERSONAL_CLIENT_ID` / `_SECRET` | `SLACK_CLIENT_ID` / `_SECRET` | — |
| GitHub | `GITHUB_PERSONAL_CLIENT_ID` / `_SECRET` | `GITHUB_APP_CLIENT_ID` / `_SECRET` | — |

On each app, register `https://<your-vocion-host>/api/connect/<provider>/callback`
as a redirect URI. That means `/api/connect/google/callback` on the Google
client, including the sign-in client when it is the fallback. Then do the
following for each vendor:

- **Google.** Enable the Gmail, Google Calendar and Google Drive APIs, and
  add the scopes above to the consent screen.
  - An **Internal** app needs neither verification nor CASA.
  - An **External** app needs Google's verification for the restricted
    scopes, and an annual CASA assessment.
  - While an External app is in "Testing", Google expires its refresh tokens
    after 7 days.
- **Slack.** Add the user scopes above under *User Token Scopes*. Bot scopes
  are not used for personal connections.
- **GitHub.** Prefer a GitHub App's client with read-only permissions
  (Contents, Issues, Pull requests, Metadata: read). Its user tokens expire
  after 8 hours and are renewed and saved automatically
  (`libs/personal/github.ts`). A classic OAuth app works too, but GitHub's
  only scope that reads private repositories (`repo`) also writes; the tools
  still only GET.

## Microsoft 365

Personal Outlook mail, calendar and OneDrive will use this same mechanism: a
descriptor in `libs/personal/connections.ts`, a personal branch in the
provider, and tools. The Microsoft 365 connector family is not on `main` yet,
so this is not wired. When that family lands, add `microsoft` to the personal
list and give the provider a `personal` branch, as Google's has.

## Pieces

| | |
|---|---|
| The list, the scopes | `libs/personal/connections.ts` |
| Gate, read path, disconnect, forget | `services/personal/connections.ts` |
| Vendor calls | `libs/personal/{google,slack,github}.ts` |
| Tools | `services/agents/tools/personalConnections.ts` |
| Personal apps | `libs/connect/serverClients.ts` (`personalLoginClient`) |
| Provider branches | `libs/connect/providers/{google,slack,github}.ts` (`audience: 'personal'`) |
| RPC | `routers/Personal.ts` (`personal.connections`, `disconnect`, `setPolicy`) |
| UI | `features/personal/PersonalConnections.tsx`, on `/dashboard/connectors` in a Personal workspace |
| Migration | `0202_personal_connections.sql` |
