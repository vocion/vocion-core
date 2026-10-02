/**
 * `repo.revert_pull` (formerly `github.revert_pull`) — A RELEASE THAT TOOK AN
 * ENVIRONMENT DOWN, TAKEN BACK
 * OUT (backlog 049; Chris, 2026-09-30: "An unhealthy one raises one
 * needs-person notification only after the Release engineer's own recovery
 * (re-run, redeploy, revert of the last release) has been tried and failed").
 * The environment was healthy on the commit before its last deploy and is not
 * on this one, and a re-run and a redeploy did not bring it back: GitHub's own
 * revert of the merged pull request is opened, and it merges itself on green
 * under `git.merge.rollback` (`pipelineChange.reconcileChanges`), deploying what
 * was live before the way every merge deploys.
 *
 * Undo closes the revert while it is open, or reverts the revert once merged:
 * the release goes back in. Only a person, or a seat whose harness grants it,
 * may open one (`github-pull.mayActOnPipeline`).
 */

import type { Action } from './types';
import { z } from 'zod';
import { parsePullUrl } from '@/services/agents/tools/githubPullRead';
import { mayActOnPipeline } from './github-pull';

export const REVERT_PULL_ACTION_ID = 'repo.revert_pull';

const revertInput = z.object({
  url: z.string().url().refine(u => parsePullUrl(u) !== null, { message: 'url must be a pull request, https://github.com/<owner>/<repo>/pull/<number>' }).describe('The merged pull request whose change to take back out, https://github.com/<owner>/<repo>/pull/<number>.'),
  recordId: z.coerce.number().int().positive().optional().describe('The environment (or request) the revert answers, so its page shows it and its merge.'),
  reason: z.string().min(8).max(600).describe('Why: what went down on this release, and what was tried first.'),
});

type RevertInput = z.infer<typeof revertInput>;

/**
 * A person's id carries no `kind:` prefix (`agent:<slug>`, `token:<id>`).
 * @param by
 */
const isPerson = (by: string | undefined): boolean => Boolean(by) && !by!.includes(':');

const prKey = (url: string): string | null => {
  const p = parsePullUrl(url);
  return p ? `${p.owner}/${p.repo}#${p.number}`.toLowerCase() : null;
};

/** What a revert would take back out: the pull request, and the releases it went out in. */
export type RevertSubject = {
  pull: { title: string; merged: boolean; mergedAt: string | null } | null;
  /** Releases that shipped it, with how production read after each. */
  releases: Array<{ id: number; code: string | null; healthAfter: string | null; healthCheckedAt: string | null }>;
  /** When the record the revert answers began (an incident, an environment's outage), if one is named. */
  recordSince: { code: string | null; at: Date } | null;
};

/**
 * Read what a revert would undo: the pull request from GitHub, the releases
 * on record that shipped it, and when the record it answers was opened. Each
 * part is null or empty when it cannot be read; nothing here throws.
 * @param orgId - The workspace.
 * @param input - The revert.
 */
export async function revertSubject(orgId: string, input: Pick<RevertInput, 'url' | 'recordId'>): Promise<RevertSubject> {
  const key = prKey(input.url);
  const { readPull } = await import('@/services/factory/githubMerge');
  const pull = await readPull(orgId, input.url).catch(() => null);
  const { loadObjectRows } = await import('@/services/workspace/objectRows');
  const releases = key
    ? (await loadObjectRows(orgId, 'release').catch(() => []))
        .filter(r => (Array.isArray(r.meta.prUrls) ? r.meta.prUrls : []).some(u => typeof u === 'string' && prKey(u.replace(/\/(files|commits|checks)\/?$/, '')) === key))
        .map(r => ({ id: Number(r.id), code: r.code ?? null, healthAfter: typeof r.meta.healthAfter === 'string' ? r.meta.healthAfter : null, healthCheckedAt: typeof r.meta.healthCheckedAt === 'string' ? r.meta.healthCheckedAt : null }))
    : [];
  let recordSince: RevertSubject['recordSince'] = null;
  if (input.recordId) {
    const { and, eq } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
    const [row] = await db.select({ createdAt: businessObjectSchema.createdAt, typeSlug: businessObjectTypeSchema.slug })
      .from(businessObjectSchema)
      .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
      .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, input.recordId)))
      .limit(1)
      .catch(() => []);
    if (row?.createdAt) {
      const { typeCodesForOrg } = await import('@/services/codes');
      const { recordCode } = await import('@/libs/codes');
      const codes = await typeCodesForOrg(orgId).catch(() => null);
      recordSince = { code: recordCode(codes, row.typeSlug, input.recordId), at: row.createdAt };
    }
  }
  return { pull, releases, recordSince };
}

/**
 * WHY AN AGENT MAY NOT TAKE THIS BACK OUT (action 5949, 2026-10-01: a product
 * manager put up a revert of the pull request that had restored production,
 * in a turn where the person had asked only to defer a request). A revert is
 * for a release that broke production, so an agent's revert is refused when
 * the facts on record say this one did not:
 *
 *   - a release that shipped it read healthy after it went out (`healthAfter: ok`)
 *     — reverting it takes a working release back out;
 *   - it merged after the record it answers was opened — it cannot be what
 *     broke it.
 *
 * Null when neither holds. A person who names the revert is never refused here.
 * @param subject - From {@link revertSubject}.
 * @param url - The pull request.
 */
export function revertRefusal(subject: RevertSubject, url: string): string | null {
  const name = url.replace(/^https:\/\/github\.com\//, '');
  const healthy = subject.releases.find(r => r.healthAfter === 'ok');
  if (healthy) {
    return `Not reverting ${name}: it went out in ${healthy.code ?? `release ${healthy.id}`}, and production read healthy after it${healthy.healthCheckedAt ? ` (checked ${healthy.healthCheckedAt})` : ''}. Reverting it would take a working release back out of production. Only a person who names this revert can open it; say what it would undo and let them decide.`;
  }
  const merged = subject.pull?.mergedAt ? new Date(subject.pull.mergedAt) : null;
  if (merged && subject.recordSince && merged.getTime() > subject.recordSince.at.getTime()) {
    return `Not reverting ${name}: it merged at ${merged.toISOString()}, after ${subject.recordSince.code ?? 'the record it answers'} was opened at ${subject.recordSince.at.toISOString()}, so it cannot be what broke it. Only a person who names this revert can open it.`;
  }
  return null;
}

export const githubRevertPullAction: Action<typeof revertInput> = {
  id: REVERT_PULL_ACTION_ID,
  aliases: ['github.revert_pull'],
  name: 'Roll a release back',
  description: 'Open GitHub\'s revert of a merged pull request, with the workspace\'s GitHub token, for a release that took an environment down; it merges itself when its checks are green (git.merge.rollback) and deploys what was live before. Undo closes the revert, or reverts it once merged.',
  inputSchema: revertInput,
  grant: 'factory_write',
  external: true,
  // One revert per pull request.
  dedupKeyFor: input => `${REVERT_PULL_ACTION_ID}:${input.url}`,
  ownsDedupKey: true,
  async precheck(ctx, input) {
    const by = ctx.proposedBy ?? ctx.invokedBy;
    const may = await mayActOnPipeline(ctx.orgId, by, REVERT_PULL_ACTION_ID);
    if (!may.ok) {
      return may.why;
    }
    // A person who named this revert is never refused; an agent is held to the facts.
    if (isPerson(by)) {
      return undefined;
    }
    return revertRefusal(await revertSubject(ctx.orgId, input), input.url) ?? undefined;
  },
  async reviewCard(ctx, raw) {
    const input = raw as RevertInput;
    // WHAT IT WOULD UNDO, said plainly: the change by its own title, and the
    // releases it went out in with how production read after each.
    const subject = await revertSubject(ctx.orgId, input).catch(() => null);
    const shippedIn = (subject?.releases ?? []).map(r => `${r.code ?? `release ${r.id}`}${r.healthAfter ? ` (production read ${r.healthAfter} after it)` : ''}`).join(', ');
    const undoes = [subject?.pull?.title ? `"${subject.pull.title}"` : null, shippedIn ? `shipped in ${shippedIn}` : null].filter(Boolean).join(', ');
    return {
      title: `Roll back ${input.url.replace(/^https:\/\/github\.com\//, '')}`,
      system: 'GitHub',
      headline: 'Open the revert; it merges itself on green and deploys what was live before.',
      badges: [{ label: 'GitHub' }, { label: 'Undo puts the release back' }],
      fields: [
        { label: 'Pull request', value: input.url, href: input.url },
        ...(undoes ? [{ label: 'It undoes', value: `${undoes} — taken back out of production` }] : []),
        { label: 'Why', value: input.reason },
      ],
      nextAction: 'Approving opens the revert now.',
      verbs: { approve: 'Roll back', reject: 'Leave it' },
    };
  },
  async execute(ctx, input) {
    const { revertPull } = await import('@/services/factory/githubMerge');
    const { revertUrl } = await revertPull(ctx.orgId, input.url);
    const at = new Date().toISOString();
    const line = `Opened the rollback ${revertUrl.replace('https://github.com/', '')} of ${input.url.replace('https://github.com/', '')}: ${input.reason} It merges itself when its checks are green.`.slice(0, 600);
    if (input.recordId) {
      const { readRecord, writeMeta } = await import('./factory-dispatch');
      const record = await readRecord(ctx.orgId, input.recordId);
      if (record) {
        // Tracked like a pipeline change, so the reconciler merges it on green;
        // a red one is written down, and the record's own recovery takes the next step.
        await writeMeta(ctx.orgId, input.recordId, { pipelineChange: { url: revertUrl, reverts: input.url, title: `Roll back ${input.url.replace('https://github.com/', '')}`, riskClass: 'rollback', state: 'open', openedAt: at, pushedAt: at, by: ctx.invokedBy ?? null, actionRunId: ctx.runId ?? null, noRework: true } });
        const { noteOnRecord } = await import('@/services/factory/environments');
        await noteOnRecord(ctx.orgId, input.recordId, line, { runId: ctx.runId ?? null, url: revertUrl });
      }
    }
    return { reverted: false, revertPullRequest: revertUrl, url: revertUrl, reverts: input.url, ...(input.recordId ? { objectId: input.recordId } : {}), line };
  },
  async undo(ctx, input, result) {
    const url = typeof result?.url === 'string' ? result.url : null;
    if (!url) {
      return { note: 'This rollback named no pull request, so there was nothing to take back.' };
    }
    const { closePull, revertPull } = await import('@/services/factory/githubMerge');
    const closed = await closePull(ctx.orgId, url, 'Undone from Vocion: the rollback is withdrawn.');
    if (closed.state === 'merged') {
      const { revertUrl } = await revertPull(ctx.orgId, url);
      return { reopened: revertUrl, note: `The rollback had merged; putting the release back is open at ${revertUrl}.` };
    }
    if (input.recordId) {
      const { writeMeta } = await import('./factory-dispatch');
      await writeMeta(ctx.orgId, input.recordId, { pipelineChange: { url, state: 'withdrawn', undoneAt: new Date().toISOString() } });
    }
    return { closed: closed.closed, note: 'The rollback is closed; nothing was reverted.' };
  },
};
