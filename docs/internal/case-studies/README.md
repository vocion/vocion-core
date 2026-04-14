# MetaCTO Case Studies

How MetaCTO uses CoreContext. Specs for each agent deployment — connectors, object model, skills, workflows, sprint plans. These are *instance* documents; the platform itself is described under `/requirements/`.

**Internal only.** Part of `docs/internal/` — not for OSS consumers. If MetaCTO's context extracts to a separate `metacto-context` repo (Phase 8), these docs move with it.

## Ziggy — Sales Ops Agent (case study 1)

Dogfooding MetaCTO's own sales pipeline. Active, running against real Zoom/HubSpot/Gmail/Drive data.

| File | Description |
|---|---|
| [ziggy-overview.md](./ziggy-overview.md) | Agent positioning + platform boundary |
| [ziggy-objects.md](./ziggy-objects.md) | Sales object model + object links + derived objects |
| [ziggy-connectors.md](./ziggy-connectors.md) | Connectors, actions, approval requirements |
| [ziggy-workflows.md](./ziggy-workflows.md) | Lead triage, discovery, NDA, proposal, inbox scan, pipeline review |
| [ziggy-skills.md](./ziggy-skills.md) | Query, mutation, and composite skills |
| [ziggy-sprints.md](./ziggy-sprints.md) | Delivery plan with milestones |

## Algren — NINJIO Customer Account Agent (case study 2)

Exec-sponsor assistant for MetaCTO's NINJIO customer account. Scoped differently than Ziggy — single account focus, Teams + Slack heavy, meeting prep + weekly health. Named for Nathan Algren (*The Last Samurai*), the outsider captain who crosses into another world and learns it from the inside.

| File | Description |
|---|---|
| [ninjio-account-manager.md](./ninjio-account-manager.md) | Algren's spec, workflows, connectors, per-customer agent architecture |

**Architecture note:** each customer account gets its own named agent (NINJIO = Algren, future customers get their own). Skills and workflows are shared across accounts by slug reference. Per-customer data (channels, cadence, stakeholders) lives in a `business_object` row of `type=account`. See the spec for details.
