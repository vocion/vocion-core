# RBAC Model

Even when using Onyx Enterprise features, keep product-level RBAC in Vocion's own control plane.

## Roles

| Role | Description |
|------|-------------|
| **Org Admin** | Full workspace control, billing, user management |
| **Integration Admin** | Manage connectors, object mappings, source systems |
| **Domain Owner** | Own a knowledge domain (Sales, Support, etc.), manage domain skills |
| **Builder** | Create and edit skills, workflows, actions |
| **Approver** | Approve workflow steps and action requests |
| **Standard User** | Use Ask, Search, Skills; give feedback |
| **Auditor** | Read-only access to audit logs, analytics, usage |

## Permission Surfaces

| Surface | What It Controls |
|---------|-----------------|
| **Data visibility** | Which sources, domains, and objects a user can see |
| **Skill usage** | Which skills a user can invoke |
| **Action execution** | Which mutations a user can trigger |
| **Workflow publishing** | Who can create and publish workflows |
| **Approval authority** | Who can approve specific workflow steps |
| **Analytics/audit visibility** | Who can view usage data and audit trails |

## Why Own RBAC Matters

- Onyx RBAC and document access controls are enterprise-gated
- API token support is evolving toward user-scoped tokens (not yet available)
- Vocion API layer must remain the source of truth for who can do what
- Onyx permissions are secondary enforcement, not primary

## Clerk Integration

- Workspace maps to Clerk Organization
- Users managed via Clerk
- Roles stored in Vocion DB, checked at API layer
- Clerk provides auth tokens; Vocion resolves permissions
