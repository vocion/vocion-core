# Where an agent turn runs

Three separate questions get confused with each other constantly, because two
of them are spelled almost the same and the third has AWS's marketing on top of
it. This page separates them.

| Question | The field | Values |
|---|---|---|
| Where does the **loop** run? | `harness.provider` | `local`, `runtime` |
| Which vendor's **model** answers? | `harness.modelProvider` | `anthropic`, `openai`, `bedrock` |
| Which AWS **account** pays for Bedrock? | not a field — the org's stored credential | the customer's, or ours |

Both fields end in "provider" and they are unrelated axes. An agent can run its
loop in this app's process and still answer on Bedrock. An agent can run
out-of-process on AWS and still answer on Anthropic direct.

---

## The loop, and who writes it

An agent turn is a loop: call the model, see that it asked for a tool, run the
tool, call the model again, repeat until it answers. We write that loop — it is
[deepagents](https://github.com/langchain-ai/deepagents), and everything that
makes an agent more than a chatbot lives in it: the tool registry, subagents,
playbooks and skills, human-approval gates, action cards, learnings.

`harness.provider` decides **which process** that loop runs in. It does not
decide who wrote it. Both values run the same code.

| | `local` | `runtime` |
|---|---|---|
| Runs in | this Next.js process | `packages/agent-runtime`, a separate container |
| Loop | ours (deepagents) | ours (deepagents) — the same code, bundled |
| Tools | called in-process | called back over HTTP to `/api/internal/agent-tools` with a signed tenant claim |
| Agent definition | read from the database | compiled per request and sent in the invocation payload |
| Deployed on | the app's own box | AWS Bedrock AgentCore Runtime |
| Use it when | dev, or a single-box install | you want the loop isolated from the web app |

Because the artifact is generic — the agent travels in the payload — editing an
agent never redeploys anything. `workspace:apply` stays a database sync.

### What it means that tools call back

On `runtime` the container holds no database credential and no KMS grant. It
cannot read a source, a learning, or a CRM record. Every tool it "has" is a
stub that POSTs to core, which executes the real implementation and returns the
result. One registry, `services/agents/tools/registry.ts`, serves both
providers.

The practical consequence, and the single most common deployment mistake: the
URL in that payload comes from `VOCION_TOOL_ENDPOINT_URL` and defaults to
`http://localhost:3000/…`. Deploy the artifact to AWS without changing it and
every tool call fails. The agent still answers, from the model alone, badly.
That is one unreachable URL, not thirty broken tools.

---

## AgentCore is a family, not a service

AWS Bedrock AgentCore is a product family. We use two things from it and
deliberately not a third.

| AgentCore service | What it does for us | Where |
|---|---|---|
| **Runtime** | Hosts our container. Session-isolated microVM, SigV4 auth instead of an open port, SSE passthrough, images from ECR. | `harness.provider: runtime`, deployed |
| **Memory** | Conversation continuity and long-term facts/preferences per actor, extracted server-side. | `VOCION_AGENTCORE_MEMORY_ID`, on the `runtime` provider |
| **Managed harness** | *Removed.* AWS would own the loop; the agent becomes pure configuration. | gone — see below |

**AgentCore Runtime is a container host.** It is closer to ECS than to an agent
framework. It runs whatever image you give it, as long as the image answers
`POST /invocations` and `GET /ping`. Ours answers both.

### AgentCore does not serve the model

This is worth stating on its own, because the name invites the opposite
assumption. **Inference never goes through AgentCore.** On every provider, a
Bedrock call is a direct `Converse` API call — from this process on `local`
(`libs/llm/bedrock.ts`), from the container on `runtime`
(`ChatBedrockConverse`). AgentCore is hosting plus memory. It is not a gateway,
a proxy, or a router for model traffic.

### Why the managed harness is gone

`harness.provider: agentcore` used to exist and had AWS run the loop: we handed
Bedrock a system prompt and a tool list, AWS drove the turn, and tool calls came
back to core as `inline_function` callbacks.

It was removed because handing over the loop hands over the product. That path
declared exactly **one** tool, `search_knowledge`, against roughly thirty on the
`runtime` path, and it had no subagents, no playbooks or skills, and no
human-approval gates — not by omission, but because those are behaviours our
loop implements and AWS's has no equivalent for. An agent on it was visibly
weaker, and keeping a second AWS execution path alive made "are we running on
AgentCore?" a question with two different true answers.

If you find `provider: agentcore` in a workspace file, it is stale. Change it to
`runtime`, or delete the line and let it be derived.

---

## The model, and who pays for it

`harness.modelProvider` picks the vendor. Leave it out and the agent inherits
`VOCION_LLM_PROVIDER`.

One default connects the two axes: **an agent with `modelProvider: bedrock` and
no `provider` runs on `runtime`.** Choosing AWS as the model vendor also chooses
AWS as the place the loop runs, because that is the shape every deployed
installation wants and repeating `provider: runtime` on every agent is a thing
people forget. Write `provider: local` next to it to opt back out; that
combination works fine.

`harness.provider` is deliberately **not** defaulted in the workspace schema.
The parsed harness block is stored verbatim as the agent's `harnessConfig`, so a
schema default would land in the database as though the author had typed it, and
"the author said nothing" would become indistinguishable from "the author asked
for `local`". Agents applied before that change carry an explicit `local` and
need one `workspace:apply` to pick up the new default.

### Which AWS account is billed

An org supplies its own AWS access key at `/dashboard/api-tokens`, under the
`aws` platform, so that its Bedrock spend lands on its own bill. That works
on both providers, by two different routes:

| Provider | How the credential reaches the model call |
|---|---|
| `local` | `resolveBedrockCredentials(orgId)` reads and decrypts the org's stored pair, and the Bedrock client signs with it |
| `runtime` | core mints a short-lived STS session from that pair and sends it in the payload's `aws` block; the container's model client signs with it |

The `runtime` route needs the extra step because the container has no database
and no KMS grant — it cannot resolve the org's key itself, and before this it
signed with its own execution role, which is the **platform's** account.

Three outcomes, and only one of them is loud:

- **Org stored a key** — session minted, customer billed.
- **Org stored nothing** — no `aws` block, the container falls through to its own
  chain (execution role, or `AWS_BEARER_TOKEN_BEDROCK`), and we pay. Correct for
  a trial, wrong for a paying client — check it at handover.
- **Org stored a key STS refuses** — the turn fails, with the reason logged.
  Deliberately not a fall back: falling back would look like success while
  billing the wrong account.

The session lasts an hour by default (`VOCION_BEDROCK_SESSION_SECONDS`), is
minted per invocation, and is never stored. The long-lived key stays in Postgres
as the only thing to rotate. The container reads the session through a
per-invocation reference rather than capturing it, because the compiled graph is
cached across invocations — and the cache is partitioned by org, so two tenants
with byte-identical agent definitions cannot share one.

---

## Overrides and kill switches

| Setting | Effect |
|---|---|
| `harness.provider` on the agent | Wins over the `modelProvider` default |
| `VOCION_AGENT_PROVIDER` | Forces one provider fleet-wide, over every agent's own setting |
| `VOCION_DISABLE_RUNTIME=1` | Sends `runtime` agents back to the in-process loop. For a dev machine with nothing on `:8080` |
| `VOCION_AGENT_RUNTIME_ARN` | Set: invoke the deployed AgentCore runtime over SigV4. Unset: plain HTTP to `VOCION_AGENT_RUNTIME_URL` (default `http://localhost:8080`) |
| `VOCION_TOOL_ENDPOINT_URL` | The callback URL sent to the container. Must be reachable from AWS on the deployed path |
| `VOCION_AGENTCORE_REGION` | Region core signs `InvokeAgentRuntime` against (default `us-west-2`) |
| `VOCION_AGENTCORE_MEMORY_ID` | Enables AgentCore Memory for conversations on the `runtime` provider |

For what a client deployment must set and where each value comes from, see
[parent project pattern](./deployment/parent-project-pattern.md).

---

## Quick answers

**"Are we using AgentCore?"** Yes, on any deployed installation: AgentCore
Runtime hosts the agent container, and AgentCore Memory backs conversation
recall.

**"Does AgentCore run our agent?"** No. It runs our *container*. The agent loop
inside it is ours.

**"Does Bedrock inference go through AgentCore?"** No. Direct Converse calls,
always.

**"Is `runtime` an alternative to AgentCore?"** No — it is how we use AgentCore.
Delete it and the AWS path goes with it.

**"Is `bedrock` a `harness.provider`?"** No. It is a `modelProvider`. The two
fields are different axes.
