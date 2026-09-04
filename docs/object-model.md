# Object model

One row per authored or recorded object: where it is authored, its schema
symbol, its table, where the runtime mounts or executes it, and the API or
UI surface that shows it. This is the lookup that used to take a code
sweep. Field-by-field reference for each authored type:
[`docs/entities/`](./entities/). Decision record: `docs/internal/adr/0003-skill-playbook-operation.md`.

## Authored objects (workspace-as-code)

| Object | Authored at | Schema symbol | Table | Runtime mount / execution | API / UI surface |
|---|---|---|---|---|---|
| [Workspace manifest](./entities/workspace-manifest.md) | `workspace.yaml` | `WorkspaceManifestSchema` | `project` (lead, surfaces) + `workspace_version` audit | `loadWorkspace` at check/apply | `/dashboard/workspace` |
| [Base pack](./entities/base-pack.md) | `packages/core/templates/base/` (`pack.yaml`) | `PackManifestSchema` | none (composed at load) | `loadPackRaw` + `resolveActivation` under the workspace | version folds into `workspace_sha` |
| [Agent](./entities/agent.md) | `agents/<slug>.yaml` (+ `.system-prompt.md`) | `AgentManifestSchema` | `agent` | compiled deepagents graph per `(org, slug)` (`services/agents/harness.ts`) | `/api/v1/agents`, `/dashboard/agents` |
| [Team](./entities/team.md) | `teams/<slug>.yaml` | `TeamManifestSchema` | `team` | lead consultation merge in the harness | `/dashboard/teams` |
| [Skill](./entities/skill.md) | `skills/<slug>/SKILL.md` | `PlaybookManifestSchema` (kind `skill`) | `playbook` (kind, origin, attached_playbooks) | mounted at `/skills/<slug>/` for agents naming it in `skills:`; read on the model's judgement via SkillsMiddleware | `/dashboard/skills` (usage from `skill_read` rows) |
| [Playbook](./entities/playbook.md) | `playbooks/<slug>/SKILL.md` | `PlaybookManifestSchema` (kind `playbook`) | `playbook` | mounted at `/playbooks/<slug>/` when named by a mounted skill's `playbooks:` or the agent's `playbooks:` | `/dashboard/skills` (Playbooks section) |
| [Object type](./entities/object-type.md) | `objects/<slug>/type.yaml` | `ObjectTypeManifestSchema` | `business_object_type` | classification + `lookup_objects` tool | `/api/v1/objects/types`, `/dashboard/objects` |
| [Mission](./entities/mission.md) | `missions/<slug>.yaml` | `MissionManifestSchema` | `mission` | `MissionService.startMission` (planner + single-turn checks) | `/dashboard/missions` |
| [Workflow](./entities/workflow.md) | `workflows/<slug>/workflow.yaml` | `WorkflowManifestSchema` | `workflow` | `WorkflowService.runLoop` (steps: approve, ask, action, sync) | `/api/v1/workflows`, `/dashboard/workflows` |
| [Automation](./entities/automation.md) | `automations/<slug>.yaml` | `AutomationManifestSchema` | `automation` | Temporal schedule or event match → `dispatchDo` (workflow, checkMission, job) | `/dashboard/automation` |
| [Source](./entities/source.md) | `sources/<slug>.yaml` | `SourceManifestSchema` | `knowledge_source` | `SourceSyncService.runSync` via connector registry | `/dashboard/sources` |
| [Learning step](./entities/learning-step.md) | `learnings/<step>.yaml` | `LearningStepManifestSchema` | `learning_step` (+ `learning` rows) | rendered to `/learnings/<step>.md` in the agent FS | `/dashboard/learnings` |
| [Eval dataset](./entities/eval-dataset.md) | `evals/<slug>.yaml` | `EvalDatasetManifestSchema` | `eval_dataset` | `npm run eval:run --workspace @vocion/core` | `/api/v1/evals` |
| [Trust rule](./entities/trust.md) | `trust.yaml` | `TrustManifestSchema` | `trust_rule` | auto-approval threshold check in `ActionService` | `/dashboard/review` (auto-executed list) |
| [Workspace page](./workspace-pages.md) | `pages/<slug>.yaml` (+ optional sibling `.md`) | `PageManifestSchema` | none — file-only | `readWorkspacePages()` at render; `workspace:apply` does not touch pages | `/dashboard/p/<slug>` |

## Recorded objects (runtime state)

| Object | Written by | Schema symbol | Table | Surface |
|---|---|---|---|---|
| Tool call | `withToolCallRecord` at the tool registry, all three harness targets; `skill_read` rows from the stream/relay for mounted SKILL.md reads | `toolCallSchema` | `tool_call` | `/dashboard/activity?kind=tool` (filter by agent, tool) |
| Workflow run | `WorkflowService.startWorkflow` | `workflowRunSchema` | `workflow_run` | `/api/v1/runs`, `/dashboard/workflows/<slug>/runs` |
| Mission run | `MissionService.startMission` | `missionRunSchema` | `mission_run` | `/dashboard/missions/runs` |
| Action run | `ActionService.proposeAction` / `executeAction` | `actionRunSchema` | `action_run` | `/dashboard/review` |
| Automation run | `AutomationService.fireAutomation` | `automationRunSchema` | `automation_run` | `/dashboard/automation` |
| Event | `EventService.emit` | `eventLogSchema` | `event_log` | `/dashboard/activity?kind=event` |
| Source sync | `SourceSyncService.runSync` | `sourceSyncCheckpointSchema` | `source_sync_checkpoint` | `/dashboard/sources`, Activity |
| Workspace version | `applyWorkspace` | `workspaceVersionSchema` | `workspace_version` | `/dashboard/workspace` |
| Conversation | chat SSE route | `conversationSchema` (+ messages) | `conversation`, `conversation_message` | `/dashboard/chat` |

## Deleted (2026-08, ADR 0003)

| Object | What replaced it |
|---|---|
| Operation (`operations/<slug>/skill.yaml`, table `skill`) | Skill (`skills/<slug>/SKILL.md`) |
| Operation run (table `skill_run`) | Tool call record (`tool_call`) + `skill_read` usage rows |
| `run_operation` tool + `SkillService` / `OperationService` | The skill body read by the agent, on the agent's own model |
| Playbook tag matching (`playbook.tags`, `agent.playbookTags`) | Attachment by name (`skill.playbooks`, `agent.playbooks`) |
| Workflow `skill` step + `discovery_followup` workflow | `discovery-followup` mission + `read_discovery_transcript` gated tool |
| `/dashboard/logs`, `/dashboard/playbooks`, `/api/v1/skills` | Activity (tool rows folded in), the one Skills page, no API replacement |
