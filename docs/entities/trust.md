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
| **Surface** | `/dashboard/autonomy` (the ladder), `/dashboard/review` (auto-executed list), Autonomy column on `/dashboard/team-report` |
| **Layering** | Workspace-only — a base pack ships no trust rules |

How a kind *earns* a higher rung — what counts as evidence, the defaults per
risk tier, automatic demotion — is the [earned autonomy guide](../guides/earned-autonomy.md).
This page is the file format and the semantics of each field.

## Fields

`rules` is a list; each entry is:

| Field | Type | Default | What it does |
|---|---|---|---|
| `action` | string | required | Registered action id, e.g. `hubspot.update`. Ids today: `gmail.send`, `hubspot.update`, `discovery.review_proposal`, `personalization.enroll`, `objects.propose_candidate`, `qc.hold`, `qc.release`, `qc.request_rework`, `dataset.add_example` (`packages/core/src/libs/actions/`). |
| `autoApproveAbove` | number 0–1 | required | A pending proposal for this action with confidence at or above this value executes without review. Still audited. Becomes the policy's `min_confidence`. |
| `enabled` | boolean | `false` | Off by default. Flipping it to `false` reverts the rule without deleting it. |
| `rung` | `observe` \| `recommend` \| `assist` \| `execute-with-approval` \| `execute-within-bounds` \| `autonomous` | derived | Where this kind stands on the ladder. Omitted, an enabled rule reads as `execute-within-bounds` and a disabled one as `execute-with-approval`. The rung and `enabled` must agree — a rung at or above `execute-within-bounds` on a disabled rule (or the reverse) is refused at apply, because the page and the gate would disagree about what runs. |
| `risk` | `low` \| `medium` \| `high` | registry default | How much evidence the next rung takes. Defaults: `hubspot.update` low; `gmail.send`, `personalization.enroll`, `objects.propose_candidate`, `qc.release` medium; any other external kind high. |

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
- Approval is an action-level concern. A skill or playbook can never grant itself sending rights — see [skill](./skill.md).

## Related

[Earned autonomy](../guides/earned-autonomy.md) · [Automation](./automation.md) · [Agent](./agent.md) (`harness.interrupts`) · [Ask](./ask.md) · [Team](./team.md) (outcome contract)
