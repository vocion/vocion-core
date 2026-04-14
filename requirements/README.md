# CoreContext Requirements

Two categories:

- **Platform** (this directory, top-level) — what CoreContext *is*. Architecture, object model, product surfaces, RBAC, customer onboarding, managed-ops services. Generic to the runtime.
- **MetaCTO case studies** (`./metacto/`) — how MetaCTO *uses* CoreContext. Per-agent specs, connectors, workflows, sprint plans. Moves with the customer, not the platform.

## Platform

| File | Description |
|---|---|
| [overview.md](./overview.md) | Product vision, positioning, one-line definition |
| [tech-stack.md](./tech-stack.md) | Technology choices + rationale per layer |
| [architecture.md](./architecture.md) | System layers, boundaries, integration points |
| [object-model.md](./object-model.md) | First-class objects: identity, context, capability, governance |
| [product-surfaces.md](./product-surfaces.md) | UI surfaces: Ask, Search, Skills, Workflows, Governance, Review |
| [skills.md](./skills.md) | Skill system design, types, schema, productization |
| [rbac.md](./rbac.md) | Roles, permissions, access control model |
| [roadmap.md](./roadmap.md) | Phased roadmap (also mirrored in root `../README.md`) |
| [sprints.md](./sprints.md) | Sprint-level breakdown |
| [customer-onboarding.md](./customer-onboarding.md) | Build-up process for new customer deployments |
| [managed-operations.md](./managed-operations.md) | Ongoing managed services: tuning, evals, training, ops |

## MetaCTO case studies

See [metacto/README.md](./metacto/README.md) for the index.

Live status of what's shipped + what's next lives in [`../docs/progress.md`](../docs/progress.md).
