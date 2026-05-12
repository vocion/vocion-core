---
title: Vocion docs
description: The open framework for production-ready agents and agentic workflows. Built-in RAG, typed plugins, MCP-native, full observability.
nav_label: Overview
nav_order: 0
---

# Vocion docs

The open framework for **production-ready agents and agentic workflows**. Built-in retrieval, typed plugins, MCP-native, full observability. Self-hostable. No vendor lock-in.

## What problem we solve

The hard parts of taking an agent from prototype to production aren't the model calls — they're everything around them: connecting to your data, chunking it, embedding it, retrieving it, caching it, observing it, governing it, evaluating it. Vocion ships those primitives as a typed, pluggable framework. You bring the data and the prompts; we own the plumbing.

---

## Get started

Pick the path that matches what you want to do.

| You want to… | Read |
|---|---|
| Run Vocion locally + ship your first Skill in 10 min | **[Quickstart](./guides/quickstart.md)** |
| Walk a real end-to-end workflow | **[Worked example: discovery follow-up](./guides/example-discovery-followup.md)** |
| Deploy to production | **[Deployment](./guides/deployment.md)** |
| Connect a new data source | **[Sources](./concepts/sources.md)** |
| Build a custom plugin | **[Writing a plugin](./guides/writing-a-plugin.md)** |

## Foundations

The five things you author. Read all five (~15 min) and you understand Vocion.

- **[Sources](./concepts/sources.md)** — connected systems that feed raw data in. Ingestion, embedding, retrieval, caching.
- **[Objects](./concepts/objects.md)** — first-class business entities your tenant cares about.
- **[Skills](./concepts/skills.md)** — single LLM-powered units of work with typed I/O.
- **[Workflows](./concepts/workflows.md)** — sequences of skills with human approve gates and durable state.
- **[Agents](./concepts/agents.md)** — LLM orchestrators that wire skills + workflows + sources into a named identity.

## How-to

Walk-throughs for recurring tasks.

- [Authoring context](./guides/authoring-context.md) — edit YAML + markdown, sync to DB.
- [Evals](./guides/evals.md) — fixtures alongside each resource; CI catches regressions.
- [Feedback + logs](./guides/feedback-and-logs.md) — rate runs, browse the timeline, close the loop.
- [Self-hosting](./guides/self-hosting.md) — install topology, requirements, local dev.
- [Extracting a tenant repo](./guides/extract-tenant.md) — split `context/<org>/` into its own git repo.

## Operate

- [Deployment](./guides/deployment.md) — AWS single-EC2 reference + scaling pressure points.
- [Observability](./guides/observability.md) — Langfuse stack, trace dimensions, cost slicing.
- [Troubleshooting](./guides/troubleshooting.md) — common failure modes and how to fix them.

## Reference

Stable interfaces you'll return to.

- **[CLI](./reference/cli.md)** — every `npm run` script.
- **[Glossary](./reference/glossary.md)** — controlled vocabulary for every term.
- **[MCP tool reference](./reference/mcp.md)** — every tool the MCP server exposes.
- **[Retrieval config](./reference/retrieval-config.md)** — every knob in `retrieval.yaml`.
- **[Repo architecture](./reference/repo-architecture.md)** — the layered model (core / SDK / plugins / starter / install).
- **[Authentication](./reference/authentication.md)** — Clerk + oRPC auth guards.

## API

Programmatic access for external systems — push objects, trigger runs, poll results, register webhooks.

- **[Overview](./api/README.md)** — API vs MCP vs A2A.
- **[Authentication](./api/authentication.md)** — tenant-scoped Bearer tokens.
- **[Resources](./api/resources.md)** — CRUD on Agents, Skills, Workflows, Objects, Sources.
- **[Runs](./api/runs.md)** — trigger, poll, approve, cancel.
- **[Webhooks](./api/webhooks.md)** — subscribe to completion + approval events.

## Releases

- **[Upgrading from v0.2 to v0.3](./upgrades/v0.2-to-v0.3.md)** — schema, env, Onyx → native retrieval, operations rename.
- [v0.2 — LangChain + deepagents](./upgrades/v0.2-langchain.md)

## License

Apache 2.0.
