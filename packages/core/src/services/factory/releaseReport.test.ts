import type { PageRow } from '@/libs/workspace/pageFields';
import type { LinkedRecord, ReleaseLinked } from '@/libs/workspace/releaseFeed';
import { describe, expect, it } from 'vitest';
import { ANNOUNCEMENT_PLACEHOLDER } from '@/libs/workspace/releaseFeed';
import { assembleReleaseReport } from './releaseReport';

/**
 * The release page, section by section. Fictional fixtures: Relay is a
 * Northwind product; the URLs are `.example`.
 */

const NOW = new Date('2026-09-28T12:00:00Z');

const REQUEST: LinkedRecord = {
  id: 41,
  type: 'request',
  title: 'Uploads that survive a bad connection',
  meta: {
    kind: 'idea',
    outcome: 'Upload a large file on a phone, lose signal, and have it pick up where it stopped.',
    result: 'not_enough_evidence',
    resultNote: 'Not enough evidence as of Sep 28: the phone test has not been run.',
    resultCheckedAt: '2026-09-28T11:30:00Z',
    checkAfter: '2026-09-30T16:00:00Z',
  },
};
const TASK: LinkedRecord = {
  id: 52,
  type: 'engineering_task',
  title: 'Resumable uploads',
  meta: { requestId: 41, prUrl: 'https://github.example/northwind/relay/pull/96', verdict: { value: 'approve', proven: 8, total: 8, at: '2026-09-28T07:58:00Z', by: 'change-reviewer' } },
};
const LINKED: ReleaseLinked = { records: new Map([[41, REQUEST], [52, TASK]]), products: new Map([['relay', 'Relay']]) };

const RELEASE: PageRow = {
  id: 197,
  title: 'relay 930a23f6ebbd',
  status: 'active',
  createdAt: NOW,
  meta: {
    product: 'relay',
    surfaces: ['api', 'web'],
    version: '930a23f6ebbd',
    commitSha: '930a23f6ebbd9628d22e8111d7a9edad345b5174',
    previousCommitSha: 'ddbf8a3a93ee04fe04810206fa1a2f1ecf7577fb',
    url: 'https://relay.example',
    releasedAt: '2026-09-28T08:12:46Z',
    healthAfter: 'ok',
    healthCheckedAt: '2026-09-28T08:12:46Z',
    commits: [
      '930a23f logic: Uploads that survive a bad connection (#96)',
      'afae194 fix(worker): a skipped named test is not reported as passed (#95)',
    ],
    prUrls: ['https://github.example/northwind/relay/pull/96', 'https://github.example/northwind/relay/pull/95'],
    taskIds: [52],
    requestIds: [41],
    evidence: [{ taskId: 52, requestId: 41, prUrl: 'https://github.example/northwind/relay/pull/96', verdict: 'approve, 8 of 8 proven' }],
    verificationArtifactIds: [1254, 1255, 999],
    announcement: ANNOUNCEMENT_PLACEHOLDER,
    notesSource: 'agent',
  },
};

const ARTIFACTS = [
  { id: 1254, title: 'Uploads that survive a bad connection · desktop · before', kind: 'markdown', role: 'qa-screenshot' },
  { id: 1255, title: 'Uploads that survive a bad connection · desktop · after', kind: 'link', role: 'qa-screenshot' },
];

function report(row: PageRow = RELEASE, linked: ReleaseLinked = LINKED) {
  return assembleReleaseReport(row, { linked, artifacts: ARTIFACTS, now: NOW, timeZone: 'UTC' });
}

describe('the release page', () => {
  it('is titled by what shipped, with product and short version beneath', () => {
    const r = report();

    expect(r.title).toBe('Uploads that survive a bad connection');
    expect(r.subtitle).toBe('Relay · 930a23f');
    expect(r.releasedAt).toBe('Mon, Sep 28, 2026, 8:12 AM UTC');
    expect(r.status).toEqual({ deploy: { line: 'Live on relay.example', tone: 'ok' }, verification: { line: 'Verified', tone: 'ok' } });
  });

  it('says what changed in plain language, with the machinery labelled as machinery', () => {
    const r = report();

    expect(r.changes.map(c => [c.label, c.title, c.href])).toEqual([
      ['Improvement', 'Uploads that survive a bad connection', '/dashboard/p/feature/41'],
      ['Internal', 'A skipped named test is not reported as passed', null],
    ]);
    expect(r.changes[1]!.detail).toBe('Changes the worker, not the product people use.');
  });

  it('separates feature acceptance from the post-deploy check from product impact', () => {
    const { verification } = report();

    expect(verification.acceptance).toEqual([{
      key: 'qa-41',
      title: 'Uploads that survive a bad connection',
      line: 'QA approved, 8 of 8 acceptance criteria proven (change-reviewer)',
      tone: 'ok',
      at: 'Mon, Sep 28, 2026, 7:58 AM UTC',
      href: '/dashboard/p/feature/41',
    }]);
    expect(verification.deployCheck).toMatchObject({ title: 'Post-deploy check', line: 'Health check passed on relay.example', tone: 'ok', at: 'Mon, Sep 28, 2026, 8:12 AM UTC' });
    expect(verification.impact[0]!.line).toBe('Not enough evidence yet to say whether it helped; the next check is due Wed, Sep 30, 2026');
    expect(verification.impact[1]).toMatchObject({ title: 'Result check: Uploads that survive a bad connection', line: 'Not enough evidence as of Sep 28: the phone test has not been run.' });
  });

  it('never shows the placeholder, and offers the announcement\'s one move', () => {
    const { announcement } = report();

    expect(announcement).toMatchObject({ state: 'not-prepared', label: 'Not prepared', text: null, action: 'draft', blocked: null });
    expect(JSON.stringify(report())).not.toContain(ANNOUNCEMENT_PLACEHOLDER);

    const drafted = report({ ...RELEASE, meta: { ...RELEASE.meta, announcement: 'Uploads now pick up where they stopped.' } }).announcement;

    expect(drafted).toMatchObject({ state: 'draft', action: 'review', text: 'Uploads now pick up where they stopped.' });

    const approved = report({ ...RELEASE, meta: { ...RELEASE.meta, announcement: 'Uploads resume.', notesSource: 'human' } }).announcement;

    expect(approved).toMatchObject({ state: 'approved', action: 'publish', blocked: null });

    const heldDown = report({ ...RELEASE, meta: { ...RELEASE.meta, announcement: 'Uploads resume.', notesSource: 'human', healthAfter: 'down' } }).announcement;

    expect(heldDown.blocked).toContain('down');

    const published = report({ ...RELEASE, meta: { ...RELEASE.meta, announcement: 'Uploads resume.', announcedAt: '2026-09-28T10:00:00Z', announcedTo: { channels: ['changelog', 'status page'] } } }).announcement;

    expect(published).toMatchObject({ state: 'published', action: null, publishedLine: 'Published Mon, Sep 28, 2026, 10:00 AM UTC to changelog, status page' });
  });

  it('says why an internal release needs no announcement', () => {
    const internal = report({ ...RELEASE, meta: { ...RELEASE.meta, commits: ['afae194 fix(worker): a skipped test (#95)'], evidence: [], taskIds: [], requestIds: [] } });

    expect(internal.title).toBe('Internal changes only');
    expect(internal.announcement).toMatchObject({ state: 'not-needed', action: null, reason: 'Only internal changes: nothing people use changed' });
  });

  it('lists included work once, and does not claim deploying closed the request', () => {
    const { included } = report();

    expect(included).toEqual([{ key: 'w-41', title: 'Uploads that survive a bad connection', href: '/dashboard/p/feature/41', detail: 'Shipped in this release, built by 1 task; its result has not been confirmed.' }]);
    expect(JSON.stringify(included)).not.toMatch(/closes/i);
  });

  it('tells the activity in order, each line with its time', () => {
    expect(report().activity.map(a => a.line)).toEqual([
      'QA approved, 8 of 8 acceptance criteria proven (change-reviewer): Uploads that survive a bad connection',
      'Deployed api + web at 930a23f',
      'Health check passed',
      'Result checked for Uploads that survive a bad connection: not enough evidence',
    ]);
  });

  it('keeps the technical record last, with evidence as labelled links rather than numbers', () => {
    const { technical } = report();

    expect(technical.pullRequests.map(p => p.label)).toEqual(['#96 · Uploads that survive a bad connection', '#95 · A skipped named test is not reported as passed (internal)']);
    expect(technical.evidence).toEqual([
      { key: 'e-1254', label: 'QA screenshot: Uploads that survive a bad connection · desktop · before', href: '/dashboard/artifacts/1254' },
      { key: 'e-1255', label: 'QA screenshot: Uploads that survive a bad connection · desktop · after', href: '/dashboard/artifacts/1255' },
      { key: 'e-999', label: 'Evidence artifact 999 is not in this workspace', href: null },
    ]);
    expect(technical.commits.map(c => c.label)).toEqual(['Product change', 'Internal']);
    expect(technical.records.map(x => x.label)).toEqual(['Release record 197', 'Request 41 · Uploads that survive a bad connection', 'Engineering task 52 · Resumable uploads']);
    expect(technical.facts.find(f => f.label === 'Surfaces deployed')?.value).toBe('api, web');
  });

  it('never reads missing cost as zero', () => {
    expect(report().technical.facts.find(f => f.label === 'Build spend')?.value).toBe('Not recorded for this release');

    const costed = report({ ...RELEASE, meta: { ...RELEASE.meta, actualCents: 857, estimateCents: 600 } });

    expect(costed.technical.facts.find(f => f.label === 'Build spend')?.value).toBe('$8.57 model spend on the tasks it shipped, against $6.00 estimated');
  });

  it('reads an older per-surface row as a deployment', () => {
    const legacy = report({ ...RELEASE, title: 'relay web 98c149b43a8d', meta: { product: 'relay', surface: 'web', releasedAt: '2026-09-27T07:22:26Z', healthAfter: 'ok', commits: ['f270a76 fix(worker): evidence links (#63)'] } });

    expect(legacy.kind).toBe('deployment');
    expect(legacy.title).toBe('Relay web deployment');
    expect(legacy.technical.facts[0]).toEqual({ label: 'Surface', value: 'web (recorded as its own deployment, before one release per deploy)' });
  });
});
