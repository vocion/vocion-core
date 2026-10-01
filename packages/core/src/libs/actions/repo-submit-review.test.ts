/**
 * `repo.submit_review`: QA's verdict as a review on the pull request, findings
 * inline, dismissed by Undo — except a plain comment review, which the host
 * cannot dismiss, and whose Undo says so.
 */
import { describe, expect, it, vi } from 'vitest';

const submitReview = vi.fn(async () => ({ reviewId: 9001, url: 'https://github.com/Acme/northwind-core/pull/7#pullrequestreview-9001' }));
const dismissReview = vi.fn(async () => undefined);
const provider = { kind: 'github', label: 'GitHub', parsePullRef: (url: string) => (url.includes('/pull/') ? { repo: 'Acme/northwind-core', number: 7, url } : null), submitReview, dismissReview };
vi.mock('@/services/repo/provider', () => ({ repoProviderFor: vi.fn(async () => provider) }));
vi.mock('@/services/factory/environments', () => ({ noteOnRecord: vi.fn(async () => undefined) }));

const { repoSubmitReviewAction: action } = await import('./repo-submit-review');
const url = 'https://github.com/Acme/northwind-core/pull/7';
const input = { url, event: 'request_changes' as const, body: 'QA verdict: changes — 4 of 6 proven.', comments: [{ path: 'src/report.ts', line: 12, body: 'against criterion 2' }], taskId: 41 };

describe('repo.submit_review', () => {
  it('submits through the provider with its inline findings, and Undo dismisses it', async () => {
    const out = await action.execute({ orgId: 'org_1' }, input);

    expect(submitReview).toHaveBeenCalledWith('org_1', { repo: 'Acme/northwind-core', number: 7, url }, { event: 'request_changes', body: input.body, comments: input.comments });
    expect(out).toMatchObject({ reviewed: true, reviewId: 9001, event: 'request_changes', line: 'Request changes on Acme/northwind-core#7 with 1 inline finding(s).' });

    await expect(action.undo!({ orgId: 'org_1' }, input, out)).resolves.toMatchObject({ dismissed: true, reviewId: 9001 });
    expect(dismissReview).toHaveBeenCalledWith('org_1', { repo: 'Acme/northwind-core', number: 7, url }, 9001, expect.stringContaining('Undone'));
  });

  it('a comment review cannot be taken back, and says so instead of pretending', async () => {
    await expect(action.undo!({ orgId: 'org_1' }, { ...input, event: 'comment' }, { reviewId: 9001 })).rejects.toThrow(/cannot be dismissed/);

    const card = await action.reviewCard!({ orgId: 'org_1' }, { ...input, event: 'comment' });

    expect(card.badges).toContainEqual({ label: 'Not dismissable', tone: 'warn' });
  });

  it('is refused at the door for a URL that is not a pull request, and keyed per pull request and kind', async () => {
    await expect(action.precheck!({ orgId: 'org_1' }, input)).resolves.toBeUndefined();
    await expect(action.precheck!({ orgId: 'org_1' }, { ...input, url: 'https://github.com/Acme/northwind-core' })).resolves.toMatch(/not a pull request URL/);
    expect(action.dedupKeyFor!(input)).toBe(action.dedupKeyFor!({ ...input, body: 'other words' }));
    expect(action.dedupKeyFor!(input)).not.toBe(action.dedupKeyFor!({ ...input, event: 'approve' }));

    const card = await action.reviewCard!({ orgId: 'org_1' }, input);

    expect(card).toMatchObject({ title: 'Request changes on Acme/northwind-core/pull/7', fields: expect.arrayContaining([{ label: 'Inline findings', value: '1 on 1 file(s)' }, { label: 'Task', value: '#41' }]) });
  });
});
