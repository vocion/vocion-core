# Compiles docs

This is the developer documentation for `@compiles/core` — the framework layer. If you're looking for a hosted platform, see [compiles.ai](https://compiles.ai).

## The five building blocks

Compiles has exactly five things you author. Each lives in your tenant's `context/<org>/` directory as YAML + markdown. Read all five (~15 minutes) and you understand Compiles.

- **[Sources](./concepts/sources.md)** — connected systems that feed raw data in
- **[Objects](./concepts/objects.md)** — the business entities your tenant cares about
- **[Skills](./concepts/skills.md)** — single LLM-powered units of work with typed I/O
- **[Workflows](./concepts/workflows.md)** — sequences of skills with human approve gates
- **[Agents](./concepts/agents.md)** — LLM orchestrators that wire skills + workflows into a named identity

## Guides

Walk-throughs for recurring tasks:

- **[Quickstart](./guides/quickstart.md)** — zero to your first skill run in 10 minutes
- **[Authoring context](./guides/authoring-context.md)** — editing the YAML + markdown that grounds your AI
- **[Writing a plugin](./guides/writing-a-plugin.md)** — shipping a Skill as an npm package via `@compiles/sdk`
- **[Self-hosting](./guides/self-hosting.md)** — running Compiles on your own infra
- **[Extracting a tenant repo](./guides/extract-tenant.md)** — splitting `context/<org>/` into its own git repo

## Reference

Stable interfaces you'll return to:

- **[MCP tool reference](./reference/mcp.md)** — every tool the MCP server exposes
- **[Repo architecture](./reference/repo-architecture.md)** — the layered model (core / SDK / plugins / starter / install)
- **[Retrieval config](./reference/retrieval-config.md)** — every knob in `retrieval.yaml`
- **[Authentication](./reference/authentication.md)** — Clerk + oRPC auth guards

## License

Apache 2.0.
