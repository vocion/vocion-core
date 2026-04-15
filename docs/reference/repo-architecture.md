# Repo Architecture

Vocion is layered across four kinds of repos. Each layer has a clear job, ships independently, and pins the layer below it.

```
┌──────────────────────────────────────────────────────────┐
│  client install repos                                     │
│  pin core + plugin versions, mount client context,        │
│  hold deploy config + secrets                             │
│  e.g. acme-vocion · metacto-vocion                    │
└──────────────────────────────────────────────────────────┘
                            ▲
                            │  uses
┌──────────────────────────────────────────────────────────┐
│  vocion-starter                                         │
│  forkable example install. empty context, sample plugins, │
│  docker-compose, "run in 10 minutes" focus                │
└──────────────────────────────────────────────────────────┘
                            ▲
                            │  uses
┌──────────────────────────────────────────────────────────┐
│  @vocion/plugin-* (one repo each)                       │
│  slack · gmail · hubspot · zoom · proposal-gamma · …      │
│  independent semver, ship to npm                          │
└──────────────────────────────────────────────────────────┘
                            ▲
                            │  imports
┌──────────────────────────────────────────────────────────┐
│  @vocion/sdk                                            │
│  Skill · Source · PluginContext · PluginManifest          │
│  the stable plugin contract. semver-pinned by core +      │
│  every plugin.                                            │
└──────────────────────────────────────────────────────────┘
                            ▲
                            │  re-exports + provides runtime
┌──────────────────────────────────────────────────────────┐
│  @vocion/core                                           │
│  Next.js app + Postgres schema + service layer + MCP +    │
│  workflow runner + review queue. the framework.           │
└──────────────────────────────────────────────────────────┘
```

## What's a layer for

| Layer | Purpose | Versioned how |
|---|---|---|
| **`@vocion/core`** | The runtime. Hosts skills + workflows + the dashboard. Apache 2.0. | semver. major bump = breaking SDK or schema change. |
| **`@vocion/sdk`** | Stable plugin contract. Imported by core and by every plugin. | semver. core declares a `peerDependencies` range; every plugin declares the same. |
| **`@vocion/plugin-*`** | Connectors + skills shipped as separate npm packages. Each in its own repo. | independent semver. plugin manifest declares a `coreVersion` range; loader checks at boot. |
| **`vocion-starter`** | Forkable example app. The "I want to try this" entry point. | semver tracking the latest core minor. |
| **`<client>-vocion`** | Real production install. Pins exact versions, mounts client context, holds deploy config + secrets. | calver or per-deployment tags, owner's call. |

## Why layered

Same reasons as Backstage, Logstash, Kong, OpenSearch:

- **Independent release cadence.** Slack plugin can ship a fix today without waiting for core. Core can ship without breaking every plugin.
- **Forkability.** A client install is a small repo that a non-core team can own. It depends on stable npm packages, not a sprawling monorepo they have to keep in sync.
- **Ecosystem.** Anyone can publish `@your-org/vocion-plugin-thing`. The contract is stable; the fork tax is low.
- **Audit + supply-chain.** Each repo has its own CI, signing, release notes. A vulnerability in one plugin doesn't force a core release.

## Where things live today (Phase A — pre-extraction)

We're in the **rename phase**. Logical structure is set; physical extraction is staged across phases:

| Logical | Physical (today) | Becomes (Phase B/C) |
|---|---|---|
| `@vocion/core` | the root of this repo (`@vocion/core` in `package.json`) | same path, no move needed |
| `@vocion/sdk` | `src/libs/plugins/` | extracted to `packages/sdk/` (Phase B), then own repo (Phase C) |
| `@vocion/plugin-transcript-highlights` | `src/plugins/samples/transcript-highlights.ts` | `packages/plugins/transcript-highlights/` (Phase B), then own repo (Phase C) |
| `vocion-starter` | does not exist yet | derived from a stripped fork of core (Phase C) |
| `metacto-vocion` | `context/metacto/` + `docs/internal/use-cases/case-studies/` | own repo at OSS launch (Phase C) |

## Phasing

### Phase A (in progress)

Naming + docs only. Validates the model before mechanical changes.

- [x] `package.json` `name` → `@vocion/core`
- [x] env vars: `VOCION_*` canonical, `VOCION_*` aliased for one release
- [x] this doc + plugin authoring guide updated to reference the layered model
- [ ] homepage copy updated to talk about Vocion / Plugins / Starter / Cloud

### Phase B — workspace conversion (next)

Restructure into npm workspaces in this repo. Lets us publish `@vocion/sdk` and one plugin as separate npm packages without yet committing to separate GitHub repos.

```
packages/
├── core/                          # current src/, the Next.js app
├── sdk/                           # extracted from src/libs/plugins/
└── plugins/
    └── transcript-highlights/     # extracted from src/plugins/samples/
```

### Phase C — split into separate repos

Once workspaces are working, `git subtree split` each `packages/*` into its own GitHub repo. Replace workspace deps with npm version pins. Create `vocion-starter` and `metacto-vocion` from stripped copies. This is OSS-launch work (Phase 8 on the internal roadmap).

## Compatibility model

Each plugin declares two compatibility signals:

1. **`peerDependencies` on `@vocion/sdk`** — npm-enforced at install time
   ```json
   { "peerDependencies": { "@vocion/sdk": "^1.0.0" } }
   ```

2. **`coreVersion` field in the plugin manifest** — runtime-enforced at boot
   ```ts
   export default {
     id: 'acme.tools',
     version: '1.2.0',
     coreVersion: '>=1.4 <2',
     skills: [/* ... */],
   };
   ```

The loader checks `coreVersion` at boot. Mismatch → log warning + skip; hard break → refuse to load with a clear error.

Pattern borrowed from Backstage (its `app-config.yaml` package versioning) and Logstash (its plugin gem dependency model).

## Versioning rules

| Change | Bump |
|---|---|
| New optional Skill manifest field | sdk: minor · core: minor |
| Required Skill manifest field | sdk: major · core: major (peer range bump) |
| Drizzle schema change requiring migration | core: minor (with migration) or major (if breaking api) |
| New step type in workflow runner | core: minor |
| Plugin loader API change | sdk: major |
| New plugin internal logic | plugin: minor or patch |

## Naming conventions

| Thing | Format |
|---|---|
| Core npm package | `@vocion/core` |
| SDK npm package | `@vocion/sdk` |
| Built-in plugin npm package | `@vocion/plugin-<name>` |
| Third-party plugin npm package | `@<org>/vocion-plugin-<name>` (recommended) |
| GitHub repo (built-in plugin) | `vocion-plugin-<name>` |
| Starter | `vocion-starter` |
| Client install repo | `<client-slug>-vocion` |

## Related

- [Writing a plugin](../guides/writing-a-plugin.md) — plugin authoring guide
- [Self-hosting](../guides/self-hosting.md) — install topology + deployment
- [MCP reference](./mcp.md) — MCP server tools
- [Authoring context](../guides/authoring-context.md) — context-as-code workflow
