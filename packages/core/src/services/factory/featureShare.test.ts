import type { FeatureReportInput, ReportActivity } from './featureReport';
import type { PublicFeatureInput, SharedArtifact } from './featureShare';
import { describe, expect, it } from 'vitest';
import { assembleFeatureReport } from './featureReport';
import { publicEmbed, publicFeaturePage, publicSteps, scrub, serveVia, sharedPictures, walkthroughOf } from './featureShare';

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

function input(over: Partial<PublicFeatureInput> = {}): PublicFeatureInput {
  const r = reportInput();
  return {
    report: assembleFeatureReport(r),
    request: { title: r.request.title, createdAt: r.request.createdAt, meta: r.request.meta },
    pictures: [art(901), art(902), art(903), art(904, { url: 'https://cdn.example/after.png' })],
    recordings: [video(950, 'qa-video', '2026-10-02T08:05:00Z'), video(951, 'qa-live-video', '2026-10-02T08:32:00Z')],
    hideAsker: false,
    mediaSrc: id => `/api/share/feature/TOKEN/media/${id}?k=sig-${id}`,
    ...over,
  };
}

describe('the public page of a feature', () => {
  const page = publicFeaturePage(input());

  it('carries exactly the six parts and nothing else', () => {
    expect(Object.keys(page).sort()).toEqual(['ask', 'built', 'effort', 'pictures', 'timeline', 'title', 'video']);
    expect(Object.keys(page.ask).sort()).toEqual(['at', 'by', 'text']);
    expect(page.title).toBe('Show the upload date on each library row');
    expect(page.ask.by).toBe('Dana Okafor');
    expect(page.ask.at).toBe('2026-10-02T07:12:00.000Z');
    expect(page.ask.text).toMatch(/^I cannot tell which file is newest\./);
    expect(page.built).toBe('Library rows show when each file was uploaded.');
  });

  it('holds no email, no internal link, no pull request, no run and no other record', () => {
    const all = JSON.stringify(page);

    expect(all).not.toMatch(/@northwind\.example|dana@/);
    expect(all).not.toMatch(/https?:\/\/(?!video-host)/);
    expect(all).not.toMatch(/\/dashboard|\/api\/media|\/api\/artifacts|github|pull\/|PR #|RUN-|ET-37|PL-37|REL-37/);
    expect(all).not.toMatch(/northwind-engineer|qa-review|Requested in chat/);
    expect(page.ask.text).toContain('[email hidden]');
    expect(page.ask.text).toContain('[link hidden]');

    // Every picture and the recording load through the share route only.
    for (const src of [...page.pictures.map(p => p.src), page.video && page.video.kind === 'file' ? page.video.src : null].filter(Boolean)) {
      expect(src).toMatch(/^\/api\/share\/feature\/TOKEN\/media\/\d+\?k=/);
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
    expect(page.effort.split).toEqual([
      { label: 'Builds', amount: '$1.81' },
      { label: 'Agents', amount: '$0.40' },
      { label: 'Chat', amount: '$0.12' },
    ]);
  });

  it('shows the mockup, the screen it was drawn on and the after-shot, only ones it can serve', () => {
    expect(page.pictures.map(p => [p.label, p.src])).toEqual([
      ['Mockup', '/api/share/feature/TOKEN/media/901?k=sig-901'],
      ['Before', '/api/share/feature/TOKEN/media/902?k=sig-902'],
      ['After', '/api/share/feature/TOKEN/media/903?k=sig-903'],
    ]);
    expect(page.pictures[0]).toMatchObject({ alt: 'Picture 901', caption: 'Caption 901' });
  });

  it('plays the newest live-check recording when there is no narrated one, through the share route', () => {
    expect(page.video).toEqual({ kind: 'file', src: '/api/share/feature/TOKEN/media/951?k=sig-951', type: 'video/webm', label: 'On the live product', caption: 'Recording caption 951', at: '2026-10-02T08:32:00.000Z' });
  });

  it('reads the timeline as fixed steps, oldest first, each with a time', () => {
    expect(page.timeline.map(t => t.step)).toEqual(['Asked', 'Plan approved', 'Built', 'QA asked for changes', 'Built', 'QA approved', 'Merged', 'Deployed', 'Released', 'Seen live']);
    expect(page.timeline.every(t => !Number.isNaN(Date.parse(t.at)))).toBe(true);
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

  it('prefers a narrated walkthrough, then the live check, then the tests', () => {
    const narrated = video(3, 'qa-video-narrated', '2026-10-01T08:00:00Z');

    expect(walkthroughOf([video(1, 'qa-video', '2026-10-02T08:00:00Z'), video(2, 'qa-live-video', '2026-10-02T09:00:00Z'), narrated])?.id).toBe(3);
    expect(walkthroughOf([video(1, 'qa-video', '2026-10-02T08:00:00Z'), video(2, 'qa-live-video', '2026-10-02T09:00:00Z')])?.id).toBe(2);
    expect(walkthroughOf([video(1, 'qa-video', '2026-10-02T08:00:00Z', { shareAudience: 'me' })])).toBeNull();
    expect(walkthroughOf([video(1, 'qa-video', '2026-10-02T08:00:00Z', { url: 'https://bucket.example/x.webm' })])).toBeNull();
  });

  it('embeds the video host\'s player only for a recording published there for anyone', () => {
    const hosted = (visibility: string) => video(5, 'qa-live-video', '2026-10-02T09:00:00Z', { spec: { contentType: 'video/webm', caption: 'c', slateShareId: 'share-fictional-1', hostedVideo: { state: 'published', visibility, embedUrl: 'https://video-host.example/embed/share-fictional-1' } } });

    expect(publicEmbed(hosted('public'))).toBe('https://video-host.example/embed/share-fictional-1');
    expect(publicEmbed(hosted('team'))).toBeNull();
    expect(publicEmbed(video(6, 'qa-live-video', '2026-10-02T09:00:00Z', { spec: { hostedVideo: { state: 'published', visibility: 'public', embedUrl: 'javascript:alert(1)' } } }))).toBeNull();

    const page = publicFeaturePage(input({ recordings: [hosted('public')] }));

    expect(page.video).toMatchObject({ kind: 'embed', src: 'https://video-host.example/embed/share-fictional-1' });
  });
});

describe('the words that leave the workspace', () => {
  it('takes out emails and links and keeps the rest', () => {
    expect(scrub('Ping ops@kestrel.example or see https://kestrel.example/a?b=1 today')).toBe('Ping [email hidden] or see [link hidden] today');
  });

  it('starts the timeline at the ask even when nothing else happened', () => {
    expect(publicSteps([], T('2026-10-02T07:12:00Z'))).toEqual([{ step: 'Asked', at: '2026-10-02T07:12:00.000Z' }]);
  });
});
