---
title: Glossary
description: Controlled vocabulary for Vocion — every term used across the docs, defined once with a link to where it lives.
nav_order: 10
---

# Glossary

Short definitions for every concept used across the docs. The detail lives in linked pages — this is the lookup index.

## Authoring concepts

**Agent.** A named LLM orchestrator with a system prompt, a tool set, and a memory. Wires together Skills, Workflows, and Sources. Authored in `context/<org>/agents/<slug>.yaml`. See [Agents](../concepts/agents.md).

**Skill / Operation.** A single LLM-powered unit of work with typed inputs and outputs. "Skill" is the legacy name; "Operation" is the v0.2 rename. Authored in `context/<org>/operations/<slug>/`. See [Skills](../concepts/skills.md).

**Workflow.** A sequence of steps — Skill, action, or approve gate — with persistent state. HITL pauses on approve steps. Authored in `context/<org>/workflows/<slug>.yaml`. See [Workflows](../concepts/workflows.md).

**Object.** A first-class business entity (Account, Opportunity, Deck, Transcript) the tenant cares about. Typed via `context/<org>/objects/<type>.yaml`. See [Objects](../concepts/objects.md).

**Source.** A connected system feeding documents into the retrieval layer (Google Drive, GitHub, Slack, web crawl, file upload). Implemented as a typed plugin against `@vocion/sdk`. See [Sources](../concepts/sources.md).

**Playbook.** Markdown + YAML procedural guide mounted into agent context at `/playbooks/<slug>/`. Authored in `context/<org>/playbooks/`.

**Learning.** Whitelisted rule-step entry that agents can commit during runs (via `add_learning`). Authored in `context/<org>/learnings/` and surfaced to the agent via virtual file mounts.

**Eval.** A scored dataset of input → expected-shape pairs that exercises an Agent or Skill in CI. Stored in `context/<org>/evals/<slug>.yaml`. See [Evals](../guides/evals.md).

## Runtime concepts

**Run.** A single execution record. `skill_run` for Skill executions, `workflow_run` for workflows. Both stamp the active `context_sha` for traceability.

**`context_sha`.** Git-style hash of the active `context/<org>/` snapshot at run time. Stamped on every run so any output can be replayed against the exact prompts that produced it.

**Retrieval.** Looking up relevant chunks from indexed knowledge sources before passing them to an LLM. Vocion uses Postgres + `pgvector` (vector) and `tsvector` (keyword), fused via RRF. See [Retrieval config](./retrieval-config.md).

**Embedding.** A numerical vector representation of a chunk of text, produced by an embedding model (OpenAI `text-embedding-3-small`, 1536-d by default). Stored on `knowledge_chunk.embedding`.

**Chunk.** A token-aware slice (~512 tokens by default, 64-token overlap) of a source document. The unit Vocion embeds and retrieves.

**RAG.** Retrieval-Augmented Generation — the pattern of retrieving relevant chunks first, then having the LLM answer with that context. Vocion's default agent loop runs RAG via the `searchDocs` / `searchKnowledge` tools.

**Hybrid retrieval.** Combining vector (semantic) and keyword (lexical) results via RRF — Reciprocal Rank Fusion. Better recall than either alone on typical docs corpora.

**Plugin.** A typed TypeScript module that registers a Skill or Source via `@vocion/sdk`. Loaded at startup; takes precedence over a prompt Skill with the same slug. See [Writing a plugin](../guides/writing-a-plugin.md).

**Connector.** Historical synonym for Source. The user-facing UI says "Connectors"; the framework code says "Source". They refer to the same thing.

**MCP.** Model Context Protocol — Anthropic-defined RPC standard for LLM tools. The Vocion MCP server exposes every Agent, Skill, Workflow, and Object as a callable tool. See [MCP reference](./mcp.md).

## Governance + auth

**RBAC.** Role-based access control. Roles: `org:admin`, `org:member`. Defined per Clerk organization. See [authentication](./authentication.md).

**DBAC.** Data-based access control. Per-row ownership and scope on every domain table (org_id everywhere; user-scoped fields where relevant). Cross-tenant queries forbidden at the service layer.

**Org / Tenant.** A Clerk organization. Vocion is multi-tenant by org; every domain row is `org_id`-scoped.

## Observability

**Trace.** A Langfuse record of one logical LLM operation. Every Vocion run produces a trace tagged with `feature:<name>`, `org:<orgId>`, `slug:<slug>`, `userId`. See [Observability](../guides/observability.md).

**Feature.** Closed enum (`agent.chat`, `operation.run`, `eval.judge`, `workflow.step`, `retrieval.search`, …) stamped on every trace. Lets you slice cost and volume by feature in the Langfuse UI.

**Budget.** Per-agent token + USD cap stored in `agent_budget`. Pre-flight check refuses runs over the hard cap. See [Evals + budgets](../../CLAUDE.md#evals--budgets).
