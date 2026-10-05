import type { FeatureReportInput, HistoryRow, ReportActivity } from './featureReport';
import type { PublicFeatureInput, SharedArtifact } from './featureShare';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BUILDER } from '@/libs/factory/featureGlance';
import { assembleFeatureReport } from './featureReport';
import { liveStatus, posterAt, publicFeaturePage, publicSteps, scrub, serveVia, shareCard, sharedPictures, shippedEvidence, shortSpan, STEP_SENTENCE, walkthroughOf } from './featureShare';

/**
 * A FEATURE'S PUBLIC PAGE (Chris, 2026-10-03): the ask and who asked, what it
 * built in a sentence, how long and what it cost, the mockups, the
 * walkthrough and the timeline — and nothing else. Fictional fixture
 * (Northwind), shaped like a feature that shipped: two attempts, QA sending
 * one back, a merge, a deploy, a release and a live check.
 */

const T = (iso: string) => new Date(iso);
const PR = (n: number) => `https://github.com/example/northwind-portal/pull/${n}`;

function reportInput(): FeatureReportInput {
  const run = (id: number, task: number, status: string, at: string, cents: number) => ({
    id,
    agentSlug: 'northwind-engineer',
    kind: 'worker',
    status,
    attempt: 1,
    cents,
    model: null,
    summary: `Task nw-t${task}: opened ${PR(id - 300)}`,
    error: status === 'failed' ? 'verification failed: required checks failed: test.' : null,
    createdAt: T(at),
    claimedAt: T(at),
    completedAt: new Date(T(at).getTime() + 10 * 60_000),
    input: { record: { type: 'engineering_task', id: task } },
    result: status === 'completed' ? { pr_url: PR(id - 300), checks: [{ name: 'test', passed: true }] } : null,
    progress: {},
    failures: status === 'failed' ? [{ scope: 'check:test' }] : [],
  });
  const agent = (over: Partial<ReportActivity> & Pick<ReportActivity, 'id'>): ReportActivity => ({ kind: 'mission_run', title: 'qa-review', at: T('2026-10-02T08:00:00Z'), status: 'completed', runStatus: 'completed', detail: null, label: 'QA reviewed', doing: 'QA reviewing', touched: [], cents: null, ...over });
  return {
    request: {
      id: 370,
      title: 'Show the upload date on each library row',
      status: 'shipped',
      createdAt: T('2026-10-02T07:13:00Z'),
      meta: {
        state: 'shipped',
        body: 'I cannot tell which file is newest. Show the upload date on each row — email dana@northwind.example if unclear, mockup at https://internal.northwind.example/x.',
        outcome: 'Library rows show when each file was uploaded. The list sorts newest first.',
        askedBy: { name: 'Dana Okafor', email: 'dana@northwind.example' },
        askedAt: '2026-10-02T07:12:00Z',
        visuals: { mockupArtifactIds: [901], beforeArtifactIds: [902], afterArtifactIds: [903, 904] },
        liveCheck: { state: 'seen', line: 'Seen live: 4 of 4 states reached', releaseId: 375, checkedAt: '2026-10-02T08:31:53Z', attempt: 1 },
        delivery: { prUrl: PR(175), pr: 'PR #175', repo: 'example/northwind-portal', mergedAt: '2026-10-02T08:22:25Z', mergedBy: 'dana', mergeSha: 'abc123', runs: [{ runId: 9001, name: 'Deploy', runNumber: 70, url: 'https://github.com/example/northwind-portal/actions/runs/9001', status: 'completed', conclusion: 'success', startedAt: '2026-10-02T08:22:28Z' }], runsReadAt: null },
      },
    },
    tasks: [
      { id: 373, title: 'Attempt 1', status: 'abandoned', createdAt: T('2026-10-02T07:48:00Z'), meta: { requestId: 370, verdict: { value: 'changes', at: '2026-10-02T08:09:25Z', proven: 4, total: 6, note: 'Four passed.' } } },
      { id: 374, title: 'Attempt 2', status: 'accepted', createdAt: T('2026-10-02T08:09:00Z'), meta: { requestId: 370, prUrl: PR(175), verdict: { value: 'approve', at: '2026-10-02T08:22:22Z', proven: 6, total: 6, note: 'All proven.' } } },
    ],
    plans: [{ id: 371, title: 'Plan', status: 'active', createdAt: T('2026-10-02T07:13:53Z'), meta: { requestId: 370, status: 'approved', approvedAt: '2026-10-02T07:14:00Z', approvedBy: 'usr-0001' } }],
    workerRuns: [run(478, 373, 'completed', '2026-10-02T07:54:00Z', 106), run(479, 374, 'completed', '2026-10-02T08:08:00Z', 75)],
    asks: [],
    actionRuns: [],
    releases: [{ id: 375, title: 'northwind 2ad2e85', status: 'active', createdAt: T('2026-10-02T08:30:30Z'), meta: { requestIds: [370], releasedAt: '2026-10-02T08:30:32Z', product: 'northwind', version: '2ad2e85' } }],
    artifacts: [],
    now: T('2026-10-02T12:00:00Z'),
    people: { 'usr-0001': 'Dana Okafor', 'dana': 'Dana Okafor' },
    spend: { agentCents: 40, chatCents: 12 },
    activity: [
      agent({ id: 7114, startedAt: T('2026-10-02T08:08:23Z'), endedAt: T('2026-10-02T08:08:55Z'), calls: [T('2026-10-02T08:09:25Z')], cents: 40 }),
      agent({ id: 7117, startedAt: T('2026-10-02T08:21:47Z'), endedAt: T('2026-10-02T08:21:59Z'), touched: [374], calls: [T('2026-10-02T08:22:22Z')] }),
      { kind: 'conversation', id: 405, title: 'Requested in chat by Dana Okafor (dana@northwind.example)', at: T('2026-10-02T07:12:00Z'), status: null, detail: null, origin: true },
    ],
  };
}

const art = (id: number, over: Partial<SharedArtifact> = {}): SharedArtifact => ({
  id,
  kind: 'file',
  title: `Picture ${id}`,
  url: `/api/artifacts/org_northwind-${id}/org_northwind-${id}.png`,
  spec: { contentType: 'image/png', caption: `Caption ${id}` },
  recordRole: null,
  createdAt: T('2026-10-02T07:20:00Z'),
  shareAudience: 'workspace',
  ...over,
});

const video = (id: number, role: string, at: string, over: Partial<SharedArtifact> = {}): SharedArtifact => art(id, { title: `Recording ${id}`, url: `/api/media/370/rec-${id}-aaaaaaaaaaaaaaaa.webm`, spec: { contentType: 'video/webm', caption: `Recording caption ${id}` }, recordRole: role, createdAt: T(at), ...over });
const shot = (id: number, task: number, title: string, at: string, over: Partial<SharedArtifact> = {}): SharedArtifact => art(id, { title, recordRole: 'qa-screenshot', recordId: String(task), createdAt: T(at), spec: { contentType: 'image/png', caption: title }, ...over });
// QA's screenshots: the approved attempt's (374) after and before, a capture
// QA named as the error state, and the attempt it sent back (373).
const evidence = [
  shot(961, 374, 'Library · desktop · before', '2026-10-02T08:20:00Z'),
  shot(962, 374, 'Library · desktop · after', '2026-10-02T08:21:00Z'),
  shot(963, 374, 'Library · phone · after (app error state)', '2026-10-02T08:21:30Z'),
  shot(964, 373, 'Library · desktop · after', '2026-10-02T08:05:00Z'),
];

function input(over: Partial<PublicFeatureInput> = {}): PublicFeatureInput {
  const r = reportInput();
  return {
    report: assembleFeatureReport(r),
    request: { title: r.request.title, createdAt: r.request.createdAt, meta: r.request.meta },
    pictures: [art(901), art(902), art(903), art(904, { url: 'https://cdn.example/after.png' })],
    recordings: [video(950, 'qa-video', '2026-10-02T08:05:00Z'), video(951, 'qa-live-video', '2026-10-02T08:32:00Z')],
    evidence,
    hideAsker: false,
    openUrl: '/w/northwind-studio/dashboard/p/feature/370',
    mediaSrc: id => `/api/share/feature/TOKEN/media/${id}?k=sig-${id}`,
    ...over,
  };
}

describe('the public page of a feature', () => {
  const page = publicFeaturePage(input());

  it('carries exactly its parts and nothing else', () => {
    expect(Object.keys(page).sort()).toEqual(['ask', 'built', 'builtBy', 'effort', 'media', 'openUrl', 'productName', 'status', 'timeline', 'title', 'workspaceName']);
    expect(page.status).toEqual({ word: 'Shipped', at: page.status.at, live: { word: 'seen live', detail: null } });
    expect(page.status.at).not.toBeNull();
    expect(Object.keys(page.ask).sort()).toEqual(['at', 'by', 'kind', 'text']);
    expect(page.title).toBe('Show the upload date on each library row');
    expect(page.ask.by).toBe('Dana Okafor');
    expect(page.ask.at).toBe('2026-10-02T07:12:00.000Z');
    expect(page.ask.text).toMatch(/^I cannot tell which file is newest\./);
    expect(page.built).toBe('Library rows show when each file was uploaded.');
  });

  it('holds no email, no internal link but the one Open link, no pull request, no run and no other record', () => {
    // The one allow-listed link back in: the feature's own page in the app.
    expect(page.openUrl).toBe('/w/northwind-studio/dashboard/p/feature/370');

    const all = JSON.stringify({ ...page, openUrl: null });

    expect(all).not.toMatch(/@northwind\.example|dana@/);
    expect(all).not.toMatch(/https?:\/\//);
    expect(all).not.toMatch(/\/dashboard|\/api\/media|\/api\/artifacts|github|pull\/|PR #|RUN-|ET-37|PL-37|REL-37/);
    expect(all).not.toMatch(/northwind-engineer|qa-review|Requested in chat/);
    expect(page.ask.text).toContain('[email hidden]');
    expect(page.ask.text).toContain('[link hidden]');

    // Every picture, QA shot and the recording load through the share route only.
    for (const m of page.media) {
      expect(m.src).toMatch(/^\/api\/share\/feature\/TOKEN\/media\/\d+\?k=/);
    }
  });

  it('leaves out who asked when the sharer hid them, and never shows an email for a name', () => {
    expect(publicFeaturePage(input({ hideAsker: true })).ask.by).toBeNull();

    const emailOnly = input();
    emailOnly.request = { ...emailOnly.request, meta: { ...emailOnly.request.meta, askedBy: { name: 'dana@northwind.example' } } };

    expect(publicFeaturePage(emailOnly).ask.by).toBeNull();
  });

  it('says how long it took, ask to seen live, the attempts and the one total with its split', () => {
    expect(page.effort.until).toBe('seen live');
    expect(page.effort.duration).toBe('1h 19m');
    expect(page.effort.attempts).toBe(2);
    expect(page.effort.total).toBe('$2.33');
    // Where the time went, from the timeline's own steps: the parts add up to the ask → seen live span.
    expect(page.effort.timeSplit).toEqual([
      { label: 'Plan', amount: '2m' },
      { label: 'Build', amount: '59m' },
      { label: 'QA', amount: '8m' },
      { label: 'Release', amount: '8m' },
      { label: 'Live check', amount: '1m' },
    ]);
    expect(page.effort.split).toEqual([
      { label: 'Builds', amount: '$1.81' },
      { label: 'Agents', amount: '$0.40' },
      { label: 'Chat', amount: '$0.12' },
    ]);
  });

  it('lays the carousel out walkthrough first, then the mockups, then the shipped attempt\'s QA shots', () => {
    expect(page.media.map(m => [m.kind, m.label, m.src])).toEqual([
      ['video', 'On the live product', '/api/share/feature/TOKEN/media/951?k=sig-951'],
      ['image', 'Mockup', '/api/share/feature/TOKEN/media/901?k=sig-901'],
      ['image', 'Before', '/api/share/feature/TOKEN/media/902?k=sig-902'],
      ['image', 'After', '/api/share/feature/TOKEN/media/903?k=sig-903'],
      // After before before; the error-state capture and the sent-back attempt's shot stay out.
      ['image', 'QA after', '/api/share/feature/TOKEN/media/962?k=sig-962'],
      ['image', 'QA before', '/api/share/feature/TOKEN/media/961?k=sig-961'],
    ]);
    expect(page.media[1]).toMatchObject({ alt: 'Picture 901', caption: 'Caption 901' });
  });

  it('plays the newest live-check recording when there is no narrated one, through the share route', () => {
    expect(page.media[0]).toEqual({ kind: 'video', src: '/api/share/feature/TOKEN/media/951?k=sig-951', type: 'video/webm', label: 'On the live product', caption: 'Recording caption 951' });
  });

  it('reads the timeline as fixed steps, oldest first, each with a time, how long to the next and a sentence', () => {
    expect(page.timeline.map(t => t.step)).toEqual(['Asked', 'Plan approved', 'Built', 'QA asked for changes', 'Built', 'QA approved', 'Merged', 'Deployed', 'Released', 'Seen live']);
    expect(page.timeline.every(t => !Number.isNaN(Date.parse(t.at)))).toBe(true);
    // Asked 07:12 → plan approved 07:14.
    expect(page.timeline[0]).toMatchObject({ step: 'Asked', took: '2 min', sentence: STEP_SENTENCE.Asked });
    expect(page.timeline.at(-1)!.took).toBeNull();
    expect(page.timeline.every(t => t.sentence.length > 0)).toBe(true);
    // The sentences are fixed words: no person, run, pull request or record code.
    expect(page.timeline.map(t => t.sentence).join(' ')).not.toMatch(/Dana|PR|RUN-|FE-|ET-|#\d/);
  });

  it('a proposal a person approved: the feature as put to them is the ask, and "built in" runs from the go-ahead (2026-10-05)', () => {
    const r = reportInput();
    const { askedBy: _askedBy, askedAt: _askedAt, ...rest } = r.request.meta as Record<string, unknown>;
    const meta = { ...rest, body: 'What should we build next? Pick one.\\n\\n[recommendation]: dates on rows', story: 'As a sender, I want to see when each file was uploaded.', recommendedAt: '2026-09-27T07:12:00Z', decidedAt: '2026-10-02T07:12:00Z' };
    const createdAt = new Date('2026-09-27T07:12:00Z');
    const page = publicFeaturePage(input({ report: assembleFeatureReport({ ...r, request: { ...r.request, createdAt, meta } }), request: { title: r.request.title, createdAt, meta } }));

    expect(page.ask.kind).toBe('proposed');
    expect(page.ask.text).toBe('As a sender, I want to see when each file was uploaded.');
    expect(page.ask.text).not.toContain('recommendation');
    // Five days as a proposal are the timeline's, not the build's.
    expect(page.effort).toMatchObject({ from: 'go-ahead', until: 'seen live', duration: '1h 19m' });
    expect(page.timeline.slice(0, 2).map(t => [t.step, t.at])).toEqual([['Proposed', '2026-09-27T07:12:00.000Z'], ['Approved', '2026-10-02T07:12:00.000Z']]);
    expect(page.timeline[0]!.took).toBe('5 d');
  });

  it('says under the name what the live check saw — partly seen with the count, and that the fix is on its way (FE-457)', () => {
    const r = reportInput();
    const meta = { ...r.request.meta, liveCheck: { state: 'partial', line: 'Partly seen live: 4 of 5 states reached.', releaseId: 9, checkedAt: '2026-10-02T08:32:00Z', attempt: 2, sentBackFor: 9, lines: [{ result: 'reached' }, { result: 'reached' }, { result: 'reached' }, { result: 'reached' }, { result: 'not_reached', reason: 'the owner was asked' }] } };
    const page = publicFeaturePage(input({ report: assembleFeatureReport({ ...r, request: { ...r.request, meta } }), request: { title: r.request.title, createdAt: r.request.createdAt, meta } }));

    expect(page.status.live).toEqual({ word: 'partly seen live', detail: '4 of 5; the fix is being built' });
    expect(liveStatus({})).toBeNull();
    expect(liveStatus({ liveCheck: { state: 'not_seen', line: 'x', releaseId: 9, checkedAt: '2026-10-02T08:32:00Z', attempt: 2 } })).toEqual({ word: 'not seen live', detail: null });
  });

  it('leads with the name it was given, never the whole ask', () => {
    expect(publicFeaturePage(input({ name: 'Upload date on library rows' })).title).toBe('Upload date on library rows');
  });
});

describe('which files a public page may show', () => {
  it('never shows a picture narrowed to "Only me", an SVG, or a link out', () => {
    const meta = { visuals: { mockupArtifactIds: [1, 2, 3, 4] } };
    const byId = new Map([
      [1, art(1, { shareAudience: 'me' })],
      [2, art(2, { url: '/api/artifacts/org_northwind-2/org_northwind-2.svg', spec: { contentType: 'image/svg+xml' } })],
      [3, art(3, { url: 'https://cdn.example/3.png' })],
      [4, art(4, { kind: 'link', url: 'data:image/png;base64,iVBORw0KGgo=', spec: {} })],
    ]);

    expect(sharedPictures(meta, byId).map(p => p.artifact.id)).toEqual([4]);
  });

  it('reads a proposal kept on the old before list as the mockup', () => {
    const byId = new Map([[7, art(7)]]);

    expect(sharedPictures({ visuals: { beforeArtifactIds: [7] } }, byId)).toEqual([{ artifact: byId.get(7), label: 'Mockup' }]);
  });

  it('serves only from Vocion\'s own stores', () => {
    expect(serveVia(art(1))).toBe('file');
    expect(serveVia(art(1, { kind: 'link' }))).toBe('stored');
    expect(serveVia(video(2, 'qa-video', '2026-10-02T08:00:00Z'))).toBe('media');
    expect(serveVia(art(3, { url: 'https://bucket.example/x.png?X-Amz-Signature=abc' }))).toBeNull();
    expect(serveVia(art(4, { url: 'data:image/svg+xml;base64,PHN2Zz4=' }))).toBeNull();
  });

  it('plays the feature demo before anything else, narrated before silent (2026-10-04)', () => {
    const demo = video(5, 'feature-demo', '2026-10-01T07:00:00Z');
    const narratedDemo = video(6, 'feature-demo-narrated', '2026-10-01T07:05:00Z');
    const rest = [video(1, 'qa-video', '2026-10-02T08:00:00Z'), video(2, 'qa-live-video', '2026-10-02T09:00:00Z'), video(3, 'qa-live-video-narrated', '2026-10-02T09:05:00Z')];

    expect(walkthroughOf([...rest, demo, narratedDemo])?.id).toBe(6);
    expect(walkthroughOf([...rest, demo])?.id).toBe(5);
    expect(walkthroughOf(rest)?.id).toBe(3);
  });

  it('prefers a narrated walkthrough, then the live check, then the tests', () => {
    const narrated = video(3, 'qa-video-narrated', '2026-10-01T08:00:00Z');

    expect(walkthroughOf([video(1, 'qa-video', '2026-10-02T08:00:00Z'), video(2, 'qa-live-video', '2026-10-02T09:00:00Z'), narrated])?.id).toBe(3);
    expect(walkthroughOf([video(1, 'qa-video', '2026-10-02T08:00:00Z'), video(2, 'qa-live-video', '2026-10-02T09:00:00Z')])?.id).toBe(2);
    expect(walkthroughOf([video(1, 'qa-video', '2026-10-02T08:00:00Z', { shareAudience: 'me' })])).toBeNull();
    expect(walkthroughOf([video(1, 'qa-video', '2026-10-02T08:00:00Z', { url: 'https://bucket.example/x.webm' })])).toBeNull();
  });
});

describe('the one link back in', () => {
  it('is a workspace path or nothing — never a link out, a query or an internal API', () => {
    expect(publicFeaturePage(input({ openUrl: null })).openUrl).toBeNull();
    expect(publicFeaturePage(input({ openUrl: 'https://elsewhere.example/w/x/y' })).openUrl).toBeNull();
    expect(publicFeaturePage(input({ openUrl: '/api/media/370/x.webm' })).openUrl).toBeNull();
    expect(publicFeaturePage(input({ openUrl: '/w/northwind-studio/dashboard/p/feature/370?token=x' })).openUrl).toBeNull();
    expect(publicFeaturePage(input({ openUrl: '//elsewhere.example/w/x' })).openUrl).toBeNull();
  });
});

describe('who built it', () => {
  it('is the workspace\'s own name, else the factory\'s; and the product by its own name', () => {
    expect(publicFeaturePage(input({ workspaceName: 'Northwind Studio', productName: 'Ledger' }))).toMatchObject({ builtBy: 'Northwind Studio', workspaceName: 'Northwind Studio', productName: 'Ledger' });
    expect(publicFeaturePage(input())).toMatchObject({ workspaceName: null, productName: null });
    expect(publicFeaturePage(input({ workspaceName: null })).builtBy).toBe(DEFAULT_BUILDER);
    expect(publicFeaturePage(input({ workspaceName: '  ' })).builtBy).toBe(DEFAULT_BUILDER);
  });
});

describe('the link\'s preview card', () => {
  const ORIGIN = 'https://agents.northwind.example';

  it('leads the description with who built it, how long and the cost — the page\'s own figures — then what it built', () => {
    const page = publicFeaturePage(input({ workspaceName: 'Northwind Studio', name: 'Upload date on library rows' }));
    const card = shareCard(page, ORIGIN);

    expect(card.description).toBe(`Built by Northwind Studio in ${page.effort.duration} for ${page.effort.total} · Library rows show when each file was uploaded.`);
    expect(card.description).toBe('Built by Northwind Studio in 1h 19m for $2.33 · Library rows show when each file was uploaded.');
    expect(card.description.length).toBeLessThanOrEqual(200);
    expect(card.title).toBe('Upload date on library rows · 1h 19m · $2.33');
    expect(card.siteName).toBe('Northwind Studio');
    expect(shareCard(publicFeaturePage(input({ workspaceName: 'Northwind Studio', productName: 'Ledger' })), ORIGIN).description).toBe('Built by Northwind Studio for Ledger in 1h 19m for $2.33 · Library rows show when each file was uploaded.');
  });

  it('falls back to the factory as the builder and Vocion as the site', () => {
    const card = shareCard(publicFeaturePage(input({ workspaceName: null })), ORIGIN);

    expect(card.description.startsWith(`Built by ${DEFAULT_BUILDER} in 1h 19m for $2.33 · `)).toBe(true);
    expect(card.siteName).toBe('Vocion');
  });

  it('pictures the first mockup, else QA\'s first shot, else nothing — absolute, through the link', () => {
    const page = publicFeaturePage(input());

    expect(shareCard(page, ORIGIN).image).toEqual({ url: `${ORIGIN}/api/share/feature/TOKEN/media/901?k=sig-901`, alt: 'Caption 901' });

    const noMockups = input();
    noMockups.request = { ...noMockups.request, meta: { ...noMockups.request.meta, visuals: {} } };

    expect(shareCard(publicFeaturePage(noMockups), ORIGIN).image?.url).toBe(`${ORIGIN}/api/share/feature/TOKEN/media/962?k=sig-962`);
    expect(shareCard(publicFeaturePage({ ...noMockups, evidence: [] }), ORIGIN).image).toBeNull();
  });

  it('carries the picture\'s size when the file says it', () => {
    const sized = input({ pictures: [art(901, { spec: { contentType: 'image/png', caption: 'Caption 901', width: 1200, height: 630 } })] });

    expect(shareCard(publicFeaturePage(sized), ORIGIN).image).toMatchObject({ width: 1200, height: 630 });
  });
});

describe('the words that leave the workspace', () => {
  it('takes out emails and links and keeps the rest', () => {
    expect(scrub('Ping ops@kestrel.example or see https://kestrel.example/a?b=1 today')).toBe('Ping [email hidden] or see [link hidden] today');
  });

  it('says what the live check said, and keeps the loop\'s order for steps stamped in the same minute (walk 19)', () => {
    const row = (kind: HistoryRow['kind'], at: string, over: Partial<HistoryRow> = {}): HistoryRow => ({ key: `${kind}-${at}`, kind, title: kind, code: null, at, tone: 'ok', cents: null, open: null, href: null, live: false, ...over });
    const steps = publicSteps([
      row('merge', '2026-10-04T15:43:30Z'),
      row('review', '2026-10-04T15:44:10Z'),
      row('live', '2026-10-04T16:00:00Z', { title: 'Live check · Could not check live: the QA environment cannot show it (the QA account has no team library); 6 lines could not be seen. Fix the environment\'s live setup, then Check live again', tone: 'warn' }),
    ], T('2026-10-04T14:59:00Z'));

    expect(steps.map(s => s.step)).toEqual(['Asked', 'QA approved', 'Merged', 'Checked live']);
    expect(steps[3]!.sentence).toBe('Could not check live: the QA environment cannot show it (the QA account has no team library); 6 lines could not be seen. Fix the environment\'s live setup, then Check live again.');
    // Far apart, the clock rules; a live row without its own words keeps the fixed sentence.
    expect(publicSteps([row('merge', '2026-10-04T15:40:00Z'), row('review', '2026-10-04T15:50:00Z'), row('live', '2026-10-04T16:00:00Z', { title: '' })], null).map(s => [s.step, s.sentence])).toEqual([['Merged', STEP_SENTENCE.Merged], ['QA approved', STEP_SENTENCE['QA approved']], ['Seen live', STEP_SENTENCE['Seen live']]]);
  });

  it('lets a failed attempt speak in its own words, not the fixed sentence (walk 20)', () => {
    const row = (kind: HistoryRow['kind'], at: string, over: Partial<HistoryRow> = {}): HistoryRow => ({ key: `${kind}-${at}`, kind, title: kind, code: null, at, tone: 'ok', cents: null, open: null, href: null, live: false, ...over });
    const steps = publicSteps([row('build', '2026-10-04T17:30:00Z', { tone: 'bad', title: 'Attempt 1 of 2 · ran out of time; its work was kept for the next attempt' }), row('build', '2026-10-04T17:50:00Z', { title: 'Attempt 2 of 2 · built' })], null);

    expect(steps.map(s => [s.step, s.sentence])).toEqual([['A build attempt failed', 'Attempt 1 of 2 · ran out of time; its work was kept for the next attempt.'], ['Built', STEP_SENTENCE.Built]]);
  });

  it('takes the preview frame at the first spoken line, never the blank first frame (walk 20)', () => {
    expect(posterAt({ script: [{ atMs: 15146, text: 'later' }, { atMs: 4443, endMs: 7900, text: 'first' }] })).toBe(7.9);
    expect(posterAt({ script: [{ atMs: 4443, text: 'first' }] })).toBe(5.943);
    expect(posterAt({})).toBeNull();

    const demo = video(9, 'feature-demo-narrated', '2026-10-04T18:09:00Z', { spec: { contentType: 'video/mp4', caption: 'demo', script: [{ atMs: 4443, text: 'I open my library.' }] } });
    const page = publicFeaturePage(input({ recordings: [demo] }));

    expect(page.media[0]).toMatchObject({ kind: 'video', posterAt: 5.943 });
  });

  it('starts the timeline at the ask even when nothing else happened', () => {
    expect(publicSteps([], T('2026-10-02T07:12:00Z'))).toEqual([{ step: 'Asked', at: '2026-10-02T07:12:00.000Z', took: null, sentence: STEP_SENTENCE.Asked }]);
  });

  it('says a span the short way', () => {
    expect(shortSpan(20_000)).toBe('under a minute');
    expect(shortSpan(18 * 60_000)).toBe('18 min');
    expect(shortSpan(79 * 60_000)).toBe('1 h 19 min');
    expect(shortSpan(2 * 3_600_000)).toBe('2 h');
    expect(shortSpan(52 * 3_600_000)).toBe('2 d 4 h');
  });
});

describe('the QA shots a public page shows', () => {
  it('shows the shipped or approved attempt\'s, never a sent-back attempt\'s, an "Only me" shot or a link out', () => {
    const ids = (attempt: Parameters<typeof shippedEvidence>[1]) => shippedEvidence([...evidence, shot(965, 374, 'Library · phone · after', '2026-10-02T08:22:00Z', { shareAudience: 'me' }), shot(966, 374, 'Library · tablet · after', '2026-10-02T08:22:00Z', { url: 'https://bucket.example/s.png' })], attempt).map(e => e.artifact.id);

    expect(ids({ taskId: 374, why: 'shipped' })).toEqual([962, 961]);
    expect(ids({ taskId: 374, why: 'judged', verdict: 'approve' })).toEqual([962, 961]);
    expect(ids({ taskId: 373, why: 'judged', verdict: 'changes' })).toEqual([]);
    expect(ids(null)).toEqual([]);
  });
});
