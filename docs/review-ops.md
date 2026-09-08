# Review operations — what ships in the base pack

Human-in-the-loop is the default shape of a Vocion workspace: an agent prepares
work, a person decides. Since base pack `core@2.1.0`, the reusable layer that
loads underneath every workspace ships the review side of that loop as
first-class defaults — two agents and three skills you activate by name instead
of authoring from scratch.

Everything on this page is authored under
[`packages/core/templates/base/`](../packages/core/templates/base) and composes
at load time through the same loader as any other base default. See
[Base pack](./entities/base-pack.md) for the layering rules and
[Workspaces](./workspace.md) for the authoring model.

> **Version note.** `core@2.1.0` is the **base pack** version, read from
> `packages/core/templates/base/pack.yaml`. It is not the `@vocion/core`
> release version and the two move independently — never rewrite an
> `extends: core@<version>` pin to match a release tag.

## The agents

| Agent | File | `agentType` | Skills it mounts |
|---|---|---|---|
| `review-coordinator` | [`agents/review-coordinator.yaml`](../packages/core/templates/base/agents/review-coordinator.yaml) | `mission` | `triage-review-queue`, `draft-for-approval` |
| `queue-analyst` | [`agents/queue-analyst.yaml`](../packages/core/templates/base/agents/queue-analyst.yaml) | `operational` | `queue-health` |

**`review-coordinator`** owns the queue. It groups what is pending, names the
decider for each item, says what the item is waiting on (a person, or missing
data — different problems), and drafts the artifacts that need sign-off. Its
prompt forbids deciding on the human's behalf: it prepares a decision, it does
not make one.

**`queue-analyst`** reports on the queue rather than working it — throughput,
the age of the oldest pending item, override rate, and where the backlog is
concentrated. Separating the two is deliberate: the agent that measures a
process should not be the agent that clears it.

Both are domain-neutral. They carry no revenue nouns, no teams, no people and
no connector list, because a base default ships none of those; a workspace
layers them on.

## The skills

| Skill | File | Output |
|---|---|---|
| `triage-review-queue` | [`skills/triage-review-queue/SKILL.md`](../packages/core/templates/base/skills/triage-review-queue/SKILL.md) | One row per pending item: what, waiting on, decider, age, what it blocks, recommendation — grouped by decider, oldest first |
| `draft-for-approval` | [`skills/draft-for-approval/SKILL.md`](../packages/core/templates/base/skills/draft-for-approval/SKILL.md) | The artifact plus its grounding, assumptions, open questions, and the next-best option if rejected. Explicitly "a DRAFT for human approval" |
| `queue-health` | [`skills/queue-health/SKILL.md`](../packages/core/templates/base/skills/queue-health/SKILL.md) | Headline flow numbers over a stated window, then throughput, override rate, backlog concentration, movers, and up to three recommendations |

Each one ends with an honesty rule — never invent an item, an owner, a
timestamp or a figure; say what is missing instead.

These are authored skills: `slug` / `name` / `description` / `version`
frontmatter plus a markdown body, exactly as documented in
[Skill](./entities/skill.md). A skill is instruction, not enforcement. It does
not gate anything by itself; the gate is an `approve` step in a
[workflow](./entities/workflow.md) or a [trust rule](./entities/trust.md).

## Activating them

Activation is agent-rooted, in your workspace's `workspace.yaml`. Naming an
agent pulls in the skills it declares — you never hand-list them:

```yaml
version: 1
orgId: org_your_id
name: your-workspace
extends: core@2.1.0
use:
  agents: [review-coordinator, queue-analyst]
```

Activating only `review-coordinator` gives you `triage-review-queue` and
`draft-for-approval` and nothing else — `queue-analyst` and `queue-health` stay
out of the loaded set until you name the analyst too.

To adapt a default rather than replace it, drop a thin override beside it and
mark it `extends: core`:

```yaml
# agents/review-coordinator.yaml — in YOUR workspace
extends: core
slug: review-coordinator
name: Review Coordinator (Acme)
systemPrompt: Acme-specific review guidance.
```

Scalars you set replace the base value; the arrays you leave alone (here,
`skills`) are inherited untouched, and the loaded agent reports
`origin: merged`. Full rules in [Base pack](./entities/base-pack.md).

## Verifying it loads

The composition is covered by a test that runs against the real pack directory,
not a fixture copy:

```bash
cd packages/core
npx vitest run src/libs/workspace/review-ops-pack.test.ts src/libs/workspace/proving-vertical.test.ts
```

[`review-ops-pack.test.ts`](../packages/core/src/libs/workspace/review-ops-pack.test.ts)
asserts that `review-coordinator` resolves with `origin: 'core'`, that its two
skills arrive transitively, that activating it does not pull the analyst, and
that `draft-for-approval`'s loaded body says the output is a draft for human
approval.

## Related

[Base pack](./entities/base-pack.md) ·
[Workspace manifest](./entities/workspace-manifest.md) ·
[Skill](./entities/skill.md) ·
[Workflow](./entities/workflow.md) ·
[authoring guide](./workspace.md)
