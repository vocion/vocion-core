# Company

A **company function stood up in one move.** Turn Company on and the Company
app joins the rail; its start page (`/dashboard/apps/company`) offers three
templates. Pick one, answer two or three questions, and the workspace gets the
function running: teams with a lead and specialists, the measures each team is
graded on, missions with schedules, the automations that keep them, trust rules
on conservative rungs and a spend cap on every seat — with you accountable.

This plugin ships no agents of its own. What it gives a workspace is the door;
the function arrives as the workspace's own files when a template is picked.

**The three templates**

| Template | Turns on | Stands up |
|---|---|---|
| **Software Company** | `software-factory`, as it ships | A leadership team (chief of staff, company analyst, customer voice) that reads the factory's week against the quarter's goal every Monday, turns what customers say into requests every weekday, and puts the founder's decisions in front of the founder as asks. |
| **Marketing Agency** | `growth-loop`, as it ships | A client-services team (account director, intake coordinator, client reporter) that turns every client ask into a brief within a business day and drafts each client's Friday report from the loop's readings — a person sends it. |
| **Support Org** | — | A support desk (support lead, ticket triager, reply drafter, escalation specialist) graded on customers answered inside a business day, with a weekday queue sweep and a Friday quality review. Every reply waits for a person. |

The building and the making are never copied: Software Company reuses the
software factory's five seats, and Marketing Agency reuses the growth loop's
brief, production, quality gate and reading. The template adds the layer the
plugin does not have.

**Describe your own**

None of the three fits? The fourth card drafts one from your own words: say
what the function does and for whom, answer the same short interview, and a
plan is drafted — reusing catalog roles and plugins where they fit, a new seat
only where none does. You see it before anything exists (teams, agents,
missions, automations — rename anything, remove what you do not want) and one
Create stands it up. From chat, an agent can draft it too and offer it as one
card. Every install, template or not, has Undo on its receipt and puts the
whole function back as one unit.

**The interview**

Two or three questions, each with a default so an empty form still stands the
function up: what the company is called (the workspace's name by default), a
template-specific line (what you build, who your clients are, what customers
come to you for), and the outcome the function owes this quarter. The answers
fill the team names, the team goals, the missions and the agents' prompts.

**What installing does**

1. Writes the template's files into the workspace folder — `teams/`,
   `agents/`, `missions/`, `automations/`, `skills/` — with the answers filled
   in, and merges its rules into `trust.yaml`.
2. Turns on `company` and the template's plugins in `workspace.yaml`, sets the
   template's lead as the workspace `lead:` and you as `accountableUser:` where
   the workspace names neither, and applies.
3. Names you accountable on every team it brings.

**Re-installing is safe.** A file already there with the same content is left
unchanged; a file someone has edited since is **kept** as they left it and
named in the receipt; a trust rule for an action the workspace already rules on
is never moved; a plugin already on stays on. Installing twice is installing
once.

**Every rule starts off.** Each template's `trust.yaml` ships every rule
`enabled: false` on a rung no higher than `execute-with-approval`: the agents
propose, a person decides, and a person raises one action at a time once the
record earns it. Anything that reaches a customer or a client — a reply, a
report, an update — waits for a person whatever the rules say.

**Applied from git?** When the workspace on this host is another project's, or
read-only, nothing is written: the start page says so and names the folder in
the workspace repo where the template's files go.

**Customising**

What a template stands up is ordinary workspace context — edit the team's
measures, an agent's prompt or budget, a mission's schedule, in the workspace
like anything else. To make a new company type, add a directory under
`packages/core/templates/apps/company/templates/` with a `template.yaml` and a
`files/` tree; see `docs/apps/company.md`.
