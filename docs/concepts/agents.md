# Agents

> An **Agent** is an LLM orchestrator wired to a specific set of Skills and Workflows, with a system prompt that defines its voice and scope.

## What it does

An Agent is the thing a user talks to. When a user says "summarize my last discovery call," the Agent:

1. Interprets intent (classification against the wired Skill catalog)
2. Picks the right Skill(s) or kicks off a Workflow
3. Gathers input via retrieval (`ctx.retrieve` across the tenant's Sources)
4. Streams back the result, with citations back to the underlying documents and objects

Agents are named identities. Multiple agents can exist per tenant (a sales agent, a support agent, an internal-ops agent). Each sees only the skills + workflows it's wired to — you can safely give the sales agent write access to HubSpot without the support agent getting the same permission.

## Folder shape

```
context/<org>/agents/<slug>/
├── agent.yaml         # structured definition (required)
├── system-prompt.md   # voice, scope, guardrails (required)
├── evals.yaml         # conversation-level fixtures (recommended)
└── README.md          # optional — rationale, edge cases
```

### `agent.yaml`

```yaml
slug: ziggy
name: Ziggy
description: MetaCTO sales agent — discovery, deal analysis, proposal drafting
active: true
model: gpt-5.4
skillSlugs:
  - discovery_summary
  - summarize_deal
  - draft_followup_email
  - search_everything
workflowSlugs:
  - discovery_followup
```

### `system-prompt.md`

The system prompt — defines voice, scope, and guardrails. Free-form markdown. The LLM sees it verbatim on every conversation.

### `evals.yaml`

Conversation fixtures — "given this user message, the agent should call skill X with args Y" or "output should mention Z." Catches regressions where a system prompt tweak silently changes which skills the agent reaches for. See [Evals](../guides/evals.md).

## Runtime

A user message routes to the Agent's `chat.completions` call with:

- The Agent's system prompt
- The wired Skills as OpenAI-style tools
- Retrieval hits already folded into context

The Agent decides whether to answer directly, call a Skill, or start a Workflow. Every decision is a Langfuse trace; every Skill run stamps the active context SHA.

Chat responses can be rated (👍/👎) inline — see [feedback + audit](../guides/feedback-and-audit.md).

## Connection to other building blocks

- **[Skills](./skills.md)** — the Agent's tools
- **[Workflows](./workflows.md)** — multi-step procedures the Agent can trigger
- **[Objects](./objects.md)** + **[Sources](./sources.md)** — what the Agent grounds answers in

## Next

- [Quickstart](../guides/quickstart.md) — talk to an Agent
- [Authoring context](../guides/authoring-context.md) — tweaking the system prompt
- [Evals](../guides/evals.md) — conversation-level regression tests
- [Feedback + audit](../guides/feedback-and-audit.md) — rating agent answers
