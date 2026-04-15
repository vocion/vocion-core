# Skills

> A **Skill** is a single LLM-powered unit of work with typed input and output. It's the smallest composable capability in Vocion.

Skills come in two forms:

1. **Prompt skills** — a YAML manifest + a `prompt.md` template. Authored in `context/<org>/skills/`. Runs the template through an LLM, returns a string (or structured JSON if the prompt asks for it).
2. **Plugin skills** — a TypeScript module implementing the `Skill<Input, Output>` contract from `@vocion/sdk`. Can do anything a TS module can: multi-pass LLM, chunking, external API calls, deterministic post-processing.

Both kinds register the same slug; the runtime picks whichever exists. Plugins win ties (so a partner can upgrade a prompt-only skill to code-powered without migration).

## Where it lives

A prompt skill: `context/<org>/skills/<slug>/skill.yaml` + `prompt.md`:

```yaml
slug: discovery_summary
name: Discovery Summary
description: Extract prospect, pain, budget, timeline from a call transcript
category: query
model: gpt-5.4-mini
temperature: '0.2'
requiresApproval: false
promptFile: prompt.md
inputSchema:
  type: object
  required: [transcript]
  properties:
    transcript: {type: string}
```

A plugin skill ships in an npm package. See [writing a plugin](../guides/writing-a-plugin.md).

## Runtime

Every invocation:

1. Validates `input` against the Zod schema (plugins) or JSON schema (prompt skills).
2. Renders the prompt / runs the code in a Langfuse-traced span.
3. Validates `output`, writes a `skill_run` row with the `context_sha` stamped in.
4. If `requiresApproval: true`, the run lands in the Review Queue before any downstream action.

## Connection to other building blocks

- **[Objects](./objects.md)** — skills typically read/write object records
- **[Workflows](./workflows.md)** — chain multiple skills + HITL gates
- **[Agents](./agents.md)** — pick which skills to call based on user intent

## Next

- [Authoring context](../guides/authoring-context.md) — the edit + apply cycle for prompt skills
- [Writing a plugin](../guides/writing-a-plugin.md) — shipping a Skill as an npm package
