# Client documents — a sample workspace

The client-engagement workflow as a workspace: one **data room** per
engagement (a `data_room` record — status, cast, sources with their weight,
open items as asks), and the paginated, print-ready **documents** written from
it, each render-verified before it is called done.

Metacto is the seller. Every client in this sample is fictional (Northwind
Logistics, Kestrel Capital…), per `libs/fixtures/realDataGuard.ts`.

```
workspace.yaml                    plugins: [proposals]  — the whole capability, in one line
brand.yaml + brand/               the seller's brand guide: palette tokens, logos, voice rules (read by get_brand)
```

Everything else comes from two **plugins** shipped in core
(`packages/core/templates/plugins/`):

| Plugin | Brings |
|---|---|
| `proposals` | the Proposal Writer, the `proposal-document` skill (framework, components, rules), the **Proposals** app under GTM, a weekly mission and the `proposals` team with its measures |
| `data-rooms` (a dependency of `proposals`) | the `data_room` object type, the `data-rooms` skill, the Room keeper, a daily mission, the Data rooms sidebar row and the after-sync collector, the `data-rooms` team |

A workspace overrides any of it by slug — `agents/proposal-writer.yaml` with
`extends: core` to patch the writer, a same-slug `skills/…/SKILL.md` to
replace a skill whole-file — and turns a plugin off by dropping it from the
list. See `docs/plugins.md`.

Apply it to a project:

```bash
npm run workspace:apply -- templates/workspaces/client-documents --project <id|slug>
```

The E2E project `documents` (`e2e/documents/`) applies this workspace and
replays the chat use cases against it with a scripted model.
