# Company — a company function stood up in one move

**Company** is a prebuilt app in the 5.0 app rail, beside Workforce, Software
Factory and GTM. It answers one question: *I want this function running in this
workspace — what do I do?* Pick a template, answer two or three questions, press
once. A few seconds later the workspace has the teams, the measures, the
missions, the automations, the trust rules and the budgets that function runs
on, with you accountable for it — and it is running: the lead answers in chat,
the automations are on, and the team report grades it from day one.

| | |
|---|---|
| **App manifest** | `packages/core/templates/apps/company/app.yaml` |
| **Templates** | `packages/core/templates/apps/company/templates/<slug>/` |
| **Plugin** | `company` (`packages/core/templates/plugins/company/`) — the app's switch and its nav row |
| **Start page** | `/dashboard/apps/company`: the app's page on Apps, with its templates under "Start from a template" |
| **Mechanism** | `libs/workspace/appTemplates.ts` (load, fill, merge) · `services/apps/AppTemplateService.ts` (write, apply) · RPC `apps.templates`, `apps.installTemplate` |

## The three templates

| Template | Reuses | Its own layer | Lead |
|---|---|---|---|
| **Software Company** | `software-factory`, as it ships (PM, Design, Eng, QA, Release) | A leadership team — chief of staff, company analyst, customer voice — that reads the factory's week against the quarter's goal every Monday, turns what customers say into requests every weekday, and puts the founder's decisions in front of the founder as asks | `company-chief-of-staff` |
| **Marketing Agency** | `growth-loop`, as it ships (brief, production, quality gate, reading) | A client-services team — account director, intake coordinator, client reporter — that turns every client ask into a brief within a business day and drafts each client's Friday report from the loop's readings; a person sends it | `account-director` |
| **Support Org** | — | A support desk — support lead, ticket triager, reply drafter, escalation specialist — graded on customers answered inside a business day, with a weekday queue sweep and a Friday quality review; every reply waits for a person | `support-lead` |

A template never copies a plugin. Where a plugin already runs part of the
function, the template turns it on as it ships and adds only the layer the
plugin does not have (principle 6: one shape, used everywhere).

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
questions. Any app can ship templates — the app's page, its template section
and the install name no app; the company types are concretions and live only
in these directories.

## Related

[Plugins and apps](../plugins.md) · [Team](../entities/team.md) ·
[Mission](../entities/mission.md) · [Automation](../entities/automation.md) ·
[Trust rules](../entities/trust.md) · [Earned autonomy](../guides/earned-autonomy.md) ·
[Budgets](../guides/budgets.md)
