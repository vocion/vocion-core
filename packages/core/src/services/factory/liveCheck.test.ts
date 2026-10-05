import type { Buffer } from 'node:buffer';
import type { Server } from 'node:http';
import type { Browser } from 'playwright';
import type { BrowserEvidence } from './liveBrowser';
import type { EnvironmentAccess } from './productAccess';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { HUMAN_BEATS } from '@/libs/factory/demoNavigation';
import { RecordedLineSchema } from '@/libs/factory/liveCheck';

vi.mock('@/libs/DB');

// The product's production access, as the vault would reveal it to the browser
// (and never to the agent): set per test.
const access: { environments: EnvironmentAccess[] } = { environments: [] };
const proposed: Array<Record<string, unknown>> = [];
vi.mock('@/services/ActionService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/ActionService')>()),
  proposeAction: async (input: Record<string, unknown>) => {
    proposed.push(input);
    return { runId: 9001, status: 'executed' };
  },
}));
vi.mock('@/services/factory/productAccess', () => ({
  productAccess: async (_org: string, product: string) => ({ product, environments: access.environments }),
}));

const { db } = await import('@/libs/DB');
const { artifactSchema, automationRunSchema, businessObjectSchema, eventLogSchema, workspaceVersionSchema } = await import('@/models/Schema');
const { createObjectType } = await import('@/services/BusinessObjectService');
const { and, eq } = await import('drizzle-orm');
const { allowedOrigins, environmentFor, liveCheckEnded, recheckNeverLooked, recordLiveCheck } = await import('./liveCheck');
const browserSvc = await import('./liveBrowser');

const ORG = 'org_live_check';
const author = { kind: 'agent' as const, id: 'agent:change-reviewer' };
const lines = (raw: unknown[]) => raw.map(l => RecordedLineSchema.parse(l));

const ONE_LINE = [{ statement: 'A blank name is not saved.' }];

async function seed(orgId: string, acceptance: unknown[] = ONE_LINE) {
  const [reqType] = await createObjectType({ slug: 'request', label: 'Request' }, orgId);
  const [relType] = await createObjectType({ slug: 'release', label: 'Release' }, orgId);
  const [request] = await db.insert(businessObjectSchema).values({ orgId, typeId: reqType!.id, title: 'Rename a document', status: 'active', metadata: { state: 'shipped', acceptance } }).returning();
  const [release] = await db.insert(businessObjectSchema).values({ orgId, typeId: relType!.id, title: 'relay 930a23f', status: 'active', metadata: { product: 'relay', releasedAt: '2026-10-01T09:00:00Z', requestIds: [request!.id], taskIds: [] } }).returning();
  return { requestId: request!.id, releaseId: release!.id };
}

async function meta(id: number) {
  const [r] = await db.select({ meta: businessObjectSchema.metadata }).from(businessObjectSchema).where(eq(businessObjectSchema.id, id));
  return (r?.meta ?? {}) as Record<string, any>;
}

const shotEvidence = (artifactId: number, extra: Partial<BrowserEvidence> = {}): BrowserEvidence => ({ id: `shot-${artifactId}`, kind: 'screenshot', at: '2026-10-03T09:00:00Z', artifactId, url: `/api/artifacts/files/live-${artifactId}.png`, pageUrl: 'https://app.relay.example/documents/d1/rename', caption: 'Save is disabled while the name is blank', viewport: 'desktop', signedIn: true, ...extra } as BrowserEvidence);

describe('where the browser opens, and where it may go', () => {
  const envs: EnvironmentAccess[] = [
    { slug: 'relay-marketing-production', surface: 'marketing', url: 'https://relay.example', login: null, liveSetup: null },
    { slug: 'relay-web-production', surface: 'web', url: 'https://app.relay.example', login: { signInUrl: 'https://auth.relay.example/sign-in', email: 'qa@relay.example', stored: true }, liveSetup: null },
  ];

  it('opens on the surface named, else where the QA sign-in is', () => {
    expect(environmentFor({ surface: 'marketing' }, envs)?.slug).toBe('relay-marketing-production');
    expect(environmentFor({}, envs)?.slug).toBe('relay-web-production');
    expect(environmentFor({ surface: 'api' }, envs)).toBeNull();
  });

  it('opens only the product\'s own origins and its sign-in page', () => {
    expect([...allowedOrigins(envs)].sort()).toEqual(['https://app.relay.example', 'https://auth.relay.example', 'https://relay.example']);
  });
});

describe('record_live_check, against what this run captured', () => {
  it('writes the release and the feature in the shape every reader reads, each line with its evidence', async () => {
    const org = `${ORG}_record`;
    const API = [{ statement: 'A blank name is not saved.' }, { statement: 'CI builds the image without exit 132.', met: true, evidence: 'Named test passed: https://ci.example/run/7' }, { statement: 'GET /api/docs returns 200 signed in.' }];
    const { requestId, releaseId } = await seed(org, API);
    const session = new Map<string, BrowserEvidence>([
      ['shot-501', shotEvidence(501)],
      ['snap-2', { id: 'snap-2', kind: 'snapshot', at: '2026-10-03T09:00:00Z', url: 'https://app.relay.example/documents/d1/rename', title: 'Rename', viewport: 'desktop', signedIn: true }],
      ['resp-3', { id: 'resp-3', kind: 'response', at: '2026-10-03T09:00:01Z', method: 'GET', url: 'https://app.relay.example/api/docs?x=1', status: 200, signedIn: true }],
    ]);

    const out = await recordLiveCheck(org, { releaseId, lines: lines([
      { line: 1, result: 'seen', evidence: ['snap-2', 'shot-501'], why: 'With the name blank, Save is disabled, so a blank name cannot be saved.' },
      { line: 2, result: 'not_observable', why: 'a CI run' },
      { line: 3, result: 'seen', evidence: ['resp-3'], why: 'The library called GET /api/docs and got 200.' },
    ]) }, { session, missionRunId: 9 }, new Date('2026-10-03T09:05:00Z'));

    expect(out.refused).toBeUndefined();
    expect(out.verdict).toMatchObject({ state: 'seen', line: 'Seen live: 2 of 2 states reached (GET /api/docs?x=1 returned 200 signed in). 1 more line proven before merge by QA\'s verdict' });

    const rel = await meta(releaseId);

    expect(rel).toMatchObject({ liveState: 'seen', liveSummary: out.verdict.line, liveAttempts: 1, liveProblems: [], liveCheckedAt: '2026-10-03T09:05:00.000Z', announcementImageArtifactId: 501 });
    expect(rel.liveEvidence[0]).toEqual({ requestId, flow: 'line 1', line: 1, criterion: 'A blank name is not saved.', viewport: 'desktop', artifactId: 501, status: 'reached', url: 'https://app.relay.example/documents/d1/rename', label: 'Save is disabled while the name is blank', evidence: ['snap-2', 'shot-501'] });
    expect(rel.liveEvidence[1]).toMatchObject({ line: 3, status: 'reached', proved: ['GET /api/docs?x=1 returned 200 signed in'], artifactId: null });
    expect(rel.liveBeforeMerge).toEqual([{ requestId, line: 2, text: 'CI builds the image without exit 132.', why: 'a CI run', proven: true }]);

    const req = await meta(requestId);

    expect(req.liveCheck).toMatchObject({ state: 'seen', releaseId, attempt: 1, beforeMerge: [{ line: 2, proven: true }] });
    expect(req.liveCheck.flows).toBeUndefined();
    expect(req.liveCheck.lines).toEqual([
      { line: 1, text: 'A blank name is not saved.', result: 'reached', url: 'https://app.relay.example/documents/d1/rename', reason: null },
      { line: 3, text: 'GET /api/docs returns 200 signed in.', result: 'reached', url: null, reason: null },
    ]);
    expect(req.visuals.afterArtifactIds).toEqual([501]);
  });

  it('a line looked for and not seen reads in QA\'s words, and the feature says so', async () => {
    const org = `${ORG}_not_seen`;
    const { requestId, releaseId } = await seed(org);
    const session = new Map<string, BrowserEvidence>([['shot-7', shotEvidence(7, { caption: 'The blank name was saved' })]]);

    const out = await recordLiveCheck(org, { releaseId, lines: lines([{ line: 1, result: 'not_seen', evidence: ['shot-7'], why: 'Save stayed enabled with a blank name, and the blank name was saved.' }]) }, { session });

    expect(out.verdict.line).toBe('Not seen live: QA looked on the live product and did not see it: Save stayed enabled with a blank name, and the blank name was saved');
    expect((await meta(releaseId)).liveWhy).toEqual({ kind: 'not_seen', detail: 'Save stayed enabled with a blank name, and the blank name was saved.' });
    expect((await meta(requestId)).liveCheck.lines).toEqual([{ line: 1, text: 'A blank name is not saved.', result: 'not_reached', url: 'https://app.relay.example/documents/d1/rename', reason: 'Save stayed enabled with a blank name, and the blank name was saved.' }]);
  });

  it('refuses evidence this run did not capture, naming it and what the run did capture, and writes nothing', async () => {
    const org = `${ORG}_foreign_evidence`;
    const { releaseId } = await seed(org);
    const session = new Map<string, BrowserEvidence>([['snap-1', { id: 'snap-1', kind: 'snapshot', at: 'x', url: 'https://app.relay.example/', title: 'Library', viewport: 'desktop', signedIn: true }]]);

    const out = await recordLiveCheck(org, { releaseId, lines: lines([{ line: 1, result: 'seen', evidence: ['snap-1', 'shot-999'], why: 'Save is disabled.' }]) }, { session, missionRunId: 9 });

    expect(out.refused).toContain('An evidence id was not captured by this run\'s browser: shot-999.');
    expect(out.refused).toContain('This run captured: snap-1 (https://app.relay.example/)');
    expect((await meta(releaseId)).liveState).toBeUndefined();
  });

  it('accepts a screenshot this run filed on the release once the session is gone, and refuses one another run filed', async () => {
    const org = `${ORG}_stored_shot`;
    const { releaseId } = await seed(org);
    const file = (missionRunId: number) => db.insert(artifactSchema).values({ orgId: org, kind: 'file', title: 'Save disabled · desktop · live', spec: { url: '/api/artifacts/files/a.png', caption: 'Save is disabled', capturedFrom: 'https://app.relay.example/r', provenance: { liveCheck: true, releaseId, missionRunId, viewport: 'desktop', signedIn: true } }, recordType: 'object', recordId: String(releaseId), recordRole: 'live-screenshot' } as never).returning();
    const [mine] = await file(41);
    const [theirs] = await file(40);

    const refused = await recordLiveCheck(org, { releaseId, lines: lines([{ line: 1, result: 'seen', evidence: [`shot-${theirs!.id}`], why: 'Save is disabled.' }]) }, { session: new Map(), missionRunId: 41 });

    expect(refused.refused).toContain(`shot-${theirs!.id}`);

    const out = await recordLiveCheck(org, { releaseId, lines: lines([{ line: 1, result: 'seen', evidence: [`shot-${mine!.id}`], why: 'Save is disabled.' }]) }, { session: new Map(), missionRunId: 41 });

    expect(out.verdict.state).toBe('seen');
    expect((await meta(releaseId)).liveEvidence[0]).toMatchObject({ artifactId: mine!.id, url: 'https://app.relay.example/r', label: 'Save is disabled' });
  });

  it('refuses a recording that leaves a line out, listing it, and writes nothing', async () => {
    const org = `${ORG}_missing`;
    const { requestId, releaseId } = await seed(org, [{ statement: 'A blank name is not saved.' }, { statement: 'A saved name shows in the title.' }]);

    const out = await recordLiveCheck(org, { releaseId, lines: lines([{ line: 1, result: 'seen', evidence: ['shot-1'], why: 'x' }]) }, { session: new Map([['shot-1', shotEvidence(1)]]) });

    expect(out.refused).toContain(`An acceptance line is not recorded:\nrequest #${requestId}: line 2 (A saved name shows in the title.)`);
    expect((await meta(releaseId)).liveState).toBeUndefined();
    expect((await meta(releaseId)).liveAttempts).toBeUndefined();
  });

  it('puts a line QA\'s verdict left to the live check in front of the recording, after the request\'s lines (FE-392)', async () => {
    const org = `${ORG}_left_to_live`;
    const { requestId, releaseId } = await seed(org);
    const risk = 'The plan\'s risk is handled: a long name must not push the menu off the title row on a phone.';
    const [taskType] = await createObjectType({ slug: 'engineering_task', label: 'Task' }, org);
    const [task] = await db.insert(businessObjectSchema).values({ orgId: org, typeId: taskType!.id, title: 'attempt', status: 'active', metadata: {
      requestId,
      acceptanceContract: [ONE_LINE[0]!.statement, risk],
      verdict: { value: 'approve', criteria: [{ criterion: ONE_LINE[0]!.statement, status: 'proven', evidence: 'Screenshot https://relay.example/a/1' }, { criterion: risk, status: 'live' }] },
    } }).returning();
    const release = await meta(releaseId);
    await db.update(businessObjectSchema).set({ metadata: { ...release, taskIds: [task!.id] } }).where(eq(businessObjectSchema.id, releaseId));

    const out = await recordLiveCheck(org, { releaseId, lines: lines([{ line: 1, result: 'seen', evidence: ['shot-1'], why: 'x' }]) }, { session: new Map([['shot-1', shotEvidence(1)]]) });

    expect(out.acceptance).toEqual([{ requestId, lines: [
      { n: 1, text: ONE_LINE[0]!.statement, provenBeforeMerge: true },
      { n: 2, text: risk, provenBeforeMerge: false, leftToLive: true },
    ] }]);
    expect(out.refused).toContain(`request #${requestId}: line 2 (The plan's risk is handled`);
    expect(out.refused).toContain(`  2. ${risk} (QA left this to the live check)`);
  });

  it('says why when the release names no product', async () => {
    const org = `${ORG}_noproduct`;
    const { releaseId } = await seed(org);
    const release = await meta(releaseId);
    await db.update(businessObjectSchema).set({ metadata: { ...release, product: null } }).where(eq(businessObjectSchema.id, releaseId));

    const out = await recordLiveCheck(org, { releaseId, lines: lines([{ line: 1, result: 'not_observable', why: 'x' }]) }, { session: new Map() });

    expect(out.refused).toBe(`release #${releaseId} names no product, so there is no live product to check`);
  });
});

describe('the browser tools, in a real browser against a fictional product', async () => {
  let chromium: typeof import('playwright').chromium | null = null;
  try {
    const pw = await import('playwright');
    const b = await pw.chromium.launch();
    await b.close();
    chromium = pw.chromium;
  } catch {
    chromium = null;
  }

  // A product with a sign-in page, a rename page whose Save is disabled while
  // the name is blank (FE-402 line 6, fictional), a library that loads its list
  // from an API, and a link to a site that is not the product's.
  const sessions = new Set<string>();
  let server: Server;
  let base = '';
  let browser: Browser | null = null;

  beforeAll(async () => {
    if (!chromium) {
      return;
    }
    server = createServer((req, res) => {
      const signedIn = sessions.has(/sid=(\w+)/.exec(req.headers.cookie ?? '')?.[1] ?? '');
      const url = new URL(req.url ?? '/', 'http://x');
      res.setHeader('content-type', 'text/html');
      const send = (html: string) => res.end(`<!doctype html><title>Relay</title><body style="font:16px sans-serif">${html}</body>`);
      if (url.pathname === '/sign-in' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => {
          body += c;
        });
        req.on('end', () => {
          const p = new URLSearchParams(body);
          if (p.get('email') === 'qa@relay.example' && p.get('password') === 'fictional-secret') {
            sessions.add('s1');
            res.writeHead(303, { 'set-cookie': 'sid=s1; Path=/', 'location': '/' });
            return res.end();
          }
          return send('<div role="alert">Wrong email or password</div>');
        });
        return;
      }
      if (url.pathname === '/sign-in') {
        return send('<form method="post"><label>Email <input name="email"></label><label>Password <input name="password" type="password"></label><button type="submit">Sign in</button></form>');
      }
      if (!signedIn) {
        res.writeHead(302, { location: '/sign-in' });
        return res.end();
      }
      if (url.pathname === '/rename') {
        return send(`<h1>Rename document</h1><label>Name <input id="n" oninput="document.getElementById('s').disabled=!this.value.trim()"></label><button id="s" disabled onclick="document.getElementById('m').textContent='Saved as '+document.getElementById('n').value">Save</button><p id="m"></p><a href="https://elsewhere.example/help">Help centre</a>`);
      }
      if (url.pathname === '/library') {
        return send(`<ul id="l"></ul><script>fetch('/api/docs').then(r=>r.json()).then(d=>{document.getElementById('l').innerHTML='<li>'+d.length+' documents</li>'})</script>`);
      }
      if (url.pathname === '/api/docs') {
        res.setHeader('content-type', 'application/json');
        return res.end('[{"title":"Q3 board deck"}]');
      }
      return send('<p>Nothing here yet</p>');
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser?.close();
    server?.close();
  });

  // Recording is off unless a test turns it on, so the other tests leave no files behind.
  const deps = (videoDir: string | null = null) => ({
    browser: async () => browser!,
    store: async (_org: string, png: Buffer) => ({ url: `/api/artifacts/files/live-${png.length}.png`, filename: `live-${png.length}.png`, bytes: png.length, contentType: 'image/png' }),
    videoDir: () => videoDir,
  });
  const env = (password: string): EnvironmentAccess[] => [{ slug: 'relay-web-production', surface: 'web', url: base, login: { signInUrl: `${base}/sign-in`, email: 'qa@relay.example', password, stored: true }, liveSetup: null }];
  const refOf = (snapshot: string | undefined, line: RegExp) => line.exec(snapshot ?? '')?.[1] ?? '';

  it('checks without recording when this installation cannot record, rather than failing the check (FE-419)', { skip: !chromium, timeout: 120_000 }, async () => {
    const org = `${ORG}_norecord`;
    const { releaseId } = await seed(org);
    access.environments = env('fictional-secret');
    const key = browserSvc.browserSessionKey({ orgId: org, missionRunId: 502 });
    // A browser whose recording contexts cannot open a page, as on an image without a video encoder.
    const broken = {
      newContext: async (opts: Record<string, unknown>) => (opts.recordVideo
        ? { newPage: async () => {
            throw new Error('browserContext.newPage: Executable doesn\'t exist at /home/app/.cache/ms-playwright/ffmpeg-1011/ffmpeg-linux');
          }, close: async () => {} }
        : browser!.newContext(opts)),
    };

    const opened = await browserSvc.browserOpen(key, org, { releaseId, target: '/rename' }, { ...deps('/tmp/vocion-live-video-test'), browser: async () => broken as never });

    expect(opened.ok).toBe(true);
    expect(opened.snapshot).toMatch(/button "Save"/);

    await browserSvc.closeBrowserSession(key);
    browserSvc.resetRecordingProbe();
  });

  it('sees a disabled Save as disabled, clicks it and hears "disabled" at once, screenshots it, and records the line seen (FE-402 line 6)', { skip: !chromium, timeout: 120_000 }, async () => {
    const org = `${ORG}_browser`;
    const { requestId, releaseId } = await seed(org);
    access.environments = env('fictional-secret');
    const key = browserSvc.browserSessionKey({ orgId: org, missionRunId: 501 });

    const opened = await browserSvc.browserOpen(key, org, { releaseId, target: '/rename' }, deps());

    expect(opened.ok).toBe(true);
    expect(opened.snapshot).toMatch(/button "Save" \[disabled\] \[ref=e\d+\]/);
    expect(opened.snapshot).toContain(`URL: ${base}/rename`);
    expect(opened.acceptance).toEqual([{ requestId, lines: [{ n: 1, text: 'A blank name is not saved.', provenBeforeMerge: false }] }]);
    // The password reached the browser and nothing else.
    expect(JSON.stringify(opened)).not.toContain('fictional-secret');

    const save = refOf(opened.snapshot, /button "Save" \[disabled\] \[ref=(e\d+)\]/);
    const started = Date.now();
    const clicked = await browserSvc.browserClick(key, save, deps());

    expect(clicked).toMatchObject({ ok: false, result: expect.stringMatching(/^disabled/) });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(clicked.id).toMatch(/^act-\d+$/);

    const shot = await browserSvc.browserScreenshot(key, 'Save is disabled while the name is blank', { author, provenance: { agentSlug: 'change-reviewer', missionRunId: 501 } }, deps());

    expect(shot).toMatchObject({ ok: true, id: expect.stringMatching(/^shot-\d+$/), url: expect.stringMatching(/^\/api\/artifacts\/files\/live-\d+\.png$/) });

    const [row] = await db.select().from(artifactSchema).where(and(eq(artifactSchema.orgId, org), eq(artifactSchema.id, Number(shot.id!.slice(5)))));

    expect(row).toMatchObject({ recordType: 'object', recordId: String(releaseId), recordRole: 'live-screenshot', kind: 'file' });

    // Typing a name enables Save, and the click goes through.
    const name = refOf(clicked.snapshot, /textbox "Name" \[ref=(e\d+)\]/);
    const typed = await browserSvc.browserType(key, { ref: name, text: 'Q3 board deck' }, deps());

    expect(typed.snapshot).toMatch(/button "Save" \[ref=e\d+\]/);

    const saved = await browserSvc.browserClick(key, refOf(typed.snapshot, /button "Save" \[ref=(e\d+)\]/), deps());

    expect(saved).toMatchObject({ ok: true, result: 'clicked' });
    expect(saved.snapshot).toContain('Saved as Q3 board deck');

    const session = browserSvc.browserSessionEvidence(key);
    const out = await recordLiveCheck(org, { releaseId, lines: lines([{ line: 1, result: 'seen', evidence: [opened.snapshotId!, clicked.id!, shot.id!], why: 'With the name blank, Save is disabled and a click does nothing.' }]) }, { session: session.evidence, problems: session.problems, missionRunId: 501 });

    expect(out.verdict).toMatchObject({ state: 'seen', line: 'Seen live: 1 of 1 state reached' });
    expect((await meta(releaseId)).announcementImageArtifactId).toBe(Number(shot.id!.slice(5)));
    expect((await meta(requestId)).liveCheck).toMatchObject({ state: 'seen', lines: [{ line: 1, result: 'reached', url: `${base}/rename` }] });

    await browserSvc.closeBrowserSession(key);

    expect(await browserSvc.browserSnapshot(key, deps())).toMatchObject({ ok: false, refused: expect.stringMatching(/^Refused: no page is open/) });
  });

  it('refuses an address that is not the product\'s, and a page that tries to go there is stopped and says so', { skip: !chromium, timeout: 120_000 }, async () => {
    const org = `${ORG}_browser_origin`;
    const { releaseId } = await seed(org);
    access.environments = env('fictional-secret');
    const key = browserSvc.browserSessionKey({ orgId: org, missionRunId: 502 });

    const foreign = await browserSvc.browserOpen(key, org, { releaseId, target: 'http://169.254.169.254/latest/meta-data' }, deps());

    expect(foreign).toMatchObject({ ok: false, refused: expect.stringContaining('is not one of the product\'s own addresses') });
    expect(foreign.id).toMatch(/^act-\d+$/);

    const opened = await browserSvc.browserOpen(key, org, { releaseId, target: '/rename' }, deps());
    const help = await browserSvc.browserClick(key, refOf(opened.snapshot, /link "Help centre" \[ref=(e\d+)\]/), deps());

    expect(help.url).toBe(`${base}/rename`);
    expect(help.result).toContain('https://elsewhere.example/help, which is not one of the product\'s own addresses; it was not opened');
    // One run checks one release.
    expect(await browserSvc.browserOpen(key, org, { releaseId: releaseId + 1000, target: '/' }, deps())).toMatchObject({ ok: false, refused: expect.stringContaining('one run checks one release') });

    await browserSvc.closeBrowserSession(key);
  });

  it('lists the responses a page received, each with an id a line about an API cites', { skip: !chromium, timeout: 120_000 }, async () => {
    const org = `${ORG}_browser_api`;
    const { releaseId } = await seed(org, [{ statement: 'GET /api/docs returns 200 signed in.' }]);
    access.environments = env('fictional-secret');
    const key = browserSvc.browserSessionKey({ orgId: org, missionRunId: 503 });

    const opened = await browserSvc.browserOpen(key, org, { releaseId, target: '/library' }, deps());

    expect(opened.snapshot).toContain('1 documents');

    const { responses } = browserSvc.browserResponses(key, '/api/docs');

    expect(responses).toEqual([{ id: expect.stringMatching(/^resp-\d+$/), method: 'GET', url: `${base}/api/docs`, status: 200, signedIn: true }]);

    const session = browserSvc.browserSessionEvidence(key);
    const out = await recordLiveCheck(org, { releaseId, lines: lines([{ line: 1, result: 'seen', evidence: [responses[0]!.id], why: 'The library called it and got 200.' }]) }, { session: session.evidence, missionRunId: 503 });

    expect(out.verdict.line).toBe('Seen live: 1 of 1 state reached (GET /api/docs returned 200 signed in)');

    await browserSvc.closeBrowserSession(key);
  });

  it('a failed sign-in is refused with its reason, and a line recorded not seen leads with it, never leaking the password', { skip: !chromium, timeout: 120_000 }, async () => {
    const org = `${ORG}_browser_badlogin`;
    const { requestId, releaseId } = await seed(org);
    access.environments = env('not-the-password');
    const key = browserSvc.browserSessionKey({ orgId: org, missionRunId: 504 });

    const opened = await browserSvc.browserOpen(key, org, { releaseId, target: '/rename' }, deps());

    expect(opened).toMatchObject({ ok: false, refused: expect.stringContaining('signing in to relay-web-production as the QA account failed: still on the sign-in page after submitting ("Wrong email or password")') });
    expect(JSON.stringify(opened)).not.toContain('not-the-password');

    const session = browserSvc.browserSessionEvidence(key);
    const out = await recordLiveCheck(org, { releaseId, lines: lines([{ line: 1, result: 'not_seen', evidence: [opened.id!], why: 'QA could not sign in, so the rename page was never seen.' }]) }, { session: session.evidence, problems: session.problems, missionRunId: 504 });

    expect(out.verdict.line).toBe('Not seen live: QA could not sign in to the live product as its QA account');
    expect((await meta(releaseId)).liveWhy).toMatchObject({ kind: 'sign_in_failed' });
    expect((await meta(requestId)).liveCheck).toMatchObject({ state: 'not_seen' });
    expect(JSON.stringify(await meta(releaseId))).not.toContain('not-the-password');

    await browserSvc.closeBrowserSession(key);
  });

  it('records a feature demo in its own tab: each said line holds the screen, and the video is filed on that request alone with the lines as its script (2026-10-04)', { skip: !chromium, timeout: 120_000 }, async () => {
    const org = `${ORG}_browser_demo`;
    const { requestId, releaseId } = await seed(org);
    access.environments = env('fictional-secret');
    const key = browserSvc.browserSessionKey({ orgId: org, missionRunId: 511 });
    const store = await mkdtemp(path.join(tmpdir(), 'vocion-live-store-'));
    const videos = await mkdtemp(path.join(tmpdir(), 'vocion-live-video-'));
    const before = process.env.VOCION_ARTIFACTS_DIR;
    process.env.VOCION_ARTIFACTS_DIR = store;
    const dwelt: number[] = [];
    // The beats a person takes (after a page, after an action) are not a line's hold.
    const beats = new Set<number>(Object.values(HUMAN_BEATS));
    const held = () => dwelt.filter(ms => !beats.has(ms));
    const d = { ...deps(videos), dwell: async (ms: number) => {
      dwelt.push(ms);
    } };
    try {
      // The check tab first: a line said here is not the demo's, and holds nothing.
      const checked = await browserSvc.browserOpen(key, org, { releaseId, target: '/library' }, d);

      expect(checked.ok).toBe(true);
      expect(await browserSvc.browserSay(key, 'This is said in the check tab.', d)).toMatchObject({ ok: true, result: expect.stringContaining('not held') });
      expect(held()).toEqual([]);

      // A demo of a request the release did not ship is refused with the ones it did.
      expect(await browserSvc.browserOpen(key, org, { releaseId, target: '/rename', demoForRequest: requestId + 9_999 }, d)).toMatchObject({ ok: false, refused: expect.stringContaining(`not one this release shipped (#${requestId})`) });

      const opened = await browserSvc.browserOpen(key, org, { releaseId, target: '/rename', demoForRequest: requestId, say: 'I open the document to rename it.' }, d);

      expect(opened.ok).toBe(true);
      expect(held()).toHaveLength(1);

      await browserSvc.browserType(key, { ref: /textbox "Name" \[ref=(e\d+)\]/.exec(opened.snapshot ?? '')?.[1] ?? '', text: 'Q3 board deck', say: 'I type the new name, Q3 board deck.' }, d);
      const closing = await browserSvc.browserSay(key, 'Save is ready, and the document keeps its new name.', d);

      expect(closing).toMatchObject({ ok: true, result: expect.stringMatching(/^said, and held the screen \d+(\.\d)?s$/) });
      expect(held()).toHaveLength(3);
      expect(held().every(ms => ms >= 1_800 && ms <= 12_000)).toBe(true);

      await browserSvc.closeBrowserSession(key);

      const demos = await db.select().from(artifactSchema).where(and(eq(artifactSchema.orgId, org), eq(artifactSchema.recordRole, 'feature-demo')));

      // Filed on the request only, never the release, captioned as its demo.
      expect(demos.map(r => r.recordId)).toEqual([String(requestId)]);
      expect(demos[0]!.spec).toMatchObject({ contentType: 'video/webm', caption: expect.stringMatching(/^Feature demo of \S+, \d{4}-\d{2}-\d{2}$/) });

      // The script is what was said in the demo tab, in order, each with the time it takes to say.
      const script = (demos[0]!.spec as { script?: Array<{ atMs: number; endMs: number; text: string }> }).script ?? [];

      expect(script.map(l => l.text)).toEqual(['I open the document to rename it.', 'I type the new name, Q3 board deck.', 'Save is ready, and the document keeps its new name.']);
      expect(script.every((l, i) => l.atMs >= 0 && l.endMs > l.atMs && (i === 0 || l.atMs >= script[i - 1]!.atMs))).toBe(true);

      // The check tab's own recording is still the check's: on the request and the release, with no script.
      const checks = await db.select().from(artifactSchema).where(and(eq(artifactSchema.orgId, org), eq(artifactSchema.recordRole, 'qa-live-video')));

      expect(checks.map(r => r.recordId).sort()).toEqual([String(requestId), String(releaseId)].sort());
      expect((checks[0]!.spec as { script?: unknown }).script).toBeUndefined();
    } finally {
      if (before === undefined) {
        delete process.env.VOCION_ARTIFACTS_DIR;
      } else {
        process.env.VOCION_ARTIFACTS_DIR = before;
      }
      await rm(store, { recursive: true, force: true });
      await rm(videos, { recursive: true, force: true });
    }
  });

  it('records the pages QA drove and, when the run\'s browser closes, keeps the recording on the feature request and the release (2026-10-03)', { skip: !chromium, timeout: 120_000 }, async () => {
    const org = `${ORG}_browser_video`;
    const { requestId, releaseId } = await seed(org);
    access.environments = env('fictional-secret');
    const key = browserSvc.browserSessionKey({ orgId: org, missionRunId: 510 });
    const store = await mkdtemp(path.join(tmpdir(), 'vocion-live-store-'));
    const videos = await mkdtemp(path.join(tmpdir(), 'vocion-live-video-'));
    const before = process.env.VOCION_ARTIFACTS_DIR;
    process.env.VOCION_ARTIFACTS_DIR = store;
    try {
      const opened = await browserSvc.browserOpen(key, org, { releaseId, target: '/rename' }, deps(videos));

      expect(opened.ok).toBe(true);

      await browserSvc.browserType(key, { ref: /textbox "Name" \[ref=(e\d+)\]/.exec(opened.snapshot ?? '')?.[1] ?? '', text: 'Q3 board deck' }, deps(videos));
      await browserSvc.closeBrowserSession(key);

      const rows = await db.select().from(artifactSchema).where(and(eq(artifactSchema.orgId, org), eq(artifactSchema.recordRole, 'qa-live-video')));

      // One recording (the page QA drove, never the sign-in page), filed on the request and the release.
      expect(rows.map(r => r.recordId).sort()).toEqual([String(requestId), String(releaseId)].sort());
      expect(new Set(rows.map(r => r.url)).size).toBe(1);
      expect(rows[0]).toMatchObject({ kind: 'file', url: expect.stringMatching(new RegExp(`^/api/media/${releaseId}/live-check-desktop-1-[0-9a-f]{16}\\.webm$`)) });
      expect(rows[0]!.spec).toMatchObject({ contentType: 'video/webm', caption: expect.stringMatching(/^Live check of \S+, \d{4}-\d{2}-\d{2}$/) });

      // What QA did while it ran, timed from the video's start, for a narration to follow.
      const timeline = (rows[0]!.spec as { timeline?: Array<{ atMs: number; what: string }> }).timeline ?? [];

      expect(timeline.some(m => /^open \/rename/.test(m.what))).toBe(true);
      expect(timeline.every(m => m.atMs >= 0)).toBe(true);

      const file = path.join(store, 'media', org, String(releaseId), rows[0]!.url!.split('/').pop()!);

      expect((await stat(file)).size).toBeGreaterThan(1000);
      // The raw videos, the sign-in page's among them, go with the session.
      expect(await readdir(videos).catch(() => [])).toEqual([]);
    } finally {
      if (before === undefined) {
        delete process.env.VOCION_ARTIFACTS_DIR;
      } else {
        process.env.VOCION_ARTIFACTS_DIR = before;
      }
      await rm(store, { recursive: true, force: true });
      await rm(videos, { recursive: true, force: true });
    }
  });
});

describe('when QA\'s fire ends', () => {
  it('asks for the one retry carrying the reason; a round that wrote no report is not checked, never "not seen" (FE-419)', async () => {
    const org = `${ORG}_ended`;
    const { requestId, releaseId } = await seed(org);
    const fire = async (attempt: number) => (await db.insert(automationRunSchema).values({ orgId: org, slug: 'release-live-check', kind: 'mission', status: 'completed', input: { releaseId, attempt }, error: 'the agent stopped' }).returning())[0]!.id;

    const first = await liveCheckEnded(org, { automationRunId: await fire(1), attempts: 2 });

    expect(first).toEqual({ releaseId, did: 'retry:2', line: 'the agent stopped' });

    const second = await liveCheckEnded(org, { automationRunId: await fire(2), attempts: 2 });

    expect(second).toEqual({ releaseId, did: 'gave-up', line: 'the agent stopped' });
    expect(await meta(releaseId)).toMatchObject({ liveState: 'not_checked', liveSummary: 'Couldn\'t check live yet: the agent stopped. Vocion will check again.', liveWhy: { kind: 'not_checked', detail: 'the agent stopped' } });
    expect((await meta(requestId)).liveCheck).toMatchObject({ state: 'not_checked', line: 'Couldn\'t check live yet: the agent stopped. Vocion will check again.', releaseId, attempts: 0, lastReason: 'the agent stopped', why: { kind: 'not_checked', detail: 'the agent stopped' } });
  });

  it('a line the check reached and found wrong sends the feature back through its loop, once per release (FE-457, 2026-10-05)', async () => {
    const org = `${ORG}_sent_back`;
    const { requestId, releaseId } = await seed(org, [{ statement: 'A blank name is not saved.' }, { statement: 'The owner is never asked for the passcode.' }]);
    await db.update(businessObjectSchema).set({ metadata: { state: 'shipped', shippedAt: '2026-10-05T04:07:00Z', acceptance: [{ statement: 'A blank name is not saved.' }, { statement: 'The owner is never asked for the passcode.' }] } }).where(eq(businessObjectSchema.id, requestId));
    const [run] = await db.insert(automationRunSchema).values({ orgId: org, slug: 'release-live-check', kind: 'mission', status: 'completed', input: { releaseId, attempt: 2 } }).returning();
    await recordLiveCheck(org, { releaseId, lines: lines([
      { line: 1, result: 'seen', evidence: ['shot-7'], why: 'Save stayed disabled while the name was blank.' },
      { line: 2, result: 'not_seen', evidence: ['shot-7'], why: 'The owner, signed in, got the passcode prompt on their own link.' },
    ]) }, { session: new Map([['shot-7', shotEvidence(7)]]) });
    proposed.length = 0;

    const out = await liveCheckEnded(org, { automationRunId: run!.id, attempts: 2 });

    expect(out.did).toBe('done');
    expect(out.line).toContain(`sent back #${requestId}`);
    const m = await meta(requestId);

    expect(m.liveCheck).toMatchObject({ state: 'partial', sentBackFor: releaseId });
    expect(m.reopenedBy).toBe('live-check');
    expect(m.reopenReason).toMatch(/^Seen live and sent back: The owner is never asked for the passcode\. — The owner, signed in/);
    expect(proposed).toHaveLength(1);
    expect(proposed[0]).toMatchObject({ actionId: 'factory.dispatch_task', invokedBy: 'factory:live-check', internal: true });
    expect(proposed[0]!.input).toMatchObject({ requestId, trigger: 'recovery', recoveryClass: 'not_seen_live' });
    expect(String((proposed[0]!.input as Record<string, unknown>).note)).toContain('line 2: "The owner is never asked for the passcode." — The owner, signed in, got the passcode prompt on their own link.');

    // The same release's end heard again starts nothing twice.
    expect(await liveCheckEnded(org, { automationRunId: run!.id, attempts: 2 })).toMatchObject({ did: 'done' });
    expect(proposed).toHaveLength(1);
  });

  it('a check that ran and recorded what failed stays "not seen" when its fire ends', async () => {
    const org = `${ORG}_ended_recorded`;
    const { requestId, releaseId } = await seed(org);
    const [run] = await db.insert(automationRunSchema).values({ orgId: org, slug: 'release-live-check', kind: 'mission', status: 'completed', input: { releaseId, attempt: 2 } }).returning();
    await recordLiveCheck(org, { releaseId, lines: lines([{ line: 1, result: 'not_seen', evidence: ['shot-7'], why: 'The blank name was saved.' }]) }, { session: new Map([['shot-7', shotEvidence(7)]]) });

    await liveCheckEnded(org, { automationRunId: run!.id, attempts: 2 });

    expect((await meta(requestId)).liveCheck).toMatchObject({ state: 'not_seen', releaseId });
    expect((await meta(releaseId)).liveState).toBe('not_seen');
  });
});

describe('a live check that never looked is checked again by Vocion (FE-419)', () => {
  const hour = 3_600_000;
  const rechecks = async (org: string, releaseId: number) => (await db.select().from(eventLogSchema).where(and(eq(eventLogSchema.orgId, org), eq(eventLogSchema.type, 'release.live_check.requested'))))
    .filter(e => (e.payload as { releaseId: number }).releaseId === releaseId);
  const setMeta = async (id: number, m: Record<string, unknown>) => db.update(businessObjectSchema).set({ metadata: { ...(await meta(id)), ...m } }).where(eq(businessObjectSchema.id, id));
  const deploy = (org: string, at: Date, sha: string) => db.insert(workspaceVersionSchema).values({ orgId: org, sha, status: 'applied', appliedAt: at });

  it('re-runs the check once per deploy, through the event a live check starts with, with the count and reason on the feature', async () => {
    const org = `${ORG}_recheck_deploy`;
    const { requestId, releaseId } = await seed(org);
    const now = new Date();
    await setMeta(requestId, { liveCheck: { state: 'not_checked', line: 'x', releaseId, checkedAt: new Date(now.getTime() - 2 * hour).toISOString(), attempts: 0, lastReason: 'the run wrote no report', why: { kind: 'not_checked', detail: 'the run wrote no report' } } });
    await deploy(org, new Date(now.getTime() - hour), 'local-a1');

    const out = await recheckNeverLooked(org, now);

    expect(out).toEqual([expect.objectContaining({ requestId, did: 'live recheck 1' })]);

    const events = await rechecks(org, releaseId);

    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ releaseId, product: 'relay', userFacing: true, attempt: 2, requestIds: [requestId] });
    expect(String((events[0]!.payload as { lastFailure: string }).lastFailure)).toContain('the run wrote no report');

    const mark = (await meta(requestId)).liveCheck;

    expect(mark).toMatchObject({ state: 'not_checked', attempts: 1, lastReason: 'the run wrote no report', recheckedFor: expect.stringMatching(/^deploy \d+$/) });
    expect(mark.line).toContain('Vocion is checking again');

    // The same deploy never starts a second one, and neither does the delay while one runs.
    expect(await recheckNeverLooked(org, new Date(now.getTime() + hour))).toEqual([]);
    expect(await rechecks(org, releaseId)).toHaveLength(1);
  });

  it('picks up a feature stamped "not seen" before this state existed, when its release recorded no check', async () => {
    const org = `${ORG}_recheck_legacy`;
    const { requestId, releaseId } = await seed(org);
    const now = new Date();
    const old = new Date(now.getTime() - 3 * hour).toISOString();
    await setMeta(releaseId, { liveState: 'not_seen', liveSummary: 'Not seen live: QA could not reach the change on the live product. Why: no report', liveReason: 'no report', liveCheckedAt: old, liveProblems: ['no report'] });
    await setMeta(requestId, { liveCheck: { state: 'not_seen', line: 'Not seen live: QA could not reach the change on the live product. Why: no report', releaseId, checkedAt: old } });
    await deploy(org, new Date(now.getTime() - hour), 'local-b2');

    expect(await recheckNeverLooked(org, now)).toEqual([expect.objectContaining({ requestId, did: 'live recheck 1' })]);
    expect((await meta(requestId)).liveCheck).toMatchObject({ state: 'not_checked', attempts: 1 });
  });

  it('checks once by itself a while after the round, with no deploy', async () => {
    const org = `${ORG}_recheck_delay`;
    const { requestId, releaseId } = await seed(org);
    const now = new Date();
    await setMeta(requestId, { liveCheck: { state: 'not_checked', line: 'x', releaseId, checkedAt: new Date(now.getTime() - 5 * 60_000).toISOString(), attempts: 0, lastReason: 'no report' } });

    expect(await recheckNeverLooked(org, now)).toEqual([]);
    expect(await recheckNeverLooked(org, new Date(now.getTime() + 20 * 60_000))).toEqual([expect.objectContaining({ requestId, did: 'live recheck 1' })]);
    expect(await recheckNeverLooked(org, new Date(now.getTime() + 2 * hour))).toEqual([]);
    expect((await meta(requestId)).liveCheck).toMatchObject({ recheckedFor: 'delay', attempts: 1 });
  });

  it('respects the cap: after three rechecks it asks the person once, and starts nothing', async () => {
    const org = `${ORG}_recheck_cap`;
    const { requestId, releaseId } = await seed(org);
    const now = new Date();
    await setMeta(requestId, { liveCheck: { state: 'not_checked', line: 'x', releaseId, checkedAt: new Date(now.getTime() - 2 * hour).toISOString(), attempts: 3, lastReason: 'no report', recheckedFor: 'deploy 1' } });
    await deploy(org, new Date(now.getTime() - hour), 'local-c3');

    expect(await recheckNeverLooked(org, now)).toEqual([]);
    expect(await rechecks(org, releaseId)).toHaveLength(0);

    // The round that ends after the third recheck says so, and asks once.
    const [run] = await db.insert(automationRunSchema).values({ orgId: org, slug: 'release-live-check', kind: 'mission', status: 'completed', input: { releaseId, attempt: 2 }, error: 'no report' }).returning();
    await liveCheckEnded(org, { automationRunId: run!.id, attempts: 2 });

    expect((await meta(requestId)).liveCheck.line).toBe('Couldn\'t check live: no report. Vocion checked again 3 times by itself and none recorded a report; press Check live again once what stops it is fixed.');
  });

  it('never re-runs a genuine "not seen": the check ran and recorded what failed', async () => {
    const org = `${ORG}_recheck_genuine`;
    const { requestId, releaseId } = await seed(org);
    await recordLiveCheck(org, { releaseId, lines: lines([{ line: 1, result: 'not_seen', evidence: ['shot-7'], why: 'The blank name was saved.' }]) }, { session: new Map([['shot-7', shotEvidence(7)]]) });
    const now = new Date(Date.now() + 2 * hour);
    await deploy(org, new Date(now.getTime() - 60_000), 'local-d4');

    expect((await meta(requestId)).liveCheck.state).toBe('not_seen');
    expect(await recheckNeverLooked(org, now)).toEqual([]);
    expect(await rechecks(org, releaseId)).toHaveLength(0);
  });
});
