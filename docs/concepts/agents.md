# Agents

> An **Agent** is an LLM orchestrator wired to a specific set of Skills and Workflows, with a system prompt that defines its voice and scope.

## What it does

An Agent is the thing a user talks to. When a user says "summarize my last discovery call," the Agent:

1. Interprets intent (classification against the wired Skill catalog)
2. Picks the right Skill(s) or kicks off a Workflow
3. Gathers input via retrieval (`ctx.retrieve` across the tenant's Sources)
4. Streams back the result, with citations back to the underlying documents and objects

Agents are named identities. Multiple agents can exist per tenant (a sales agent, a support agent, an internal-ops agent). Each sees only the skills + workflows it's wired to — you can safely give the sales agent write access to HubSpot without the support agent getting the same permission.

## Where it lives

`context/<org>/agents/<slug>.yaml` + `<slug>.system-prompt.md`:

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
  - find_related_conversations
workflowSlugs:
  - discovery_followup
```

The system prompt defines voice, scope, and guardrails.

## Runtime

A user message routes to the Agent's `chat.completions` call with:

- The Agent's system prompt
- The wired Skills as OpenAI-style tools
- Retrieval hits already folded into context

The Agent decides whether to answer directly, call a Skill, or start a Workflow. Every decision is a Langfuse trace; every Skill run stamps the active context SHA.

## Connection to other building blocks

- **[Skills](./skills.md)** — the Agent's tools
- **[Workflows](./workflows.md)** — multi-step procedures the Agent can trigger
- **[Objects](./objects.md)** + **[Sources](./sources.md)** — what the Agent grounds answers in

## Next

- [Quickstart](../guides/quickstart.md) — talk to an Agent
- [Authoring context](../guides/authoring-context.md) — tweaking the system prompt
