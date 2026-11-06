/**
 * `repo.comment_pull` — A LINE ON THE PULL REQUEST, WHERE THE ENGINEERS READ.
 *
 * The engineer's run report (what changed, the checks, the assumptions, what
 * is still broken), the Release engineer's two lines on why a check is red,
 * a pointer from the factory to the record that asked for the change: each
 * belongs on the pull request itself, because that is the page a repository's
 * own engineers open. Reversible by nature — Undo deletes the comment — so
 * the plugin's trust ladder runs it done for you; a workspace that wants a
 * person to read every word first holds it in trust.yaml.
 *
 * The provider is chosen from the URL (`services/repo/provider.ts`); the
 * card names the host it will post to.
 */

import type { Action } from './types';
import { z } from 'zod';
import { contentHash } from './contentHash';

export const COMMENT_PULL_ACTION_ID = 'repo.comment_pull';

const commentPullInput = z.object({
  url: z.string().url().describe('The pull request to comment on.'),
  body: z.string().min(8).max(20_000).describe('The comment, as the host renders it (Markdown). Say what a reader on the pull request needs: the run report, why a check is red, where the request is.'),
  recordId: z.coerce.number().int().positive().optional().describe('The record this comment is about (the engineering task, the request or the environment), so its page shows it.'),
});

type Input = z.infer<typeof commentPullInput>;

export const repoCommentPullAction: Action<typeof commentPullInput> = {
  id: COMMENT_PULL_ACTION_ID,
  name: 'Comment on a pull request',
  description: 'Post a comment on a pull request on a connected code host, with the workspace\'s own credential: the engineer\'s run report, why a check is red, where the request is. Undo deletes the comment.',
  inputSchema: commentPullInput,
  grant: 'factory_write',
  external: true,
  // One comment per pull request and wording: the same words proposed twice are one card.
  dedupKeyFor: input => `${COMMENT_PULL_ACTION_ID}:${input.url}:${contentHash(undefined, input.body)}`,
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
    return {
      title: `Comment on ${input.url.replace(/^https:\/\/[^/]+\//, '')}`,
      system: host,
      headline: `Approving posts this comment on the pull request now, on ${host}. Undo deletes it.`,
      badges: [{ label: host }, { label: 'Reversible' }],
      contentHeading: { label: 'Comment' },
      content: [{ kind: 'message' as const, id: 'body', label: 'Comment', body: input.body }],
      fields: [{ label: 'Pull request', value: input.url, href: input.url }],
      nextAction: 'Approving posts the comment now; Undo deletes it.',
      verbs: { approve: 'Post it', reject: 'Leave it' },
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
    const posted = await provider.commentPull(ctx.orgId, ref, input.body);
    const line = `Commented on ${ref.repo}#${ref.number}: ${input.body.split('\n')[0]!.slice(0, 160)}`;
    if (input.recordId) {
      const { noteOnRecord } = await import('@/services/factory/environments');
      await noteOnRecord(ctx.orgId, input.recordId, line, { runId: ctx.runId ?? null, url: posted.url }).catch(() => undefined);
    }
    return { commented: true, repo: ref.repo, number: ref.number, commentId: posted.commentId, url: posted.url, ...(input.recordId ? { objectId: input.recordId } : {}), line };
  },
  async undo(ctx, input, result) {
    const commentId = Number(result?.commentId);
    const repo = typeof result?.repo === 'string' ? result.repo : null;
    if (!repo || !Number.isInteger(commentId) || commentId <= 0) {
      throw new Error('This run recorded no comment, so there is nothing to take back.');
    }
    const { repoProviderFor } = await import('@/services/repo/provider');
    const provider = await repoProviderFor(ctx.orgId, input.url);
    const number = Number(result?.number);
    await provider.deletePullComment(ctx.orgId, repo, commentId, Number.isInteger(number) && number > 0 ? number : undefined);
    return { deleted: true, commentId, line: `Deleted the comment on ${repo}.` };
  },
};
