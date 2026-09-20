# Plugins — capability you turn on

A **plugin** is a bundle of agents, skills, object types, missions, automations,
teams, pages and trust rules that a workspace turns on with one line:

```yaml
# workspace.yaml
plugins: [wiki, data-rooms, proposals]
```

It is the abstract rung of the ladder (concrete → abstract → core) made
installable. Core ships the **mechanism** — the artifact noun, the room noun,
the render-verify engine, the tools, the pages' archetypes, the event bus. A
plugin ships the **meaning**: which agent, on what cadence, graded on what,
with which pages and which rules. A workspace ships the **concretion**: its
brand, its overrides, its own facts.

Four ship in core, at `packages/core/templates/plugins/`:

| Plugin | What turning it on gives you | Depends on |
|---|---|---|
| **`wiki`** | The workspace's long-term memory — voice, standing rules, who is who, decisions — as markdown artifacts in a `wiki` folder. Every agent gets the index and the pages that fit in context each turn; any agent writes back through `write_wiki_page`, done for you above a confidence bar and reviewed below it; every save indexes for search; a curator consolidates the week every Friday. | — |
| **`data-rooms`** | One room per engagement: the `data_room` type, the filing skill, the Room keeper and its daily mission, the Data rooms sidebar row, and the after-sync collector that files clear matches and asks about plausible ones. | — |
| **`proposals`** | The Proposal Writer, the house sheet framework, the Proposals app under GTM, a weekly verify mission, and a team graded on documents rendered and verified clean. | `data-rooms` |
| **`software-factory`** | Every request — bug, review, email, incident — as one `request` record; the `engineering_task` contract as the record a person reads; the `repo` registry and the `product` with its written promises; five disciplines on one team — a product manager that tags, ranks, recommends in batches of ten and then pauses, ideates as requests and authorizes nothing; a planner (architecture) that triages and writes contracts under three WIP limits; an `external-worker` engineer that executes in its own checkout and attaches the proof; a reviewer (QA) that approves nothing without evidence; the Design seat declared empty — nine standing missions, every way the product manager acts an automation a person can read on /dashboard/automation; the AppCurious portfolio and Releases on top with agent-maintained counters, and the Backlog, Recommendations, Factory floor, Product board, Factory log and Team report as the evidence underneath; one merge bar per risk class and one authorization bar per class, earned or never. | — |

Each plugin directory has a `README.md` that says what it adds and how to
customise it; the **Marketplace** (`/dashboard/marketplace`, under Build) shows
the same catalogue with an on/off switch, beside the catalog agents this
workspace has not hired. `/dashboard/plugins` 308s there; the per-plugin detail
page stays at `/dashboard/plugins/<slug>`.

## Turning one on

Three doors, one write:

1. **workspace.yaml** — add the slug to `plugins:` and apply (`workspace:apply`,
   the drift banner, or a push in a workspace that applies on deploy).
2. **The Plugins page** — Turn on. Edits `workspace.yaml` (comments preserved)
   and applies; the receipt is the new workspace sha. Under a shared mount
   (several projects, one `WORKSPACE_PATH`) the folder is one project's; a
   toggle from any other project never edits it — it updates that project's
   `enabled_plugins` and says so, naming the file that makes it permanent
   (`workspace/<slug>/workspace.yaml` `plugins:` in the workspace repo).
3. **Chat** — the agent knows which plugins are off and when each helps
   (`plugin.yaml` `recommend.when`). When the conversation calls for one it
   recommends it as a one-tap card; the card is the reversible `plugin.enable`
   action, so under the done-for-you default it runs above the confidence bar
   with Undo one move away.

All three are the same edit to the same file, so the workspace stays the source
of truth and the change is in git the next time someone commits. Dependencies
come along: `plugins: [proposals]` loads `data-rooms` first. Turning a plugin
off removes its pages, nav rows, agents, automations and team from the applied
workspace; nothing it *wrote* (artifacts, rooms, learnings) is deleted.

## How a plugin composes

The loader treats every enabled plugin as an **inherited layer**, exactly like
the base pack (`docs/workspace.md` → *Base packs*):

- A plugin's resources are always active — no `use:` selector.
- A same-slug **workspace** file overrides: `extends: core` to patch a YAML kind
  (agent, object type, mission — merge vocabulary applies, `$append` works),
  whole-file replace for a SKILL.md folder, an automation, a team or a learning
  step; a workspace `trust.yaml` rule for the same action replaces the plugin's.
- Where a plugin ships a slug the **base pack** also ships, the plugin wins —
  `proposals` ships a `proposal-writer` that shadows the pack's brief-only one,
  and a workspace `extends: core` patch lands on the plugin's version.
- Two plugins shipping one slug is an error. A workspace file with a plugin's
  slug and no `extends: core` marker is an error (declare intent, or rename).
- `disable:` reaches a plugin's agents, skills and playbooks. Disabling an
  agent that leads a plugin team or owns its mission means overriding those
  too; each error names the agent.
- Each enabled plugin's version folds into `workspace_sha`
  (`…+data-rooms@1.0.0+proposals@1.0.0`), so a toggle or a new plugin version
  is a new sha and the audit trail says exactly what ran.
- `surfaces:` a plugin declares join the workspace's on `project.enabled_surfaces`;
  the resolved plugin list lands on `project.enabled_plugins`.

Pages (`pages/*.yaml`) ride the same rule: an enabled plugin's pages join the
sidebar, and a workspace page with the same slug replaces the plugin's. A
plugin page's prose (`<slug>.md`) is read beside its YAML.

Plugin pages follow the **project's** enabled plugins, not only the mounted
folder's. One deployment mounts one workspace (`WORKSPACE_PATH`) but hosts
several projects, and each project's apply records its own list on
`project.enabled_plugins`. Page discovery reads the mounted folder's pages and
its plugins' as before, then adds the pages of every plugin the current
project has on, from core's `templates/plugins/<slug>/pages` — the same
pipeline, the same "workspace first, plugin yields" dedupe, the same
`plugin:<slug>` origin. So a project that turned on `software-factory` sees
its Factory floor even when the mounted `workspace.yaml` never named the
plugin, and a project that did not sees nothing extra.

**Where its rows sit** is decided once, in `plugin.yaml` `nav.section`
(`features/navigation/pluginNav.ts`): the plugin's pages, the core routes it
owns (`DashboardRoute.plugin`, e.g. Data rooms) and the surfaces it switches on
all land in that section. The default is `Workspace` — beside Chat and Review,
pinned by default. A plugin names a section only when it is part of a named
app: `proposals` says `nav: {section: GTM}` and sits under GTM with the
workspace's own Personalization and Discovery surfaces, one heading.

## Anatomy of a plugin

```
templates/plugins/<slug>/
├── plugin.yaml            # identity: slug, name, version, description, depends, surfaces, recommend
├── README.md              # what it adds, how to customise — shown on the Plugins page
├── agents/<slug>.yaml     # + .system-prompt.md
├── skills/<slug>/SKILL.md
├── playbooks/<slug>/SKILL.md
├── objects/<slug>/type.yaml
├── missions/<slug>.yaml
├── automations/<slug>.yaml
├── teams/<slug>.yaml      # the plugin's team, with the measures it is graded on
├── pages/<slug>.yaml      # (+ <slug>.md) — list / queue / markdown archetypes
└── trust.yaml             # confidence bars for the plugin's own actions
```

`plugin.yaml`:

```yaml
slug: wiki
name: Wiki
version: 1.0.0
description: One line — what turning it on gives a person.
depends: [] # other plugin slugs, loaded first
surfaces: [] # core-registered surfaces to switch on (features/navigation/surfaces.ts)
nav: {section: Workspace} # where ALL its rows sit — pages, owned routes, surfaces. Default Workspace; name an app (GTM) to join it
recommend:
  when: # what the chat reads to suggest it
    - a person repeats a standing fact or rule they have said before
  connectors: [] # connector slugs it works better with
```

A plugin's slug must match its directory name. Everything else is the same
schema a workspace uses (`docs/entities/`), read as shipped (no `{{env}}`
substitution, not sha-tracked — the version is the provenance).

## What a plugin can and cannot do

A plugin is **YAML and markdown**. It composes what core already knows how to
run: agents on missions, automations on schedules and events, skills, object
types, pages over core data, measures over core rows, trust rules over
registered actions. That is the point — the next capability costs a
descriptor, not a subsystem (principle 7).

What a plugin cannot do on its own is add a **tool**, an **action**, an
**artifact kind**, an **event**, a **built-in job**, or a **measure row kind**.
Those are core code, and they are where the ladder's third rung earns its
place. The wiki plugin needed four such seams, each generic:

| Plugin need | Core mechanism it became | Any other plugin can now… |
|---|---|---|
| index a page for search on every save | `artifact.saved` event + `index-artifact` job | index any folder of artifacts with one automation |
| write a page done-for-you with a bar | `wiki.write_page` action (reversible) + `write_wiki_page` tool | — (wiki-specific, gated on the plugin) |
| recommend itself from chat | `list_capabilities` tool, the capabilities note in the system prompt, `plugin.enable` action | be recommended and turned on from a conversation |
| be graded on pages that exist | `rows: artifacts` (+ `where`) measure source | count any kind, folder, playbook, verified state of artifact |

The **data-rooms** plugin owns the Data rooms nav row (`DashboardRoute.plugin`)
and the after-sync collector runs only where the plugin is on; its tool set is
present only with the plugin. The **proposals** plugin's `rows: artifacts where
{kind: document, playbook: proposal, verified: true}` measure is what "verified
clean" means on its team report.

## Measures and missions — a plugin that improves itself

Every plugin ships a **team** with **measures**, so the team report grades it
from the day it is on: rooms opened and sources filed; proposals rendered and
verified clean; wiki pages written by agents and edits a person had to decide.
Every plugin ships a **mission** on a **schedule**, so it keeps working without
anyone asking: the keeper's weekday room check, the writer's Monday verify pass,
the curator's Friday consolidation. Corrections in chat become learnings, room
rules, or wiki pages; the trust ladder promotes what people keep approving.

That is the loop the manifesto describes — outcome → work → measure → learn →
improve → automate — inside one directory.

## Writing your own

1. Start from the shipped one nearest your shape. Copy the directory, rename the
   slug (directory and `plugin.yaml` must agree), bump nothing else.
2. Keep every fixture fictional (`realDataGuard.test.ts` scans plugin files too).
3. Give it a team with at least one measure that reads a row Vocion keeps, and
   a mission with a schedule. A plugin with no measure has no outcome.
4. Say when the chat should recommend it (`recommend.when`) in the words a
   person would use, not the feature's name.
5. Load it in a test: `loadWorkspace(dir)` with `plugins: [<slug>]` — see
   `libs/workspace/plugins.test.ts`.

If the plugin needs a tool or an action core does not have, that is a core
change; make it generic (the seam, not the feature), then use it from YAML.
