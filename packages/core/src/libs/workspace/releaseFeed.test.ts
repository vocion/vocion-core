import type { PageRow } from './pageFields';
import type { LinkedRecord, ReleaseLinked } from './releaseFeed';
import { describe, expect, it } from 'vitest';
import { recordLinker, recordLinksOf } from './recordHref';
import {
  ANNOUNCEMENT_PLACEHOLDER,
  announcementOf,
  announcementText,
  deriveReleaseFeed,
  parseCommit,
  readRelease,
  releaseCommits,
  releaseDayLabel,
  releaseKindOf,
} from './releaseFeed';

/**
 * The product owner's red team of the Releases page, as tests.
 *
 * Every assertion here is a sentence a person read on the page and could not
 * use: a sha for a title, a factory worker fix presented as a product
 * improvement, the deploy script's placeholder shown as the announcement,
 * "watching" where a precise statement belonged. Fixtures are fictional —
 * Relay is a product of the Northwind fixture cast.
 */

const NOW = new Date('2026-09-28T12:00:00Z');

function row(id: number, meta: Record<string, unknown>, title = `relay ${id}`): PageRow {
  return { id, title, status: 'active', createdAt: NOW, meta };
}

function linked(records: LinkedRecord[] = []): ReleaseLinked {
  return { records: new Map(records.map(r => [r.id, r])), products: new Map([['relay', 'Relay']]) };
}

const REQUEST: LinkedRecord = {
  id: 41,
  type: 'request',
  title: 'Uploads that survive a bad connection',
  meta: { kind: 'idea', outcome: 'Upload a large file on a phone, lose signal, and have it pick up where it stopped. Then more detail.' },
};
const TASK: LinkedRecord = {
  id: 52,
  type: 'engineering_task',
  title: 'Resumable uploads',
  meta: { requestId: 41, prUrl: 'https://github.example/northwind/relay/pull/96', verdict: { value: 'approve', proven: 8, total: 8, at: '2026-09-28T07:58:00Z', by: 'change-reviewer' } },
};

/** A release from the one-release-per-deploy era: one feature, two worker fixes. */
const FEATURE_RELEASE = row(197, {
  product: 'relay',
  surfaces: ['api', 'web'],
  version: '930a23f6ebbd',
  releasedAt: '2026-09-28T08:12:46Z',
  healthAfter: 'ok',
  healthCheckedAt: '2026-09-28T08:12:46Z',
  commits: [
    '930a23f logic: Uploads that survive a bad connection (#96)',
    'afae194 fix(worker): a skipped named test is not reported as passed (#95)',
    'f7263ec feat(worker): qa flows can pick a large file and drop the network (#92)',
  ],
  prUrls: ['https://github.example/northwind/relay/pull/96', 'https://github.example/northwind/relay/pull/95', 'https://github.example/northwind/relay/pull/92'],
  taskIds: [52],
  requestIds: [41],
  evidence: [{ taskId: 52, requestId: 41, prUrl: 'https://github.example/northwind/relay/pull/96', verdict: 'approve, 8 of 8 proven' }],
  announcement: ANNOUNCEMENT_PLACEHOLDER,
  notesSource: 'agent',
}, 'relay 930a23f6ebbd');

describe('reading a commit subject', () => {
  it('reads a factory-built change as a product improvement from its pull request', () => {
    expect(parseCommit('930a23f logic: Uploads that survive a bad connection (#96)')).toMatchObject({
      sha: '930a23f',
      kind: 'improvement',
      pr: 96,
      plain: 'Uploads that survive a bad connection',
    });
  });

  it('flags a change to the factory worker as internal, whatever its type', () => {
    // The Releases page presented these as product improvements: a
    // `feat(worker)` is a feature of the machine that builds the product.
    expect(parseCommit('afae194 fix(worker): a skipped named test is not reported as passed (#95)')).toMatchObject({ kind: 'internal', area: 'worker' });
    expect(parseCommit('f7263ec feat(worker): qa flows can drop the network (#92)')).toMatchObject({ kind: 'internal', area: 'worker' });
    expect(parseCommit('4a904ea feat(deploy): one release per deploy (#74)')).toMatchObject({ kind: 'internal', area: 'deploy' });
    expect(parseCommit('ec38774 ci: write the session into the profile (#51)')).toMatchObject({ kind: 'internal', area: 'ci' });
    expect(parseCommit('a187882 chore: ignore build output (#48)')).toMatchObject({ kind: 'internal' });
  });

  it('reads an acronym a subject wrote in lower case in capitals', () => {
    expect(parseCommit('f7263ec feat(worker): qa flows can drop the network (#92)').plain).toBe('QA flows can drop the network');
  });

  it('keeps a fix to the product a fix', () => {
    expect(parseCommit('1234567 fix(web): the share link copies on Safari (#12)')).toMatchObject({ kind: 'fix', plain: 'The share link copies on Safari' });
  });

  it('reads a subject with no prefix as a product change rather than hiding it', () => {
    expect(parseCommit('Failed work is kept on a branch')).toMatchObject({ sha: null, kind: 'improvement' });
  });

  it('reads a revert as the thing it undid', () => {
    const c = parseCommit('98c149b revert: logic: find a document in your library (#66), merged by mistake before qa approved (#68)');

    expect(c).toMatchObject({ kind: 'revert', pr: 68, plain: 'Find a document in your library' });
  });

  it('marks a change reverted in the same deploy, and falls back to the notes when no commits were kept', () => {
    const commits = releaseCommits({
      commits: [
        '98c149b revert: logic: find a document in your library (#66), merged by mistake (#68)',
        '91e0fcc logic: Find a document in your library (#66)',
      ],
    });

    expect(commits.map(c => c.kind)).toEqual(['revert', 'reverted']);
    expect(releaseCommits({ notes: '- fix(web): one\n- two\nprose line' }).map(c => c.plain)).toEqual(['One', 'Two']);
  });
});

describe('what a release is called', () => {
  it('leads with the shipped feature, not the sha', () => {
    const r = readRelease(FEATURE_RELEASE, { linked: linked([REQUEST, TASK]), now: NOW });

    expect(r.headline).toBe('Uploads that survive a bad connection');
    expect(r.versionShort).toBe('930a23f');
    expect(r.summary).toBe('Upload a large file on a phone, lose signal, and have it pick up where it stopped. Also 2 internal changes (worker).');
    expect(r.counts).toEqual({ improvements: 1, fixes: 0, internal: 2, reverted: 0 });
  });

  it('names a release of several changes concisely and counts them', () => {
    const r = readRelease(row(1, {
      product: 'relay',
      surfaces: ['web'],
      commits: ['a1b2c3d feat(web): dark mode (#1)', 'b2c3d4e fix(web): the export keeps accents (#2)', 'c3d4e5f feat(api): webhooks (#3)', 'd4e5f6a fix: login loops (#4)', 'e5f6a7b feat: bulk invite (#5)'],
    }), { now: NOW });

    expect(r.headline).toBe('Dark mode, and 4 more changes');
    expect(r.summary).toBe('3 improvements and 2 fixes. No linked feature: Dark mode, the export keeps accents and webhooks and more.');
  });

  it('says "No linked feature" with what actually changed, never "No factory feature in this deploy"', () => {
    const r = readRelease(row(2, { product: 'relay', surfaces: ['web'], commits: ['a1b2c3d feat(web): a search box on the library (#7)'] }), { now: NOW });

    expect(r.headline).toBe('A search box on the library');
    expect(r.summary).toBe('No linked feature.');
    expect(r.summary).not.toContain('factory');
  });

  it('calls a deploy of machinery what it is, and needs no announcement', () => {
    const r = readRelease(row(182, {
      product: 'relay',
      surfaces: ['api', 'web', 'marketing'],
      commits: ['4a904ea feat(deploy): one release per deploy (#74)', '2438da4 fix(worker): every qa shot names its url (#67)'],
      announcement: ANNOUNCEMENT_PLACEHOLDER,
    }), { now: NOW });

    expect(r.headline).toBe('Internal changes only');
    expect(r.summary).toBe('2 internal changes to the deploy and worker; nothing people use changed.');
    expect(r.userFacing).toBe(false);
    expect(r.announcement).toMatchObject({ state: 'not-needed', label: 'Not needed', text: null });
    expect(r.announcement.reason).toContain('internal');
  });

  it('reads an older per-surface row as a deployment of one surface', () => {
    const legacy = row(175, {
      product: 'relay',
      surface: 'web',
      version: '98c149b43a8d',
      releasedAt: '2026-09-27T07:22:26Z',
      healthAfter: 'ok',
      commits: [
        '98c149b revert: logic: find a document in your library (#66), merged by mistake (#68)',
        '91e0fcc logic: Find a document in your library (#66)',
        'f270a76 fix(worker): evidence links each shot (#63)',
      ],
      announcement: ANNOUNCEMENT_PLACEHOLDER,
    }, 'relay web 98c149b43a8d');

    expect(releaseKindOf(legacy.meta)).toBe('deployment');

    const r = readRelease(legacy, { linked: linked(), now: NOW });

    expect(r.headline).toBe('Relay web deployment');
    expect(r.summary).toBe('Find a document in your library went out and was reverted in the same deploy. Also 1 internal change (worker).');
    expect(r.userFacing).toBe(false);
    expect(r.announcement.state).toBe('not-needed');
  });

  it('keeps a release that names its surfaces a release', () => {
    expect(releaseKindOf({ surfaces: ['api'] })).toBe('release');
    expect(releaseKindOf({})).toBe('release');
  });
});

describe('verification, said precisely', () => {
  it('separates feature acceptance, the post-deploy check and product impact', () => {
    const seen = { ...FEATURE_RELEASE.meta, liveState: 'seen', liveSummary: 'Seen live: 2 of 2 states reached', liveCheckedAt: '2026-09-28T13:00:00Z' };
    const r = readRelease(row(1, seen), { linked: linked([REQUEST, TASK]), now: NOW });

    expect(r.verification.acceptance).toEqual({ state: 'passed', line: 'QA approved, 8 of 8 criteria proven' });
    expect(r.verification.health).toMatchObject({ value: 'ok', line: 'Health check passed', freshness: 'checked 4h ago' });
    expect(r.verification.live).toEqual({ state: 'seen', line: 'Seen live: 2 of 2 states reached', tone: 'ok' });
    // "watching" became a statement a person can act on.
    expect(r.verification.impact.line).toBe('Too early to judge: live for 4 hours; an outcome is read after 24 hours');
    expect(r.verification).toMatchObject({ state: 'verified', label: 'Verified' });
    expect(r.verification.line).toBe('QA approved, 8 of 8 criteria proven · Seen live: 2 of 2 states reached · Health check passed · checked 4h ago');
  });

  it('never calls a release verified on its health check alone: the change must be seen live (release #280, 2026-09-30)', () => {
    const unseen = readRelease(FEATURE_RELEASE, { linked: linked([REQUEST, TASK]), now: NOW });

    expect(unseen.verification.live).toEqual({ state: 'pending', line: 'Not yet seen live', tone: 'warn' });
    expect(unseen.verification).toMatchObject({ state: 'missing', label: 'Verification missing' });

    // What the product's own deploy check wrote: six states, none reached.
    const rows = Array.from({ length: 6 }, (_, i) => ({ flow: `flow ${i}`, criterion: 'Last opened line', viewport: 'desktop', status: 'not_reached', reason: 'step 1 (wait_for "text=Last opened 2 hours ago by maya@acme.example") failed: Timeout 15000ms exceeded.' }));
    const missed = readRelease(row(7, { ...FEATURE_RELEASE.meta, liveEvidence: rows, liveSummary: '0 of 6 live states reached' }), { linked: linked([REQUEST, TASK]), now: NOW });

    expect(missed.verification.live.state).toBe('not_seen');
    expect(missed.verification.live.line).toMatch(/^Live check could not reach the change: step 1 \(wait_for/);
    expect(missed.verification).toMatchObject({ state: 'issue', label: 'Issue detected' });
    expect(missed.attention).toContain(missed.verification.live.line);

    const internalOnly = readRelease(row(8, { product: 'relay', commits: ['4a904ea feat(deploy): one release per deploy (#74)'] }), { now: NOW });

    expect(internalOnly.verification.live.state).toBe('none');
  });

  it('says "outcome not checked" as what it is, once there has been time to check', () => {
    const r = readRelease(row(3, { ...FEATURE_RELEASE.meta, releasedAt: '2026-09-24T12:00:00Z' }), { linked: linked([REQUEST, TASK]), now: NOW });

    expect(r.verification.impact).toMatchObject({ state: 'unchecked', line: 'Outcome not checked: live for 4 days and no production measure has been read for it' });
  });

  it('reads the request\'s own result check when the release has none', () => {
    const request = { ...REQUEST, meta: { ...REQUEST.meta, result: 'not_enough_evidence', checkAfter: '2026-09-30T16:00:00Z' } };
    const r = readRelease(FEATURE_RELEASE, { linked: linked([request, TASK]), now: NOW });

    expect(r.verification.impact.line).toBe('Not enough evidence yet to say whether it helped; the next check is due Wed, Sep 30, 2026');
  });

  it('tells an issue detected apart from verification that is missing', () => {
    const down = readRelease(row(4, { ...FEATURE_RELEASE.meta, healthAfter: 'down' }), { linked: linked([REQUEST, TASK]), now: NOW });

    expect(down.verification).toMatchObject({ state: 'issue', label: 'Issue detected' });
    expect(down.attention).toContain('Health check found the service down after this deploy');
    // Said once, as what needs a person, not again as evidence beside it.
    expect(down.verification.line).toBe('QA approved, 8 of 8 criteria proven');

    const unchecked = readRelease(row(5, { ...FEATURE_RELEASE.meta, healthAfter: 'unknown' }), { linked: linked([REQUEST, TASK]), now: NOW });

    expect(unchecked.verification).toMatchObject({ state: 'missing', label: 'Verification missing' });
    expect(unchecked.attention).toEqual(['No post-deploy health check was recorded']);

    const noQa = readRelease(row(6, { ...FEATURE_RELEASE.meta, evidence: [{ taskId: 52, requestId: 41, verdict: 'merged without a QA verdict' }] }), { linked: linked([REQUEST, { ...TASK, meta: { requestId: 41 } }]), now: NOW });

    expect(noQa.verification.acceptance).toEqual({ state: 'missing', line: '1 feature shipped without a QA verdict' });
    expect(noQa.verification.state).toBe('missing');
  });

  it('draws no attention line on a release where nothing is unresolved', () => {
    expect(readRelease(FEATURE_RELEASE, { linked: linked([REQUEST, TASK]), now: NOW }).attention).toEqual([]);
  });

  it('names the people who asked and have not heard', () => {
    const asked = { ...REQUEST, meta: { ...REQUEST.meta, askedBy: { channel: 'email', name: 'Rowan Pike' } } };
    const r = readRelease(FEATURE_RELEASE, { linked: linked([asked, TASK]), now: NOW });

    expect(r.attention).toEqual(['1 person who asked has not been told it shipped']);

    const told = { ...asked, meta: { ...asked.meta, told: { status: 'sent' } } };

    expect(readRelease(FEATURE_RELEASE, { linked: linked([told, TASK]), now: NOW }).attention).toEqual([]);
  });
});

describe('the announcement is a workflow, not a field', () => {
  it('never treats the deploy script\'s placeholder as content', () => {
    expect(announcementText(ANNOUNCEMENT_PLACEHOLDER)).toBeNull();
    expect(announcementText(`  ${ANNOUNCEMENT_PLACEHOLDER}\n`)).toBeNull();
    expect(announcementOf({ announcement: ANNOUNCEMENT_PLACEHOLDER }, true)).toMatchObject({ state: 'not-prepared', label: 'Not prepared', text: null });
  });

  it('moves draft → approved → published', () => {
    expect(announcementOf({ announcement: 'Uploads now resume.', notesSource: 'agent' }, true)).toMatchObject({ state: 'draft', label: 'Draft ready', text: 'Uploads now resume.' });
    expect(announcementOf({ announcement: 'Uploads now resume.', notesSource: 'human' }, true)).toMatchObject({ state: 'approved', label: 'Approved' });

    const published = announcementOf({ announcement: 'Uploads now resume.', announcedAt: '2026-09-28T10:00:00Z', announcedTo: { channels: ['changelog'] } }, true);

    expect(published).toMatchObject({ state: 'published', label: 'Published', channels: ['changelog'] });
    expect(published.publishedAt?.toISOString()).toBe('2026-09-28T10:00:00.000Z');
  });

  it('reads the product manager\'s draft as a draft ready, with its words', () => {
    // What `release-announcement-draft` writes on a linked release.
    const drafted = row(197, { ...FEATURE_RELEASE.meta, announcement: 'Uploads now pick up where they stopped when the signal drops. QA proved 8 of 8 criteria.', notesSource: 'agent', announcementState: 'draft' });
    const r = readRelease(drafted, { linked: linked([REQUEST, TASK]), now: NOW });

    expect(r.announcement).toMatchObject({ state: 'draft', label: 'Draft ready', text: 'Uploads now pick up where they stopped when the signal drops. QA proved 8 of 8 criteria.', publishedAt: null });

    const [out] = deriveReleaseFeed([drafted], { linked: linked([REQUEST, TASK]), now: NOW });

    expect(out!.meta.communication).toBe('Draft ready');
  });

  it('reads a release core marked "not needed" as not needed, with no draft', () => {
    const internalOnly = row(198, { product: 'relay', releasedAt: '2026-09-28T09:00:00Z', commits: ['1a2b3c4 fix(worker): retry the lease (#80)'], announcementState: 'not-needed' });

    expect(readRelease(internalOnly, { now: NOW }).announcement).toMatchObject({ state: 'not-needed', label: 'Not needed', text: null });
  });

  it('keeps words a person wrote even on an internal release', () => {
    expect(announcementOf({ announcement: 'The worker keeps failed work.' }, false).state).toBe('draft');
  });
});

describe('where a shipped feature links', () => {
  it('opens the page the workspace declares for a request, and the generic record with none', () => {
    const withPages = { ...linked([REQUEST, TASK]), link: recordLinker(recordLinksOf([{ slug: 'feature', archetype: 'report', report: { subject: 'request' } }] as never, 'northwind')) };

    expect(readRelease(FEATURE_RELEASE, { linked: withPages, now: NOW }).features[0]!.href).toBe('/w/northwind/dashboard/p/feature/41');
    expect(readRelease(FEATURE_RELEASE, { linked: linked([REQUEST, TASK]), now: NOW }).features[0]!.href).toBe('/dashboard/objects/41');
  });
});

describe('the feed row', () => {
  it('carries the words the page is declared in, grouped by day in the workspace\'s zone', () => {
    const seen = row(197, { ...FEATURE_RELEASE.meta, liveState: 'seen', liveSummary: 'Seen live: 2 of 2 states reached' });
    const [out] = deriveReleaseFeed([seen], { linked: linked([REQUEST, TASK]), now: NOW, timeZone: 'America/Los_Angeles' });

    expect(out!.meta).toMatchObject({
      headline: 'Uploads that survive a bad connection',
      versionShort: '930a23f',
      context: 'Relay · api + web · 1:12 AM PDT',
      verification: 'Verified',
      communication: 'Not prepared',
      needsAttention: false,
      issueDetected: false,
      verificationMissing: false,
      releaseKind: 'release',
      releaseDay: '2026-09-28',
      releaseDayLabel: 'Today · Mon, Sep 28, 2026',
    });
    expect(out!.meta.attention).toBeUndefined();
    // What the row used to lead with is still on the record, just not drawn.
    expect(out!.meta.commits).toEqual(FEATURE_RELEASE.meta.commits);
  });

  it('says yesterday, and a date before that', () => {
    expect(releaseDayLabel(new Date('2026-09-27T20:00:00Z'), NOW, 'UTC')).toBe('Yesterday · Sun, Sep 27, 2026');
    expect(releaseDayLabel(new Date('2026-09-20T20:00:00Z'), NOW, 'UTC')).toBe('Sun, Sep 20, 2026');
    expect(releaseDayLabel(null, NOW, 'UTC')).toBe('No release date');
  });

  it('labels an older per-surface row as a deployment in its context', () => {
    const [out] = deriveReleaseFeed([row(9, { product: 'relay', surface: 'web', releasedAt: '2026-09-27T07:22:26Z', commits: [] })], { now: NOW });

    expect(out!.meta).toMatchObject({ releaseKind: 'deployment', headline: 'Relay web deployment', context: 'Relay · web only · 7:22 AM UTC' });
  });
});
