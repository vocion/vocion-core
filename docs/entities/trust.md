# Trust rules — `trust.yaml`

The trust ladder is the one place that says which proposed actions may execute
without a human looking first, and how confident the system has to be. One file
per workspace, not one per rule.

| | |
|---|---|
| **Path** | `trust.yaml` (or `trust.yml`) at the workspace root |
| **Schema** | `TrustManifestSchema` — `packages/core/src/libs/workspace/schemas.ts` |
| **Applied to** | `trust_rule` table |
| **Runtime** | Auto-approval threshold check in `ActionService` |
| **Surface** | `/dashboard/review`, auto-executed list |
| **Layering** | Workspace-only — a base pack ships no trust rules |

## Fields

`rules` is a list; each entry is:

| Field | Type | Default | What it does |
|---|---|---|---|
| `action` | string | required | Registered action id, e.g. `hubspot.update`. |
| `autoApproveAbove` | number 0–1 | required | A pending proposal for this action with confidence at or above this value executes without review. Still audited. |
| `enabled` | boolean | `false` | Off by default. Flipping it to `false` reverts the rule without deleting it. |

Keep the list short and the thresholds high. Everything that executes this way
still lands in the review queue's auto-executed list.

## Example

```yaml
rules:
  - action: hubspot.update
    autoApproveAbove: 0.95
    enabled: true
  - action: gmail.send_email
    autoApproveAbove: 0.99
    enabled: false
```

## Rules

- `autoApproveAbove` must be between 0 and 1 inclusive.
- A rule with `enabled: false` never auto-approves, whatever the threshold says.
- Approval is an action-level concern. A skill or playbook can never grant itself sending rights — see [skill](./skill.md).

## Related

[Automation](./automation.md) · [Agent](./agent.md) (`harness.interrupts`)
