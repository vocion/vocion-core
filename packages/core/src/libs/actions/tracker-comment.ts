/**
 * `tracker.comment` — a sentence on the issue where the client reads it: the
 * plan's link, the honest answer, "shipped in 1.8, here is the release".
 *
 * Telling an asker is two different things (plugin trust.yaml, 2026-09-24),
 * and a comment is one of its channels. So the proposal names the kind, and
 * the ladder keys it `tracker.comment.<kind>`: a routine completion may earn
 * its way out under a policy the product owner turns on; a decline, an
 * incident update or anything that touches a promise (`sensitive`) is read
 * by a person every time; `update` is the plan or a status line. A kind with
 * no rule of its own reads the parent's (`parentRuleGoverns`). The words are
 * on the card as an editable message, and Undo deletes the comment.
 */

import type { Action, ReviewCard } from './types';
import { z } from 'zod';

export const COMMENT_ACTION_ID = 'tracker.comment';
export const COMMENT_KINDS = ['completion', 'sensitive', 'update'] as const;

const commentInput = z.object({
  key: z.string().min(3).max(40).describe('The issue key, e.g. NOCO-123.'),
  text: z.string().min(1).max(10_000).describe('The comment, plain text; paragraphs separated by a blank line. Name the evidence (the release, the pull request) by its link.'),
  kind: z.enum(COMMENT_KINDS).optional().describe('completion: it shipped, with the release. sensitive: a decline, an incident, anything touching a promise. update: the plan, a status line.'),
});

type Input = z.infer<typeof commentInput>;

export const trackerCommentAction: Action<typeof commentInput> = {
  id: COMMENT_ACTION_ID,
  name: 'Comment on a tracker issue',
  description: 'Write a comment on an issue of the connected issue tracker — the plan\'s link, the honest answer, the release it shipped in. Name the kind (completion, sensitive, update) so the right trust rule applies. Undo deletes the comment.',
  inputSchema: commentInput,
  grant: 'factory_write',
  external: true,
  policyKeyFor: input => (input.kind ? `${COMMENT_ACTION_ID}.${input.kind}` : COMMENT_ACTION_ID),
  // One rule for tracker.comment governs every kind until a kind earns its own.
  parentRuleGoverns: true,
  // Two pending comments of one kind on one issue are one card; the words are the card's to edit.
  dedupKeyFor: input => `${COMMENT_ACTION_ID}:${input.key.trim().toUpperCase()}:${input.kind ?? 'any'}`,
  ownsDedupKey: true,
  async reviewCard(_ctx, raw): Promise<ReviewCard> {
    const input = raw as Input;
    return {
      title: `Comment on ${input.key.toUpperCase()}${input.kind ? ` (${input.kind})` : ''}`,
      system: 'Issue tracker',
      headline: `Approving writes this comment on ${input.key.toUpperCase()} now, where the client reads it. Undo deletes it.`,
      badges: [{ label: 'Issue tracker' }, ...(input.kind === 'sensitive' ? [{ label: 'Sensitive', tone: 'warn' as const }] : []), { label: 'Undo deletes the comment' }],
      contentHeading: { label: 'Comment' },
      content: [{ kind: 'message' as const, id: 'message', label: 'Comment', body: input.text }],
      fields: [
        { label: 'Issue', value: input.key.toUpperCase() },
        ...(input.kind ? [{ label: 'Kind', value: input.kind }] : []),
      ],
      nextAction: 'Approving writes the comment now.',
      verbs: { approve: 'Approve & comment', reject: 'Decline' },
    };
  },
  applyContentEdits(input, edits) {
    const edit = edits.find(e => e.id === 'message');
    return edit?.body === undefined ? input : { ...input, text: edit.body };
  },
  async execute(ctx, input) {
    const { trackerProviderFor } = await import('@/services/tracker/provider');
    const key = input.key.trim().toUpperCase();
    const provider = await trackerProviderFor(ctx.orgId, { issueKey: key });
    const comment = await provider.addComment(key, input.text);
    return { commented: true, key, commentId: comment.id, url: comment.url, line: `Commented on ${key}${input.kind ? ` (${input.kind})` : ''}.` };
  },
  async undo(ctx, input, result) {
    const key = typeof result?.key === 'string' ? result.key : input.key.trim().toUpperCase();
    const commentId = typeof result?.commentId === 'string' ? result.commentId : null;
    if (!commentId) {
      throw new Error('This run recorded no comment, so there is nothing to take back.');
    }
    const { trackerProviderFor } = await import('@/services/tracker/provider');
    const provider = await trackerProviderFor(ctx.orgId, { issueKey: key });
    await provider.deleteComment(key, commentId);
    return { deleted: true, key, commentId, line: `Deleted the comment from ${key}.` };
  },
};
