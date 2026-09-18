# Object model

One row per authored or recorded object: where it is authored, its schema
symbol, its table, where the runtime mounts or executes it, and the API or
UI surface that shows it. This is the lookup that used to take a code
sweep. Field-by-field reference for each authored type:
[`docs/entities/`](./entities/). Decision record: `docs/adr/0003-skill-playbook-operation.md`.

## Authored objects (workspace-as-code)

| Object | Authored at | Schema symbol | Table | Runtime mount / execution | API / UI surface |
|---|---|---|---|---|---|
| [Workspace manifest](./entities/workspace-manifest.md) | `workspace.yaml` | `WorkspaceManifestSchema` | `project` (lead, goal, surfaces) + `workspace_version` audit | `loadWorkspace` at check/apply | `/dashboard/workspace`; goal leads `/dashboard/team-report` and gates its setup state |
| [Base pack](./entities/base-pack.md) | `packages/core/templates/base/` (`pack.yaml`) | `PackManifestSchema` | none (composed at load) | `loadPackRaw` + `resolveActivation` under the workspace | version folds into `workspace_sha` |
| [Agent](./entities/agent.md) | `agents/<slug>.yaml` (+ `.system-prompt.md`) | `AgentManifestSchema` | `agent` | compiled deepagents graph per `(org, slug)` (`services/agents/harness.ts`) | `/api/v1/agents`, `/dashboard/agents` (Agents tab of Teams & agents) |
| [Team](./entities/team.md) | `teams/<slug>.yaml` | `TeamManifestSchema` (`TeamMeasureSchema`, `MeasureSourceSchema`) | `team` (lead, goal = mission, measures; `kpis` deprecated) | lead consultation merge in the harness; measures read at report time from their source — HubSpot mirror (verified), `action_run` (observed), `decision_alignment` / `ask` (human-confirmed), `worker_run.counts` (agent-reported) — by `services/team-report/` | `/dashboard/teams`, `/dashboard/team-report` (team performance, lineage sheet), `router.teamReport.*`, the daily mail |
| [Skill](./entities/skill.md) | `skills/<slug>/SKILL.md` | `PlaybookManifestSchema` (kind `skill`) | `playbook` (kind, origin, attached_playbooks) | mounted at `/skills/<slug>/` for agents naming it in `skills:`; read on the model's judgement via SkillsMiddleware | `/dashboard/skills` (usage from `skill_read` rows) |
| [Playbook](./entities/playbook.md) | `playbooks/<slug>/SKILL.md` | `PlaybookManifestSchema` (kind `playbook`) | `playbook` | mounted at `/playbooks/<slug>/` when named by a mounted skill's `playbooks:` or the agent's `playbooks:` | `/dashboard/skills` (Playbooks section) |
| [Object type](./entities/object-type.md) | `objects/<slug>/type.yaml` | `ObjectTypeManifestSchema` | `business_object_type` | classification + `lookup_objects` tool | `/api/v1/objects/types`, `/dashboard/objects` |
| [Mission](./entities/mission.md) | `missions/<slug>.yaml` | `MissionManifestSchema` | `mission` | `MissionService.startMission` (planner + single-turn checks) | `/dashboard/missions` |
| [Workflow](./entities/workflow.md) | `workflows/<slug>/workflow.yaml` | `WorkflowManifestSchema` | `workflow` | `WorkflowService.runLoop` (steps: approve, ask, action, sync) | `/api/v1/workflows`, `/dashboard/workflows` |
| [Automation](./entities/automation.md) | `automations/<slug>.yaml` | `AutomationManifestSchema` | `automation` | Temporal schedule or event match → `dispatchDo` (workflow, checkMission, job) | `/dashboard/automation` |
| [Source](./entities/source.md) | `sources/<slug>.yaml` | `SourceManifestSchema` | `knowledge_source` | `SourceSyncService.runSync` via connector registry | `/dashboard/connectors` |
| [Learning step](./entities/learning-step.md) | `learnings/<step>.yaml` | `LearningStepManifestSchema` | `learning_step` (+ `learning` rows) | rendered to `/learnings/<step>.md` in the agent FS | `/dashboard/learnings` |
| [Eval dataset](./entities/eval-dataset.md) | `evals/<slug>.yaml` | `EvalDatasetManifestSchema` | `eval_dataset` | `npm run eval:run --workspace @vocion/core` | `/api/v1/evals` |
| [Trust rule](./entities/trust.md) | `trust.yaml` | `TrustManifestSchema` | `trust_rule` + `autonomy_policy` (rung, risk tier, floor, evidence) | auto-approval threshold check in `ActionService`; rung mapping in `AutonomyService` | `/dashboard/autonomy`; auto-executed runs over `GET /api/v1/reviews/auto-executed` |
| [Voice rules](./guides/voice-rules.md) | `voice.yaml` | `VoiceManifestSchema` | `project.voice_rules` | `lintCopy` at every outbound-copy seam: the skill-turn output schema, `proposeAction` precheck, and the queue's rewrite | reviewer edit-diffs become pending rule candidates at `/dashboard/learnings` |
| [Workspace page](./workspace-pages.md) | `pages/<slug>.yaml` (+ optional sibling `.md`) | `PageManifestSchema` | none — file-only | `readWorkspacePages()` at render; `workspace:apply` does not touch pages | `/dashboard/p/<slug>` |

## Recorded objects (runtime state)

| Object | Written by | Schema symbol | Table | Surface |
|---|---|---|---|---|
| Tool call | `withToolCallRecord` at the tool registry, all three harness targets; `skill_read` rows from the stream/relay for mounted SKILL.md reads | `toolCallSchema` | `tool_call` | `/dashboard/activity?kind=tool` (filter by agent, tool) |
| Workflow run | `WorkflowService.startWorkflow` | `workflowRunSchema` | `workflow_run` | `/api/v1/runs`, `/dashboard/workflows/<slug>/runs`; paused: Needs you, kind **run** (`/dashboard/inbox/workflow-:id`) |
| Mission run | `MissionService.startMission` | `missionRunSchema` | `mission_run` | `/dashboard/missions/runs`; paused / awaiting review: Needs you, kind **run** (`/dashboard/inbox/mission-:id`) |
| Action run | `ActionService.proposeAction` / `executeAction` | `actionRunSchema` | `action_run` | [Needs you](./guides/needs-you.md), kind **proposal**: `/dashboard/inbox?kind=proposal`, `/dashboard/inbox/proposal-:id`, `/dashboard/inbox/r/:recordKey`; `/api/v1/reviews` |
| Ask | `AskService.upsertAsk` — agents, external workers and sync scripts over `POST /api/v1/asks` | `askSchema` | `ask` | [Needs you](./guides/needs-you.md), kind = the ask's kind: `/dashboard/inbox?kind=ruling…`, `/dashboard/inbox/:id`, `/dashboard/inbox/g/:groupKey`; `/api/v1/asks` |
| Decision alignment | `AlignmentService.recordDecision` on every `ReviewService.decide` (actions) and `AskService.decideAsk` (asks) | `decisionAlignmentSchema` | `decision_alignment` | *agrees with you N%* in the meta row of every decision screen on Needs you (proposal and ask alike); `/dashboard/autonomy`; on `/dashboard/team-report` the human-confirmed measures, quality rate, decision latency and the evidence chains |
| Autonomy policy | `AutonomyService.promote` / `demote` / `noteRejection` (in-app), `syncPoliciesFromManifest` (trust.yaml on apply) | `autonomyPolicySchema` | `autonomy_policy` | `/dashboard/autonomy`; `router.autonomy.*`; adoption events `autonomy.promoted` / `autonomy.demoted` |
| Automation run | `AutomationService.fireAutomation` | `automationRunSchema` | `automation_run` | `/dashboard/automation` |
| Event | `EventService.emit` | `eventLogSchema` | `event_log` | `/dashboard/activity?kind=event` |
| Source sync | `SourceSyncService.runSync` | `sourceSyncCheckpointSchema` | `source_sync_checkpoint` | `/dashboard/connectors`, Activity |
| Workspace version | `applyWorkspace` | `workspaceVersionSchema` | `workspace_version` | `/dashboard/workspace` |
| [Worker run](./entities/worker-run.md) | `WorkerRunService` via `/api/v1/worker-runs` (external workers, ADR 0004) | `workerRunSchema` | `worker_run` (kind, model, summary, counts, tokens, cents) | `/dashboard/team-report` (operating cost, agent-reported and observed measures, evidence by member), `/dashboard/activity?kind=worker` |
| Conversation | chat SSE route | `conversationSchema` (+ messages) | `conversation`, `conversation_message` | `/dashboard/chat` |
| [Artifact](./artifacts.md) | `render_table` / `render_markdown` / `render_chart` / `render_record`, then `update_artifact` (and `create_artifact` files), or a person editing the pane — all via `ArtifactService` | `artifactSchema` | `artifact` | the pane at `/dashboard/chat/[id]?artifact=<id>`, standalone at `/dashboard/artifacts/[id]`, the log at `/dashboard/artifacts` |
| Artifact version | every write through `ArtifactService` (agent tool call or human save) | `artifactVersionSchema` | `artifact_version` | the version menu in the artifact pane |

## Deleted (2026-08, ADR 0003)

| Object | What replaced it |
|---|---|
| Operation (`operations/<slug>/skill.yaml`, table `skill`) | Skill (`skills/<slug>/SKILL.md`) |
| Operation run (table `skill_run`) | Tool call record (`tool_call`) + `skill_read` usage rows |
| `run_operation` tool + `SkillService` / `OperationService` | The skill body read by the agent, on the agent's own model |
| Playbook tag matching (`playbook.tags`, `agent.playbookTags`) | Attachment by name (`skill.playbooks`, `agent.playbooks`) |
| Workflow `skill` step + `discovery_followup` workflow | `discovery-followup` mission + `read_discovery_transcript` gated tool |
| `/dashboard/logs`, `/dashboard/playbooks`, `/api/v1/skills` | Activity (tool rows folded in), the one Skills page, no API replacement |
| `/dashboard/api-tokens` (2026-09 nav sweep) | Developers (`/dashboard/developers`): credentials, the MCP/REST endpoints and the docs on one page; the old URL redirects |
