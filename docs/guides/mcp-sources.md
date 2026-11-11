# Remote MCP sources

Connect a remote Streamable HTTP MCP server as a source. The source is read live and ingests no documents. Reads require an explicit local allowlist and the provider's `readOnlyHint: true`; writes are available only through a human Review decision.

```yaml
slug: accounting-sandbox
name: Accounting sandbox
kind: mcp
config:
  readTools: [get_account, get_write_receipt]
  writeTools: [post_journal]
```

Connect a **REST or MCP API (bearer token)** credential to the source, using the complete HTTPS MCP endpoint as `baseUrl`. The existing credential platform supports multiple independent endpoint/token pairs per workspace. Credentials remain in the vault, never in YAML. Redirects and private network endpoints are refused.

## Each person signs in (`auth: person`)

A server that answers each person by their own identity, with its own document permissions, roles or MFA, cannot be read with one workspace token: everyone would read as whoever pasted it. Declare the endpoint and let each person sign in:

```yaml
slug: company-knowledge
name: Company knowledge
kind: mcp
config:
  auth: person
  url: https://knowledge.example.com/mcp
  readTools: [search_knowledge, get_document]
```

No credential is connected. The first time a person's turn reads the source, chat docks the same one-tap card a connector login uses ("Sign in to …"), and signing in lands back in that conversation with the card marked done. People can also `@`-tag the source in the composer to point a question at it. Vocion discovers the server's OAuth (protected-resource metadata), registers itself as a public client and signs the person in with PKCE. The grant is kept in that person's Personal, keyed by the endpoint, so one sign-in serves every workspace that declares the same `url`. It is refreshed when it runs out, and it is used only for that person's own turns. A turn with no person in it (an automation, a background step) cannot read the source and says so. A per-person source declares no `writeTools`: a write runs when a reviewer approves it, not as the person who asked. The server must support dynamic client registration, S256 PKCE and refresh tokens.

### Your connections follow you

A per-person server is declared once and used wherever its people work (`services/outboundMcp/followingSources.ts`, migration 0215):

- **Declared once anywhere in the Org, visible Org-wide.** An `auth: person` server declared in any workspace of the Org, or in the person's own Personal there, counts as known to the Org. Another person's Personal never counts, and nothing crosses to another Org.
- **Used in any turn the person starts, in any workspace of that Org,** because they signed in. The answering agent gets it beside its own sources, under the declaring slug (renamed `<slug>-yours` only where this workspace already uses that slug). Reads run as the person, with their grant and the server's own ACLs. Write tools never travel: only `readTools` come with it, and `mcp.call` only reaches sources the workspace declares. An agent that already holds the same endpoint as its own source keeps its own, once.
- **Every answer that used one says so** in the turn line/ledger. The step reads "Read your Company Knowledge · your connection, from Finance", the read's output carries `via`, and both are kept with the turn. `describe_sources` lists it as "your connection, from <workspace>", and the `@` picker offers it as "<name> · your connection".
- **Missions and automations never get it.** Only a person's own chat turn (the chat stream and its recovery, `personTurn` on `runAgentDeep`, carried in the signed claim to the AgentCore container) asks for it. A mission, automation, workflow, eval or API caller still needs the source declared in its own workspace and assigned to the agent.
- **Two switches, both default on:** the person's **Use in every workspace**, per connection, on Personal → Connectors (`api_token.every_workspace`, kept on their sign-in), and the workspace admin's **Members' own connections** on the workspace's Connectors page (`project.members_own_connections`). Off for a workspace whose shared records must not draw on members' own access; the servers that workspace declares itself are unaffected.
- **Without a sign-in,** the person gets the sign-in link once: the same docked card, started from the workspace they are in.

Assign the source slug to the agent's `connectorSources`. `mcp_list_tools` discovers declared schemas; `mcp_read` calls reads. Both intersect the agent's assignment with the requesting user's source ACL. Discovery never executes a provider tool.

Submit a write with `propose_action` using action id `mcp.call` and input:

```json
{
  "sourceSlug": "accounting-sandbox",
  "tool": "post_journal",
  "input": { "idempotency_key": "journal-review-2026-001" },
  "summary": "Post the reviewed journal"
}
```

The `input` object must contain every argument required by the discovered provider schema. The review card displays those exact arguments. Even a high-autonomy agent cannot bypass Review; provider errors record a failed action. Tool availability and the source's write allowlist are checked again at execution.

Core does not invent a provider's confirmation protocol, deduplication or read-back verification. Enable writes only once that contract is established. For financial writes, use a service that provides durable idempotency and verified receipts; freeze the idempotency key and expected record version in the proposal. Following a timeout, inspect the provider's receipt before retrying. A generic MCP success alone does not prove a business outcome.

## Requests that run on the person's word (`actTools`, `mcp.act`)

A write is a change of record in somebody else's system, and a person reads every one. A **request** is different: "file this with the factory", "tell it the answer is yes". Nothing of record changes until the other system does its own work behind its own gates. Declare those tools apart:

```yaml
slug: factory
name: Factory
kind: mcp
config:
  readTools: [ticket_status, ticket_updates]
  actTools: [request_ticket, reply_ticket]
  updatesTool: ticket_updates
```

An agent submits one with `propose_action`, action id `mcp.act`, and the same input shape as `mcp.call`. When the person in the turn asked for exactly that, it runs at once, as theirs, and the provider's answer comes back to the agent to tell them. When an agent decides it on its own, it follows the workspace's trust rule `mcp.act.<source>.<tool>` (a tool with no rule reads `mcp.act`'s), and is a card when there is none. A tool is a read, a reviewed write or an act tool, never two of them, and a per-person source declares no act tools.

When the provider's tool takes an `origin` object, Vocion fills in `origin.conversation` (the conversation the request was made in) and `origin.request` (a stable id for the filing, so a retry files nothing twice). What the agent put in `origin` (who asked, a link to the message) is kept.

## A source that reports back (`updatesTool`, `updatesWatchTool`)

A system that was asked for something has things to say later: it needs an answer, it stopped, it shipped. It says so when it happens. Nothing is polled.

```yaml
config:
  readTools: [ticket_status, ticket_updates]
  actTools: [request_ticket, reply_ticket, watch_updates]
  updatesTool: ticket_updates
  updatesWatchTool: watch_updates
```

- **`updatesTool`** is a declared read the provider marks `readOnlyHint: true`. It returns `{updates: [{id, conversation, text, url?, asks?}]}` and takes `{ack: [ids]}`.
- **`updatesWatchTool`** is a declared act tool that takes `{url}`. Vocion gives it `https://<app>/api/webhooks/mcp/<workspace>/<source>`, and the provider POSTs there the moment it has an update. The ping is signed with no new secret: headers `x-updates-timestamp` (ms) and `x-updates-signature` = `sha256=` + hex HMAC-SHA256 of `timestamp.body`, keyed with the hex SHA-256 of the source's bearer token. Its body is not read. A ping older than five minutes, unsigned or wrongly signed gets a 401.
- A good ping reads that source's updates at once (`mcp-updates`). Each update is said once in the conversation it names, in the app's chat and in its Slack thread, and acknowledged so the provider stops returning it. Two reads of one source never overlap; pings during a read become one more read after it.
- An update with `asks: true` goes to the conversation's agent first: it answers the provider itself when the thread already settled the question (through `mcp.act`, on the trust rule) and says what it answered, or asks the people in the thread. If the agent cannot run, the provider's own words are said, so a question is never dropped.

The schedule is only the net under a lost ping. Run the job at a long interval (the `factory-desk` plugin does, hourly); that run also renews the address with the provider:

```yaml
when: {schedule: '7 * * * *', timezone: UTC}
do: {job: mcp-updates}
```

Native connector actions continue to use their native providers; adding an MCP source does not redirect them.
