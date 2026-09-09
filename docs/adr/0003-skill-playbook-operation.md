# ADR 0003: Skill, playbook, and the deletion of the operations layer

Date: 2026-08-28
Status: accepted

## Context

Vocion carried three overlapping capability shapes:

1. **Operation** (DB table `skill`, workspace kind `operations/`): a typed
   prompt template executed by `SkillService.executeSkill` as a single
   direct OpenAI call, invoked by agents through the `run_operation` tool,
   recorded in `skill_run`.
2. **Playbook** (DB table `playbook`, workspace kind `playbooks/`): a
   SKILL.md folder mounted into an agent's virtual filesystem, selected by
   tag intersection (`playbook.tags` x `agent.playbookTags`), read on the
   model's judgement via deepagents' SkillsMiddleware.
3. **Workflow steps of type `skill`**: the workflow engine invoking
   operations deterministically.

An audit of the operation layer's four justifications (typed IO, model
pinning, approval gating, record keeping) found only record keeping still
held up, and it was scoped to the wrong unit: eleven operations left rows
while roughly thirty tools left nothing. Meanwhile the operation execution
path had real defects: a hardcoded `gpt-4o` bypassing the role registry, a
2000-token output ceiling silently truncating `pipeline_health` and
`extract_event_debrief`, and `{{var}}` interpolation that failed open.
Tag-based playbook mounting was a filter nobody could reason about: an
agent without tags mounted everything, and a tag typo mounted nothing,
silently.

## Decision

**One capability shape.** A **skill** is the deepagents unit: a folder with
a SKILL.md (YAML frontmatter + markdown procedure), mounted at
`/skills/<slug>/` for the agents that name it in `skills:`, listed to the
model with progressive disclosure, and read when the model judges it
relevant. Where the work must happen every time, the mission or automation
prompt names the skill outright.

A **playbook** is the same folder shape under `playbooks/`, but it is
ATTACHED rather than invoked: named by a skill (frontmatter `playbooks:`,
so it travels wherever the skill is switched on) or by an agent (manifest
`playbooks:`, for context that should always be present). Tag matching is
retired entirely; `playbookTags` and `playbook.tags` are gone.

**Operations are deleted, not renamed.** `SkillService`, the
`OperationService` shim, `runOperation.ts`, `/api/v1/skills`, the
`operations/` workspace kind, and the `skill` + `skill_run` tables are
removed. The eleven operations became eleven skills; `write-lead-brief`,
an 801-line playbook that always had an invocation contract, became the
twelfth. Ten ship base versions in the core pack; `draft-followup-email`
(Chris's voice) and `write-lead-brief` stay workspace-only.

**The record widens from eleven operations to every tool call.** Every
tool returned by `buildDomainTools` is wrapped at the registry (the single
seam all three harness providers share) and writes one `tool_call` row per
invocation: acting agent (the delegated specialist, not the dispatching
lead, resolved via the traceEmitter's checkpoint_ns convention), tool,
input, output, duration, error state, conversation id, provider, Langfuse
trace id, and the active workspace SHA. Skill reads (`read_file` on a
mounted SKILL.md) are recorded as `skill_read` rows, which is where
per-skill usage counts come from. A logging failure is caught and
reported, never propagated into the turn. The Activity surface lists the
rows filterable by agent and tool; the Logs page folded into it.

**Composition follows the agent model.** `loadPackRaw` gains skills and
playbooks; `resolveActivation` pulls an activated agent's skills, those
skills' attached playbooks, and its object types transitively, with
`use.skills` / `use.playbooks` for stragglers. Overriding a base folder is
whole-file replace by slug (no deep merge, no `extends` marker needed),
with sibling resources merged by path. `workspace:check` fails on an
activation entry naming a slug the pack does not ship and on any
skill/playbook reference that resolves to nothing.

**The workflow engine stays.** It lost its only authored workflow (the
discovery follow-up became a scheduled mission plus a gated
`read_discovery_transcript` tool), but
`MissionService.promoteMissionToWorkflow` is the path where a proven
mission graduates into a fixed sequence. The `skill` step type is gone;
`approve`, `ask`, `action`, and `sync` remain.

## Consequences

- Outputs changed model: skills run on the agent's model via the role
  registry instead of hardcoded `gpt-4o`. Judged on quality, not diff.
- The 2000-token operation ceiling is gone; `pipeline-health` and
  `extract-event-debrief` produce full-length output now.
- Approval lives exclusively with actions (`propose_action` + Review).
  A skill cannot grant itself sending rights; the drafting skills instruct
  the model to finish by proposing `gmail.send`.
- Skills activate on the model's judgement. Deterministic invocation is
  achieved by naming the skill in the calling prompt, and verified by the
  `skill_read` record.
- Plugin-registered skills lost their execution path (it lived in
  `SkillService.executePluginSkill`); the plugin registry remains as a
  catalog. Rebuilding plugin execution as tools is future work if needed.
- `docs/object-model.md` is the one-page map of every authored object;
  this ADR is why the map looks the way it does.
