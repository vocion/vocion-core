# Cobalt Works — Engineering (starter workspace template)

The third starter workspace, and the first one shaped for the team that
installs Vocion rather than for the team that sells. `meridian-revenue`
is a sales desk and `larkfield-support` is a service desk; a six-person
engineering team applying either of those sees nothing that belongs to
them.

Cobalt Works is fictional — a small platform team running an internal
API product. Every number, pull request, and incident here is sample
flavour and lives only in prompts, descriptions, and the corpus under
`data/`.

## Shape

- **Workspace lead:** `engineering-lead` (`lead:` in `workspace.yaml`) —
  answers "can we ship, and what is in the way" by consulting the four
  specialists.
- **One team, flat:** `engineering`. The entity model is one level deep
  — a lead plus specialists via `parent:` — and this template uses
  exactly that.
- **Four specialists:** `pr-reviewer`, `incident-responder`,
  `release-manager`, `docs-writer`.
- **Four skills**, each `skills/<slug>/SKILL.md`: `review-pull-request`,
  `triage-incident`, `draft-release-notes`, `draft-doc-update`.
- **Three sources**, all `kind: local-files`, so the workspace is useful
  with zero credentials: `handbook` (4 documents), `pull-requests` (5),
  `incidents` (3).
- **Two learning steps**, `code_review` and `incident_response`, seeded
  with twelve rules between them.

## Autonomy defaults

The defaults are deliberately low, and each one is a different mechanism:

| Where | Setting | What it means |
|---|---|---|
| `agents/pr-reviewer.yaml`, `release-manager.yaml`, `docs-writer.yaml` | `harness.interrupts: [propose_action]` | The agent can propose, but the proposal call itself pauses for a human. |
| `agents/incident-responder.yaml` | `harness.excludeTools: [propose_action]` | Read-only by construction — the proposal tool never reaches its catalog, so it cannot offer to touch a running system during an incident. |
| `missions/keep-main-releasable.yaml` | `autonomyPolicy.level: 1` | The floor of the ladder: the team proposes, a human disposes. |
| `workflows/release-approval/workflow.yaml` | `approve-release` (`type: approve`, `reviews: release-notes`) | The release notes are read by a person before the announcement step runs. |
| `trust.yaml` | one rule, `enabled: false` | Nothing auto-approves. |

One honest limit worth knowing before you edit `trust.yaml`: `action`
must be a **registered action id**, and the ids that ship today
(`packages/core/src/libs/actions/`, listed in
[`docs/entities/trust.md`](../../../../../docs/entities/trust.md)) are
CRM- and mail-shaped. There is no code-host action id, so a trust rule
cannot yet say "auto-approve a merge". In this template the review,
release, and documentation boundaries are held by `harness.interrupts`
and by the workflow's approve gate instead — which is the stronger
boundary anyway, because it stops the call rather than rating it.

`automations/release-readiness.yaml` is the only place time lives: a
weekday cron that checks the standing mission. Missions stay pure goals,
workflows stay pure procedures.

## Loading it

`workspace:check` makes no database writes, but it does connect — so a
reachable, migrated `DATABASE_URL` has to exist first. Migrate, then
check, then apply:

```bash
npm run db:migrate
npm run workspace:check -- packages/core/templates/workspaces/engineering-team
npm run workspace:apply -- packages/core/templates/workspaces/engineering-team --project <id|slug>
```

Two notes on a manual apply:

- `workspace.yaml` deliberately omits `accountableUser`, so the team
  resolves no owner and the loader warns about it. Add
  `accountableUser: <your email>` before applying if you want the team
  to inherit a real person.
- The `local-files` sources resolve `directory:` relative to
  `WORKSPACE_PATH` (or absolute). Copy this directory to your workspace
  root — or set `WORKSPACE_PATH` to it — so `data/handbook`,
  `data/pull-requests`, and `data/incidents` resolve, then sync from
  `/dashboard/connectors`.

## Sample data

`data/pull-requests/` — five pull requests chosen so the review skill
has something to find: cursor pagination with a missing test and a
deprecation window (PR-1841), a backfill migration with no batching on a
41-million-row table (PR-1847), a scheduler timezone fix (PR-1852), a
debug log that would print an API key (PR-1856), and one merged change
whose new response field is not documented yet (PR-1830).

`data/incidents/` — one open SEV2 on the events API that points at the
same deep-offset behaviour as PR-1841, and two closed SEV3s that trace
to the known defects in the severity matrix.

`data/handbook/` — the four documents a review or a release decision has
to be grounded in: review standards (what blocks a merge), the release
checklist, the severity matrix with its known-defect table, and the
on-call runbook.

## Related

`../meridian-revenue/` — the revenue-shaped starter ·
`../larkfield-support/` — the human-in-the-loop starter.
[`docs/entities/agent.md`](../../../../../docs/entities/agent.md) ·
[`docs/entities/team.md`](../../../../../docs/entities/team.md) ·
[`docs/entities/mission.md`](../../../../../docs/entities/mission.md) ·
[`docs/workspace.md`](../../../../../docs/workspace.md)
