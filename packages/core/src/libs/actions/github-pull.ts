/**
 * `repo.open_pull` (formerly `github.open_pull`) — THE PIPELINE'S OWNER OPENS
 * ITS OWN FIX (backlog 049). The GitHub provider of the repo family.
 * A red default branch or a pipeline that cannot run is often fixed in files
 * no engineer's worker may touch: `.github/workflows/*`, the runner's setup,
 * the checks' own config. The Release engineer writes the fix itself: the
 * files' whole new contents as one commit on a `vocion/pipeline-…` branch, and
 * a pull request from it (`services/factory/githubChange.ts`). The pull
 * request merges itself on green under `git.merge.pipeline`
 * (`services/factory/pipelineChange.ts`), and Undo closes it and deletes the
 * branch, or opens the revert once it merged.
 *
 * WHO MAY OPEN ONE. A person, in their own words; or an agent whose harness
 * grants it (`harness.grantTools: [repo.open_pull]`) — the seat that owns
 * the pipeline. Any other seat is refused with who to ask, so the engineer's
 * worker, which is walled off from the workflows, gains no way around the wall
 * through this door. No seat is named here: the grant is the agent's own
 * configuration.
 */

import type { Action } from './types';
import { z } from 'zod';

export const OPEN_PULL_ACTION_ID = 'repo.open_pull';

const fileSchema = z.object({
  path: z.string().min(1).max(400).describe('The file, from the repository root, e.g. .github/workflows/ci.yml.'),
  content: z.string().max(200_000).optional().describe('The file\'s whole new text. Required unless delete is true.'),
  delete: z.boolean().optional().describe('Remove the file instead of writing it.'),
});

const openPullInput = z.object({
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'the repository as owner/name').describe('The repository, owner/name.'),
  title: z.string().min(8).max(200).describe('The pull request\'s title: what it fixes, e.g. "CI: give the e2e job the database service it needs".'),
  body: z.string().min(20).max(20_000).describe('What broke (quote the log line), why this change fixes it, and how it is undone.'),
  files: z.array(fileSchema).min(1).max(20).describe('Every file the change writes, each with its whole new content (read it whole first: fetch_url on its github.com blob URL).'),
  base: z.string().max(200).optional().describe('The branch it targets; the repository\'s default branch when omitted.'),
  branch: z.string().max(200).optional().describe('An open change\'s branch (vocion/pipeline-…) to add this commit to, when it is a second attempt at the same fix.'),
  recordId: z.coerce.number().int().positive().optional().describe('The record this change answers — the fix request, or the environment — so its page shows the change and its merge.'),
});

type OpenPullInput = z.infer<typeof openPullInput>;

/**
 * Whether the proposer may open a pipeline change: a person, or an agent whose harness grants it.
 * @param orgId - The workspace.
 * @param invokedBy - `agent:<slug>`, a person's id, or `token:<id>`.
 */
export async function mayOpenPipelinePull(orgId: string, invokedBy: string | undefined): Promise<{ ok: true } | { ok: false; why: string }> {
  return mayActOnPipeline(orgId, invokedBy, OPEN_PULL_ACTION_ID);
}

/**
 * The repository's own record: the one titled with its owner/name, the way a
 * repo record is filed. Null when the workspace keeps none.
 * @param orgId - The workspace.
 * @param repo - owner/name.
 */
async function repositoryRecordId(orgId: string, repo: string): Promise<number | null> {
  const { and, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');
  const [row] = await db.select({ id: businessObjectSchema.id }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), sql`lower(${businessObjectSchema.title}) = ${repo.toLowerCase()}`)).limit(1);
  return row?.id ?? null;
}

/**
 * Whether the proposer may take one of the pipeline's own actions: a person,
 * or an agent whose harness grants that action by its id.
 * @param orgId - The workspace.
 * @param invokedBy - `agent:<slug>`, a person's id, or `token:<id>`.
 * @param actionId - The action, as the harness grants it.
 */
export async function mayActOnPipeline(orgId: string, invokedBy: string | undefined, actionId: string): Promise<{ ok: true } | { ok: false; why: string }> {
  const by = invokedBy ?? '';
  if (by && !by.includes(':')) {
    return { ok: true };
  }
  const slug = by.startsWith('agent:') ? by.slice('agent:'.length) : null;
  const { eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { agentSchema } = await import('@/models/Schema');
  const { aliasesOf } = await import('./registry');
  const names = new Set([actionId, ...aliasesOf(actionId)]);
  const owners = (await db.select({ slug: agentSchema.slug, harness: agentSchema.harnessConfig }).from(agentSchema).where(eq(agentSchema.orgId, orgId)))
    .filter(a => (a.harness?.grantTools ?? []).some(name => names.has(name)))
    .map(a => a.slug);
  if (slug && owners.includes(slug)) {
    return { ok: true };
  }
  const who = owners.length > 0 ? owners.join(' or ') : `the seat whose harness grants ${actionId}`;
  return { ok: false, why: `${actionId} is the pipeline's own move, made by the seat that owns the pipeline (${who}), not by ${slug ?? (by || 'this caller')}. Ask it in the same chat, with what broke and the log line that says so.` };
}

async function stampChange(orgId: string, recordId: number, change: Record<string, unknown>): Promise<void> {
  const { readRecord, writeMeta } = await import('./factory-dispatch');
  const record = await readRecord(orgId, recordId);
  if (!record) {
    return;
  }
  const prior = (record.meta.pipelineChange ?? null) as Record<string, unknown> | null;
  const same = prior && prior.url === change.url;
  await writeMeta(orgId, recordId, { pipelineChange: { ...(same ? prior : {}), ...change } });
}

export const githubOpenPullAction: Action<typeof openPullInput> = {
  id: OPEN_PULL_ACTION_ID,
  aliases: ['github.open_pull'],
  name: 'Open a pipeline change',
  description: 'Write files as one commit on a vocion/pipeline-… branch and open its pull request, with the workspace\'s GitHub token — for the seat that owns CI to fix the pipeline itself (a workflow under .github/workflows, the runner\'s setup, a check\'s config). Give each file\'s whole new content. The pull request merges itself when its checks are green (git.merge.pipeline); Undo closes it and deletes the branch, or opens the revert once it merged.',
  inputSchema: openPullInput,
  grant: 'factory_write',
  external: true,
  // One open change per branch; a new change per title and set of paths.
  dedupKeyFor: input => `${OPEN_PULL_ACTION_ID}:${input.repo}:${input.branch ?? `${input.title}:${input.files.map(f => f.path).sort().join(',')}`}`.slice(0, 400),
  ownsDedupKey: true,
  async precheck(ctx, input) {
    const may = await mayOpenPipelinePull(ctx.orgId, ctx.proposedBy ?? ctx.invokedBy);
    if (!may.ok) {
      return may.why;
    }
    const { cleanPath, PIPELINE_BRANCH_PREFIX } = await import('@/services/factory/githubChange');
    const bad = input.files.find(f => !cleanPath(f.path) || (!f.delete && typeof f.content !== 'string'));
    if (bad) {
      return `${bad.path}: ${cleanPath(bad.path) ? 'give its whole new content, or delete: true' : 'not a path inside the repository'}.`;
    }
    if (input.branch && !input.branch.startsWith(PIPELINE_BRANCH_PREFIX)) {
      return `${input.branch} is not a pipeline change's branch: continue one that starts ${PIPELINE_BRANCH_PREFIX}, or leave branch out for a new one.`;
    }
    return undefined;
  },
  async reviewCard(_ctx, raw) {
    const input = raw as OpenPullInput;
    return {
      title: `Open a pipeline change on ${input.repo}: ${input.title}`,
      system: 'GitHub',
      headline: 'Open a pull request with these files; it merges itself when its checks are green.',
      badges: [{ label: 'GitHub' }, { label: 'Undo closes it, or reverts it' }],
      fields: [
        { label: 'Repository', value: input.repo, href: `https://github.com/${input.repo}` },
        { label: 'Files', value: input.files.map(f => `${f.delete ? 'delete ' : ''}${f.path}`).join(', ') },
        ...(input.branch ? [{ label: 'Adds to', value: input.branch }] : []),
      ],
      summary: input.body.slice(0, 1200),
      nextAction: 'Approving opens the pull request now; it merges on green under the pipeline\'s merge rule.',
      verbs: { approve: 'Open it', reject: 'Leave it' },
    };
  },
  async execute(ctx, input) {
    const { openChangePull } = await import('@/services/factory/githubChange');
    const opened = await openChangePull(ctx.orgId, { repo: input.repo, title: input.title, body: input.body, files: input.files, base: input.base ?? null, branch: input.branch ?? null });
    const at = new Date().toISOString();
    // EVERY CHANGE IS TRACKED. Named record or not, the change lands on a record
    // the pipeline reconcile reads, or it never merges: squatch-core #148
    // (2026-10-01) was opened from chat with no recordId, went green, and sat,
    // while the reply said it "merges itself when its checks are green".
    // With no record named, it is the repository's own record (titled owner/name).
    const recordId = input.recordId ?? await repositoryRecordId(ctx.orgId, opened.repo);
    const short = opened.url.replace('https://github.com/', '');
    const line = recordId
      ? `${opened.created ? 'Opened' : 'Added a commit to'} ${short} (${opened.paths.join(', ')}): ${input.title}. It merges itself when its checks are green.`
      : `${opened.created ? 'Opened' : 'Added a commit to'} ${short} (${opened.paths.join(', ')}): ${input.title}. No record tracks it (name the request or environment it answers), so it will not merge itself.`;
    if (recordId) {
      await stampChange(ctx.orgId, recordId, {
        url: opened.url,
        repo: opened.repo,
        branch: opened.branch,
        base: opened.base,
        headSha: opened.headSha,
        title: input.title,
        paths: opened.paths,
        riskClass: 'pipeline',
        state: 'open',
        openedAt: at,
        pushedAt: at,
        by: ctx.invokedBy ?? null,
        actionRunId: ctx.runId ?? null,
      });
      const { noteOnRequest } = await import('@/services/factory/carry');
      await noteOnRequest(ctx.orgId, recordId, line, ctx.runId ?? null).catch(() => undefined);
    }
    return { opened: true, ...opened, ...(recordId ? { objectId: recordId } : {}), line };
  },
  async undo(ctx, input, result) {
    const url = typeof result?.url === 'string' ? result.url : null;
    const branch = typeof result?.branch === 'string' ? result.branch : null;
    if (!url || !branch) {
      return { note: 'This change named no pull request, so there was nothing to take back.' };
    }
    const { discardChange } = await import('@/services/factory/githubChange');
    const out = await discardChange(ctx.orgId, { url, repo: input.repo, branch });
    const recordId = input.recordId ?? (typeof result?.objectId === 'number' ? result.objectId : null);
    if (recordId) {
      await stampChange(ctx.orgId, recordId, { url, state: out.state === 'merged' ? 'reverting' : 'withdrawn', revertUrl: out.revertUrl, undoneAt: new Date().toISOString() });
    }
    return { ...out, note: out.revertUrl ? `It had merged; the revert is open at ${out.revertUrl}.` : 'The pull request is closed and its branch deleted.' };
  },
};
