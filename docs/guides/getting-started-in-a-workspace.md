# Getting started in a new workspace

A new shared workspace opens on its **workspace lead**, not on a blank page.
The lead introduces itself in one sentence and offers three ways in:

- **Set up this workspace with me** — a short interview, then a plan.
- **Connect a system** — which systems the work lives in, then a connect card for each.
- **Start from a template** — what the team does, then the apps and templates that fit.

Everything after that happens in the conversation. The person answers at most
three questions, and the lead puts the plan in front of them as one-click
cards. Each card runs when the person presses it, as their own action, and
can be undone from the same card. The sidebar's **Getting started · N of 4**
checklist counts what the workspace has really done.

This guide covers what each part does and where it lives in core. The
tutorial for authoring a workspace as files is [Getting started — build an
agent workforce from zero](../getting-started.md).

## The workspace lead

| | |
|---|---|
| **Template** | `packages/core/templates/workspace/agents/workspace-lead.yaml` |
| **Its skill** | `packages/core/templates/workspace/skills/workspace-setup/SKILL.md` |
| **Seeded by** | `ensureWorkspaceLead` in `services/workspace/workspaceLead.ts` |
| **Shared definition** | `WORKSPACE_LEAD_SLUG`, `WORKSPACE_SETUP_SKILL` in `libs/workspace/workspaceLead.ts` |

The lead is a core template written into the workspace as an ordinary agent
row. It is the same pattern the personal workspace's assistant uses
(`templates/personal/agents/assistant.yaml`). It is generic: it names no
company, industry, app, plugin, connector or catalog role. What it sets up
comes from what the person says, read against what the installation ships. A
test in `workspaceLead.test.ts` fails if the template or its skill names any of
them.

**When it is seeded.**

- When core creates a shared workspace: the first workspace of a new Org
  (`scripts/support/createLocalUser.ts`) and `setup-local-projects.ts`.
- Lazily, the first time anyone opens chat in a shared workspace with **no
  agent at all** (`loadChatAgentContext`), or sends a turn there (the stream
  route). This covers a workspace made before the lead existed.

**What it never does.**

- It is never written into a workspace that already has an agent, whether
  authored, hired or retired. A workspace with a team does not get a second
  lead it did not ask for.
- It is never written into a personal workspace, which has its own assistant.
- It never writes outside the one workspace it was asked about. Every read
  and write is keyed on that project id.
- It never adds a second row. Concurrent calls lose quietly to the
  `(org_id, slug)` unique index, so twice is once.

Once written, the row belongs to the workspace. A voice someone sets, a cap an
admin puts on it, or an edited prompt all survive. A change to the template
reaches new workspaces only.

**Routing.** The lead becomes the workspace's `lead` (`project.lead_agent_slug`)
unless the workspace already names one. While it is the only agent it answers
everything. As agents arrive, it is the default the router falls back to below
a confidence of 0.5 ([agent routing](../entities/agent.md#routing--who-answers-a-message-nobody-addressed)).

**Through `workspace:apply`.** The seeded lead stays, and stays the lead,
until `workspace.yaml` names a `lead:` of its own. Then it retires like any
agent the YAML no longer names (`seededLeadSurvives`). So turning on an app in
the middle of setup, which applies the workspace, never takes away the agent
the person is talking to. A template that names its own lead takes over. If
the workspace later stops naming a lead (a template undone), the seeded lead
comes back as the lead. The exception is a seeded lead a person retired
themselves (a pause hold), which stays retired.

## The empty state

A chat whose only agent is the seeded lead opens on `LeadIntro`
(`features/dashboard/chat/LeadIntro.tsx`):

- the lead's mark and name;
- one sentence (`Onboarding.intro`);
- three starters.

Each starter sends its ask to the lead, the way a suggestion chip does. As
soon as the team has a second agent, the chat opens on the usual empty state
with the workspace's own suggestions.

If a workspace has no agent at all (one could not be seeded, or every one was
retired), the chat says so in words for the person: *"This workspace has no
agents yet. Hire one from the agent catalog."* (`NoAgentsYet`).

## The interview and the plan

The lead's skill (`workspace-setup`) is a short procedure:

1. **Look first.** Call `setup_options` to see what is done and what is on
   offer.
2. **Ask three questions at most, one at a time, each with an example.** What
   the team does, one job it does every week, and which systems the work lives
   in. Skip any question already answered. Stop asking when the person says
   "you pick".
3. **Propose the plan with one `propose_setup` call.** The plan has three to
   six steps, each with one line of *why* in the team's own words.

`propose_setup` takes typed steps and emits typed cards. No plan is ever
parsed back out of prose.

| Step `kind` | `id` | The card | What a press runs |
|---|---|---|---|
| `app` | app id (`templates/apps/<id>`) | "Add …" | `app.install` turns on the plugins the app is made of, in one write and one apply — the same write the Apps page's Add makes (`plugins.addApp`). Undo puts the earlier list back. |
| `template` | `<app>/<template>`, with `answers` | "Start from …" | `app.install_template` runs the install an app's start page makes (`AppTemplateService`, e.g. the Company app's Software Company, Marketing Agency and Support Org). The template's teams, agents, missions, automations and trust rules are written into the workspace's own folder. The interview is filled from what the person said, with defaults for the rest. The person who decided is named accountable. Undo removes what the install created, puts `workspace.yaml` and the trust file back, and applies. A workspace applied from git has nowhere to write one here, and `setup_options` says so. |
| `plugin` | plugin slug | "Turn on …" | `plugin.enable`. Undo restores the list. |
| `connect` | connector slug | the ordinary connect card | The connect flow (`offer_connection`), returning to the conversation. |
| `hire` | catalog role slug | "Hire …", with its daily cap | `team.hire_agent` at the workspace's default daily allowance. Undo removes the agent, its budget and any team the hire created. |
| `invite` | — (`emails`) | "Invite …" | `members.invite` makes the same invites as the Members page: emailed when this server sends mail ([invites.md](invites.md)), and on Members to share either way. Undo withdraws any invite nobody has used. Admins only, as on the Members page. |

Each step is checked with its action's own `precheck` before it becomes a card.
A step that could only fail is left out, and the lead reads why in the tool
result. Examples: an app already added, a template already set up or with no
folder to write into, a role already hired, a system already connected, an
address already in the Org, or an invite from someone who is not an admin. The cards end the lead's turn like any card a person acts on, so
it says what the plan gets them *before* it calls the tool.

### What a press does

A setup card (`features/dashboard/chat/cards/SetupCard.tsx`) is one step: its
title, its why, and one button. Pressing it:

1. **Runs the step as the person.** `review.actAsPerson` proposes the action
   with the person as principal, the same path a person's own word takes in
   chat. It runs within their authority and the run records them. An action
   that waits for a person whatever happens comes back `pending`, and the card
   approves it in the same press.
2. **Records the run on the card, with no words written for the person.** The
   card calls `conversations.recordCardDecision` with `turn: false`. A reload
   draws Done and Undo where the button was. The lead's next turn reads what
   became of each step from its run (`withLiveCardState`).
3. **Shows Done, Undo and where the result lives.** "Open Members" or the
   app's own page, for example.
4. **Tells the checklist.** It fires `vocion:workspace-setup-changed`.

A reply's setup cards render as one column under a "Setup plan" eyebrow
(`cards/SetupPlan.tsx`), in the lead's order, instead of the
suggested-actions strip. A plan should be read whole.

## Getting started · N of 4

`features/dashboard/GettingStartedChecklist.tsx`, in the sidebar where the
"Invite team members" box sat. Each tick is read from the workspace
(`services/workspace/gettingStarted.ts`, `nav.gettingStarted`), never ticked by
hand:

| Step | Done when |
|---|---|
| Connect a system | A connector the workspace reads has a live login or key. A revoked or expired one is not connected. |
| Add an app or template | A plugin is on (`project.enabled_plugins`). An app and a template are the plugins they turn on. |
| Hire an agent | An active agent besides the seeded lead. |
| Invite someone | Someone else is in the Org, or an unexpired invite is out. |

- A step left to do opens the chat with the lead's ask already written.
- A step done opens the page where it lives.
- The checklist re-reads when a setup card runs or is undone, when the page
  changes, and when the window regains focus.
- It can be dismissed, which is remembered per person per workspace (nav
  prefs), and it goes away by itself at 4 of 4.
- It replaces the invite box in shared workspaces. A personal workspace keeps
  the old box.

## Testing it

- **Unit tests:**
  - `workspaceLead.test.ts`: idempotent, tenant-scoped, never a second lead, no concretions in the template.
  - `gettingStarted.test.ts`.
  - `app-install.test.ts`.
  - `members-invite.test.ts`.
  - `setupWorkspace.test.ts`.
  - `applier.seededLead.test.ts`.
  - `agentOptions.seed.test.ts`.
  - `turnLedger.keepCards.test.ts`.
- **UI:** `LeadIntro.test.tsx`, `cards/SetupCard.test.tsx`,
  `GettingStartedChecklist.test.tsx`.
- **Storybook:** `Chat/LeadIntro`, `Chat/SetupPlan`,
  `Dashboard/GettingStartedChecklist`.
- **End to end:** `npm run e2e:onboarding` runs `e2e/onboarding` against the
  scripted model. It covers a new workspace, the interview, the plan, each
  card run and undone, the checklist counting, and a reload.

## Related

[Agent](../entities/agent.md) · [Agent tools that write](./agent-tools.md) · [Connecting a tool](./connect.md) · [Plugins](../plugins.md)
