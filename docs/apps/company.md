# Company — a company function stood up in one move

**Company** is a prebuilt app in the 5.0 app rail, beside Workforce, Software
Factory and GTM. It answers one question: *I want this function running in this
workspace — what do I do?* Pick a template — or describe your own — answer two or three questions,
press once. A few seconds later the workspace has the teams, the measures, the
missions, the automations, the trust rules and the budgets that function runs
on, with you accountable for it — and it is running: the lead answers in chat,
the automations are on, and the team report grades it from day one.

| | |
|---|---|
| **App manifest** | `packages/core/templates/apps/company/app.yaml` |
| **Templates** | `packages/core/templates/apps/company/templates/<slug>/` |
| **Plugin** | `company` (`packages/core/templates/plugins/company/`) — the app's switch and its nav row |
| **Start page** | `/dashboard/apps/company` — also reached from the Marketplace ("Start from a template") |
| **Mechanism** | `libs/workspace/appTemplates.ts` (load, fill, merge) · `libs/workspace/functionPlan.ts` (a drafted plan: schema, citations, files) · `services/apps/AppTemplateService.ts` (write, apply, undo) · `services/apps/FunctionDraftService.ts` (draft) · action `apps.install` · RPC `apps.templates`, `apps.installTemplate`, `apps.draftPlan`, `apps.createFromPlan` |

## The three templates

| Template | Reuses | Its own layer | Lead |
|---|---|---|---|
| **Software Company** | `software-factory`, as it ships (PM, Design, Eng, QA, Release) | A leadership team — chief of staff, company analyst, customer voice — that reads the factory's week against the quarter's goal every Monday, turns what customers say into requests every weekday, and puts the founder's decisions in front of the founder as asks | `company-chief-of-staff` |
| **Marketing Agency** | `growth-loop`, as it ships (brief, production, quality gate, reading) | A client-services team — account director, intake coordinator, client reporter — that turns every client ask into a brief within a business day and drafts each client's Friday report from the loop's readings; a person sends it | `account-director` |
| **Support Org** | — | A support desk — support lead, ticket triager, reply drafter, escalation specialist — graded on customers answered inside a business day, with a weekday queue sweep and a Friday quality review; every reply waits for a person | `support-lead` |

A template never copies a plugin. Where a plugin already runs part of the
function, the template turns it on as it ships and adds only the layer the
plugin does not have (principle 6: one shape, used everywhere).

## Describe your own — a blank start

Not a software company, an agency or a support org? The fourth card on the
start page is **Describe your own**. The person says what the function does,
in their own words, and answers the same short interview (what the company is
called, what it should deliver this quarter). Then:

1. **A model drafts a plan** (`services/apps/FunctionDraftService.ts`) — the
   same pieces a template ships: one to three teams, each with a lead and
   specialists; each agent's role, goal and prompt; missions with measures;
   automations that keep them; conservative trust bars; a daily budget on
   every seat. The answer is **typed**: one JSON object that
   `FunctionPlanSchema` (`libs/workspace/functionPlan.ts`) parses, that cites
   only what exists (`planProblems`), and whose rendered files pass the
   workspace loader's own schemas (`renderedProblems`). An answer that does
   not is sent back once with every problem named; a second miss fails in
   words. Nothing is read out of prose.
2. **It reuses before it writes.** The model is offered the agent catalog, the
   plugins, this app's templates and the registered actions. A catalog role
   that fits is **hired as itself** (its prompt and skills copied from the
   catalog, `source.kind: catalog`, with why); a plugin that already runs part
   of the function is turned on as it ships; the closest template is cited. A
   new seat is written only where nothing fits.
3. **The preview** shows the plan before anything exists — teams, then each
   team's agents, then what each agent owns (missions and the automations
   that keep them), with what it reuses cited, the budgets totalled and the
   trust bars stated. Every name is editable and every item removable (a
   team's lead goes with its team; an agent takes its missions and
   automations; a mission takes the automations that keep it).
4. **One Create** stands it up as the person's own action, through the same
   install a template uses — so a blank start and a template produce the same
   kind of records — with **Undo** on the receipt.

The drafting brief is the app's own file (`templates/apps/company/blank.md`,
named by `app.yaml` `blank.brief`); core names no function. The draft is
charged to the workspace (`chargeModelCall`, feature `app.draft`) and refused,
in words, while a hard budget cap it would land on is spent (`preflightCheck`).

**From chat.** While Company is on, agents carry `draft_function_plan`: a
person describes a function, the agent drafts it through the same service and
puts it in front of them as **one card** — Create stands it up as their
decision (an agent can only offer it: `apps.install` holds for a person), and
the card's link opens the full preview at `/dashboard/apps/company?start=blank`.
The onboarding card that offers "Start from a template" can offer "Describe
your own" through the same tool or `blankStartHref(appId)`
(`services/agents/tools/draftFunction.ts`).

## Undo, as one unit

Every install — a template or a plan — is a run of `apps.install`
(`libs/actions/apps-install.ts`), and its Undo puts the whole thing back:
every file it wrote returns to what was there before (a file it created is
removed), the workspace is applied again so the agents, missions and
automations it brought retire and the trust bars return, and the teams and
budget rows it created are removed. If a file it wrote has changed since, the
undo refuses, names the file and changes nothing — it never discards a
person's edit, and never leaves half a function behind.

## What one install does

1. **Answers the interview.** Two or three questions, each prefilled: what the
   company is called (the workspace's name), a line about what it does, and
   what the function owes this quarter. The answers fill the team names, their
   goals and the agents' prompts. An answer is a value, never markup: the YAML is
   filled scalar by scalar through the parsed document, so a colon or a quote in
   an answer cannot change a file's shape.
2. **Writes the template's files into the workspace folder** — `teams/`,
   `agents/` (with their prompts), `missions/`, `automations/`, `skills/` — and
   merges its `trust.yaml` into the workspace's, adding a rule only for an action
   the workspace does not rule on yet. Every team names the installing person as
   `accountableUser`; every agent carries a `budget:`; every trust rule starts
   off (`enabled: false`, at or below `execute-with-approval`).
3. **Edits `workspace.yaml` in place**, comments kept: turns on `company` and the
   template's plugins, and — only where the workspace names none — sets `lead:`
   to the template's lead and `accountableUser:` to you.
4. **Loads and applies**, the same edit-then-apply the plugin switch makes. The
   receipt says what was created, what was already there, which files you had
   changed and were left alone, and links to the lead and the team report.

What lands is ordinary context-as-code. From then on it is the workspace's own:
edit a team, a prompt or a bar like anything a person wrote.

## Guarantees

- **Idempotent.** A file already there with the same content is unchanged; a
  plugin already on stays on; a lead or accountable person already named stays;
  the apply upserts. Installing twice is installing once.
- **A person's edit is kept.** A file that differs from what the template would
  write is never overwritten — the receipt names it.
- **Tenant-scoped.** Everything is written to the one workspace folder that is
  the project's own and applied with that project's id. Another project's
  folder is never written; another project's rows are never touched.
- **All or nothing.** An unanswered question is named on the question, and
  nothing is written. Files that would not load are put back as they were —
  every file the install wrote is restored or removed — and the reason is said.
- **Applied from git? The repo is the door.** On a host where the workspace
  folder is another project's, or read-only, the start page says so and names
  `workspace/<slug>/` in the workspace repo instead of offering the action —
  the same judgement the plugin switch makes (`pluginWriteTarget`).
- **Admins set it up.** A member sees what each template stands up and who can
  set it up.

## Adding a template

A template is a directory under an app's `templates/`:

```
templates/apps/<app>/templates/<slug>/
├── template.yaml        # AppTemplateManifestSchema
└── files/               # laid out like a workspace
    ├── teams/<slug>.yaml
    ├── agents/<slug>.yaml + <slug>.system-prompt.md
    ├── missions/<slug>.yaml
    ├── automations/<slug>.yaml
    ├── skills/<slug>/SKILL.md
    └── trust.yaml
```

```yaml
slug: support-org
name: Support Org
icon: life-buoy # a name iconByName.ts can draw
order: 3
description: One line — the function it stands up.
includes: # the card's list, in a person's words
  - A support team — a lead and three specialists, with you accountable
plugins: [] # plugins it turns on as they ship — never copied
lead: support-lead # becomes the workspace lead where there is none
interview: # one to three questions
  - key: company
    question: What is the company called?
    default: '{{workspace.name}}'
  - key: goal
    question: What should the desk deliver this quarter?
    default: Every customer hears back within one business day.
```

Placeholders are `{{key}}` — an interview key, or `installer.email`,
`installer.name`, `workspace.name`. A template may write only `agents/`,
`teams/`, `missions/`, `automations/`, `skills/`, `playbooks/`, `pages/`,
`learnings/` and `trust.yaml`; the loader refuses one that writes anywhere else
or uses a placeholder nothing answers.

`libs/workspace/appTemplates.test.ts` stands every shipped template up in a
fresh workspace through the real loader and holds it to the bar: a team with a
lead and specialists, the installer accountable, measures, missions and
automations, a budget on every agent, every trust rule off, two or three
questions. Any app can ship templates — the start page, the marketplace link
and the install name no app; the company types are concretions and live only
in these directories.

## Related

[Plugins and apps](../plugins.md) · [Team](../entities/team.md) ·
[Mission](../entities/mission.md) · [Automation](../entities/automation.md) ·
[Trust rules](../entities/trust.md) · [Earned autonomy](../guides/earned-autonomy.md) ·
[Budgets](../guides/budgets.md)
