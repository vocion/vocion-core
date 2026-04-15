# Docs overview

The developer documentation for `@vocion/core` — the framework layer. If you're looking for a hosted platform, see [vocion.ai](https://vocion.ai).

## The five resources

Vocion has exactly five things you author. Each lives in your tenant's `context/<org>/` directory as YAML + markdown. Read all five (~15 minutes) and you understand Vocion.

- **[Sources](./concepts/sources.md)** — connected systems that feed raw data in
- **[Objects](./concepts/objects.md)** — the business entities your tenant cares about
- **[Skills](./concepts/skills.md)** — single LLM-powered units of work with typed I/O
- **[Workflows](./concepts/workflows.md)** — sequences of skills with human approve gates
- **[Agents](./concepts/agents.md)** — LLM orchestrators that wire skills + workflows into a named identity

## Guides

Walk-throughs for recurring tasks:

Ordered from first-touch to deepest:

1. **[Quickstart](./guides/quickstart.md)** — zero to your first skill run in 10 minutes
2. **[Worked example: discovery follow-up](./guides/example-discovery-followup.md)** — a real workflow end-to-end (source → object → skills → workflow → agent → audit)
3. **[Authoring context](./guides/authoring-context.md)** — editing the YAML + markdown that grounds your AI
4. **[Evals](./guides/evals.md)** — fixtures alongside each resource; CI catches regressions
5. **[Feedback + audit](./guides/feedback-and-audit.md)** — rating runs, browsing the timeline, closing the loop
6. **[Writing a plugin](./guides/writing-a-plugin.md)** — shipping a Skill as an npm package via `@vocion/sdk`
7. **[Self-hosting](./guides/self-hosting.md)** — running Vocion on your own infra
8. **[Extracting a tenant repo](./guides/extract-tenant.md)** — splitting `context/<org>/` into its own git repo

## API

Programmatic access for external systems — push objects, trigger runs, poll results, register webhooks:

- **[Overview](./api/README.md)** — when to use the API vs MCP vs A2A
- **[Authentication](./api/authentication.md)** — tenant-scoped Bearer tokens
- **[Resources](./api/resources.md)** — CRUD on Agents, Skills, Workflows, Objects, Sources
- **[Runs](./api/runs.md)** — trigger, poll, approve, cancel
- **[Webhooks](./api/webhooks.md)** — subscribe to completion + approval events

## Reference

Stable interfaces you'll return to:

- **[MCP tool reference](./reference/mcp.md)** — every tool the MCP server exposes
- **[Repo architecture](./reference/repo-architecture.md)** — the layered model (core / SDK / plugins / starter / install)
- **[Retrieval config](./reference/retrieval-config.md)** — every knob in `retrieval.yaml`
- **[Authentication](./reference/authentication.md)** — Clerk + oRPC auth guards (for web + server-side code)

## License

Apache 2.0.
