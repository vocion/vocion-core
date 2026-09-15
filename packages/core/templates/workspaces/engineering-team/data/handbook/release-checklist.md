---
title: Release checklist
owner: Platform team
updated: 2026-08-28
---

# Release checklist

Every item is pass, fail, or unknown, with evidence. An unknown is a
blocker until someone checks it.

| # | Item | Evidence |
|---|---|---|
| 1 | All pull requests in the release have an approving human review | Review record on each pull request |
| 2 | Migrations run forward and back on a copy of production data | Migration job log |
| 3 | No open SEV1 or SEV2 incident | Incident list |
| 4 | Release notes name every migration and irreversible step | Draft notes |
| 5 | Feature flags for unfinished work default to off | Flag configuration diff |
| 6 | Rollback plan written, and the previous version is still deployable | Rollback note in the release issue |
| 7 | Dependency bumps reviewed for licence changes | Dependency diff |

## Cadence

Releases go out Tuesday and Thursday afternoons. Nothing ships on a
Friday and nothing ships during an open SEV1 or SEV2.

## Versioning

Semantic versioning from conventional commit messages. A breaking change
requires a migration note and a deprecation period of one minor version.
