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

Eight ship in core, at `packages/core/templates/plugins/`:

| Plugin | What turning it on gives you | Depends on |
|---|---|---|
| **`wiki`** | The workspace's long-term memory — voice, standing rules, who is who, decisions — as markdown artifacts in a `wiki` folder. Every agent gets the index and the pages that fit in context each turn; any agent writes back through `write_wiki_page`, done for you above a confidence bar and reviewed below it; every save indexes for search; a curator consolidates the week every Friday. | — |
| **`data-rooms`** | One room per engagement: the `data_room` type, the filing skill, the Room keeper and its daily mission, the Data rooms sidebar row, and the after-sync collector that files clear matches and asks about plausible ones. | — |
| **`proposals`** | The Proposal Writer, the house sheet framework, the Proposals app under GTM, a weekly verify mission, and a team graded on documents rendered and verified clean. | `data-rooms` |
| **`growth-loop`** | The loop a go-to-market team actually runs: the `growth_brief` — one claim, one audience, the list of what the piece may NOT say, the acceptance contract, and the number it will be judged on with its baseline, source and attribution model fixed before anything is made; five seats on one team (Demand writes the brief, Production makes one deliverable as an artifact, Quality decides fit-to-publish against that brief and nothing else, Measurement takes the reading on its due date and writes the verdict, Growth promotes inside three limits), Design declared empty; four standing missions, every way an agent acts an automation a person can read on /dashboard/automation; Briefs, Measure and Cost-and-return on top with the team report beside them; and `team.hire_agent` — the team adding a teammate from the catalog, with the daily allowance it is hired under, refused while the workspace is over its own spend, and one Undo from being put back. | — |
| **`production-watch`** | Production errors from Sentry become `incident` records: the `error-watch` job opens one when an issue is new and busy or spiking, with its cause (`deploy`, `code`, `unknown`) read by a model from the release and the stack, resolves it after a quiet hour, and raises `incident.opened` / `incident.updated`. An on-call engineer reads each one and writes the move on it; a person hears once per incident. With `software-factory` on, a deploy-caused incident wakes its Release engineer, and a major code bug becomes a factory request. The watch list is the `error-watch` automation's input. | — |
| **`software-factory`** | Every request — bug, review, email, incident — as one `request` record; the `engineering_task` contract as the record a person reads; the `repo` registry and the `product` with its written promises; five disciplines on one team — a product manager that tags, ranks, recommends in batches of ten and then pauses, ideates as requests and authorizes nothing; a planner (architecture) that triages and writes contracts under three WIP limits; an `external-worker` engineer that executes in its own checkout and attaches the proof; a reviewer (QA) that approves nothing without evidence; the Design seat declared empty — nine standing missions, every way the product manager acts an automation a person can read on /dashboard/automation; the AppCurious portfolio and Releases on top with agent-maintained counters, and the Backlog, Recommendations, Factory floor, Product board, Factory log and Team report as the evidence underneath; one merge bar per risk class and one authorization bar per class, earned or never. | — |
| **`company`** | The Company app: its start page (`/dashboard/apps/company`), where a template — Software Company, Marketing Agency, Support Org — stands a whole function up in one move: teams with a lead and specialists, their measures, missions, automations, conservative trust rules and a budget on every seat, written into the workspace as its own files with you accountable. See [Company](./apps/company.md). | — |
| **`red-team`** | A second reader on everything an agent publishes outside — `gmail.send`, `release.announce`, `notify.requester`, `chat.post_message`: a model from a **different vendor** than the one that wrote it reads it against the workspace's voice rules and wiki and returns typed findings. Serious findings send the draft back to the agent once, then to a person; on a person's own word they are advice and it runs. See [Action gates](#action-gates--a-second-reader-before-anything-goes-out). | — |

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

## Apps — plugins as a person picks them

The dashboard's far-left **app rail** lists apps: Workforce first, then the
prebuilt apps (Software Factory, GTM, Company), then "Add app", which opens the
marketplace. An app is a manifest at `packages/core/templates/apps/<id>/app.yaml`
(`AppManifestSchema`, loaded by `libs/workspace/apps.ts`), not new capability:

```yaml
id: software-factory
name: Software Factory
icon: git-branch # a lucide name the sidebar can draw (features/dashboard/iconByName.ts)
order: 2 # rail position
description: Requests become approved work, verified changes and releases.
plugins: [software-factory, production-watch] # member plugins
surfaces: [] # core surfaces that belong to it
entry: /dashboard/p/products # where picking it lands, when that row is there
nav: [Software factory, Production Watch] # the nav.section labels it owns
```

- **Installed per workspace, derived.** An app is in a workspace exactly when
  one of its plugins (or surfaces) is on there — read from
  `project.enabled_plugins`, so turning a plugin on is still the one way to add
  capability, and there is no app column to keep in step. The app marked
  `core: true` (Workforce) is in every workspace. `hidden: true` holds a slot
  (Assistants) that is never installed until it ships.
- **Each row has one app.** `features/navigation/apps.ts` `splitNavByApp`
  hands every row to the app that lists its plugin, else to the app that owns
  its section; a plugin row in the default `Workspace` section sits under the
  app's first section. Everything no app owns stays with Workforce, exactly
  where it was. A workspace page that names an app's section is a
  customisation of that app and sits inside it — never an app of its own.
- **The URL says the app.** A page an app owns (its pages, its surfaces, a core
  route its plugin owns) opens in that app, so a link or a refresh lands right.
  Shared pages — Chat, Review, the wiki, a record — keep the app you were in.
- **Templates: a function in one move.** An app may ship templates under
  `templates/apps/<id>/templates/<slug>/` — a `template.yaml` with a short
  interview and a `files/` tree laid out like a workspace. Its start page
  (`/dashboard/apps/<id>`, linked from the marketplace) lists them; picking one
  writes the files into the workspace with the answers filled in, turns on the
  app's plugins and the template's own, and applies. The Company app is the
  first: [Company](./apps/company.md).
- **One picker.** Every app's nav starts with the workspace switcher, listing
  only the workspaces that have that app (`apps.forUser` RPC); switching keeps
  the app when the target has it and falls back to Workforce when it does not.
  The marketplace's plugin list is grouped the same way: installed apps, each
  with its plugins as its features, then the apps this workspace lacks.

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
├── pages/<slug>.yaml      # (+ <slug>.md) — list / queue / markdown / configure archetypes
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
| read what an agent publishes before it goes out | `actionGates:` in `plugin.yaml` + `services/gates/actionGate.ts` | put a critic from another vendor in front of any registered action |

The **data-rooms** plugin owns the Data rooms nav row (`DashboardRoute.plugin`)
and the after-sync collector runs only where the plugin is on; its tool set is
present only with the plugin. The **proposals** plugin's `rows: artifacts where
{kind: document, playbook: proposal, verified: true}` measure is what "verified
clean" means on its team report.

## Notifications — the few moments a person hears about

Nothing notifies unless a plugin or the workspace says so. A `notifications:`
block in `plugin.yaml` (or `workspace.yaml`) names each moment: the typed event,
an optional payload filter (the automation `===` rule), who hears it, the title
and body as `{field}` templates over the payload, the record it is about (its
page is where the notification opens) and what makes two events one
notification (`dedupe`, default the record).

```yaml
notifications:
  - kind: needs-person
    label: Needs a person
    event: factory.stopped
    who: accountable # accountable | admins | members | {user: email} | {field: payloadKey}
    title: '{title} needs you'
    body: '{why}. What would unblock it: {unblock}.'
    record: {type: request, id: '{requestId}'}
    dedupe: 'request:{requestId}:ask:{askId}'
```

The applier stores each kind (`notification_rule`); `emitEvent` matches it and
calls one `notify()`, which writes one notification per person and one delivery
per channel — in-app always, iPhone and Chrome for the devices the person
registered, email and Slack when they turn those on — drained by one queue with
retries (`services/notifications/`). A workspace entry with a plugin's `kind`
replaces it; `status: disabled` turns it off. The software-factory plugin
declares exactly two: a feature needs a person, and a feature was released.
Each person chooses channels per kind, quiet hours and devices at
`/dashboard/notifications/settings`, `/api/v1/notifications/preferences` or MCP.

## A Configure page — what drives the plugin, by descriptor

A plugin gets one page that answers *what drives this, and is any of it
asking for me?* by declaring it, with no code:

```yaml
# pages/configure.yaml
slug: configure
title: Configure
description: What drives it — its measures, seats, skills, rules and automations, and what it learned from use.
nav: {section: My plugin, order: 9, secondary: true}
archetype: configure
pluginPanel: false
configure: # optional — omitted, every block in this order
  tabs: [{kind: seats}, {kind: skills}, {kind: automations}, {kind: trust}, {kind: learned}, {kind: measures}]
  aside: [{kind: health}, {kind: attention}, {kind: changes}]
```

Each **tab** is one relation of the plugin, read from the rows core already
keeps and scoped to what the plugin's directory ships: **seats** (its agents —
seat, role, model, missions owned, last run; a row opens the agent in the
preview pane), **skills** (its skills and playbooks, the workspace's
overrides marked), **automations** (trigger, what it does, the newest fire and
its result — a match that could not start included — and a person's pause),
**trust** (each rule in its `trust.yaml` and any class the workspace derived
from it, `git.merge.docs`: runs on its own, or asks), **learned** (rules its
agents follow and where each came from) and **measures** (its team's, each
with its direction and the change against the prior window). The tab is in
`?tab=`.

The **sidebar** stacks under the tabs on a phone: **health** (the measures,
value and change), **attention** (links only, and absent when empty: an
automation that errored, a seat over budget, an override the plugin moved on
from, a rung that demoted itself, a measure nothing reads) and **changes**
(pauses, rung changes, adopted rules and applies — what, who, when, link).

An override is *behind the plugin* when the plugin's copy of the SKILL.md body
changed after the override was last edited: the apply stores the body the
override replaced (`frontmatter.baseSha`) when the override is new or edited,
and keeps it while the override is unchanged. An override applied before this
takes its base on its next apply.

The renderer is `features/dashboard/configure/` over
`services/plugins/configureData.ts`; the tab and block kinds are a closed set
in `libs/workspace/pageFields.ts`.

## Settings — a plugin's options, set per workspace

A plugin declares its options in `plugin.yaml`, each an on/off switch with its
default and what it does in a person's words; a workspace sets them under
`pluginSettings:` in `workspace.yaml`:

```yaml
# plugin.yaml
settings:
  narrateRecordings:
    type: boolean
    default: false
    label: Narrate QA recordings
    description: When a voice is connected, QA adds a second, narrated video to every recording on a feature.

# workspace.yaml
plugins: [software-factory]
pluginSettings:
  software-factory:
    narrateRecordings: true
```

A plugin automation that waits for an option names it with `setting:`, and the
load applies it `disabled` while the option is off (the workspace's value, else
the plugin's default) — so the switch is the automation being there, on the
Configure page's automations tab like every other. A key the plugin does not
declare, or a plugin that is not on, fails the load; `setting:` on a workspace's
own automation does too (it has `status:`).

The software factory's one option, `narrateRecordings`, needs a voice connected
on Connections (the ElevenLabs connector today, through the generic voice
capability in `services/voice/provider.ts`). QA then narrates each recording
filed on a feature in its own voice (`harness.voiceId` on its agent, else the
connector's first voice), under its avatar, and the feature page offers
Recording | Narrated (`services/jobs/narrateRecording.ts`,
`services/artifacts/narrate.ts`).

## Setup — what a plugin needs before it works

A plugin that is on is not necessarily set up: the software factory with no
GitHub connected has seats, missions and pages and nothing to read. A plugin
says once what "set up" means for it:

```yaml
# plugin.yaml
setup:
  connectors: [github] # connector slugs a person must connect
  records: [product, repo] # object types that must hold at least one record
```

Core turns that into a state (`services/plugins/setupState.ts`): a connector
step is done when a live credential exists for it in the workspace (a vendor
login, an app installation or a pasted key alike); a record step is done when
the type has an active record. While any step is undone the workspace's chat
leads with one chip, "Set up your <plugin>", routed to the lead; every agent
can read the same steps with `describe_setup`, each with the link a person
taps — the Connectors page's add flow for that connector, the same one the
`offer_connection` card opens from chat, which runs the vendor login where the
deployment has one (the login is the approval) and takes a pasted key
otherwise. The chip goes away on its own when the last step is done. Core names no connector and no type here: a plugin that declares
no `setup:` has no setup state.

The plugin's Configure page can show the steps as a sidebar block
(`aside: [{kind: setup}]`), with **Reset setup** for a workspace admin: it
disconnects the connectors the declaration names, deletes the records of the
types it names with their artifacts, and rejects proposals still waiting to
create one — so onboarding can be run again from nothing
(`services/plugins/setupReset.ts`, `rpc setup.reset`).

When a credential is stored, core emits `source.connected` (connector,
install id, credential id, who, when), so a plugin automation can carry setup
on from the login. The software factory does not file anything on it: which
of the granted repositories the factory includes is the person's choice, asked
in the conversation the connect card returns them to.

## Factory types — the roles a factory plugin's records play

Core's factory services (`services/factory/`, `libs/actions/factory*`) name no
object type. A factory plugin says once which of its types plays each role:

```yaml
factory:
  types:
    request: request # the ask
    task: engineering_task # the unit a worker builds
    plan: architecture_plan # the approach approved before a build
    environment: environment # where a product runs
    release: release # what shipped
    product: product # what is built
    repo: repo # the code it is built in
```

Every factory service reads its slugs through `factoryTypes(orgId)`
(`libs/factory/types.ts`): the first plugin the workspace has on that declares
the block, else the core's own factory plugin. A plugin that calls its work item
something else runs the same loop with no core edit
(`services/factory/renamedTypes.test.ts`), and `libs/factory/noConcretions.test.ts`
fails the build on a type slug written where a type goes in that code.

Work-row states carry their own tone (`workStateOf` in
`libs/workspace/workQueue.ts`, written as `meta.stateTone`). A `format: badge`
field with `toneFrom` draws that tone wherever its own `tones:` names none, so a
page lists only the tones it changes and a new state is never drawn uncoloured.

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

## Action gates — a second reader before anything goes out

A plugin can declare a gate on the registered actions that publish outside the
workspace. Before an **agent's** proposal of one is queued or run, a critic
reads what it would publish — the action's own review card, so it reads what a
person would — and returns **typed findings**: a severity (`serious` /
`minor`), the rule (`voice` / `fact` / `claim` / `other`), the words quoted,
why, and the fix. Code routes on those fields, never on the critic's prose.

```yaml
# plugin.yaml
actionGates:
  - name: red-team
    label: Red team
    actions: [gmail.send, release.announce, notify.requester, chat.post_message]
    critic:
      vendor: different # a model from a different vendor than the author
      rubric: red-team-critique # a skill the plugin ships
    returns: 1 # serious findings go back to the author this many times, then to a person
```

| What it found | An agent's proposal | A person's own word |
|---|---|---|
| Nothing serious | Goes on to the trust ladder as before; the reading rides on the run | Runs |
| Serious, not yet returned | Returned to the agent with the findings (`RETURNED_FOR_REVISION`); nothing queued; the return is a run closed by `system:gate:<name>` | Runs; the findings come back as one line of advice |
| Serious after `returns` revisions | Held for a person, whatever the trust ladder says; the findings are rows on the card | Runs, with the advice |
| No critic could read it | Held for a person, and the card says why | Runs |

`vendor: different` reads the author's vendor off its agent's `harness` (Claude
on Bedrock is Anthropic's) and takes the first other vendor the workspace can
reach — its own key first, the server's second (`buildChatModelForOrg`). The
call is charged like any other (`chargeModelCall`, feature `gate.action`). The
workspace's `voice.yaml` is checked twice: by the rules it authored (a blocking
rule is a serious finding) and by the critic; its facts are the wiki passages
that bear on the words. The `red-team` plugin is the shipped one; its README
says how to tune it.

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
