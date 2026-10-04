/**
 * The software factory's hand-offs — every write the factory needs a person
 * or an outside system to perform, registered so `propose_action` accepts
 * them and their trust rules bind to something.
 *
 * The plugin (`templates/plugins/software-factory/trust.yaml`) has carried
 * rules for these ids since 1.1.0; a plugin cannot register an action
 * (`docs/plugins.md`), so they live here under one `factory` group until the
 * registry takes plugin-owned actions. That is the follow-up, and the shape
 * is ready for it: each entry is a descriptor, nothing here is code.
 *
 * Ordered by what is on the other side of a mistake, like the trust file.
 * Only the push is reversible — a branch is deleted with one command and
 * nothing downstream runs because of it. Everything else reaches people who
 * did not ask for the change and cannot undo it from where they stand.
 */

import type { Action } from './types';
import { z } from 'zod';
import { manualAction } from './manual';
import { MERGE_ACTION_ID } from './mergeAction';

/**
 * A merge is not one decision. The class names what the diff touches, and
 * the trust rule, the risk tier and the ledger live under
 * `git.merge.<riskClass>` (`policyKeyFor`), so docs can earn its way to
 * running within bounds while schema never does.
 */
/**
 * `pipeline` is a change the seat that owns CI opened itself
 * (`repo.open_pull`): its workflows, its runner setup, its checks' config,
 * merged on green with a revert as the undo (backlog 049). `rollback` is the
 * revert of a release an environment's recovery opened (`repo.revert_pull`)
 * after the environment went down on it: what was live before, put back.
 */
export const MERGE_RISK_CLASSES = ['docs', 'deps', 'marketing', 'ui', 'logic', 'auth', 'billing', 'schema', 'infra', 'promise', 'pipeline', 'rollback'] as const;
export type MergeRiskClass = typeof MERGE_RISK_CLASSES[number];

export const gitPushBranchAction = manualAction({
  id: 'git.push_branch',
  name: 'Push a branch',
  description: 'Push a worker\'s branch to the shared remote so a person can read the diff. Creates nothing anyone has to live with; the branch is deleted with one command. Hand-off: performed by the worker after approval, marked done when pushed.',
  system: 'Git',
  grant: 'factory_write',
  reversible: true,
});

const gitMergeHandoff = manualAction({
  id: MERGE_ACTION_ID,
  name: 'Merge a branch',
  description: 'Merge a reviewed pull request into the mainline (squash), only onto the commit QA judged and only with its checks green. Carries a riskClass (docs, deps, marketing, ui, logic, auth, billing, schema, infra, promise, pipeline, rollback) — the trust rule and the ledger key on git.merge.<riskClass>, so each class earns on its own. Undo opens the revert pull request.',
  system: 'Git',
  grant: 'factory_write',
  extend: {
    /** What the diff touches — picks the trust rule and the ledger. */
    riskClass: z.enum(MERGE_RISK_CLASSES),
    /**
     * THE EXACT CHANGE. On most repositories the merge is the deploy, so the
     * person approving is approving one commit, not a branch that may move
     * under them (review, 2026-09-24). Required: a merge ask that cannot name
     * its head is not a merge ask.
     */
    commitSha: z.string().regex(/^[0-9a-f]{7,40}$/i, 'the head commit, 7–40 hex characters'),
    /**
     * The commit QA's verdict was read against (`engineering_task.verdict.commitSha`).
     * Optional so an unreviewed hand-off can still be filed — the card then
     * says the verdict is not bound to a commit, which is the finding.
     */
    verdictCommitSha: z.string().regex(/^[0-9a-f]{7,40}$/i).optional(),
    /** How this is put back if the health check fails. Required, because a merge that is a deploy is not proposed without a way out. */
    rollback: z.string().min(8).max(600),
    /**
     * The engineering task this merge closes. With it, the merge ask is
     * refused while QA has a `block` finding open on the task (backlog 003) —
     * the finding is read off the record, not off the proposer's word.
     */
    taskId: z.number().int().positive().optional(),
  },
  extraFields: input => [
    { label: 'Risk class', value: input.riskClass },
    { label: 'Commit', value: input.commitSha },
    { label: 'QA verdict', value: verdictLine(input.commitSha, input.verdictCommitSha) },
    ...(input.taskId ? [{ label: 'Task', value: `#${input.taskId}` }] : []),
    { label: 'If the health check fails', value: input.rollback },
  ],
  policyKeyFor: input => `git.merge.${input.riskClass}`,
  precheck: async (ctx, input) => {
    const taskId = typeof input.taskId === 'number' ? input.taskId : null;
    if (taskId === null) {
      return undefined;
    }
    const open = await openBlockingFindings(ctx.orgId, taskId);
    if (open.length > 0) {
      const f = open[0]!;
      return `A merge ask cannot be filed while a blocking QA finding is open on task #${taskId}: [${f.against}] ${f.ref} — ${f.what}${open.length > 1 ? ` (and ${open.length - 1} more)` : ''}. Close the finding on the task (verdict.findings) with the evidence, or change the contract, then file again.`;
    }
    return undefined;
  },
  // One rule for git.merge governs every class until a class earns its own.
  parentRuleGoverns: true,
  // HELD MERGE, SENT BACK. A person who will not merge what QA approved is
  // disagreeing with the verdict; the task goes back to Changes asked with the
  // person's reason as the note, so Build again is offered and carries it.
  // Before, a rejected card left the task "accepted" and the feature could not
  // be built again (#131 attempt 187, 2026-09-28: approved on a URL shot taken
  // mid-debounce and a loading skeleton).
  onRejected: async (ctx, input, _runId, reason) => {
    const taskId = typeof input.taskId === 'number' ? input.taskId : null;
    if (taskId !== null) {
      await holdMerge(ctx.orgId, taskId, reason);
    }
  },
});

/**
 * The pull request a merge card is about: its externalRef, else its first step's link.
 * @param input
 */
function pullUrlOf(input: Record<string, unknown>): string | null {
  const ref = input.externalRef as { url?: unknown } | undefined;
  if (typeof ref?.url === 'string') {
    return ref.url;
  }
  const steps = Array.isArray(input.steps) ? input.steps as Array<{ url?: unknown }> : [];
  const url = steps.find(st => typeof st.url === 'string' && /github\.com\/.+\/pull\/\d+/.test(st.url))?.url;
  return typeof url === 'string' ? url : null;
}

/**
 * ONE PRESS (Chris, 2026-09-29: "simplify my work"). The merge is performed
 * here, not handed off: approving the card — a person's press, or the trust
 * rule for its risk class — merges the pull request (`githubMerge.ts`), onto
 * the commit QA judged with its checks green. Undo opens the revert.
 */
export const gitMergeAction: Action = {
  ...gitMergeHandoff,
  manual: undefined,
  external: true,
  async reviewCard(ctx, raw) {
    const card = await gitMergeHandoff.reviewCard!(ctx, raw);
    // THE DEMO FIRST (backlog 058): the feature recorded from the branch
    // before merge, narrated when QA has narrated it, so the person approving
    // watches it work before reading the verdict's lines.
    const taskId = typeof (raw as { taskId?: unknown }).taskId === 'number' ? (raw as { taskId: number }).taskId : null;
    const { previewDemoForTask } = await import('@/services/factory/previewDemo');
    const demo = taskId !== null ? await previewDemoForTask(ctx.orgId, taskId) : null;
    const content = demo ? [demo, ...(card.content ?? [])] : card.content;
    return { ...card, ...(demo ? { content, contentHeading: { label: 'What it does' } } : {}), nextAction: 'Approving merges the pull request now (squash), onto the commit QA judged, only with every check green — the merge is the deploy. Undo opens the revert.', verbs: { approve: 'Merge', reject: 'Hold' } };
  },
  async execute(ctx, raw) {
    const input = raw as Record<string, unknown>;
    const url = pullUrlOf(input);
    if (!url) {
      throw new Error('This merge card names no pull request, so there is nothing to merge.');
    }
    const { mergePull } = await import('@/services/factory/githubMerge');
    const judged = typeof input.verdictCommitSha === 'string' ? input.verdictCommitSha : typeof input.commitSha === 'string' ? input.commitSha : null;
    const res = await mergePull(ctx.orgId, url, judged);
    // VOCION KNOWS ITS OWN MERGE AT ONCE (2026-10-01, FE-314: merged 23:51:30,
    // the page read "Nothing running" over a running deploy until the next
    // GitHub sync raised pr.merged at 23:55). The same event, same dedupe key.
    if (res.pull) {
      const { mergedPullEvent } = await import('@/libs/github/events');
      const { emitEvent } = await import('@/services/EventService');
      const event = mergedPullEvent(res.repo, res.pull);
      await emitEvent({ orgId: ctx.orgId, type: event.type, payload: event.payload, dedupeKey: event.dedupeKey, invokedBy: 'action:git.merge' }).catch((err: Error) => console.warn('[git.merge] pr.merged was not raised; the sync will raise it', { url, message: err.message }));
    }
    return { merged: true, pullRequest: url, mergeSha: res.sha, alreadyMerged: res.already };
  },
  async undo(ctx, raw) {
    const url = pullUrlOf(raw as Record<string, unknown>);
    if (!url) {
      throw new Error('This merge names no pull request, so there is nothing to revert.');
    }
    const { revertPull } = await import('@/services/factory/githubMerge');
    const { revertUrl } = await revertPull(ctx.orgId, url);
    return { reverted: false, revertPullRequest: revertUrl, note: 'The revert pull request is open; merging it takes the change back out.' };
  },
};

/**
 * A person held the merge: the task reads Changes asked, the reason is QA's note.
 * @param orgId - The workspace.
 * @param taskId - The task the merge card was for.
 * @param reason - What the person said, if anything.
 */
export async function holdMerge(orgId: string, taskId: number, reason?: string): Promise<void> {
  const { db } = await import('@/libs/DB');
  const { and, eq, sql } = await import('drizzle-orm');
  const { businessObjectSchema } = await import('@/models/Schema');
  const [task] = await db.select({ meta: businessObjectSchema.metadata }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, taskId))).limit(1);
  if (!task) {
    return;
  }
  const verdict = ((task.meta ?? {}) as Record<string, unknown>).verdict as Record<string, unknown> | undefined;
  const held = { ...(verdict ?? {}), value: 'changes', heldBy: 'person', note: `A person held the merge: ${reason?.trim() || 'no reason given'}`.slice(0, 400) };
  await db
    .update(businessObjectSchema)
    .set({ status: 'changes_requested', metadata: sql`coalesce(${businessObjectSchema.metadata}, '{}'::jsonb) || ${JSON.stringify({ status: 'changes_requested', verdict: held })}::jsonb`, updatedAt: new Date() })
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, taskId)));
  const { recomputeRollupsForObject } = await import('@/services/objects/rollups');
  await recomputeRollupsForObject(orgId, taskId).catch(() => undefined);
}

/**
 * Is the verdict about the commit being merged? A verdict is evidence about
 * one diff; a head that moved after review carries an approval of code
 * nobody read, and the card says so instead of hiding it in a matching badge.
 * @param head - The commit the merge proposes.
 * @param reviewed - The commit QA's verdict names, if any.
 */
export function verdictLine(head: string, reviewed: string | undefined): string {
  if (!reviewed) {
    return 'not bound to a commit — nobody has recorded a verdict on this head';
  }
  const same = head.toLowerCase().startsWith(reviewed.toLowerCase()) || reviewed.toLowerCase().startsWith(head.toLowerCase());
  return same ? `read at ${reviewed.slice(0, 7)} — this commit` : `STALE — read at ${reviewed.slice(0, 7)}, the branch has moved to ${head.slice(0, 7)}`;
}

export const deployReleaseAction = manualAction({
  id: 'deploy.release',
  name: 'Release a deploy',
  description: 'Ship a built release to an environment people use. Reaches people who did not ask for the change and cannot undo it from where they stand. Hand-off: run by the deploy pipeline or a person after approval, marked done with the deployment URL.',
  system: 'Deploy',
  grant: 'factory_write',
});

export const deployProvisionAction = manualAction({
  id: 'deploy.provision',
  name: 'Provision infrastructure',
  description: 'Create or change the ground a product runs on — a database, a queue, a runtime, a role. Cannot be put back by clicking. Hand-off: a person or the provisioning pipeline applies the recipe, then marks it done.',
  system: 'Deploy',
  grant: 'factory_write',
});

export const awsMutateAction = manualAction({
  id: 'aws.mutate',
  name: 'Change an AWS resource',
  description: 'Any write to an AWS account — an IAM change, a parameter, a bucket policy, a service update. The recipe is the exact CLI or console steps. Cannot be put back. Hand-off: performed by a person holding the account, marked done with the change reference.',
  system: 'AWS',
  grant: 'factory_write',
});

export const credentialsWriteAction = manualAction({
  id: 'credentials.write',
  name: 'Write a credential',
  description: 'Create, rotate or place a secret where a worker can read it. The worker runs on a machine we do not host, so a credential it can read has left the building; the agent says what it needs and why, a person does it. Never auto-approved. Hand-off: a person writes it and marks it done — the value itself never travels through this card.',
  system: 'Credentials',
  grant: 'factory_write',
});

const releaseAnnounceHandoff = manualAction({
  id: 'release.announce',
  name: 'Announce a release',
  description: 'Publish a release\'s announcement under the company\'s name, with the live screenshot it leads with: posted to the workspace\'s Slack channel (the picture uploaded with it). Carries the release\'s id; the words and the picture are read off the release, never from the proposal. Undo deletes the post.',
  system: 'Release',
  grant: 'factory_write',
  extend: {
    /** The release whose announcement this publishes. Its words and picture are read off the record at execution. */
    releaseId: z.number().int().positive(),
  },
  extraFields: input => [{ label: 'Release', value: `#${input.releaseId}` }],
});

/**
 * ONE PRESS, WITH ITS PICTURE (backlog 043). Publishing is performed here,
 * not handed off: a person's press on the release page (their own action) or
 * an approved card posts the announcement to the workspace's Slack channel
 * with the live screenshot uploaded beside it, and records where it landed on
 * the release (`services/factory/releaseAnnounce.ts`). Undo deletes the post.
 * A workspace with no Slack connection publishes by copy from the page, which
 * runs nothing here.
 */
export const releaseAnnounceAction: Action = {
  ...releaseAnnounceHandoff,
  manual: undefined,
  external: true,
  async reviewCard(ctx, raw) {
    const card = await releaseAnnounceHandoff.reviewCard!(ctx, raw);
    return { ...card, nextAction: 'Approving posts the announcement to the workspace\'s Slack channel now, with its picture. Undo deletes the post.', verbs: { approve: 'Publish', reject: 'Hold' } };
  },
  async execute(ctx, raw) {
    const input = raw as { releaseId: number };
    const { publishAnnouncementToSlack } = await import('@/services/factory/releaseAnnounce');
    const { post, line } = await publishAnnouncementToSlack({ orgId: ctx.orgId, releaseId: input.releaseId, runId: ctx.runId ?? null, by: ctx.reviewedBy ?? ctx.invokedBy ?? null });
    return { published: true, releaseId: input.releaseId, post, line };
  },
  async undo(ctx, raw, result) {
    const input = raw as { releaseId: number };
    const post = (result?.post ?? null) as { channelId?: string; ts?: string | null; fileIds?: string[] } | null;
    if (!post?.channelId) {
      throw new Error('This run recorded no post, so there is nothing to take back.');
    }
    const { unpublishAnnouncement } = await import('@/services/factory/releaseAnnounce');
    return unpublishAnnouncement(ctx.orgId, input.releaseId, { channelId: post.channelId, ts: post.ts ?? null, fileIds: post.fileIds ?? [] });
  },
};

/**
 * Telling the asker is two different things (review, 2026-09-24). A routine,
 * evidenced completion — "shipped in v1.8, here is the release" — may earn
 * its way out under a policy the product owner turns on. A decline, an
 * incident update, an answer to a question or anything touching a promise is
 * read by a person every time. The kind picks the ledger, the way a merge's
 * risk class does.
 */
export const REPLY_KINDS = ['completion', 'decline', 'incident', 'question'] as const;
export type ReplyKind = typeof REPLY_KINDS[number];

export const notifyRequesterAction = manualAction({
  id: 'notify.requester',
  name: 'Answer the person who asked',
  description: 'The honest answer back to whoever filed the request — what shipped, what did not, and why — in the store, inbox or chat it came from, under the company\'s name. Cannot be unsent. Carries a kind: a routine completion may earn autonomy (notify.requester.completion); a decline, an incident update or an answer to a question is always a person\'s (notify.requester.sensitive). Hand-off: a person sends it and marks it done.',
  system: 'Requests',
  grant: 'factory_write',
  extend: {
    /** What sort of reply this is — picks the ledger. */
    kind: z.enum(REPLY_KINDS),
  },
  extraFields: input => [{ label: 'Reply kind', value: input.kind }],
  policyKeyFor: input => (input.kind === 'completion' ? 'notify.requester.completion' : 'notify.requester.sensitive'),
  // One rule for notify.requester governs both kinds until a kind earns its own.
  parentRuleGoverns: true,
});

/** Every factory hand-off, in trust-file order. */
export const factoryActions: readonly Action[] = [
  gitPushBranchAction,
  gitMergeAction,
  deployReleaseAction,
  deployProvisionAction,
  awsMutateAction,
  credentialsWriteAction,
  releaseAnnounceAction,
  notifyRequesterAction,
];

/** A QA finding as written on `engineering_task.verdict.findings` (backlog 003). */
export type QaFinding = { against: string; ref: string; severity: string; what: string; closeBy?: string };

/**
 * The `block` findings still open on a task's verdict. Read off the record so
 * a proposer cannot file around them by leaving them out of the input.
 * @param orgId - The workspace.
 * @param taskId - The engineering task.
 */
export async function openBlockingFindings(orgId: string, taskId: number): Promise<QaFinding[]> {
  const { db } = await import('@/libs/DB');
  const { and, eq } = await import('drizzle-orm');
  const { businessObjectSchema } = await import('@/models/Schema');
  const [row] = await db.select({ metadata: businessObjectSchema.metadata }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, taskId))).limit(1);
  const verdict = (row?.metadata as { verdict?: { findings?: unknown } } | null)?.verdict;
  const findings = Array.isArray(verdict?.findings) ? verdict.findings : [];
  return findings.filter((f): f is QaFinding => typeof f === 'object' && f !== null && (f as QaFinding).severity === 'block' && typeof (f as QaFinding).ref === 'string');
}
