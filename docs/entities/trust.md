# Trust rules — `trust.yaml`

The trust ladder is the one place that says which proposed actions may execute
without a human looking first, how confident the system has to be, and where
each action kind stands on the autonomy ladder. One file per workspace, not
one per rule.

| | |
|---|---|
| **Path** | `trust.yaml` (or `trust.yml`) at the workspace root |
| **Schema** | `TrustManifestSchema` — `packages/core/src/libs/workspace/schemas.ts` |
| **Applied to** | `trust_rule` (the execution record) + `autonomy_policy` (rung, risk tier, floor, evidence) |
| **Runtime** | Auto-approval threshold check in `ActionService`; rung ↔ rule mapping in `services/autonomy/AutonomyService.ts` |
| **Surface** | `/dashboard/autonomy` (the ladder), Needs you (`/dashboard/inbox?kind=proposal`) for what still waits on a person, `GET /api/v1/reviews/auto-executed` for what a rule let through, Autonomy column on `/dashboard/team-report` |
| **Layering** | Workspace-only — a base pack ships no trust rules |

How a kind *earns* a higher rung — what counts as evidence, the defaults per
risk tier, automatic demotion — is the [earned autonomy guide](../guides/earned-autonomy.md).
This page is the file format and the semantics of each field.

## Fields

`rules` is a list; each entry is:

| Field | Type | Default | What it does |
|---|---|---|---|
| `action` | string | required | Registered action id, e.g. `hubspot.update`. Ids today: `gmail.send`, `hubspot.update`, `discovery.review_proposal`, `personalization.enroll`, `objects.propose_candidate`, `objects.update_meta`, `ask.file`, `ask.withdraw`, `plugin.enable`, `wiki.write_page`, `learning.adopt_rule`, `mission.update_notes`, `playbook.write`, `agent.revise_prompt`, `qc.hold`, `qc.release`, `qc.request_rework`, `dataset.add_example` (`packages/core/src/libs/actions/`). |
| `autoApproveAbove` | number 0–1 | required | A pending proposal for this action with confidence at or above this value executes without review. Still audited. Becomes the policy's `min_confidence`. |
| `enabled` | boolean | `false` | Off by default. Flipping it to `false` reverts the rule without deleting it. |
| `rung` | `observe` \| `recommend` \| `assist` \| `execute-with-approval` \| `execute-within-bounds` \| `autonomous` | derived | Where this kind stands on the ladder. Omitted, an enabled rule reads as `execute-within-bounds` and a disabled one as `execute-with-approval`. The rung and `enabled` must agree — a rung at or above `execute-within-bounds` on a disabled rule (or the reverse) is refused at apply, because the page and the gate would disagree about what runs. |
| `risk` | `low` \| `medium` \| `high` | registry default | How much evidence the next rung takes. Defaults: `hubspot.update`, `objects.update_meta`, `ask.file`, `ask.withdraw` and the internal self-improvement kinds low; `gmail.send`, `personalization.enroll`, `objects.propose_candidate`, `qc.release` medium; any other external kind high. |

`risk` may also be given at the top level as a map, for kinds that have no
rule yet but whose tier the workspace wants to state:

```yaml
risk:
  qc.release: high
```

## Example

```yaml
rules:
  - action: hubspot.update
    autoApproveAbove: 0.95
    enabled: true
    rung: execute-within-bounds # optional: this is what enabled: true means
  - action: gmail.send
    autoApproveAbove: 0.99
    enabled: false
    risk: high # ask for high-tier evidence before ever promoting it
risk:
  qc.release: high
```

Keep the list short and the thresholds high. Everything that executes this way
still lands in the review queue's auto-executed list.

## The agent's own writes

Three kinds are how an agent inside the app asks a person and writes on a record, and they are on
the ladder for the same reason a CRM update is — not because a mistake is expensive, but because
whether an agent may do these unasked is the workspace's call:

| Id | Tool | What it does | Default |
|---|---|---|---|
| `ask.file` | `file_ask` | Puts one question on Needs you ([ask](./ask.md)), owned by the agent and bound to its run. | low, reversible (Undo withdraws it while open) → done for you at 0.8 |
| `ask.withdraw` | `withdraw_ask` | Closes an open question the agent filed as superseded, with the reason. | low, reversible (Undo reopens it) → done for you at 0.8 |
| `objects.update_meta` | `update_object` | Writes declared fields on an existing record of an [object type](./object-type.md) — never the title or the lifecycle status. Keyed per type: `objects.update_meta.<objectType>`. | low, reversible (the previous values ride the run) → done for you at 0.8 |

A workspace that wants a person on every question an agent asks, or on every write to its records,
parks the kind:

```yaml
rules:
  - action: ask.file
    autoApproveAbove: 1
    enabled: false
    rung: execute-with-approval
  - action: objects.update_meta.product # one ledger per object type
    autoApproveAbove: 1
    enabled: false
    rung: execute-with-approval
  - action: objects.update_meta.request
    autoApproveAbove: 0.95
    enabled: true # writes at 0.95 and above run; the rest wait for a person
```

Record writes key on the object type — `objects.update_meta.<objectType>` — the way a merge keys
on its risk class, so `product` can be held at approval while `request` earns its way, and each
type's evidence is its own. A rule for the bare `objects.update_meta` binds to nothing. A type
nobody has written a rule for reads the action's own default (low, reversible, done for you):
the ladder finds the registered action behind a derived key by its id prefix
(`actionForPolicyKey`), so a derived key with no rule is never mistaken for an unknown, high-risk
kind. Which types an agent may write at all is not a trust question but the agent's own
`objectTypes:` list — `update_object` refuses a type outside it before anything is proposed.

## The two tables

`trust_rule` is what `ActionService.proposeAction` reads: `{ action_id,
threshold, enabled }` per org. `autonomy_policy` is the policy behind it: the
rung, the risk tier, the confidence floor, who moved the kind and on what
evidence, and a flag for an automatic demotion nobody has looked at yet. Every
rung change writes both, so they cannot disagree:

| Rung | `trust_rule.enabled` | `trust_rule.threshold` |
|---|---|---|
| `observe`, `recommend`, `assist`, `execute-with-approval` | `false` | kept (`min_confidence`), so re-promoting needs no retyping |
| `execute-within-bounds`, `autonomous` | `true` | `min_confidence` |

Where a rung comes from, and which wins:

- **`trust.yaml`** is the source of truth for authored rules. Every workspace
  apply replaces the org's `trust_rule` rows from the file and mirrors each
  named kind into `autonomy_policy` with `source: trust.yaml`. A kind the file
  does not name is left alone.
- **In-app promotions and demotions** (`/dashboard/autonomy`, `router.autonomy.*`)
  write `autonomy_policy` rows with `source: app` and the matching trust rule.
  They are audited on the adoption stream as `autonomy.promoted` /
  `autonomy.demoted`. An apply that names the same kind overwrites them, so to
  keep an in-app promotion, copy it into `trust.yaml` — the page says so under
  the table. An export-to-YAML action is not built; the row holds everything
  the rule needs (`action`, `autoApproveAbove = min_confidence`, `enabled`,
  `rung`, `risk`).
- **Automatic demotions** write `source: system` and set `flagged` with the
  reason. A person clears the flag on the page (*Seen*) or moves the kind.

## Rules

- **Done for you by default.** A kind nobody has written a rule for, and no one
  has parked or held, executes on its own when three things are true: the
  action declares `undo` (it can be put back), its risk tier is `low`, and the
  agent's confidence clears the kind's bar (0.8; `libs/actions/autoAccept.ts`).
  Every such run is listed on the Review queue's Decided tab as "done for you"
  with Undo one click away; an undo counts like the rejection of an
  auto-executed run and can demote the kind. A `trust.yaml` rule for the kind,
  or any rung a person set, replaces the default. Irreversible kinds always ask.
- `autoApproveAbove` must be between 0 and 1 inclusive.
- A rule with `enabled: false` never auto-approves, whatever the threshold says.
- Some kinds are held at `execute-with-approval` by the platform regardless of
  any rule — `gmail.send` (and anything with the `send_email` grant),
  `discovery.review_proposal`, `personalization.enroll`,
  `objects.propose_candidate` (`libs/actions/neverAuto.ts`). A rule for one of
  them is stored but cannot release anything, and the ladder page says so
  instead of counting toward a promotion that would never fire.
- A `reject` or `snooze` recommendation from the agent keeps an item in the
  queue however confident it is — the trust rule reads confidence, not advice,
  and would otherwise run the thing the agent asked us not to.
- **A rule may name a derived id.** An action that serves several ledgers
  declares `policyKeyFor` (`libs/actions/policyKey.ts`): `git.merge` with
  `riskClass: docs` is gated, tiered and scored under `git.merge.docs`, so a
  rule for `git.merge.docs` and one for `git.merge.schema` bind to the same
  registered action and earn separately. A rule for the bare `git.merge` id
  binds to nothing. A derived key with no rule takes its risk tier from the
  action behind it (found by id prefix), so `objects.update_meta.request`
  with nothing said about it is low like its action, not high like an
  unknown kind.
- **A hand-off action** (`Action.manual`, [Needs you → Hand-off actions](../guides/needs-you.md#hand-off-actions))
  rides the ladder like any other kind, and "execute" means *approve for a
  person to do*: a promoted `git.push_branch` above its floor goes to
  `awaiting_execution` on its own, and the worker that proposed it reads that
  back and pushes. Every other factory hand-off is irreversible, so with no
  rule it asks, and with the plugin's rule (`execute-with-approval`,
  `risk: high`) it cannot be approved by any confidence, 1.0 included.
- Approval is an action-level concern. A skill or playbook can never grant itself sending rights — see [skill](./skill.md).

## Related

[Earned autonomy](../guides/earned-autonomy.md) · [Automation](./automation.md) · [Agent](./agent.md) (`harness.interrupts`) · [Ask](./ask.md) · [Team](./team.md) (outcome contract)
