# Where an agent turn runs

Three separate questions get confused with each other constantly, because two
of them are spelled almost the same and the third has AWS's marketing on top of
it. This page separates them.

| Question | The field | Values |
|---|---|---|
| Where does the **loop** run? | `harness.provider` | `local`, `runtime`, `agentcore` |
| Which vendor's **model** answers? | `harness.modelProvider` | `anthropic`, `openai`, `bedrock` |
| Which AWS **account** pays for Bedrock? | not a field — the org's stored credential | the customer's, or ours |

Both fields end in "provider" and they are unrelated axes. An agent can run its
loop in this app's process and still answer on Bedrock. An agent can run
out-of-process on AWS and still answer on Anthropic direct.

**`bedrock` is a `modelProvider` value. It has never been a `harness.provider`
value.** If that sentence is surprising, this page is for you.

---

## The loop, and who writes it

An agent turn is a loop: call the model, see that it asked for a tool, run the
tool, call the model again, repeat until it answers. We write that loop — it is
[deepagents](https://github.com/langchain-ai/deepagents), and everything that
makes an agent more than a chatbot lives in it: the tool registry, subagents,
playbooks and skills, human-approval gates, action cards, learnings.

`harness.provider` picks where that happens. Two of the three values run our
loop and differ only in which process holds it. The third hands the loop to AWS.

| | `local` | `runtime` | `agentcore` |
|---|---|---|---|
| Whose loop | ours (deepagents) | ours (deepagents), same code | **AWS's** |
| Runs in | this Next.js process | `packages/agent-runtime`, a separate container | AWS's managed harness |
| Tools | in-process | called back over HTTP to `/api/internal/agent-tools` with a signed claim | one, `search_knowledge`, handed back mid-turn as an `inline_function` |
| Subagents, playbooks, approval gates | yes | yes | none |
| AgentCore Memory | no | yes | no |
| Deployed on | the app's own box | AgentCore Runtime | AWS, no container of ours |
| Default for | everything not on Bedrock | Bedrock agents | nothing — opt in explicitly |

### `local` and `runtime` are the same agent

Only the process boundary moves. The agent definition, the tool registry, the
prompt assembly and the event stream are identical, which is what makes
`VOCION_DISABLE_RUNTIME=1` a safe dev switch rather than a behaviour change.

Because the artifact is generic — the agent travels in the invocation payload —
editing an agent never redeploys anything. `workspace:apply` stays a database
sync.

### What it means that tools call back

On `runtime` the container holds no database credential and no KMS grant. It
cannot read a source, a learning, or a CRM record. Every tool it "has" is a stub
that POSTs to core, which executes the real implementation and returns the
result. One registry, `services/agents/tools/registry.ts`, serves every
provider.

The practical consequence, and the single most common deployment mistake: the
URL in that payload comes from `VOCION_TOOL_ENDPOINT_URL` and defaults to
`http://localhost:3000/…`. Deploy the artifact to AWS without changing it and
every tool call fails. The agent still answers, from the model alone, badly.
That is one unreachable URL, not thirty broken tools.

### `agentcore` gives the loop away

On this provider AWS drives the turn. We hand Bedrock a system prompt, a model
id and a tool list; AWS decides when to call a tool and pauses so core can
execute it. The agent becomes pure configuration.

The cost is everything the loop implements. That path declares exactly **one**
tool, and has no subagents, no playbooks or skills, and no human-approval
gates — not by omission, but because those are deepagents behaviours AWS's loop
has no equivalent for.

It is kept for the case it fits: an agent that only needs to answer questions
over ingested knowledge, with no procedure and no write surface, on
infrastructure we do not have to deploy or patch.
`Veerio-Life/veerio-vocion` runs `event-ingestion-lead` on it. **Do not delete
this provider on the grounds that core has no agent on it** — the users are in
parent projects, along with `infra/aws/agentcore-harness-role.sh` and an
`apply-workspace.sh` that hard-fails without `VOCION_AGENTCORE_REGION`.

Choose it deliberately, and expect the tool ceiling. An agent that grows a
procedure has outgrown it.

---

## AgentCore is a family, not a service

AWS Bedrock AgentCore is a product family. Two of our providers touch it, and
they touch different services inside it — which is why "are we on AgentCore?"
has more than one true answer.

| AgentCore service | What it does for us | Which provider |
|---|---|---|
| **Runtime** | Hosts our container. Session-isolated microVM, SigV4 auth instead of an open port, SSE passthrough, images from ECR. | `runtime`, deployed |
| **Memory** | Conversation continuity plus long-term facts and preferences per actor, extracted server-side. | `runtime` |
| **Managed harness** | Runs AWS's own agent loop (`CreateHarness` / `InvokeHarness`). | `agentcore` |

**AgentCore Runtime is a container host.** It is closer to ECS than to an agent
framework. It runs whatever image you give it, as long as the image answers
`POST /invocations` and `GET /ping`. Ours answers both. That is the whole
contract — AWS supplies isolation, auth and streaming, and knows nothing about
agents.

The managed harness is the opposite trade: AWS knows everything about agents and
nothing about ours.

### AgentCore does not serve the model

Worth stating on its own, because the name invites the opposite assumption.
**Inference never goes through AgentCore.** On every provider, a Bedrock call is
a direct `Converse` API call — from this process on `local`
(`libs/llm/bedrock.ts`), from the container on `runtime`
(`ChatBedrockConverse`), from AWS's own loop on `agentcore`. AgentCore is
hosting, memory, and in one case a loop. It is not a gateway, a proxy, or a
router for model traffic.

---

## The model, and who pays for it

`harness.modelProvider` picks the vendor. Leave it out and the agent inherits
`VOCION_LLM_PROVIDER`.

One default connects the two axes: **an agent with `modelProvider: bedrock` and
no `provider` runs on `runtime`.** Choosing AWS as the model vendor also chooses
AWS as the place the loop runs, because that is the shape every deployed
installation wants and repeating `provider: runtime` on every agent is a thing
people forget. Write `provider: local` next to it to opt back out, or
`provider: agentcore` to hand the loop over; either is honoured.

`harness.provider` is deliberately **not** defaulted in the workspace schema.
The parsed harness block is stored verbatim as the agent's `harnessConfig`, so a
schema default would land in the database as though the author had typed it, and
"the author said nothing" would become indistinguishable from "the author asked
for `local`". Agents applied before that change carry an explicit `local` and
need one `workspace:apply` to pick up the new default.

### Which AWS account is billed

An org supplies its own AWS access key at `/dashboard/api-tokens`, under the
`aws` platform, so that its Bedrock spend lands on its own bill. That works on
both of the providers we drive, by two different routes:

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

On `agentcore` the model call is made inside AWS's harness, on the harness
execution role. An org's own stored key does not reach it.

---

## Overrides and kill switches

| Setting | Effect |
|---|---|
| `harness.provider` on the agent | Wins over the `modelProvider` default |
| `VOCION_AGENT_PROVIDER` | Forces one provider fleet-wide, over every agent's own setting |
| `VOCION_DISABLE_RUNTIME=1` | Sends `runtime` agents back to the in-process loop. For a dev machine with nothing on `:8080` |
| `VOCION_DISABLE_AGENTCORE=1` | Same idea for `agentcore` agents — for a machine with no AWS credentials or no provisioned harness, where such an agent would otherwise be unchattable |
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

**"Does AgentCore run our agent?"** On `runtime`, no — it runs our *container*,
and the loop inside is ours. On `agentcore`, yes, and that is the entire
difference between the two.

**"Does Bedrock inference go through AgentCore?"** No. Direct Converse calls,
always, on every provider.

**"Is `runtime` an alternative to AgentCore?"** No — it is how we use AgentCore.
Delete it and the AWS container path goes with it.

**"Is `bedrock` a `harness.provider`?"** No. It is a `modelProvider`. The two
fields are different axes.

**"Which should a new agent use?"** Nothing — leave `provider` out. A Bedrock
agent gets `runtime`, everything else gets `local`. Reach for `agentcore` only
for a knowledge-answering agent with no procedure, knowing it gets one tool.
