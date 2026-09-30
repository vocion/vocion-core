import type { PageRow } from '@/libs/workspace/pageFields';
import type { LinkedRecord, ReleaseLinked } from '@/libs/workspace/releaseFeed';
import { describe, expect, it } from 'vitest';
import { recordLinker, recordLinksOf } from '@/libs/workspace/recordHref';
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
// The software factory's pages: a request opens its feature page, a release its release page.
const LINK = recordLinker(recordLinksOf([
  { slug: 'feature', archetype: 'report', report: { subject: 'request' } },
  { slug: 'releases', archetype: 'list', source: { kind: 'objects', objectType: 'release' }, recordPage: { kind: 'release', actions: {} } },
] as never));
const LINKED: ReleaseLinked = { records: new Map([[41, REQUEST], [52, TASK]]), products: new Map([['relay', 'Relay']]), link: LINK };

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
  { id: 1254, title: 'Uploads that survive a bad connection · desktop · before', kind: 'markdown', role: 'qa-screenshot', url: null, md: 'New surface, nothing to compare' },
  { id: 1255, title: 'Uploads that survive a bad connection · desktop · after', kind: 'link', role: 'qa-screenshot', url: 'https://files.example/qa/relay/uploads-desktop-after.png?sig=1', md: null },
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
      // The verdict judged no line by name, so there is no per-criterion proof to draw.
      proof: null,
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

    // A check informs; the press stays (principle 13).
    expect(heldDown.blocked).toContain('down');
    expect(heldDown.publish).toEqual({ mode: 'copy' });

    const published = report({ ...RELEASE, meta: { ...RELEASE.meta, announcement: 'Uploads resume.', announcedAt: '2026-09-28T10:00:00Z', announcedTo: { channels: ['changelog', 'status page'] } } }).announcement;

    expect(published).toMatchObject({ state: 'published', action: null, publishedLine: 'Published Mon, Sep 28, 2026, 10:00 AM UTC to changelog, status page' });
    expect(published.publish).toBeNull();
  });

  it('publishes in one press where it can: Slack with a connection, else a copy; a failed post says why', () => {
    const approved = { ...RELEASE, meta: { ...RELEASE.meta, announcement: 'Uploads resume.', notesSource: 'human' } };

    expect(report().announcement.publish).toBeNull();
    expect(assembleReleaseReport(approved, { linked: LINKED, now: NOW, timeZone: 'UTC', announceMode: 'slack' }).announcement.publish).toEqual({ mode: 'slack' });

    const failed = assembleReleaseReport({ ...approved, meta: { ...approved.meta, announceFailure: { at: '2026-09-28T09:00:00Z', error: 'Slack refused the post: not_in_channel.' } } }, { linked: LINKED, now: NOW, timeZone: 'UTC' }).announcement;

    expect(failed.failure).toBe('Not published (Mon, Sep 28, 2026, 9:00 AM UTC): Slack refused the post: not_in_channel.');

    const posted = assembleReleaseReport({ ...approved, meta: { ...approved.meta, announcedAt: '2026-09-28T10:00:00Z', announcedTo: { channels: ['Slack'], post: { surface: 'slack', channelId: 'C0NW', ts: '1.2', fileIds: [], media: 'blocks', runId: 88 } } } }, { linked: LINKED, now: NOW, timeZone: 'UTC' }).announcement;

    expect(posted).toMatchObject({ state: 'published', publish: null, post: { surface: 'slack', runId: 88 }, failure: null });
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
      { key: 'e-1254', label: 'Before, not captured: Uploads that survive a bad connection · desktop · before', href: '/dashboard/artifacts/1254' },
      { key: 'e-1255', label: 'QA screenshot: Uploads that survive a bad connection · desktop · after', href: '/dashboard/artifacts/1255' },
      { key: 'e-999', label: 'Evidence artifact 999 is not in this workspace', href: null },
    ]);
    expect(technical.commits.map(c => c.label)).toEqual(['Product change', 'Internal']);
    expect(technical.records.map(x => x.label)).toEqual(['Release record 197', 'Request 41 · Uploads that survive a bad connection', 'Engineering task 52 · Resumable uploads']);
    // The release record is the raw view on purpose (its fields and history);
    // the request opens its feature page, the task the generic record.
    expect(technical.records.map(x => x.href)).toEqual(['/dashboard/objects/197', '/dashboard/p/feature/41', '/dashboard/objects/52']);
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

/**
 * THE PROOF ON THE RELEASE (Chris, 2026-09-29: "Is evidence in the release
 * and well written?"). A release whose verdict judged each line: every
 * criterion under the summary line with its status and its evidence — the
 * after shot as a thumbnail, the before one click away, duplicates collapsed;
 * a named test by name, linking the stored run at that test's section.
 */
describe('the release page, per criterion', () => {
  const SHOT = 'https://files.example/qa/relay/resume-banner-desktop-after.png';
  const RUN_MD = [
    '# Named tests, run 77',
    '',
    '## Passed: A dropped upload resumes from the last chunk the server acknowledged.',
    '',
    '`npx vitest run tests/upload.test.ts -t "resume: picks up at the acknowledged chunk"`',
    '',
    '```',
    ' ✓ tests/upload.test.ts > resume: picks up at the acknowledged chunk 41ms',
    '```',
    '',
    '## Passed: The plan\'s risk is handled: A resumed upload could write a chunk twice',
    '',
    '`npx vitest run tests/upload.test.ts -t "resume: a chunk is never written twice"`',
  ].join('\n');
  const CONTRACT = [
    'A banner reads "Resuming upload" while the file picks up where it stopped.',
    'A dropped upload resumes from the last chunk the server acknowledged.',
    'The plan\'s risk is handled: A resumed upload could write a chunk twice. Mitigation: the server keys chunks by offset.',
  ];
  const task: LinkedRecord = {
    id: 52,
    type: 'engineering_task',
    title: 'Resumable uploads',
    meta: {
      requestId: 41,
      workerRunId: 77,
      prUrl: 'https://github.example/northwind/relay/pull/96',
      acceptanceContract: CONTRACT,
      verdict: {
        value: 'approve',
        at: '2026-09-28T07:58:00Z',
        by: 'change-reviewer',
        criteria: [
          { criterion: CONTRACT[0], status: 'proven', evidence: `Screenshot resume-banner-desktop-after.png shows the banner. ${SHOT}` },
          { criterion: CONTRACT[1], status: 'proven', evidence: 'Named test \'resume: picks up at the acknowledged chunk\' passed in run 77. https://app.example/dashboard/artifacts/1302' },
          { criterion: CONTRACT[2], status: 'proven', evidence: 'Named test \'resume: a chunk is never written twice\' passed in run 77. https://app.example/dashboard/artifacts/1302' },
        ],
      },
    },
  };
  const request: LinkedRecord = { ...REQUEST, meta: { ...REQUEST.meta, acceptance: [{ statement: CONTRACT[0] }, { statement: CONTRACT[1] }] } };
  const linked: ReleaseLinked = { records: new Map([[41, request], [52, task]]), products: new Map([['relay', 'Relay']]), link: LINK };
  const artifacts = [
    { id: 1298, title: 'Resume banner · desktop · before', kind: 'markdown', role: 'qa-screenshot', url: null, md: 'New surface, nothing to compare' },
    { id: 1299, title: 'Resume banner · desktop · after', kind: 'link', role: 'qa-screenshot', url: `${SHOT}?X-Amz-Signature=a`, md: null },
    // The capture stored the same picture twice.
    { id: 1300, title: 'Resume banner · desktop · after', kind: 'link', role: 'qa-screenshot', url: `${SHOT}?X-Amz-Signature=b`, md: null },
    { id: 1302, title: 'Named tests, run 77', kind: 'markdown', role: 'qa-test-run', url: null, md: RUN_MD },
  ];
  const row: PageRow = { ...RELEASE, meta: { ...RELEASE.meta, verificationArtifactIds: [1298, 1299, 1300, 1302] } };
  const page = () => assembleReleaseReport(row, { linked, artifacts, now: NOW, timeZone: 'UTC' });

  it('keeps the summary line on top and lists each criterion under it, the plan risks as their own group', () => {
    const [feature] = page().verification.acceptance;

    expect(feature!.line).toBe('QA approved, 2 of 2 acceptance criteria proven, 1 plan risk handled (change-reviewer)');
    expect(feature!.proof!.acceptance.map(r => [r.statement, r.state, r.kind])).toEqual([
      [CONTRACT[0], 'passed', 'screenshot'],
      [CONTRACT[1], 'passed', 'test'],
    ]);
    // A risk reads as the risk, not the contract's prefix and mitigation paragraph.
    expect(feature!.proof!.risks.map(r => [r.statement, r.state, r.kind])).toEqual([['A resumed upload could write a chunk twice.', 'passed', 'test']]);
  });

  it('shows a screenshot proof as the after shot, opening its artifact, with the before shot one click away', () => {
    const shot = page().verification.acceptance[0]!.proof!.acceptance[0]!;

    expect(shot).toMatchObject({ line: 'Screenshot', href: '/dashboard/artifacts/1299', imageUrl: `${SHOT}?X-Amz-Signature=a`, before: { href: '/dashboard/artifacts/1298', label: 'Before: not captured' } });
  });

  it('shows a named-test proof by its name, linking the stored run at that test\'s section', () => {
    const [, test] = page().verification.acceptance[0]!.proof!.acceptance;
    const [risk] = page().verification.acceptance[0]!.proof!.risks;

    expect(test).toMatchObject({ line: 'Named test “resume: picks up at the acknowledged chunk” passed', href: '/dashboard/artifacts/1302#passed-a-dropped-upload-resumes-from-the-last-chunk-the-server-acknowledged', imageUrl: null, before: null });
    expect(risk!.href).toBe('/dashboard/artifacts/1302#passed-the-plans-risk-is-handled-a-resumed-upload-could-write-a-chunk-twice');
  });

  it('lists each piece of evidence once under technical details, the test run by what it is', () => {
    expect(page().technical.evidence.map(e => e.label)).toEqual([
      'Before, not captured: Resume banner · desktop · before',
      'QA screenshot: Resume banner · desktop · after',
      'Named tests: Named tests, run 77',
    ]);
  });

  it('opens a task no page claims at the run that built it, through the workspace\'s own links', () => {
    const task52 = page().technical.records.find(r => r.key === 'task-52')!;

    expect(task52).toEqual({ key: 'task-52', label: 'Engineering task 52 · run 77 · Resumable uploads', href: '/dashboard/p/runs/77' });

    const prefixed = recordLinker({ ...recordLinksOf([{ slug: 'feature', archetype: 'report', report: { subject: 'request' } }] as never), workspaceSlug: 'northwind' });

    expect(assembleReleaseReport(row, { linked: { ...linked, link: prefixed }, artifacts, now: NOW }).technical.records.find(r => r.key === 'task-52')!.href).toBe('/w/northwind/dashboard/p/runs/77');
  });
});

describe('the release notes', () => {
  it('reads the deploy\'s commit log as no notes, and says the features by title until someone writes them', () => {
    const logged = report({ ...RELEASE, meta: { ...RELEASE.meta, notes: '- logic: Uploads that survive a bad connection (#96)\n- fix(worker): a skipped named test is not reported as passed (#95)', notesSource: 'agent' } });

    expect(logged.notes).toEqual({ source: 'features', lines: ['Uploads that survive a bad connection', 'Internal: A skipped named test is not reported as passed'] });
    expect(JSON.stringify(logged.notes)).not.toMatch(/\(#\d+\)|fix\(worker\)/);
  });

  it('shows notes the product manager wrote, and a person\'s as theirs', () => {
    const notes = '- Upload a large file on a phone, lose signal, and it picks up where it stopped.\n- Internal: the worker no longer reports a skipped test as passed.';

    expect(report({ ...RELEASE, meta: { ...RELEASE.meta, notes, notesSource: 'agent' } }).notes).toEqual({
      source: 'agent',
      lines: ['Upload a large file on a phone, lose signal, and it picks up where it stopped.', 'Internal: the worker no longer reports a skipped test as passed.'],
    });
    expect(report({ ...RELEASE, meta: { ...RELEASE.meta, notes, notesSource: 'human' } }).notes.source).toBe('human');
  });
});

describe('the live check after the deploy (2026-09-30)', () => {
  const LIVE_ART = [
    ...ARTIFACTS,
    { id: 1301, title: 'Resume banner · desktop · live', kind: 'link', role: 'qa-screenshot', url: 'https://files.example/qa/relay/resume-live.png?sig=2', md: null },
    { id: 1302, title: 'Offline notice · desktop · live', kind: 'link', role: 'qa-screenshot', url: 'https://files.example/qa/relay/offline-live.png?sig=3', md: null },
  ];
  const withLive = (extra: Record<string, unknown>): PageRow => ({ ...RELEASE, meta: { ...RELEASE.meta, ...extra } });

  it('is absent until a live check ran', () => {
    expect(report().verification.live).toBeNull();
    expect(report().announcement.image).toBeNull();
  });

  it('shows each live state with its picture, and why one was not reached', () => {
    const page = assembleReleaseReport(withLive({
      liveCheckedAt: '2026-09-28T08:20:00Z',
      liveSummary: '1 of 2 live states reached',
      liveEvidence: [
        { taskId: 52, flow: 'Resume banner', criterion: 'The upload resumes where it stopped.', artifactId: 1301, status: 'reached' },
        { taskId: 52, flow: 'Offline notice', criterion: 'Losing signal shows a notice.', artifactId: 1302, status: 'not_reached', reason: 'Step 3 (offline) could not run on production.' },
      ],
      announcementImageArtifactId: 1301,
    }), { linked: LINKED, artifacts: LIVE_ART, now: NOW, timeZone: 'UTC' });
    const live = page.verification.live!;

    expect(live).toMatchObject({ title: 'Live check', line: '1 of 2 live states reached', tone: 'warn', href: 'https://relay.example' });
    expect(live.shots.map(s => [s.reached, s.imageUrl])).toEqual([[true, 'https://files.example/qa/relay/resume-live.png?sig=2'], [false, 'https://files.example/qa/relay/offline-live.png?sig=3']]);
    expect(live.shots[1]!.reason).toBe('Step 3 (offline) could not run on production.');
    expect(page.announcement.image?.url).toBe('https://files.example/qa/relay/resume-live.png?sig=2');
  });
});
