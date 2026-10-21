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

Native connector actions continue to use their native providers; adding an MCP source does not redirect them.
