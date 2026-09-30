import type { PullSignals } from '@/libs/factory/workFacts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { MERGE_RISK_CLASSES } from '@/libs/actions/factory';
import { MERGE_ACTION_ID, MERGE_PROPOSAL_CONFIDENCE } from '@/libs/actions/mergeAction';
import { db } from '@/libs/DB';
import { NO_PULL_SIGNALS, normalisePullUrl } from '@/libs/factory/workFacts';
import { PR_CHECKS_COMPLETED, PR_CLOSED, PR_MERGED } from '@/libs/github/events';
import { actionRunSchema, eventLogSchema } from '@/models/Schema';

/**
 * WHAT THE RECORDS SAY ABOUT A PULL REQUEST, AND WHETHER ITS MERGE RUNS ITSELF
 * (backlog 044). The reads behind `libs/factory/workFacts.ts`: GitHub's own
 * events for merged, closed and CI, the done merge action, and the trust
 * ladder's verdict on a merge of the change's class — so an agent says
 * "merged" only when a record does, and "it merges on its own" only when the
 * rule says so.
 */

type Meta = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Every pull request's signals, in two reads.
 * @param orgId - Tenant.
 * @param urls - The pull requests.
 * @returns URL → signals; a URL nothing records reads {@link NO_PULL_SIGNALS}.
 */
export async function loadPullSignals(orgId: string, urls: readonly (string | null | undefined)[]): Promise<Map<string, PullSignals>> {
  const want = [...new Set(urls.filter((u): u is string => typeof u === 'string' && u.trim() !== '').map(normalisePullUrl))];
  const out = new Map<string, PullSignals>(want.map(u => [u, { ...NO_PULL_SIGNALS }]));
  if (want.length === 0) {
    return out;
  }
  const urlOf = sql<string>`${eventLogSchema.payload}->>'url'`;
  const mergeUrl = sql<string>`${actionRunSchema.input}#>>'{externalRef,url}'`;
  const [events, merges] = await Promise.all([
    db
      .select({ type: eventLogSchema.type, payload: eventLogSchema.payload, createdAt: eventLogSchema.createdAt })
      .from(eventLogSchema)
      .where(and(eq(eventLogSchema.orgId, orgId), inArray(eventLogSchema.type, [PR_CHECKS_COMPLETED, PR_MERGED, PR_CLOSED]), inArray(urlOf, want)))
      .orderBy(desc(eventLogSchema.id))
      .limit(50 * want.length),
    db
      .select({ url: mergeUrl, executedAt: actionRunSchema.executedAt })
      .from(actionRunSchema)
      .where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.actionId, MERGE_ACTION_ID), eq(actionRunSchema.status, 'done'), inArray(mergeUrl, want))),
  ]);
  // Newest first: the first event of each kind for a URL is the one that stands.
  for (const e of events) {
    const payload = (e.payload ?? {}) as Meta;
    const url = str(payload.url);
    const s = url ? out.get(normalisePullUrl(url)) : undefined;
    if (!s) {
      continue;
    }
    if (e.type === PR_CHECKS_COMPLETED && !s.checks) {
      s.checks = { conclusion: str(payload.conclusion), failedChecks: str(payload.failedChecks), headSha: str(payload.headSha), at: e.createdAt.toISOString() };
    } else if (e.type === PR_MERGED && !s.merged) {
      s.merged = { at: str(payload.mergedAt) ?? e.createdAt.toISOString() };
    } else if (e.type === PR_CLOSED && !s.closed) {
      s.closed = { at: e.createdAt.toISOString() };
    }
  }
  for (const m of merges) {
    const s = m.url ? out.get(normalisePullUrl(m.url)) : undefined;
    if (s && !s.merged) {
      s.merged = { at: m.executedAt?.toISOString() ?? null };
    }
  }
  return out;
}

/**
 * The class a merge of this task would carry: the higher of the task's own
 * and the class of the files its change touched (the repo's `riskDefaults`),
 * so a change that reached auth is ruled as auth. `record_verdict` files the
 * merge card with this; the facts read the trust rule with the same one.
 * @param orgId - Tenant.
 * @param meta - The task's metadata.
 */
export async function mergeRiskClassOf(orgId: string, meta: Meta): Promise<string> {
  const riskRaw = typeof meta.riskClass === 'string' ? meta.riskClass : 'logic';
  const { higherRisk, readRepo, riskFromPaths } = await import('@/libs/actions/factory-dispatch');
  const changed = Array.isArray(meta.filesChanged) ? (meta.filesChanged as unknown[]).filter((f): f is string => typeof f === 'string') : [];
  const repo = changed.length > 0
    ? await readRepo(orgId, typeof meta.repoSlug === 'string' ? meta.repoSlug : null, typeof meta.productSlug === 'string' ? meta.productSlug : null).catch(() => null)
    : null;
  const touched = repo ? riskFromPaths(changed, (repo.riskDefaults ?? {}) as Record<string, string>) : null;
  const effective = higherRisk(riskRaw, touched);
  return (MERGE_RISK_CLASSES as readonly string[]).includes(effective) ? effective : 'logic';
}

/**
 * Would QA's approve merge this class on its own? The ladder's own answer
 * (`willExecuteOnItsOwn`) for the card `record_verdict` files, at the
 * confidence it files it at — never a threshold of this module's. Null when
 * it cannot be read.
 * @param orgId - Tenant.
 * @param riskClass - The merge's class.
 */
export async function mergeRunsItself(orgId: string, riskClass: string): Promise<boolean | null> {
  try {
    const { willExecuteOnItsOwn } = await import('@/services/ActionService');
    return await willExecuteOnItsOwn({
      orgId,
      actionId: MERGE_ACTION_ID,
      input: {
        title: 'Merge the approved change',
        summary: 'QA approved it; merging is the deploy.',
        steps: [{ say: 'Merge the pull request.' }],
        riskClass,
        commitSha: '0000000',
        rollback: 'Revert the pull request and merge the revert.',
      },
      principal: { kind: 'agent', id: 'agent:merge-rule-read', scope: { orgId }, grants: ['*'], autonomy: 2 },
      proposal: { confidence: MERGE_PROPOSAL_CONFIDENCE, suggestedDecision: 'approve' },
    });
  } catch {
    return null;
  }
}

/**
 * {@link mergeRunsItself} for several classes, each read once.
 * @param orgId - Tenant.
 * @param classes - The classes.
 */
export async function mergeRulesFor(orgId: string, classes: Iterable<string>): Promise<Map<string, boolean | null>> {
  const unique = [...new Set(classes)];
  const answers = await Promise.all(unique.map(c => mergeRunsItself(orgId, c)));
  return new Map(unique.map((c, i) => [c, answers[i] ?? null]));
}
