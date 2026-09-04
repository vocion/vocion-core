import type { HarnessTarget } from '@/services/agents/harnessTarget';
import { z } from 'zod';
import { harnessTargetSchema } from '@/services/agents/harnessTarget';

const SlugSchema = z.string().regex(/^[a-z][a-z0-9_-]*$/, {
  message: 'slug must be lowercase, start with a letter, and contain only letters, numbers, dashes, or underscores',
});

const FewShotExampleSchema = z.object({
  input: z.string(),
  output: z.string(),
  label: z.string().optional(),
});

/**
 * Base-pack activation allowlist (workspace.yaml `use:`). Activation is
 * AGENT-rooted: naming an agent transitively pulls in the skills it
 * declares in `skills:` and the playbooks those skills attach — you
 * never hand-list an agent's own skills. `skills` remains for a skill
 * no activated agent mounts; `playbooks` for standalone context. `use:
 * all` takes every default the pack ships. Omitting `use` while
 * `extends` is set means `use: none` — explicit opt-in, no surprise
 * agents.
 */
const ActivationSelectorSchema = z.object({
  agents: z.array(SlugSchema).default([]),
  skills: z.array(z.string()).default([]),
  playbooks: z.array(z.string()).default([]),
}).partial();

export const WorkspaceManifestSchema = z.object({
  version: z.literal(1).describe('manifest format version'),
  orgId: z.string().min(1).describe('Clerk organization id'),
  name: z.string().min(1),
  description: z.string().optional(),
  /**
   * Workspace lead agent (F1) — the agent that runs the whole workspace
   * and consults the team leads. Must name an agent in this workspace;
   * applied to `project.leadAgentSlug`. Omit = no workspace lead.
   */
  lead: SlugSchema.optional(),
  /**
   * Workspace-default accountable human (F1) — an email, resolved to a
   * user id at apply and stored on `project.accountableUserId`. Teams
   * without their own `accountableUser` inherit this at read time.
   */
  accountableUser: z.string().email().optional(),
  defaults: z.object({
    model: z.string().optional(),
    temperature: z.string().optional(),
    /**
     * Which vendor produces this workspace's embeddings, and which model.
     * Omitted keys fall back to `VOCION_EMBEDDING_PROVIDER` /
     * `VOCION_EMBEDDING_MODEL`, then to OpenAI.
     *
     * Set here — at the workspace — and deliberately not on an agent. A query
     * vector is only comparable to vectors produced by the same model, so an
     * agent embedding its queries on a different provider from the one that
     * ingested the documents would quietly return worse search results with no
     * error to point at. `harness.modelProvider` covers the per-agent case for
     * chat models, where no such coupling exists.
     *
     * Changing this on a workspace that already holds chunks means re-embedding
     * them; a model of a different vector width means a schema migration too.
     */
    embeddingProvider: z.enum(['openai', 'bedrock']).optional(),
    embeddingModel: z.string().optional(),
  }).partial().optional(),
  /**
   * Optional dashboard surfaces to switch on, by registry id (see
   * `features/navigation/surfaces.ts`). The route, page, label, icon and
   * sidebar section all live in core; this list only says which ones this
   * workspace gets. Unknown ids fail at load. Omit for none.
   */
  surfaces: z.array(z.string()).default([]),
  /**
   * Pin a versioned base pack that ships inside vocion-core, e.g.
   * `core@1.4.0` (or bare `core` to track the pack's current version).
   * OMIT → no base layer at all: the workspace loads exactly as it does
   * today, byte-for-byte. A workspace only ever moves onto a new pack
   * version by changing this pin — publishing a newer pack never reaches
   * a pinned instance.
   */
  extends: z.string().optional().describe('base pack pin, e.g. "core@1.4.0"; omit for no base layer'),
  /**
   * Activation allowlist for the pinned pack. `use: all` activates every
   * default; an {agents,operations} selector activates only what it names
   * (agents pull their skills transitively). Omitted while `extends` is
   * set = activate nothing (`use: none`).
   */
  use: z.union([z.literal('all'), ActivationSelectorSchema]).optional(),
  /**
   * Suppress a core default even under `use: all` — the escape hatch. A
   * disabled slug is omitted from the merged workspace entirely.
   */
  disable: ActivationSelectorSchema.optional(),
});
export type WorkspaceManifest = z.infer<typeof WorkspaceManifestSchema>;

/**
 * Team manifest (F1) — workspace/<org>/teams/<slug>.yaml. The team's
 * slug comes from the FILENAME (no `slug:` field), so a team cannot
 * disagree with its own path. Teams are flat by construction: there is
 * no parent field here and no parent column in the `team` table.
 */
export const TeamManifestSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  /**
   * Slug of the agent leading this team. Optional — a team may exist
   * before its lead is chosen (rendered "no lead yet") — but when set
   * it must name an agent in this workspace.
   */
  lead: SlugSchema.optional(),
  /**
   * The accountable human for this team — an email, resolved to a user
   * id at apply. Omit to inherit the workspace-level default
   * (`accountableUser:` in workspace.yaml); inheritance is resolved at
   * read time and is NOT baked in on export.
   */
  accountableUser: z.string().email().optional(),
});
export type TeamManifest = z.infer<typeof TeamManifestSchema>;

/**
 * `pack.yaml` — the identity of a base pack shipped inside vocion-core at
 * `packages/core/templates/<name>/`. The version is what a workspace pins
 * via `extends: core@<version>` and what folds into `workspace_sha`, so a
 * pinned instance is insulated from later pack publishes.
 */
export const PackManifestSchema = z.object({
  name: z.literal('core').describe('pack identity — only "core" today'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'pack version must be semver x.y.z'),
  description: z.string().optional(),
});
export type PackManifest = z.infer<typeof PackManifestSchema>;

/**
 * Collapse a parsed harness block's two spellings of the same field into one.
 *
 * `runsOn` is the field; `provider` is what it used to be called. Authors may
 * have written either, and a workspace kept in a parent project may not be
 * updated for a long time — so both are read here, `runsOn` wins if somehow
 * both are present, and only `runsOn` survives into the stored row. Callers
 * downstream therefore never have to know the old name existed.
 *
 * Both keys are dropped entirely when neither was authored. That absence is
 * load-bearing: `defaultHarnessTargetFor` derives a target from the agent's
 * model vendor, and it can only do that while "unset" is still visible.
 * @param harness - The parsed harness block, before normalisation.
 */
function normalizeHarnessBlock<T extends { runsOn?: HarnessTarget; provider?: HarnessTarget }>(
  harness: T,
): Omit<T, 'provider'> {
  const { provider, ...rest } = harness;
  const target = harness.runsOn ?? provider;
  if (!target) {
    const withoutRunsOn = { ...rest };
    delete withoutRunsOn.runsOn;
    return withoutRunsOn;
  }
  return { ...rest, runsOn: target };
}

export const AgentManifestSchema = z.object({
  slug: SlugSchema,
  name: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
  active: z.boolean().default(true),
  /**
   * Slug of the primary agent this specialist reports to. Omit for
   * primary agents. One level deep: the referenced agent must itself
   * have no `parent`. Source of truth for the agent hierarchy.
   */
  parent: SlugSchema.optional(),
  /**
   * DEPRECATED — derived from `parent` ('specialist' when parent is
   * set, 'lead' otherwise). If authored, it must match the derived
   * value; workspace:check errors on a mismatch.
   */
  role: z.enum(['lead', 'specialist']).optional(),
  /** The work mode this agent primarily runs. */
  agentType: z.enum(['mission', 'workflow', 'operational']).optional(),
  /**
   * The team this agent belongs to (F1) — a slug matching a file in the
   * workspace's teams/ dir. Validated whenever the workspace defines
   * teams; workspaces without a teams/ dir keep the old behavior
   * (free-text display label, deprecated) byte-for-byte.
   */
  team: z.string().optional(),
  model: z.string().optional(),
  temperature: z.union([z.string(), z.number()]).optional(),
  systemPromptFile: z.string().optional().describe('path to markdown system prompt, relative to agent file'),
  systemPrompt: z.string().optional().describe('inline system prompt — prefer systemPromptFile for long prompts'),
  skills: z.array(z.string()).default([]).describe('skill slugs this agent can invoke'),
  connectorSources: z.array(z.string()).default([]).describe('source slugs (matching knowledge_source.slug) this agent can search'),
  objectTypes: z.array(z.string()).default([]).describe('business object type slugs'),
  documentSetIds: z.array(z.number()).default([]),
  searchConfig: z.object({
    recencyDecay: z.number().optional(),
    sourceWeights: z.record(z.string(), z.number()).optional(),
    maxResults: z.number().optional(),
    minRelevance: z.number().optional(),
  }).partial().default({}),
  fewShotExamples: z.array(FewShotExampleSchema).default([]),
  approvalPolicy: z.record(z.string(), z.unknown()).default({}),
  langfuseProjectId: z.string().optional(),
  /**
   * Sub-agent definitions (v0.2). Each entry compiles into a deepagents
   * `SubAgent` the parent dispatches via the `task` tool. `systemPrompt`
   * may be inlined here, or supplied via `systemPromptFile` (relative
   * path). At least one of the two is required per entry.
   */
  subagents: z.array(z.object({
    name: z.string().regex(/^[a-z][a-z0-9_-]*$/),
    description: z.string(),
    systemPrompt: z.string().optional(),
    systemPromptFile: z.string().optional(),
    tools: z.array(z.string()).optional(),
    model: z.string().optional(),
  }).refine(
    s => !!(s.systemPrompt || s.systemPromptFile),
    { message: 'subagent must have either systemPrompt or systemPromptFile' },
  )).default([]),
  /**
   * Playbooks attached to this agent by name — context that should
   * always be present for it, independent of any skill. A named slug
   * must resolve to a playbook the workspace or its base pack ships.
   */
  playbooks: z.array(z.string()).default([]),
  /** Names of `learning_step` rows this agent owns. (Wired in Phase 5.) */
  learningSteps: z.array(z.string()).default([]),
  /** Empty-state suggestions shown in the chat UI. */
  suggestions: z.array(z.object({
    label: z.string(),
    prompt: z.string(),
  })).default([]),
  /** CSS color name for the agent's chat header / sidebar. */
  accent: z.string().optional(),
  /** Short tagline shown above the chat title. */
  eyebrow: z.string().optional(),
  /**
   * Harness config (v0.3) — per-agent knobs for the reusable agent
   * harness. `provider` selects where the agent loop executes:
   * `local` (in-process deepagents loop, the default), `agentcore`
   * (the AWS AgentCore managed harness — provisioned by
   * workspace:apply, invoked via InvokeHarness; operations execute
   * client-side in vocion-core as inline functions), or `runtime`
   * (the BYOA artifact — packages/agent-runtime: our deepagents loop
   * hosted out-of-process, localhost in dev / AgentCore Runtime when
   * deployed; tools execute in core via the claim-verified tool
   * endpoint).
   *
   * `agentcore` and `runtime` are BOTH AWS Bedrock AgentCore — it is a
   * product family, and these are two services inside it. The difference
   * is who owns the loop: on `agentcore` AWS does, and the agent is pure
   * configuration with `search_knowledge` as its only tool; on `runtime`
   * we do, and the agent keeps the full tool registry, subagents,
   * playbooks and approval gates, because those are deepagents features
   * our loop implements. Neither routes inference — a Bedrock call is a
   * direct Converse call in all three cases. `interrupts` lists skill/tool slugs that pause for
   * human approval (via the hitl_gate flow) before executing;
   * `maxTokens` caps the model's output tokens; `excludeTools`
   * withholds built-in tools by name (e.g. `propose_action` for agents
   * that should have no CRM-write surface at all); `model` overrides the
   * model id; `modelProvider` overrides which vendor serves it.
   *
   * `runsOn` and `modelProvider` are different axes and are easy to
   * confuse. `runsOn` is *which machinery runs the turn*; `modelProvider` is
   * whose model answers*. `bedrock` belongs to the second and has never been
   * a value of the first.
   *
   * Three values, named for whose loop you get rather than whose cloud it
   * sits in — see `services/agents/harnessTarget.ts`:
   *
   *   - `in-process` — our deepagents loop, in this process. No AgentCore.
   *   - `agentcore-container` — the SAME loop, in our container, hosted on
   *     AWS AgentCore Runtime. Tools call back to core.
   *   - `aws-managed-harness` — AWS owns the loop. The agent becomes pure
   *     configuration with one tool and no subagents, playbooks or gates.
   *
   * The old spellings (`local`, `runtime`, `agentcore`) are still accepted
   * and normalised on parse, because parent projects hold workspace files
   * this repo cannot see. `provider:` is likewise still read as an alias for
   * `runsOn:`.
   *
   * One default links the two axes: an agent that names `modelProvider:
   * bedrock` and no `runsOn` gets `agentcore-container`, since choosing AWS
   * as the vendor is almost always choosing AWS as the place to run.
   * `runsOn: in-process` next to it opts back out, and that combination
   * works — the in-process loop reaches Bedrock on the org's own stored key.
   *
   * `runsOn` is deliberately NOT defaulted here. The default has to stay
   * absent in the stored row for `defaultHarnessTargetFor` (AgentService) to
   * tell "the author wanted the in-process loop" apart from "the author said
   * nothing" — writing one for both would make the Bedrock default
   * unreachable for every agent that came through workspace YAML.
   */
  harness: z.object({
    runsOn: harnessTargetSchema.optional(),
    /** Pre-rename spelling of `runsOn`. Read, normalised, and not re-emitted. */
    provider: harnessTargetSchema.optional(),
    interrupts: z.array(z.string()).default([]),
    maxTokens: z.number().int().positive().optional(),
    excludeTools: z.array(z.string()).default([]),
    /**
     * Granted-only tools this agent receives. Some built-ins (the discovery
     * lane: classify_call, match_meetings, …) exist only for agents that name
     * them here — the inverse of excludeTools, for tools too powerful to be
     * default-on.
     */
    grantTools: z.array(z.string()).default([]),
    model: z.string().optional(),
    modelProvider: z.enum(['anthropic', 'openai', 'bedrock']).optional(),
    /**
     * Structural guarantee for A2UI action cards: when true and a turn ends
     * with ZERO recommend_action calls, the runtime runs a small follow-up
     * pass over the finished answer that emits the cards the agent's rules
     * require. Exists because prompt compliance alone proved unreliable —
     * long tool outputs (e.g. the daily brief) anchor the model into prose
     * mode and it stops calling the tool (observed 3→0 card regression).
     */
    recommendActionBackstop: z.boolean().optional(),
  }).partial().transform(normalizeHarnessBlock).default({}),
}).refine(
  v => !!(v.systemPromptFile || v.systemPrompt),
  { message: 'agent must have either systemPromptFile or inline systemPrompt' },
);
export type AgentManifest = z.infer<typeof AgentManifestSchema>;

/* ----------------------------------------------------------------
 * Workflow manifest
 * ---------------------------------------------------------------- */

const InterpolatableStringSchema = z.string().describe(
  'supports {{input.x}}, {{steps.name.output.y}}, {{trigger.y}}',
);

/**
 * Step types — workflows are DETERMINISTIC: same structure every run.
 * Open-ended agent work belongs in missions, never in a workflow step.
 *   - `skill`   — invoke a skill (typed LLM call) with interpolated input
 *   - `sync`    — refresh named sources so downstream steps read live data
 *   - `approve` — HITL pause; workflow resumes after runtime_approve
 *   - `ask`     — HITL input; pause until a human supplies text
 *   - `action`  — connector-backed action (v1 = registered stubs only)
 */
const ApproveStepSchema = z.object({
  name: SlugSchema,
  type: z.literal('approve'),
  prompt: z.string().describe('what is being approved — shown in the review queue'),
  /** Optional — reference to prior step whose output is being reviewed. */
  reviews: z.string().optional(),
});

/**
 * Human input as a step. Pauses the run in Review until a human supplies
 * text (e.g. "paste the call transcript"); the run then resumes with that
 * text as the step's output, interpolable downstream via
 * `{{steps.<name>.output}}`. Deterministic: the question is fixed at
 * authoring time — only the data comes from the human.
 */
const AskStepSchema = z.object({
  name: SlugSchema,
  type: z.literal('ask'),
  prompt: z.string().describe('what to ask the human — shown in the review queue'),
  /**
   * Optional interpolable template (e.g. `{{input.transcript}}`). When it
   * resolves to a non-empty string the step completes with that value and the
   * run never pauses — an ask that already has its answer doesn't ask. Lets one
   * workflow serve both an automated caller that supplies the data and a human
   * starting it by hand, without forking the definition.
   */
  default: z.string().optional(),
  /** Optional — persist this step's output into named variable (defaults to step name). */
  outputAs: z.string().optional(),
});

const ActionStepSchema = z.object({
  name: SlugSchema,
  type: z.literal('action'),
  action: z.string().describe('registered action id, e.g. `gmail.send_email`'),
  input: z.record(z.string(), z.unknown()).default({}),
});

const SyncStepSchema = z.object({
  name: SlugSchema,
  type: z.literal('sync'),
  /**
   * Source slugs to incrementally sync before downstream steps read. Gives a
   * scheduled workflow LIVE data (last-hours email, fresh CRM state) instead
   * of index-freshness. Per-source failures degrade gracefully — the step
   * records them and the workflow continues on the existing index.
   */
  sources: z.array(z.string()).min(1),
});

const WorkflowStepSchema = z.discriminatedUnion('type', [ApproveStepSchema, AskStepSchema, ActionStepSchema, SyncStepSchema]);

const ManualTriggerSchema = z.object({
  type: z.literal('manual').default('manual'),
});
const EventTriggerSchema = z.object({
  type: z.literal('event'),
  /** e.g. `object.created`, `skill.completed`, `external.zoom.meeting_ended` */
  event: z.string(),
  filter: z.record(z.string(), z.unknown()).optional(),
});
const ScheduleTriggerSchema = z.object({
  type: z.literal('schedule'),
  /** Standard 5-field cron, UTC — e.g. `0 12 * * 1-5` (weekdays 12:00 UTC). */
  cron: z.string().regex(/^\S+ \S+ \S+ \S+ \S+$/, 'cron must have 5 space-separated fields'),
  /** Optional fixed input passed to every scheduled run. */
  input: z.record(z.string(), z.unknown()).optional(),
});

const WorkflowTriggerSchema = z.discriminatedUnion('type', [ManualTriggerSchema, EventTriggerSchema, ScheduleTriggerSchema]);

/* ----------------------------------------------------------------
 * Automation manifest — the WHEN of the system
 * ---------------------------------------------------------------- */

/**
 * An automation binds a trigger to a piece of work:
 *   when: {schedule: '<cron UTC>'} | {event: '<type>', filter?}
 *   do:   {workflow: '<slug>', input?} | {checkMission: '<slug>'}
 *
 * Missions and workflows contain NO trigger logic — missions are pure
 * goals, workflows are pure procedures. Automations are the only place
 * time and events live.
 */
/**
 * Trust ladder rules — workspace/<org>/trust.yaml. A pending proposal whose
 * confidence >= autoApproveAbove on an ENABLED rule executes without review
 * (audited). Keep rules few and thresholds high; disable to revert.
 */
export const TrustManifestSchema = z.object({
  rules: z.array(z.object({
    action: z.string().describe('registered action id, e.g. hubspot.update'),
    autoApproveAbove: z.number().min(0).max(1),
    enabled: z.boolean().default(false),
  })).default([]),
});
export type TrustManifest = z.infer<typeof TrustManifestSchema>;

export const AutomationManifestSchema = z.object({
  slug: SlugSchema,
  name: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(['active', 'disabled']).default('active'),
  /**
   * Owning agent slug. For `checkMission` the owner is implied by the
   * mission's own `agent`, so this is optional; for `job`/`workflow`
   * automations, which carry no mission, set it so the schedule rolls up to a
   * visible agent instead of running ownerless. Validated to exist.
   */
  agent: SlugSchema.optional(),
  when: z.object({
    /** 5-field cron, UTC. */
    schedule: z.string().regex(/^\S+ \S+ \S+ \S+ \S+$/, 'schedule must be a 5-field cron').optional(),
    /** Event type, e.g. `prospect.reply`. */
    event: z.string().optional(),
    /** Payload filter for event-whens: every key must equal the payload's value. */
    filter: z.record(z.string(), z.unknown()).optional(),
  }).refine(w => !!w.schedule !== !!w.event, { message: 'when must have exactly one of schedule | event' }),
  do: z.object({
    workflow: z.string().optional(),
    checkMission: z.string().optional(),
    /** Built-in server job (deterministic, not an agent). */
    job: z.string().optional(),
    /**
     * Execution prompt for `checkMission` fires — WHAT to do on this cadence.
     * The mission stays the standing context (charter, working notes); the
     * automation carries the marching orders. Falls back to the generic
     * scheduled-check brief when omitted.
     */
    prompt: z.string().optional(),
    /** Fixed input passed to the workflow run / job. */
    input: z.record(z.string(), z.unknown()).optional(),
  }).refine(
    d => [d.workflow, d.checkMission, d.job].filter(Boolean).length === 1,
    { message: 'do must have exactly one of workflow | checkMission | job' },
  ).refine(
    d => !d.prompt || !!d.checkMission,
    { message: 'do.prompt requires do.checkMission — only mission checks carry an execution prompt' },
  ),
});
export type AutomationManifest = z.infer<typeof AutomationManifestSchema>;

export const WorkflowManifestSchema = z.object({
  slug: SlugSchema,
  name: z.string(),
  description: z.string().optional(),
  status: z.enum(['active', 'disabled', 'draft']).default('active'),
  version: z.number().int().positive().default(1),
  /** Owning agent slug — the agent this procedure belongs to. Validated to exist. */
  agent: SlugSchema.optional(),
  trigger: WorkflowTriggerSchema,
  steps: z.array(WorkflowStepSchema).min(1),
  /** Optional input JSON Schema for manual triggers. */
  inputSchema: z.record(z.string(), z.unknown()).optional(),
});
export type WorkflowManifest = z.infer<typeof WorkflowManifestSchema>;
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export type WorkflowTrigger = z.infer<typeof WorkflowTriggerSchema>;

/** Mission templates — open-ended team work starting points. */
export const MissionManifestSchema = z.object({
  slug: SlugSchema,
  name: z.string(),
  description: z.string().optional(),
  status: z.enum(['active', 'disabled', 'draft']).default('active'),
  version: z.number().int().positive().default(1),
  goal: z.string(),
  /**
   * The single agent that owns this mission. If it's a lead
   *  (via agent.parent_agent_slug reverse-lookup), that lead's specialists
   *  are the team the runtime can hand off to.
   */
  agent: z.string(),
  autonomyPolicy: z.object({ level: z.number().int().min(1).max(5).default(1) }).default({ level: 1 }),
  successCriteria: z.array(z.string()).default([]),
  desiredArtifacts: z.array(z.string()).default([]),
  /**
   * A mission is a STANDING responsibility, not a one-off. When `schedule`
   * is set (5-field cron, UTC), the team's lead checks the charter on that
   * cadence: review current state, do only what's needed now — via
   * workflows, skills, tools, or open-ended agent work — and report.
   * Each check is one mission run (mode: check, no planner).
   */
  schedule: z.string().regex(/^\S+ \S+ \S+ \S+ \S+$/, 'schedule must be a 5-field cron').optional(),
});
export type MissionManifest = z.infer<typeof MissionManifestSchema>;

// Re-export InterpolatableStringSchema for step authors who want to type inputs explicitly.
export { InterpolatableStringSchema };

export const ObjectTypeManifestSchema = z.object({
  slug: SlugSchema,
  label: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
  schema: z.record(z.string(), z.unknown()).optional().describe('JSON Schema for metadata shape'),
  sourceRelevance: z.record(z.string(), z.number()).optional(),
  classificationPromptFile: z.string().optional(),
  classificationPrompt: z.string().optional(),
  fewShotExamples: z.array(FewShotExampleSchema).default([]),
});
export type ObjectTypeManifest = z.infer<typeof ObjectTypeManifestSchema>;

/**
 * Playbook frontmatter schema (v0.2).
 *
 * A Playbook is a markdown + YAML procedural guide that the agent
 * reads on demand from its virtual filesystem at
 * `/playbooks/<slug>/SKILL.md`. The file's YAML frontmatter must
 * validate against this schema. The body is the agent-facing playbook
 * content — sections, rules, examples, anti-patterns — written as if
 * for a smart human collaborator.
 *
 * Naming note: the on-disk filename is `SKILL.md` (rather than
 * `playbook.md`) because deepagents's `createSkillsMiddleware` looks
 * for that exact name when lazy-loading on `task` activation. The
 * external concept is "Playbook"; the internal deepagents filename
 * is `SKILL.md`.
 */
/**
 * LearningStep authoring schema (v0.2). Each
 * `workspace/<org>/learnings/<name>.yaml` declares one named step
 * (`global`, `meeting_triage`, ...). Steps are whitelisted via this
 * authoring path so the rule store doesn't drift into a junk drawer.
 */
/**
 * Eval dataset authoring schema (v0.2). Each
 * `workspace/<org>/evals/<slug>.yaml` declares one dataset.
 */
export const EvalDatasetManifestSchema = z.object({
  slug: SlugSchema,
  name: z.string(),
  description: z.string().optional(),
  agentSlug: z.string().describe('which agent slug this dataset evaluates'),
  version: z.number().int().positive().default(1),
  items: z.array(z.object({
    input: z.string().describe('the user message to send to the agent'),
    expectedOutput: z.string().optional().describe('substantive-equivalence guidance, not literal match'),
    rubric: z.string().optional().describe('per-case rubric the judge uses'),
    tags: z.array(z.string()).optional(),
  })).min(1),
});
export type EvalDatasetManifest = z.infer<typeof EvalDatasetManifestSchema>;

export const LearningStepManifestSchema = z.object({
  name: SlugSchema,
  title: z.string(),
  description: z.string(),
  /** Long-form intro shown above the rule list. Markdown allowed. */
  preamble: z.string().optional(),
  /** Which agent slugs own / read this step. */
  agents: z.array(z.string()).default([]),
  /**
   * SEED rules shipped with the workspace. Applied once each (keyed on
   * `workspace:<id>` in `learning.source`); later edits to a seeded rule's
   * text are applied as updates. Rules people add at runtime live only in
   * the DB and are never touched by apply.
   */
  rules: z.array(z.object({ id: SlugSchema, text: z.string().min(1) })).default([]),
});
export type LearningStepManifest = z.infer<typeof LearningStepManifestSchema>;

export const PlaybookManifestSchema = z.object({
  slug: SlugSchema,
  name: z.string().describe('Human-readable name for catalog UI.'),
  description: z.string().describe('One-line summary the agent reads to decide when to activate this skill or playbook.'),
  /**
   * Playbook slugs this skill attaches (skill folders only). A playbook
   * named here travels wherever the skill is switched on. Each slug must
   * resolve to a playbook the workspace or its base pack ships.
   */
  playbooks: z.array(z.string()).default([]),
  version: z.number().int().positive().default(1),
  /**
   * Sibling resource files (e.g. `REFERENCE.html`, `COMPONENTS.md`,
   * `examples/*.json`) that the playbook references. Listed here so
   * the catalog row is aware of them; the runtime mount helper picks
   * them up from the same folder regardless.
   */
  resources: z.array(z.string()).default([]),
  /**
   * Optional license string (e.g. `proprietary`, `Apache-2.0`,
   * `client:metacto`). Surfaced in the catalog so partners can
   * filter / audit by license.
   */
  license: z.string().optional(),
});
export type PlaybookManifest = z.infer<typeof PlaybookManifestSchema>;

export const SourceManifestSchema = z.object({
  slug: SlugSchema,
  name: z.string().describe('Human-readable name shown in the Sources page.'),
  description: z.string().optional().describe('One-line summary for the catalog UI.'),
  /**
   * Connector kind — must match a registered connector in
   * `libs/sources/registry`. Built-ins: `web`, `local-files`. Authored
   * sources can use a *labelled* kind (e.g. `zendesk`) that routes
   * through a built-in connector at the registry level when no live
   * implementation is wired yet — see the support-reply demo's
   * `sources/zendesk.yaml` for the Stripe-style test-mode pattern.
   */
  kind: z.string().describe('Connector kind. Maps to a SourceConnector slug.'),
  /** Resolved per-connector config (validated against the connector\'s configSchema at apply time). */
  config: z.record(z.string(), z.unknown()).default({}),
  /**
   * Sync schedule (cron expression) for Temporal scheduled syncs. When
   * omitted, the source only syncs on manual trigger via /dashboard/connectors.
   */
  schedule: z.string().optional().describe('Cron expression for scheduled sync. Manual-only when omitted.'),
  /**
   * Cron for a periodic FULL sync that tombstones records deleted upstream
   * (invisible to incremental syncs). Omitted = the connector's
   * `defaultReconcileCron` applies; `false` disables the reconcile pass.
   */
  reconcileSchedule: z.union([
    z.string().regex(/^\S+ \S+ \S+ \S+ \S+$/, 'reconcileSchedule must be a 5-field cron'),
    z.literal(false),
  ]).optional().describe('Cron for periodic full-sync reconcile. Connector default when omitted; false disables.'),
  /**
   * Per-connection ACL. Omitted = org-wide. `restricted` limits retrieval
   * (chat + search) to the listed member emails; enforced as an
   * intersection at query time. Scheduled team runs keep access.
   */
  access: z.object({
    visibility: z.enum(['org', 'restricted']).default('org'),
    users: z.array(z.string().email()).default([]),
  }).optional(),
  enabled: z.boolean().default(true),
});
export type SourceManifest = z.infer<typeof SourceManifestSchema>;
