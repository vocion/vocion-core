# Google API data handling

How Vocion requests, uses, stores, protects and deletes Google user data. This
document supports Google's OAuth app verification and the CASA security
assessment for restricted scopes. It describes the code in this repository; an
operator's own deployment choices (the KMS key, log shipping, trace retention)
are called out where they apply.

It covers the scopes a member grants for their **own** account through Personal
→ Connectors ([personal connections](../guides/personal-connections.md)).
Workspace connectors that an admin connects for a shared workspace use
read-only scopes and are described in [connect.md](../guides/connect.md); the
storage, encryption and logging sections below apply to both.

Google data is read in two ways, both for the person who connected it and
both described in §2:

- **On request**, when the person asks their assistant something in their
  own Personal chat.
- **On a schedule, for the person's daily brief and evening wrap.** These are
  user-facing features the person can see, retime and turn off, and their Org
  can turn off for everyone.

## 1. Scopes requested, and why

The scope list lives in one file, `packages/core/src/libs/personal/connections.ts`,
and nowhere else. Each login asks only for the scopes of the connection the
person chose (incremental authorization, `include_granted_scopes=true`).

| Scope | Google classification | What it is used for | Feature that needs it |
|---|---|---|---|
| `openid`, `email` | Non-sensitive | Identify which Google account was connected, so the person sees "Connected as …" | Every login |
| `https://www.googleapis.com/auth/gmail.readonly` | Restricted | Search the person's mail and read a thread they ask about; find recent mail with a meeting's outside attendees for the morning brief | `mail_search`, `mail_read`; the morning brief |
| `https://www.googleapis.com/auth/gmail.compose` | Restricted | Create a reply as a **draft** in the person's Gmail Drafts | `mail_draft_reply` |
| `https://www.googleapis.com/auth/calendar.events.readonly` | Sensitive | Read the events on the person's own primary calendar for a day or a range of days | `calendar_today`, `calendar_range`; the morning brief and evening wrap |
| `https://www.googleapis.com/auth/drive.readonly` | Restricted | Find the person's files and read one they ask about as text | `drive_search`, `drive_read` |

**Why `calendar.events.readonly`.** Every Calendar read is one `events.list`
call on the primary calendar (`libs/personal/google.ts`, `calendarEvents`).
Nothing reads calendar settings, the calendar list or free/busy, so the
events-only scope is enough. Logins made before this scope was narrowed hold
`calendar.readonly`, which covers the same events. They keep working
(`hasEveryScope` in `libs/connect/providers/google.ts` accepts the broader
scope), so nobody has to reconnect. A person who wants the narrower grant
disconnects (which revokes the old grant at Google) and connects again.

**Why `gmail.compose` and not a narrower scope.** The product writes replies
into Drafts for the person to review and send themselves. Google offers no
drafts-only scope: `gmail.compose` is the narrowest one that creates drafts, and
it also permits sending. Vocion never sends:

- There is no code path that calls `users.messages.send` or `users.drafts.send`.
  `libs/personal/google.ts` is the only module that holds a personal Gmail
  credential, and its test (`libs/personal/google.test.ts`) fails the build if
  either endpoint ever appears in it.
- The tool's result says "Draft written to your Gmail Drafts — NOT sent",
  with a link to Drafts, and tells the assistant to say it is a draft waiting
  for the person, never that it was sent.

**Why `drive.readonly` and not `drive.file`.** The feature is "find the
document I'm thinking of": the person asks the assistant for a file they did
not create through Vocion. `drive.file` only reaches files the app created or
the person opened with a picker, which cannot answer that question.

Every scope is requested by the person, for themselves, from a button that
names what it unlocks. No scope is requested at sign-in: signing in with Google
asks for `openid email profile` only.

## 2. How the data is used

Google user data is used only to provide features the person can see and
control. There are two of them.

### On request

A tool call made in the person's own conversation reads from Google at that
moment and returns the result to that conversation. The same is true when the
person presses the button for their day on the Briefings page: the brief is
composed from the reads described below, at that moment.

### On a schedule: the morning brief and the evening wrap

Every person gets a **morning brief** ("Your day") and an **evening wrap**
("Your wrap"), written in their Personal workspace at their own local times
([morning-brief.md](../guides/morning-brief.md)). These are the only reads made
without a request in the moment. One composer writes both, the scheduled ones
and the on-request one (`services/briefings/personal.ts`). It reads facts
through `services/briefings/personalFacts.ts`, and the schedule is
`services/personal/rhythm/schedule.ts`.

**When.** A sweep runs every five minutes. Each person has a brief time
(default 07:30) and a wrap time (default 17:30) in their own time zone, and a
delivery starts at most once per person, kind and local day. A delivery more
than two hours late is skipped, not sent. Nothing is read for a person who has
not signed in or used the app in the last seven days, or whose Org has daily
briefs off.

**What the morning brief reads:**

- **Calendar.** One `events.list` call on the person's primary calendar for
  today, in their time zone (at most 100 events). Google returns each event
  in full; the brief keeps only its title, start time, all-day flag, status
  and attendee email addresses, and drops the rest in memory. Cancelled
  events are dropped.
- **Gmail**, only when the brief will be written (there is something to say
  and the budget allows it). For up to six of today's timed meetings, it
  searches the person's mail from the last 30 days with the meeting's
  attendees from outside the person's own email domain (at most three per
  meeting, at most two messages each). It reads only each message's From,
  Subject, Date and Google's snippet (`format=metadata`), never a body.
- **No Drive.** The brief reads nothing from Drive.

**What the evening wrap reads:** one `events.list` call on the primary
calendar for tomorrow, to name tomorrow's first meeting. It reads no mail.

**Why.** The brief lists today's meetings with one line of context each, so
the person walks into each meeting knowing what it is about. The wrap names
what is first tomorrow. Nothing else is done with the data.

**Where it goes:**

- The meetings and mail evidence are rendered into the brief, which is stored
  in the person's Personal workspace (see §4). A meeting's title and the
  outside attendees' company names are also used as a keyword search of the
  person's shared workspaces, within their own source access. This finds
  what the team's records say about the meeting. The search query is not
  stored in those workspaces.
- When the Org's brief budget allows, the facts (meeting titles, times,
  attendee addresses and the mail evidence) are sent once to the Org's
  configured model provider. The model writes the context lines and up to
  three suggested actions (`services/briefings/personalWriter.ts`). Otherwise
  the brief is composed from the facts alone, with no model call.
- The person is told in their Personal chat with one short message: the
  brief's lead line ("3 meetings, 2 decisions on you") and a link to the
  stored brief. If they chose push beyond the app (Slack DM, text or email),
  the morning brief's push carries the same lead line and link. The lead line
  holds a meeting count, never a meeting's title or any mail.
- If there are no meetings, nothing waiting and nothing done, no brief is
  stored and nothing is sent. The calendar was still read to learn that.

**How to turn it off:**

- **The person:** under **Notification settings → Your day**, change the brief
  and wrap times, or switch either one off.
- **The Org:** **Daily briefs for your Org**, on the same page, is an
  admin-only switch (`tenant_account.daily_briefs`). When it is off, no
  scheduled brief or wrap runs for anyone in the Org.
- **Connections:** a brief only reads a connection that exists. Without
  Calendar it says the calendar is not connected; without Gmail it adds no
  mail evidence. Disconnecting, or the Org turning personal connections off,
  stops every read, scheduled or not.

### Limits on both kinds of read

- **Only for the person who connected it.** Every read, on request or
  scheduled, goes through one function, `personalCredential`
  (`services/personal/connections.ts`). It refuses unless:
  - the read is for the person's own Personal workspace;
  - the person it is for owns that workspace;
  - their Org has personal connections on.

  A two-person test (`services/agents/tools/personalConnections.test.ts`)
  records the token on every outbound call and proves one person's grant is
  never used for another.
- **Nothing is synced.** No mail, calendar or file is copied into the
  knowledge store, embedded or indexed, and nothing from a personal connection
  becomes a searchable "source".
- **Never in a shared space.** Shared workspaces have no tools that can read a
  personal connection, a personal grant is never turned into a workspace
  source, and a brief is stored only in its owner's Personal workspace.

## 3. Limited Use

Vocion's use of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements. Specifically:

1. **Allowed use.** Google user data is used only to provide or improve
   user-facing features that are prominent in the requesting application's
   user interface: searching and reading the person's mail, calendar and files,
   and drafting replies, at the person's request; and the person's own morning
   brief and evening wrap, which they can see, retime and turn off (§2).
2. **Transfers.** Google user data is transferred only as necessary to provide
   those features, with the person's consent, for security purposes, to comply
   with law, or as part of a merger or acquisition with notice. Concretely, the
   text a tool returns, and the facts a brief is written from, are sent to the
   large language model provider the Org has configured (Anthropic, OpenAI or Amazon Bedrock) to compose the answer.
   These providers act as processors under API terms that prohibit training on
   API inputs.
3. **No advertising.** Google user data is never used for serving ads,
   including retargeting, personalized or interest-based advertising.
4. **No human reading**, except:
   - with the person's affirmative agreement for specific messages;
   - when necessary for security purposes, such as investigating abuse;
   - to comply with applicable law;
   - for internal operations, where the data has been aggregated and
     anonymized.
5. **No model training.** Google user data is not used to develop, improve or
   train generalized or non-personalized AI or machine-learning models. It is
   not sold, and it is not transferred to data brokers or information resellers.

## 4. Where tokens and data are stored

### OAuth tokens

- **Table.** A personal grant is one row in Postgres table `api_token`,
  `obtained_via = 'login'`, scoped to the person's Personal workspace
  (`project.kind = 'personal'`, one per person per Org).
- **Contents.** The row holds the refresh token, the current access token, its
  expiry, the granted scopes and the Google account email, as one JSON document.
- **Encryption at rest.** The document is encrypted with AES-256-GCM under a
  data encryption key (DEK) that belongs to that Personal workspace alone
  (`source_dek`).
  - In production (`VOCION_CREDENTIAL_VAULT=kms`), the DEK is itself wrapped
    by an AWS KMS key (`VOCION_KMS_KEY_ARN`). The plaintext DEK exists only in
    process memory, for at most 15 minutes per cache window.
  - The row stores ciphertext, a 12-byte random nonce and a 16-byte
    authentication tag. Nothing secret is stored in plaintext.
  - The only plaintext trace of a token is a masked hint (`key_hint`) for the
    person to recognise the row.
- **In memory.** Access tokens minted from the refresh token are cached in
  process memory only, keyed by the refresh token itself, until five minutes
  before they expire. They are never written to disk or logs.
- **In transit.** All Google API calls are HTTPS. Tokens never reach the
  browser:
  - the OAuth code is exchanged server-side;
  - the callback URL carries only an outcome code;
  - the UI receives the connected account's email and the date, never a token.

### Google data

- **Not stored by design.** Mail, calendar and file content is not written to
  the knowledge store, not embedded and not indexed.
- **Where it does persist.** Everything below is in the person's Personal
  workspace, which only they can open:
  - a tool's text result is recorded on the run's audit row
    (`tool_call.output`, capped at 10,000 characters);
  - the assistant's reply, which may quote it, is stored in the conversation;
  - each morning brief and evening wrap is one row in table `briefing`
    (`content`, Markdown), one per person, kind and local day, kept as the
    Briefings page's history. A brief holds today's meeting titles and times
    and a context line under each, which may quote a mail's subject and
    snippet with its sender and date. A wrap holds tomorrow's first meeting.
    The attendee list is not written into either.
- **LLM traces.** When the operator runs Langfuse tracing, the model's inputs
  and outputs, including tool results, are kept in the operator's Langfuse
  instance. Retention there is `LANGFUSE_RETENTION_DAYS` (default 365 days;
  minimum 3), enforced daily by `LangfuseRetentionService`. Operators serving
  restricted scopes should set a short value, or turn tracing off for Personal
  workspaces. The brief's model call is traced under the Personal workspace.
  Its keyword search of the person's shared workspaces is traced under each
  shared workspace and carries the query: a meeting's title and the outside
  attendees' company names. Traces are not shown in the app.

## 5. Retention and deletion

| Event | What happens | Where |
|---|---|---|
| The person clicks **Disconnect** | The grant is revoked at Google (`oauth2.googleapis.com/revoke`), then its row is **deleted**, not merely marked revoked. A vendor that does not answer never keeps the row. One Google login serves Gmail, Calendar and Drive, so all three disconnect together. | `disconnectPersonalConnection` |
| The person revokes access in their Google account | The next read fails, and the assistant says so. The row is removed when they disconnect, leave or are deleted. | — |
| The person is removed from the Org | Every credential in their Personal workspace on that Org is revoked at Google and deleted. | `removeMember` → `forgetPersonalConnections` |
| The person's user record is deleted | A database trigger deletes every credential in their Personal workspace in the same statement. | migration `0202`, `personal_project_forget_credentials` |
| The Org turns personal connections off | Every grant stops being read immediately, on request and on schedule. The rows remain until their owner disconnects or leaves; turning the switch back on restores them. | `tenant_account.personal_connections` |
| The person switches off their brief or wrap, or the Org switches off daily briefs | No further scheduled reads for that kind (person) or for anyone in the Org. Briefs already written stay in the person's Briefings history. | `personal_rhythm.brief_on` / `wrap_on`, `tenant_account.daily_briefs` |

Conversation content in the Personal workspace, including quoted results,
follows the conversation's own lifecycle, and stored briefs stay in the
Briefings history; disconnecting a connection does not delete either. On a
deletion request for an account, the operator deletes the person's Personal
workspace. That cascades to its conversations and audit rows (`project_id`
foreign keys). The `briefing` table has no foreign key to the workspace, so
the operator also deletes its rows for that workspace (`org_id`). Trace copies age out under
`LANGFUSE_RETENTION_DAYS`, or the operator deletes them through the Langfuse
API.

## 6. Logging

- **Application logs** (LogTape, shipped to Better Stack when configured) never
  contain tokens, codes, OAuth state or Google content.
  - The connect routes log the provider, the connector and a short reason code.
  - Vendor clients log an error's class name, never its message body or the
    request.
  - A vendor's refusal reaches a URL or a log only as a sanitized short code
    (`[a-z0-9_.-]`).
- **Audit rows.** Every completed or failed connect is recorded with who, when,
  which provider and the outcome code (`recordConnectAttempt`). Every tool call
  is recorded with its tool name, arguments, output (capped) and the person
  (`tool_call`).
- **Error monitoring** (Sentry, when configured) receives exceptions. No code
  path here puts a credential value or Google content into an exception
  message: vendor clients raise errors that carry only the call's name and the
  HTTP status (`GoogleCallError`, `SlackCallError`, `GithubCallError`).
  Credential errors are flattened to fixed sentences before they can reach a
  client. `CredentialValidationError` and `VaultDecryptionError` are the only
  exceptions, and neither carries a secret.

## 7. Who can access it

| Who | Tokens | Google data |
|---|---|---|
| The person | Never sees a token; sees the connected account and date | Yes, in their own conversations and briefs |
| Other members, including Org admins | No. A Personal workspace is reachable only by its owner, admins included (`WorkspaceAccessService`) | No |
| Agents in shared workspaces | No. Personal tools exist only in the person's Personal workspace | No |
| The operator's engineers | Only with both database access and decrypt permission on the KMS key, which production restricts to the application's role | Through database or Langfuse access, governed by the operator's access controls and the human-reading rules in §3 |
| The LLM provider the Org configured | No | Tool results needed to answer the person's request, and the facts a brief is written from, under no-training API terms |

## 8. Security controls summary

- **Least privilege.** A login asks only for the scopes of the connection
  being made.
- **Org switches.** Admins can disable personal connections Org-wide, which
  stops every read at once, or disable daily briefs, which stops every
  scheduled read.
- **Person's switches.** Each person sets their brief and wrap times, or turns
  either off, under Notification settings → Your day.
- **OAuth state.** The state is HMAC-signed, expires after ten minutes, and is
  bound to the workspace and the person. The redirect URI comes from configured
  origin only.
- **Separate apps.** The personal Google OAuth client is configured separately
  from sign-in (`GOOGLE_PERSONAL_CLIENT_ID`), so an install can use an
  Internal-type app and a hosted service can use a separately verified External
  app.
- **Refresh tokens stay with their app.** Each refresh token is bound to the
  OAuth client that issued it, recorded with the grant (`loginClientId`).
- **Tests.** The tests that hold these properties are:
  - `services/personal/connections.test.ts`: the gate, whose credential a read
    gets, the Org switch, and deletion on disconnect, departure and user
    deletion;
  - `services/agents/tools/personalConnections.test.ts`: two people, each
    vendor call's token;
  - `libs/personal/google.test.ts`: no send path, and no header injection in
    drafts;
  - `libs/connect/providers/google.test.ts`: the scopes each login asks for,
    and a login holding the broader `calendar.readonly` still serving Calendar;
  - `services/briefings/personalDelivery.test.ts`: the scheduled brief, the
    Org switch, and nothing sent on an empty day.
