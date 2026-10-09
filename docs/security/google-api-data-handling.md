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

## 1. Scopes requested, and why

The scope list lives in one file, `packages/core/src/libs/personal/connections.ts`,
and nowhere else. Each login asks only for the scopes of the connection the
person chose (incremental authorization, `include_granted_scopes=true`).

| Scope | Google classification | What it is used for | Feature that needs it |
|---|---|---|---|
| `openid`, `email` | Non-sensitive | Identify which Google account was connected, so the person sees "Connected as …" | Every login |
| `https://www.googleapis.com/auth/gmail.readonly` | Restricted | Search the person's mail and read a thread they ask about | `mail_search`, `mail_read` |
| `https://www.googleapis.com/auth/gmail.compose` | Restricted | Create a reply as a **draft** in the person's Gmail Drafts | `mail_draft_reply` |
| `https://www.googleapis.com/auth/calendar.readonly` | Sensitive | Read the person's own calendar for a day or a range of days | `calendar_today`, `calendar_range` |
| `https://www.googleapis.com/auth/drive.readonly` | Restricted | Find the person's files and read one they ask about as text | `drive_search`, `drive_read` |

**Why `gmail.compose` and not a narrower scope.** The product writes replies
into Drafts for the person to review and send themselves. Google offers no
drafts-only scope: `gmail.compose` is the narrowest one that creates drafts, and
it also permits sending. Vocion never sends:

- There is no code path that calls `users.messages.send` or `users.drafts.send`.
  `libs/personal/google.ts` is the only module that holds a personal Gmail
  credential, and its test (`libs/personal/google.test.ts`) fails the build if
  either endpoint ever appears in it.
- The assistant's tool tells the model the draft is unsent, and the person sees
  "Draft written to your Gmail Drafts — not sent" with a link to Drafts.

**Why `drive.readonly` and not `drive.file`.** The feature is "find the
document I'm thinking of": the person asks the assistant for a file they did
not create through Vocion. `drive.file` only reaches files the app created or
the person opened with a picker, which cannot answer that question.

Every scope is requested by the person, for themselves, from a button that
names what it unlocks. No scope is requested at sign-in: signing in with Google
asks for `openid email profile` only.

## 2. How the data is used

Google user data is used only to provide the feature the person asked for, in
the moment they ask:

- **Read live, on request.** A tool call made in the person's own conversation
  reads from Google at that moment and returns the result to that conversation.
  Nothing is fetched in the background, nothing is synced, and nothing from a
  personal connection becomes a searchable "source".
- **Only for the person who connected it.** Every read goes through one
  function, `personalCredential` (`services/personal/connections.ts`). It
  refuses unless:
  - the conversation is in the person's own Personal workspace;
  - the person in the conversation owns that workspace;
  - their Org has personal connections on.

  A two-person test (`services/agents/tools/personalConnections.test.ts`)
  records the token on every outbound call and proves one person's grant is
  never used for another.
- **Never in a shared space.** Shared workspaces have no tools that can read a
  personal connection, and a personal grant is never turned into a workspace
  source.

## 3. Limited Use

Vocion's use of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements. Specifically:

1. **Allowed use.** Google user data is used only to provide or improve
   user-facing features that are prominent in the requesting application's
   user interface: searching and reading the person's mail, calendar and files,
   and drafting replies, at the person's request.
2. **Transfers.** Google user data is transferred only as necessary to provide
   those features, with the person's consent, for security purposes, to comply
   with law, or as part of a merger or acquisition with notice. Concretely, the
   text a tool returns is sent to the large language model provider the Org
   has configured (Anthropic, OpenAI or Amazon Bedrock) to compose the answer.
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
- **Where it does persist.** What the assistant read becomes part of the
  person's own conversation, in their Personal workspace, which only they can
  open:
  - the tool's text result is recorded on the run's audit row (`tool_call.output`,
    capped at 10,000 characters);
  - the assistant's reply, which may quote it, is stored in the conversation.
- **LLM traces.** When the operator runs Langfuse tracing, the model's inputs
  and outputs, including tool results, are kept in the operator's Langfuse
  instance. Retention there is `LANGFUSE_RETENTION_DAYS` (default 365 days;
  minimum 3), enforced daily by `LangfuseRetentionService`. Operators serving
  restricted scopes should set a short value, or turn tracing off for Personal
  workspaces.

## 5. Retention and deletion

| Event | What happens | Where |
|---|---|---|
| The person clicks **Disconnect** | The grant is revoked at Google (`oauth2.googleapis.com/revoke`), then its row is **deleted**, not merely marked revoked. A vendor that does not answer never keeps the row. One Google login serves Gmail, Calendar and Drive, so all three disconnect together. | `disconnectPersonalConnection` |
| The person revokes access in their Google account | The next read fails, and the assistant says so. The row is removed when they disconnect, leave or are deleted. | — |
| The person is removed from the Org | Every credential in their Personal workspace on that Org is revoked at Google and deleted. | `removeMember` → `forgetPersonalConnections` |
| The person's user record is deleted | A database trigger deletes every credential in their Personal workspace in the same statement. | migration `0202`, `personal_project_forget_credentials` |
| The Org turns personal connections off | Every grant stops being read immediately. The rows remain until their owner disconnects or leaves; turning the switch back on restores them. | `tenant_account.personal_connections` |

Conversation content in the Personal workspace, including quoted results,
follows the conversation's own lifecycle. On a deletion request for an
account, the operator deletes the person's Personal workspace, which cascades
to its conversations and audit rows. Trace copies age out under
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
| The person | Never sees a token; sees the connected account and date | Yes, in their own conversations |
| Other members, including Org admins | No. A Personal workspace is reachable only by its owner, admins included (`WorkspaceAccessService`) | No |
| Agents in shared workspaces | No. Personal tools exist only in the person's Personal workspace | No |
| The operator's engineers | Only with both database access and decrypt permission on the KMS key, which production restricts to the application's role | Through database or Langfuse access, governed by the operator's access controls and the human-reading rules in §3 |
| The LLM provider the Org configured | No | Tool results needed to answer the person's request, under no-training API terms |

## 8. Security controls summary

- **Least privilege.** A login asks only for the scopes of the connection
  being made.
- **Org switch.** Admins can disable personal connections Org-wide, which stops
  every read at once.
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
    drafts.
