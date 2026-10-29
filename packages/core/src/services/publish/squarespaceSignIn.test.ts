/**
 * When Squarespace will not sign a publish run in: read from the run (its
 * typed output, the page it ended on), never from its words; the page waits
 * on a fresh sign-in, publishing, not failed; the connector says so. Every
 * site and person here is fictional.
 */
import type { BrowserRunView } from '@/libs/browser/run';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getBrowserRun = vi.fn();
const writeMeta = vi.fn(async () => {});
const markSignInNeeded = vi.fn(async () => {});

vi.mock('@/services/browser/BrowserRunService', () => ({ getBrowserRun }));
vi.mock('@/libs/sources/squarespace', () => ({ findPublishedPost: vi.fn(async () => ({ post: null })) }));
vi.mock('@/libs/actions/factory-dispatch', () => ({ readRecord: vi.fn(async () => ({ typeSlug: 'note', meta: {} })), writeMeta }));
vi.mock('@/services/browser/keptSignIn', () => ({ markSignInNeeded }));

const { editorSignedIn, freshSignInLine, needsFreshSignIn } = await import('./squarespaceSignIn');
const { settlePublishRun } = await import('./sitePublish');

const SITE = 'https://example-site.squarespace.com';

function run(over: Partial<BrowserRunView>): BrowserRunView {
  return { id: 41, status: 'failed', task: 'Save a blog post as a DRAFT', startUrl: `${SITE}/config/pages`, inputs: {}, outputs: [], result: null, summary: 'Could not sign in.', steps: [], waiting: null, error: 'Could not sign in.', url: null, title: null, frameSeq: 0, live: false, finalShotUrl: null, proposedBy: 'person', agentSlug: null, conversationId: null, cents: 0, isolation: null, resumes: 0, resuming: false, startedAt: null, ...over } as BrowserRunView;
}

describe('a run Squarespace would not sign in', () => {
  it('is told by its typed output, or by ending on the login page', () => {
    expect(needsFreshSignIn(run({ result: { sign_in: 'refused' } }))).toBe(true);
    expect(needsFreshSignIn(run({ steps: [{ n: 1, at: '', kind: 'open', label: 'Opened', ok: true, url: 'https://login.squarespace.com/api/1/login/oauth/provider/authorize' }] }))).toBe(true);
    expect(needsFreshSignIn(run({ result: { sign_in: 'ok' }, url: `${SITE}/config/pages` }))).toBe(false);
    // A run that ended any other way is not a sign-in problem, whatever page it was on.
    expect(needsFreshSignIn(run({ status: 'stopped', result: { sign_in: 'refused' } }))).toBe(false);
  });

  it('says what is needed, for the site, plainly', () => {
    expect(freshSignInLine(`${SITE}/`, true)).toMatch(/^Squarespace needs a fresh sign-in for example-site\.squarespace\.com\./);
    expect(freshSignInLine(SITE, false)).toContain('connect the site');
  });
});

describe('settling a run that needs a fresh sign-in', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('leaves the page publishing and waiting on the sign-in, never failed, and marks the connector', async () => {
    getBrowserRun.mockResolvedValue(run({ result: { sign_in: 'refused' } }));
    const owner = { userId: 'user_ada', conversationId: 5, agentSlug: null };

    const out = await settlePublishRun({ orgId: 'org_a', phase: 'draft', browserRunId: 41, pageRecordId: 9, siteUrl: SITE, blogPath: '/blog', slug: 'drain-cleaning', title: 'Drain cleaning', owner, actionRunId: 3, signInSourceId: 12 });

    expect(out).toEqual({ done: true, line: expect.stringContaining('Squarespace needs a fresh sign-in for example-site.squarespace.com') });
    expect(markSignInNeeded).toHaveBeenCalledWith('org_a', 12, expect.any(String));
    expect(writeMeta).toHaveBeenCalledWith('org_a', 9, expect.objectContaining({
      status: 'publishing',
      publishing: expect.objectContaining({ waitingOn: 'sign-in', signInSourceId: 12, phase: 'draft', owner, actionRunId: 3, note: out.line }),
    }));
    expect(JSON.stringify(writeMeta.mock.calls)).not.toContain('"error"');
  });

  it('keeps what going live needs to carry on', async () => {
    getBrowserRun.mockResolvedValue(run({ url: 'https://login.squarespace.com/' }));

    await settlePublishRun({ orgId: 'org_a', phase: 'live', browserRunId: 41, pageRecordId: 9, siteUrl: SITE, blogPath: '/blog', slug: 'drain-cleaning', title: 'Drain cleaning', owner: { userId: 'user_ada', conversationId: null, agentSlug: null }, signInSourceId: null });

    expect(markSignInNeeded).not.toHaveBeenCalled();
    expect(writeMeta).toHaveBeenCalledWith('org_a', 9, expect.objectContaining({ publishing: expect.objectContaining({ phase: 'live', post: { siteUrl: SITE, blogPath: '/blog', slug: 'drain-cleaning', title: 'Drain cleaning' } }) }));
  });

  it('records any other failure as before', async () => {
    getBrowserRun.mockResolvedValue(run({ result: { sign_in: 'ok' }, error: 'a click failed twice' }));

    const out = await settlePublishRun({ orgId: 'org_a', phase: 'draft', browserRunId: 41, pageRecordId: 9, siteUrl: SITE, blogPath: '/blog', slug: 'drain-cleaning', title: 'Drain cleaning', owner: { userId: 'user_ada', conversationId: null, agentSlug: null } });

    expect(out.line).toContain('could not finish');
    expect(writeMeta).toHaveBeenCalledWith('org_a', 9, expect.objectContaining({ status: 'approved', publishing: expect.objectContaining({ error: out.line }) }));
  });
});

describe('the operator CLI\'s wait', () => {
  it('reads the site\'s editor as signed in, and the login page as not', () => {
    expect(editorSignedIn(`${SITE}/config/pages`)).toBe(true);
    expect(editorSignedIn('https://login.squarespace.com/config')).toBe(false);
    expect(editorSignedIn(`${SITE}/blog`)).toBe(false);
    expect(editorSignedIn('https://northwind-home.example/config')).toBe(false);
  });
});
