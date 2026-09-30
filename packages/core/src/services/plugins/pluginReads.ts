import type { PluginPanelAction, PluginPanelLearning } from '@/features/dashboard/plugins/pluginPanelPlan';
import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { actionRunSchema, learningCandidateSchema, memoryNamespaceSchema, memorySchema } from '@/models/Schema';
import { actionAgentSlug } from '@/services/team-report';

/**
 * What a plugin's agents learned and what people decided on their proposals —
 * the reads behind the plugin panel's "Learned from use" group and the
 * Configure page's Learned tab, in one place so the two can never disagree
 * about what a plugin was taught.
 */

/**
 * The plugin's learnings: candidates filed against a learning step one of its
 * agents owns, or scoped directly to one of its agents. Newest `limit`
 * (five on the panel).
 *
 * A step is a `memory_namespace` row carrying `agent_slugs`, so "whose step is
 * this" is answered by the same table the agent reads its rules from rather
 * than by a name convention.
 * @param orgId - Tenant.
 * @param agentSlugs - The plugin's agents.
 * @param limit - How many, newest first.
 */
export async function readPluginLearnings(orgId: string, agentSlugs: readonly string[], limit = 5): Promise<PluginPanelLearning[]> {
  if (agentSlugs.length === 0) {
    return [];
  }
  const namespaces = await db
    .select({ name: memoryNamespaceSchema.name, agentSlugs: memoryNamespaceSchema.agentSlugs })
    .from(memoryNamespaceSchema)
    .where(eq(memoryNamespaceSchema.orgId, orgId));
  const steps = namespaces.filter(ns => ns.agentSlugs.some(s => agentSlugs.includes(s))).map(ns => ns.name);
  const scoped = and(eq(learningCandidateSchema.scopeKind, 'agent'), inArray(learningCandidateSchema.scopeRef, [...agentSlugs]));
  const where = steps.length > 0 ? or(inArray(learningCandidateSchema.stepName, steps), scoped) : scoped;
  const [candidates, adopted] = await Promise.all([
    db
      .select({
        id: learningCandidateSchema.id,
        ruleText: learningCandidateSchema.ruleText,
        editedRuleText: learningCandidateSchema.editedRuleText,
        status: learningCandidateSchema.status,
        stepName: learningCandidateSchema.stepName,
        decidedAt: learningCandidateSchema.decidedAt,
        createdAt: learningCandidateSchema.createdAt,
        memoryKey: learningCandidateSchema.createdMemoryKey,
        feedbackJobId: learningCandidateSchema.sourceFeedbackJobId,
        decidedBy: learningCandidateSchema.decidedBy,
        sourceRunId: learningCandidateSchema.sourceRunId,
      })
      .from(learningCandidateSchema)
      .where(and(eq(learningCandidateSchema.orgId, orgId), where))
      .orderBy(desc(learningCandidateSchema.createdAt))
      .limit(limit),
    // A rule an agent writes from chat (`add_learning`) or one seeded by the
    // workspace never passes through the review queue, so the candidate table
    // cannot see it — and those are exactly the rules now in force. Read the
    // rules themselves from the steps this plugin's agents own.
    steps.length > 0
      ? db
          .select({ id: memorySchema.id, key: memorySchema.key, value: memorySchema.value, updatedAt: memorySchema.updatedAt })
          .from(memorySchema)
          .where(and(eq(memorySchema.orgId, orgId), or(...steps.map(step => like(memorySchema.key, `/workspace/${step}/%`)))))
          .orderBy(desc(memorySchema.updatedAt))
          .limit(limit)
      : Promise.resolve([]),
  ]);

  const adoptedRules: PluginPanelLearning[] = adopted
    .filter(r => (r.value as { meta?: { kind?: string } }).meta?.kind === 'rule')
    .map((r) => {
      const meta = (r.value as { meta?: { adoptedAt?: string; source?: string | null; createdBy?: string | null } }).meta;
      const adoptedAt = meta?.adoptedAt ? new Date(meta.adoptedAt) : null;
      return {
        id: `rule:${r.id}`,
        text: String((r.value as { content?: unknown }).content ?? ''),
        status: 'adopted',
        at: adoptedAt && !Number.isNaN(adoptedAt.getTime()) ? adoptedAt : r.updatedAt,
        step: r.key.split('/')[2] ?? '',
        origin: ruleOrigin(meta?.source ?? null),
        by: meta?.createdBy ?? null,
      };
    })
    .filter(r => r.text.length > 0);
  const adoptedKeys = new Set(adopted.map(r => r.key));

  // A candidate somebody adopted became one of those rules; show the rule, not
  // both — the panel is what the agent reads now, not the paperwork behind it.
  const pending: PluginPanelLearning[] = candidates
    .filter(r => !(r.memoryKey && adoptedKeys.has(r.memoryKey)))
    .map(r => ({
      id: `candidate:${r.id}`,
      text: r.editedRuleText ?? r.ruleText,
      status: r.status,
      at: r.decidedAt ?? r.createdAt,
      step: r.stepName,
      origin: r.feedbackJobId ? 'Review feedback' : r.sourceRunId ? 'A run' : 'Learning queue',
      by: r.decidedBy,
    }));

  return [...adoptedRules, ...pending]
    .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0))
    .slice(0, limit);
}

/**
 * Where an adopted rule came from, in words, read off the provenance the
 * writer stamped on it (`MemoryService.addRule`'s `source`). The prefixes are
 * the writers' own typed markers, not a person's words: `feedback:<id>` from
 * the review queue, `workspace:<id>` seeded from a file, `<runKind>:<runId>`
 * from a run's learning step. Anything else was written in conversation.
 * @param source - `value.meta.source` on the rule.
 */
export function ruleOrigin(source: string | null): string {
  if (!source) {
    return 'Conversation';
  }
  const kind = source.split(':')[0] ?? '';
  switch (kind) {
    case 'feedback': return 'Review feedback';
    case 'learning-candidate': return 'Learning queue';
    case 'workspace': return 'Workspace file';
    case 'preference-fast-lane': return 'A person, in chat';
    case 'manual': return 'Added by hand';
    case 'action_run':
    case 'eval_run':
    case 'mission_run':
    case 'workflow_run':
    case 'worker_run': return 'A run';
    default: return 'Conversation';
  }
}

/** The statuses that mean a proposal has been decided, either way. */
const DECIDED_ACTION_STATUSES = ['done', 'rejected', 'undone'] as const;

/**
 * The plugin's decided proposals: action runs one of its agents proposed that
 * reached an end — executed, rejected or undone. Newest `limit`, by when they
 * were decided.
 *
 * The agent behind a run is the same expression the team report reads
 * (`actionAgentSlug`), so "who proposed this" is answered once.
 * @param orgId - Tenant.
 * @param agentSlugs - The plugin's agents.
 * @param limit - How many, newest first.
 */
export async function readPluginActions(orgId: string, agentSlugs: readonly string[], limit = 5): Promise<PluginPanelAction[]> {
  if (agentSlugs.length === 0) {
    return [];
  }
  const rows = await db
    .select({
      id: actionRunSchema.id,
      actionId: actionRunSchema.actionId,
      input: actionRunSchema.input,
      status: actionRunSchema.status,
      decidedAt: actionRunSchema.decidedAt,
      executedAt: actionRunSchema.executedAt,
      createdAt: actionRunSchema.createdAt,
    })
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      inArray(actionRunSchema.status, [...DECIDED_ACTION_STATUSES]),
      inArray(actionAgentSlug, [...agentSlugs]),
    ))
    .orderBy(sql`coalesce(${actionRunSchema.decidedAt}, ${actionRunSchema.executedAt}, ${actionRunSchema.createdAt}) desc`)
    .limit(limit);
  return rows.map((r) => {
    const title = r.input?.title;
    return {
      id: r.id,
      title: typeof title === 'string' && title.length > 0 ? title : r.actionId,
      status: r.status,
      at: r.decidedAt ?? r.executedAt ?? r.createdAt,
    };
  });
}
