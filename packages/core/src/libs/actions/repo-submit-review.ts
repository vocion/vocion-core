/**
 * `repo.submit_review` — QA'S VERDICT, WHERE THE ENGINEERS READ IT.
 *
 * The verdict lives on the task (`record_verdict`) and decides the merge
 * card; this mirrors it onto the pull request as a review on the host —
 * approve, request changes or comment — with each finding as an inline
 * comment on the line it is about, so a repository's own engineers see the
 * factory's judgement in the tool they already use, keyed to the acceptance
 * criterion it fails. Nothing merges here; a review is an opinion on the
 * record. Undo dismisses an approval or a request for changes; a plain
 * comment review cannot be dismissed on GitHub, so its Undo says so.
 *
 * The reviewer's verdict mirror is proposed by `record_verdict` itself
 * (`services/agents/tools/recordVerdict.ts`), so a seat that holds no
 * `propose_action` still gets one; a seat that holds it may propose its own.
 */

import type { Action } from './types';
import { z } from 'zod';

export const SUBMIT_REVIEW_ACTION_ID = 'repo.submit_review';

export const REVIEW_EVENTS = ['approve', 'request_changes', 'comment'] as const;

const EVENT_LABEL: Record<typeof REVIEW_EVENTS[number], string> = {
  approve: 'Approve',
  request_changes: 'Request changes',
  comment: 'Comment',
};

const inlineComment = z.object({
  path: z.string().min(1).max(400).describe('The file, from the repository root.'),
  line: z.number().int().positive().describe('The line in the diff the finding is about, on the new side unless side is LEFT.'),
  body: z.string().min(1).max(4_000).describe('The finding, keyed to the acceptance criterion, path rule or check it fails.'),
  side: z.enum(['LEFT', 'RIGHT']).optional().describe('RIGHT (the new code, default) or LEFT (the removed code).'),
});

const submitReviewInput = z.object({
  url: z.string().url().describe('The pull request to review.'),
  event: z.enum(REVIEW_EVENTS).describe('approve, request_changes or comment.'),
  body: z.string().min(1).max(20_000).describe('The review\'s summary: the verdict in one line, the proven count, each finding.'),
  comments: z.array(inlineComment).max(50).optional().describe('Findings on lines of the diff, at most fifty.'),
  taskId: z.coerce.number().int().positive().optional().describe('The engineering task this review is the verdict of.'),
  recordId: z.coerce.number().int().positive().optional().describe('The record this review is about, so its page shows it.'),
});

type Input = z.infer<typeof submitReviewInput>;

export const repoSubmitReviewAction: Action<typeof submitReviewInput> = {
  id: SUBMIT_REVIEW_ACTION_ID,
  name: 'Review a pull request',
  description: 'Submit a review on a pull request on a connected code host — approve, request changes or comment — with each finding as an inline comment on its line, keyed to the acceptance criterion it fails. Merges nothing. Undo dismisses an approval or a request for changes.',
  inputSchema: submitReviewInput,
  grant: 'factory_write',
  external: true,
  // One pending review of a kind per pull request; a review on a later head is a new card once this one is decided.
  dedupKeyFor: input => `${SUBMIT_REVIEW_ACTION_ID}:${input.url}:${input.event}`,
  ownsDedupKey: true,
  async precheck(ctx, input) {
    const { repoProviderFor } = await import('@/services/repo/provider');
    try {
      const provider = await repoProviderFor(ctx.orgId, input.url);
      return provider.parsePullRef(input.url) ? undefined : `${input.url} is not a pull request URL on ${provider.label}.`;
    } catch (err) {
      return (err as Error).message;
    }
  },
  async reviewCard(ctx, raw) {
    const input = raw as Input;
    const { repoProviderFor } = await import('@/services/repo/provider');
    const host = await repoProviderFor(ctx.orgId, input.url).then(p => p.label).catch(() => 'the code host');
    const findings = input.comments?.length ?? 0;
    return {
      title: `${EVENT_LABEL[input.event]} on ${input.url.replace(/^https:\/\/[^/]+\//, '')}`,
      system: host,
      headline: `Approving submits this review (${EVENT_LABEL[input.event].toLowerCase()}) on the pull request now, on ${host}. It merges nothing.`,
      badges: [{ label: host }, { label: input.event === 'comment' ? 'Not dismissable' : 'Undo dismisses it', ...(input.event === 'comment' ? { tone: 'warn' as const } : {}) }],
      contentHeading: { label: 'Review' },
      content: [{ kind: 'message' as const, id: 'body', label: 'Review', body: input.body }],
      fields: [
        { label: 'Pull request', value: input.url, href: input.url },
        { label: 'Verdict', value: EVENT_LABEL[input.event] },
        ...(findings > 0 ? [{ label: 'Inline findings', value: `${findings} on ${new Set(input.comments!.map(c => c.path)).size} file(s)` }] : []),
        ...(input.taskId ? [{ label: 'Task', value: `#${input.taskId}` }] : []),
      ],
      nextAction: 'Approving submits the review now.',
      verbs: { approve: 'Submit review', reject: 'Leave it' },
    };
  },
  applyContentEdits(input, edits) {
    const edit = edits.find(e => e.id === 'body');
    return edit?.body === undefined ? input : { ...input, body: edit.body };
  },
  async execute(ctx, input) {
    const { repoProviderFor } = await import('@/services/repo/provider');
    const provider = await repoProviderFor(ctx.orgId, input.url);
    const ref = provider.parsePullRef(input.url);
    if (!ref) {
      throw new Error(`${input.url} is not a pull request URL on ${provider.label}.`);
    }
    const submitted = await provider.submitReview(ctx.orgId, ref, { event: input.event, body: input.body, comments: input.comments });
    const line = `${EVENT_LABEL[input.event]} on ${ref.repo}#${ref.number}${input.comments?.length ? ` with ${input.comments.length} inline finding(s)` : ''}.`;
    if (input.recordId) {
      const { noteOnRecord } = await import('@/services/factory/environments');
      await noteOnRecord(ctx.orgId, input.recordId, line, { runId: ctx.runId ?? null, url: submitted.url }).catch(() => undefined);
    }
    return { reviewed: true, repo: ref.repo, number: ref.number, reviewId: submitted.reviewId, url: submitted.url, event: input.event, ...(input.recordId ? { objectId: input.recordId } : {}), line };
  },
  async undo(ctx, input, result) {
    const reviewId = Number(result?.reviewId);
    if (!Number.isInteger(reviewId) || reviewId <= 0) {
      throw new Error('This run recorded no review, so there is nothing to take back.');
    }
    if (input.event === 'comment') {
      throw new Error('A comment review cannot be dismissed once submitted; it stays on the pull request as an opinion on the record.');
    }
    const { repoProviderFor } = await import('@/services/repo/provider');
    const provider = await repoProviderFor(ctx.orgId, input.url);
    const ref = provider.parsePullRef(input.url);
    if (!ref) {
      throw new Error(`${input.url} is not a pull request URL on ${provider.label}.`);
    }
    await provider.dismissReview(ctx.orgId, ref, reviewId, 'Undone from Vocion: the review is withdrawn.');
    return { dismissed: true, reviewId, line: `Dismissed the review on ${ref.repo}#${ref.number}.` };
  },
};
