/**
 * `repo.comment_pull`: a comment on the pull request through the provider the
 * URL names, deleted by Undo, one card per pull request and wording.
 */
import { describe, expect, it, vi } from 'vitest';

const commentPull = vi.fn(async () => ({ commentId: 501, url: 'https://github.com/Acme/northwind-core/pull/7#issuecomment-501' }));
const deletePullComment = vi.fn(async () => undefined);
const provider = { kind: 'github', label: 'GitHub', parsePullRef: (url: string) => (url.includes('/pull/') ? { repo: 'Acme/northwind-core', number: 7, url } : null), commentPull, deletePullComment };
vi.mock('@/services/repo/provider', () => ({ repoProviderFor: vi.fn(async (_o: string, url: string) => {
  if (url.includes('bitbucket')) {
    throw new Error('bitbucket.org is not a code host this workspace connected.');
  }
  return provider;
}) }));
const noteOnRecord = vi.fn(async () => undefined);
vi.mock('@/services/factory/environments', () => ({ noteOnRecord }));

const { repoCommentPullAction: action } = await import('./repo-comment-pull');
const input = { url: 'https://github.com/Acme/northwind-core/pull/7', body: 'Run report: checks green, one assumption.' };

describe('repo.comment_pull', () => {
  it('is refused at the door for a URL that is not a pull request on a connected host', async () => {
    await expect(action.precheck!({ orgId: 'org_1' }, input)).resolves.toBeUndefined();
    await expect(action.precheck!({ orgId: 'org_1' }, { ...input, url: 'https://github.com/Acme/northwind-core' })).resolves.toMatch(/not a pull request URL on GitHub/);
    await expect(action.precheck!({ orgId: 'org_1' }, { ...input, url: 'https://bitbucket.org/a/b/pull-requests/1' })).resolves.toMatch(/bitbucket\.org is not a code host/);
  });

  it('posts through the provider, writes the line on the record it is about, and Undo deletes the comment', async () => {
    const out = await action.execute({ orgId: 'org_1', runId: 9 }, { ...input, recordId: 41 });

    expect(commentPull).toHaveBeenCalledWith('org_1', { repo: 'Acme/northwind-core', number: 7, url: input.url }, input.body);
    expect(out).toMatchObject({ commented: true, commentId: 501, objectId: 41, line: expect.stringContaining('Commented on Acme/northwind-core#7') });
    expect(noteOnRecord).toHaveBeenCalledWith('org_1', 41, expect.any(String), { runId: 9, url: expect.stringContaining('#issuecomment-501') });

    await expect(action.undo!({ orgId: 'org_1' }, input, out)).resolves.toMatchObject({ deleted: true, commentId: 501 });
    expect(deletePullComment).toHaveBeenCalledWith('org_1', 'Acme/northwind-core', 501);
    await expect(action.undo!({ orgId: 'org_1' }, input, {})).rejects.toThrow(/recorded no comment/);
  });

  it('is one card per pull request and wording, with the words editable on the card', async () => {
    expect(action.dedupKeyFor!(input)).toBe(action.dedupKeyFor!({ ...input, recordId: 3 }));
    expect(action.dedupKeyFor!(input)).not.toBe(action.dedupKeyFor!({ ...input, body: 'Other words, same pull request.' }));

    const card = await action.reviewCard!({ orgId: 'org_1' }, input);

    expect(card).toMatchObject({ system: 'GitHub', content: [{ kind: 'message', id: 'body', body: input.body }] });
    expect(action.applyContentEdits!(input, [{ id: 'body', body: 'Edited.' }])).toMatchObject({ body: 'Edited.' });
  });
});
