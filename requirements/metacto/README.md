# MetaCTO Case Studies

How MetaCTO uses CoreContext. Specs for each agent deployment — connectors, object model, skills, workflows, sprint plans. These are *instance* documents; the platform itself is described in the parent `requirements/` directory.

If/when MetaCTO's context extracts to a separate `metacto-context` repo (Phase 8), these docs move with it.

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

## NINJIO — Account Manager (case study 2)

Exec-sponsor assistant for MetaCTO's NINJIO customer account. Scoped differently than Ziggy — single account focus, Teams + Slack heavy, meeting prep + weekly health.

| File | Description |
|---|---|
| [ninjio-account-manager.md](./ninjio-account-manager.md) | Agent spec, workflows, connectors, architecture (template + business_object row) |

**Architecture note:** `account-manager` is a *template* agent. NINJIO, and any future customer account, is a `business_object` row with `type=account`. One agent definition, N per-customer instances. See the NINJIO doc for details.
