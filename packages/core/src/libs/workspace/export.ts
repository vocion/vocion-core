/**
 * Rows as workspace files — the half of an export that the database holds
 * and no stored file says.
 *
 * An export is the workspace as it is running (`services/workspace/
 * WorkspaceExportService.ts`). Wherever the project's stored files still say
 * exactly what runs, they go out as authored: their comments, their layout and
 * their `{{env.NAME}}` tokens intact. These functions write the rest, one kind
 * at a time, from the rows an apply wrote or the app wrote directly — an agent
 * hired from the catalog, a connector added on the Connect page, a trust rule
 * a promotion raised, a resource changed in the app since its file.
 *
 * Each is the inverse of what `applier.ts` writes for that kind, so a file
 * written here applies back to the row it was read from. Where the applier
 * folds a default into the row, the default is written out explicitly (an
 * agent's model); where a row carries something the file never says — run
 * state, a pause, a credential, the folder a connector was declared in — it is
 * left out. Pure: rows in, files out, no database.
 */

import type { CollectedFile } from './snapshot';
import type { TeamExportRow } from './team-export';
import type { agentSchema, automationSchema, businessObjectTypeSchema, evalDatasetSchema, evalEvaluatorSchema, knowledgeSourceSchema, memoryNamespaceSchema, missionSchema, projectSchema, workflowSchema } from '@/models/Schema';
import { stringify as stringifyYaml } from 'yaml';
import { TYPE_CODE_SCHEMA_KEY } from '@/libs/codes';
import { processorRefOf } from '@/libs/sources/processor';
import { sourceNameOf } from '@/libs/sources/upsert';
import { projectLeadToManifestKeys, teamRowToManifest } from './team-export';

/**
 * One file of an exported workspace: its path inside the workspace folder,
 * and its text, or its bytes in base64 for a file that is not text — the
 * same shape the project's stored files have.
 */
export type ExportFile = Pick<CollectedFile, 'path' | 'content' | 'encoding'>;

type AgentRow = typeof agentSchema.$inferSelect;
type ObjectTypeRow = typeof businessObjectTypeSchema.$inferSelect;
type MissionRow = typeof missionSchema.$inferSelect;
type AutomationRow = typeof automationSchema.$inferSelect;
type WorkflowRow = typeof workflowSchema.$inferSelect;
type SourceRow = typeof knowledgeSourceSchema.$inferSelect;
type EvalDatasetRow = typeof evalDatasetSchema.$inferSelect;
type EvalEvaluatorRow = typeof evalEvaluatorSchema.$inferSelect;
type LearningStepRow = typeof memoryNamespaceSchema.$inferSelect;
type ProjectRow = typeof projectSchema.$inferSelect;

/** The gates key the applier folds into an object type's stored schema. */
const GATES_SCHEMA_KEY = 'x-gates';

/**
 * A YAML file, written the way the workspace's own files are: no folding, so
 * a long prompt line stays one line and diffs as one.
 * @param path - Where it goes in the workspace.
 * @param value - What it says.
 */
export function yamlFile(path: string, value: unknown): ExportFile {
  return textFile(path, stringifyYaml(value, { lineWidth: 0 }));
}

/**
 * A text file, ending in one newline.
 * @param path - Where it goes in the workspace.
 * @param content - Its text.
 */
export function textFile(path: string, content: string): ExportFile {
  return { path, content: content.endsWith('\n') ? content : `${content}\n`, encoding: 'utf8' };
}

/**
 * Drop the keys that would say nothing: null and undefined, and an empty list
 * or object where the schema defaults the key to exactly that.
 * @param obj - A manifest under construction.
 */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) {
      continue;
    }
    if (Array.isArray(v) && v.length === 0) {
      continue;
    }
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) {
      continue;
    }
    out[k] = v;
  }
  return out as Partial<T>;
}

/**
 * An object type's folder name: the slug with dashes, as `objects/` is laid out.
 * @param slug - The type's slug.
 */
export function objectTypeDir(slug: string): string {
  return `objects/${slug.replace(/_/g, '-')}`;
}

/**
 * An agent row as `agents/<slug>.yaml` and the system prompt beside it.
 *
 * The team: the label the row was written with, else the validated team ref —
 * except for a lead of exactly one team, whom apply assigns to it; writing
 * that out would make the next apply a spurious update. A proposal budget the
 * applier merged into `approvalPolicy` goes back under `proposals:`, so a
 * workspace default set later still reaches the agent the way it would have.
 * @param row - The agent row.
 * @param teams - The workspace's teams, for the lead rule.
 */
export function agentFiles(row: AgentRow, teams: ReadonlyArray<Pick<TeamExportRow, 'slug' | 'leadAgentSlug'>>): ExportFile[] {
  const promptFile = `${row.slug}.system-prompt.md`;
  const led = teams.filter(t => t.leadAgentSlug === row.slug);
  const autoTeam = led.length === 1 && row.teamSlug === led[0]!.slug;
  const team = row.team ?? (row.teamSlug && !autoTeam ? row.teamSlug : null);
  const { proposals, ...approvalPolicy } = (row.approvalPolicy ?? {}) as Record<string, unknown> & { proposals?: unknown };
  const manifest = compact({
    slug: row.slug,
    name: row.name,
    description: row.description,
    icon: row.icon,
    active: row.active === 'false' ? false : undefined,
    parent: row.parentAgentSlug,
    agentType: row.agentType,
    team,
    model: row.model,
    temperature: row.temperature,
    voice: row.voice,
    systemPromptFile: promptFile,
    skills: row.skillSlugs ?? [],
    connectorSources: row.connectorSources ?? [],
    objectTypes: row.objectTypeSlugs ?? [],
    documentSetIds: row.documentSetIds ?? [],
    searchConfig: row.searchConfig ?? {},
    fewShotExamples: row.fewShotExamples ?? [],
    approvalPolicy,
    proposals: proposals && typeof proposals === 'object' ? proposals : undefined,
    langfuseProjectId: row.langfuseProjectId,
    subagents: (row.subagents ?? []).map(s => compact({ name: s.name, description: s.description, systemPrompt: s.systemPrompt, tools: s.tools, model: s.model })),
    playbooks: row.playbookSlugs ?? [],
    learningSteps: row.learningSteps ?? [],
    suggestions: row.suggestions ?? [],
    persona: row.persona,
    accent: row.accent,
    eyebrow: row.eyebrow,
    handles: row.handles ?? [],
    // `normal` is the schema default either way; only a chosen value says anything.
    initiative: row.initiative && row.initiative !== 'normal' ? row.initiative : undefined,
    harness: row.harnessConfig ?? {},
  });
  return [yamlFile(`agents/${row.slug}.yaml`, manifest), textFile(`agents/${promptFile}`, row.systemPrompt)];
}

/**
 * A team row as `teams/<slug>.yaml` (`team-export.ts` owns the mapping).
 * @param row - The team row.
 * @param emailByUserId - Owners' emails, by user id.
 */
export function teamFile(row: TeamExportRow, emailByUserId: Map<string, string>): ExportFile {
  return yamlFile(`teams/${row.slug}.yaml`, teamRowToManifest(row, emailByUserId));
}

/**
 * An object type row as `objects/<slug>/type.yaml`, with its classification
 * prompt beside it. The gates and the type code the applier folded into the
 * stored schema come back out as `gates:` and `code:`.
 * @param row - The object type row.
 */
export function objectTypeFiles(row: ObjectTypeRow): ExportFile[] {
  const dir = objectTypeDir(row.slug);
  const { [GATES_SCHEMA_KEY]: gates, [TYPE_CODE_SCHEMA_KEY]: code, ...schema } = (row.schema ?? {}) as Record<string, unknown>;
  const files: ExportFile[] = [];
  let classificationPromptFile: string | undefined;
  if (row.classificationPrompt) {
    classificationPromptFile = 'classification-prompt.md';
    files.push(textFile(`${dir}/${classificationPromptFile}`, row.classificationPrompt));
  }
  files.unshift(yamlFile(`${dir}/type.yaml`, compact({
    slug: row.slug,
    label: row.label,
    description: row.description,
    icon: row.icon,
    code: typeof code === 'string' ? code : undefined,
    schema: Object.keys(schema).length > 0 ? schema : undefined,
    sourceRelevance: row.sourceRelevance,
    classificationPromptFile,
    fewShotExamples: row.fewShotExamples ?? [],
    gates: Array.isArray(gates) ? gates : undefined,
  })));
  return files;
}

/**
 * A mission row as `missions/<slug>.yaml`. Its working notes are run state,
 * not authoring, and stay behind.
 * @param row - The mission row.
 */
export function missionFile(row: MissionRow): ExportFile {
  return yamlFile(`missions/${row.slug}.yaml`, compact({
    slug: row.slug,
    name: row.name,
    description: row.description,
    status: row.status,
    version: row.version,
    goal: row.goal,
    agent: row.agentSlug,
    autonomyPolicy: row.autonomyPolicy,
    successCriteria: row.successCriteria ?? [],
    desiredArtifacts: row.desiredArtifacts ?? [],
    schedule: row.schedule,
  }));
}

/**
 * An automation row as `automations/<slug>.yaml`. A run's words (`label`,
 * `doing`) ride the stored do-config and come back out to the top level; a
 * person's pause lives on the row and is not authoring.
 * @param row - The automation row.
 */
export function automationFile(row: AutomationRow): ExportFile {
  const { label, doing, ...doConfig } = (row.doConfig ?? {}) as Record<string, unknown> & { label?: string; doing?: string };
  return yamlFile(`automations/${row.slug}.yaml`, compact({
    slug: row.slug,
    name: row.name,
    label,
    doing,
    description: row.description,
    status: row.status,
    agent: row.ownerAgentSlug,
    when: row.whenConfig,
    do: doConfig,
  }));
}

/**
 * A workflow row as `workflows/<slug>/workflow.yaml`.
 * @param row - The workflow row.
 */
export function workflowFile(row: WorkflowRow): ExportFile {
  return yamlFile(`workflows/${row.slug}/workflow.yaml`, compact({
    slug: row.slug,
    name: row.name,
    description: row.description,
    status: row.status,
    version: row.version,
    agent: row.ownerAgentSlug,
    trigger: row.trigger,
    steps: row.steps,
    inputSchema: row.inputSchema,
  }));
}

/**
 * A connector row as `sources/<slug>.yaml`: its settings and nothing that
 * opens it. The credential a connector signs in with is a row of its own
 * (`api_token`, `source_credential`) and never leaves; the reserved keys the
 * writers stamp into the stored config (`_connector`, `_manifestDir`,
 * `_processor`, `_name`) come back out as the manifest's own fields or not at
 * all. Its sync cadence lives with the scheduler, not on the row, so a
 * connector added in the app goes out without one.
 * @param row - The source row.
 */
export function sourceFile(row: SourceRow): ExportFile {
  const stored = (row.configJson ?? {}) as Record<string, unknown>;
  const config = Object.fromEntries(Object.entries(stored).filter(([key]) => !key.startsWith('_')));
  const connector = typeof stored._connector === 'string' ? stored._connector : row.kind;
  const processor = processorRefOf(stored);
  return yamlFile(`sources/${row.slug}.yaml`, compact({
    slug: row.slug,
    name: sourceNameOf(stored, row.slug),
    kind: connector,
    config,
    access: row.accessPolicy,
    processor: processor ? { slug: processor.slug, config: processor.config } : undefined,
    enabled: row.enabled === 'false' ? false : undefined,
  }));
}

/**
 * An eval dataset row as `evals/<slug>.yaml`, with the evaluators it still
 * grades with. Built-in evaluators were stored one row per id and go back as
 * one `builtin:` entry per provider and level; a custom one as itself.
 * @param row - The dataset row.
 * @param evaluators - Its evaluator rows.
 */
export function evalDatasetFile(row: EvalDatasetRow, evaluators: readonly EvalEvaluatorRow[]): ExportFile {
  const live = evaluators.filter(e => e.retiredAt === null && e.datasetSlug === row.slug);
  const builtins = new Map<string, { provider: string; level?: string; builtin: string[] }>();
  const custom: Array<Record<string, unknown>> = [];
  for (const e of live) {
    const config = (e.config ?? {}) as Record<string, unknown>;
    if (Object.keys(config).length === 0) {
      const key = `${e.provider}\0${e.level ?? ''}`;
      const entry = builtins.get(key) ?? { provider: e.provider, ...(e.level ? { level: e.level } : {}), builtin: [] };
      entry.builtin.push(e.slug);
      builtins.set(key, entry);
    } else {
      custom.push(compact({ provider: e.provider, slug: e.slug, level: e.level, ...config }));
    }
  }
  return yamlFile(`evals/${row.slug}.yaml`, compact({
    slug: row.slug,
    name: row.name,
    description: row.description,
    agentSlug: row.agentSlug,
    version: row.version,
    provider: row.provider,
    passThreshold: row.passThreshold,
    evaluators: [...builtins.values(), ...custom],
    items: row.items,
  }));
}

/**
 * A learning step's namespace row as `learnings/<name>.yaml`, with the rules
 * the workspace seeded it with (each kept under its authored id, text as it
 * stands now). Rules the step learned since from people's feedback are the
 * workspace's memory, not its authoring, and stay.
 * @param row - The namespace row.
 * @param seeded - Its seeded rules, by authored id.
 */
export function learningStepFile(row: LearningStepRow, seeded: ReadonlyArray<{ id: string; text: string }> = []): ExportFile {
  return yamlFile(`learnings/${row.name}.yaml`, compact({
    name: row.name,
    title: row.title,
    description: row.description,
    preamble: row.preamble,
    agents: row.agentSlugs ?? [],
    rules: [...seeded].sort((a, b) => a.id.localeCompare(b.id)),
    scope: row.scopeKind !== 'workspace' && row.scopeRef ? { kind: row.scopeKind, ref: row.scopeRef } : undefined,
  }));
}

/** A trust rule as stored, and the autonomy policy beside it. */
export type TrustRows = {
  rules: ReadonlyArray<{ actionId: string; threshold: number; enabled: string }>;
  policies: ReadonlyArray<{ actionId: string; rung: string; riskTier: string; source: string }>;
};

/**
 * The trust rules as `trust.yaml`: one rule per stored rule, carrying the rung
 * and risk tier its policy holds where they are not what an apply would give
 * the rule anyway (`defaults`), and a risk tier for each kind the file named
 * without a rule. Null when there is nothing to say.
 * @param rows - The trust rules and autonomy policies.
 * @param defaults - The rung and risk an apply gives a rule that names neither.
 */
export function trustFile(rows: TrustRows, defaults: (actionId: string, enabled: boolean) => { rung: string; risk: string }): ExportFile | null {
  const policyFor = new Map(rows.policies.map(p => [p.actionId, p]));
  const rules = [...rows.rules]
    .sort((a, b) => a.actionId.localeCompare(b.actionId))
    .map((r) => {
      const enabled = r.enabled === 'true';
      const policy = policyFor.get(r.actionId);
      const usual = defaults(r.actionId, enabled);
      return compact({
        action: r.actionId,
        autoApproveAbove: r.threshold,
        enabled,
        rung: policy && policy.rung !== usual.rung ? policy.rung : undefined,
        risk: policy && policy.riskTier !== usual.risk ? policy.riskTier : undefined,
      });
    });
  const ruled = new Set(rows.rules.map(r => r.actionId));
  const risk = Object.fromEntries(rows.policies
    .filter(p => p.source === 'trust.yaml' && !ruled.has(p.actionId))
    .sort((a, b) => a.actionId.localeCompare(b.actionId))
    .map(p => [p.actionId, p.riskTier]));
  if (rules.length === 0 && Object.keys(risk).length === 0) {
    return null;
  }
  return yamlFile('trust.yaml', compact({ rules, risk }));
}

/**
 * The workspace's voice rules as `voice.yaml`, or null for none.
 * @param voiceRules - `project.voice_rules`.
 */
export function voiceFile(voiceRules: ProjectRow['voiceRules']): ExportFile | null {
  return voiceRules ? yamlFile('voice.yaml', voiceRules) : null;
}

/**
 * The workspace's operating intent as `operating-intent.yaml`, or null for none.
 * @param operatingIntent - `project.operating_intent`.
 */
export function operatingIntentFile(operatingIntent: ProjectRow['operatingIntent']): ExportFile | null {
  return operatingIntent ? yamlFile('operating-intent.yaml', operatingIntent) : null;
}

/**
 * The settings `workspace.yaml` carries, from the project row: for a project
 * with no manifest stored (a personal workspace, one an operator made by
 * script), and to correct a stored manifest where the row has moved on.
 *
 * Plugins are written as the row holds them, dependencies included (listing a
 * dependency is the same as pulling it in). Surfaces are the row's less those
 * an enabled plugin turns on by itself, which the loader adds back.
 * @param project - The project row.
 * @param ctx - What the row alone does not say.
 * @param ctx.ownerEmails - Owners' emails, by user id.
 * @param ctx.pluginSurfaces - Surfaces the enabled plugins declare.
 */
export function manifestSettingsFromProject(
  project: Pick<ProjectRow, 'leadAgentSlug' | 'accountableUserId' | 'goal' | 'enabledSurfaces' | 'enabledPlugins' | 'enabledDurable' | 'embeddingConfig' | 'regenerateSkills' | 'clientFacingPlaybooks' | 'learningEagerness' | 'timeZone' | 'mailboxEnabled' | 'mailboxAddress'>,
  ctx: { ownerEmails: Map<string, string>; pluginSurfaces: ReadonlySet<string> },
): Record<string, unknown> {
  const defaults = compact({
    timezone: project.timeZone,
    embeddingProvider: project.embeddingConfig?.provider,
    embeddingModel: project.embeddingConfig?.model,
    regenerateSkills: project.regenerateSkills,
    learningEagerness: project.learningEagerness,
  });
  return compact({
    ...projectLeadToManifestKeys({ leadAgentSlug: project.leadAgentSlug, accountableUserId: project.accountableUserId, goal: project.goal }, ctx.ownerEmails),
    // On, and no more: the address is this deployment's and this workspace's,
    // and a workspace made from the file derives its own from its slug.
    mailbox: project.mailboxEnabled ? { enabled: true } : undefined,
    // An empty list of client-facing playbooks is a choice (gate nothing), so
    // it is written where `compact` would drop it; null is no choice at all.
    defaults: project.clientFacingPlaybooks === null
      ? defaults
      : { ...defaults, clientFacingPlaybooks: project.clientFacingPlaybooks },
    surfaces: (project.enabledSurfaces ?? []).filter(s => !ctx.pluginSurfaces.has(s)),
    plugins: project.enabledPlugins ?? [],
    durable: project.enabledDurable ?? [],
  });
}
