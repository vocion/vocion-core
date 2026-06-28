# Update the docs

Docs live in `vocion-www/docs/`. Match the existing structure — don't invent new shapes.

## Where things go

| Change | File |
|---|---|
| New primitive (tool/source/…) | new `concepts/<name>.md` |
| Enhancement to a primitive | extend the existing `concepts/<name>.md` |
| A how-to | `guides/<task>.md` |
| MCP-exposed tool | add a row to `reference/mcp.md` |
| Breaking change | `upgrades/v<X>-to-v<Y>.md` |
| Any new page | link it from `docs/README.md` |

## Concept-doc format (follow it exactly)

1. `# Title`
2. A `>` blockquote one-line definition.
3. Short positioning paragraph (how it relates to the other primitives).
4. `## What it does` / capability tables.
5. `## Where it lives` — real file paths.
6. `## Runtime` — how it executes.
7. `## Connection to other resources`.
8. `## Next` — cross-links.

Use `concepts/skills.md` and `concepts/tools.md` as the reference templates.

## Linking conventions

- In-docs links are relative (`../guides/x.md`).
- App-side links to docs use the dashboard docs viewer path: `/dashboard/docs/docs/concepts/<x>`.
- Marketing-side links use `/docs/docs/concepts/<x>`.
