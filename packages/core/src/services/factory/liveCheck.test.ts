import type { Buffer } from 'node:buffer';
import type { Server } from 'node:http';
import type { Browser } from 'playwright';
import type { EnvironmentAccess } from './productAccess';
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LiveFlowSchema } from '@/libs/factory/liveCheck';

vi.mock('@/libs/DB');

// The product's production access, as the vault would reveal it to the check
// (and never to the agent): set per test.
const access: { environments: EnvironmentAccess[] } = { environments: [] };
vi.mock('@/services/factory/productAccess', () => ({
  productAccess: async (_org: string, product: string) => ({ product, environments: access.environments }),
}));

const { db } = await import('@/libs/DB');
const { artifactSchema, automationRunSchema, businessObjectSchema } = await import('@/models/Schema');
const { createObjectType } = await import('@/services/BusinessObjectService');
const { and, eq } = await import('drizzle-orm');
const { allowedOrigins, environmentFor, liveCheckEnded, runLiveCheck } = await import('./liveCheck');

const ORG = 'org_live_check';
const flows = (raw: unknown[]) => raw.map(f => LiveFlowSchema.parse(f));
const author = { kind: 'agent' as const, id: 'agent:change-reviewer' };

const ONE_LINE = [{ statement: 'Under the title, a line says when the document was last opened.' }];

async function seed(orgId: string, acceptance: unknown[] = ONE_LINE) {
  const [reqType] = await createObjectType({ slug: 'request', label: 'Request' }, orgId);
  const [relType] = await createObjectType({ slug: 'release', label: 'Release' }, orgId);
  const [request] = await db.insert(businessObjectSchema).values({ orgId, typeId: reqType!.id, title: 'Show when a document was last opened', status: 'active', metadata: { state: 'shipped', acceptance } }).returning();
  const [release] = await db.insert(businessObjectSchema).values({ orgId, typeId: relType!.id, title: 'relay 930a23f', status: 'active', metadata: { product: 'relay', releasedAt: '2026-10-01T09:00:00Z', requestIds: [request!.id], taskIds: [] } }).returning();
  return { requestId: request!.id, releaseId: release!.id };
}

async function meta(id: number) {
  const [r] = await db.select({ meta: businessObjectSchema.metadata }).from(businessObjectSchema).where(eq(businessObjectSchema.id, id));
  return (r?.meta ?? {}) as Record<string, any>;
}

describe('where a flow runs, and where it may go', () => {
  const envs: EnvironmentAccess[] = [
    { slug: 'relay-marketing-production', surface: 'marketing', url: 'https://relay.example', login: null, liveSetup: null },
    { slug: 'relay-web-production', surface: 'web', url: 'https://app.relay.example', login: { signInUrl: 'https://auth.relay.example/sign-in', email: 'qa@relay.example', stored: true }, liveSetup: null },
  ];

  it('runs on the surface a flow names, else where the QA sign-in is', () => {
    expect(environmentFor({ surface: 'marketing' }, envs)?.slug).toBe('relay-marketing-production');
    expect(environmentFor({}, envs)?.slug).toBe('relay-web-production');
    expect(environmentFor({ surface: 'api' }, envs)).toBeNull();
  });

  it('opens only the product\'s own origins and its sign-in page', () => {
    expect([...allowedOrigins(envs)].sort()).toEqual(['https://app.relay.example', 'https://auth.relay.example', 'https://relay.example']);
  });
});

describe('the live check, end to end in a real browser against a fictional product', async () => {
  let chromium: typeof import('playwright').chromium | null = null;
  try {
    const pw = await import('playwright');
    const b = await pw.chromium.launch();
    await b.close();
    chromium = pw.chromium;
  } catch {
    chromium = null;
  }

  // A product with a sign-in page, an upload, a document page whose line
  // says when it was last opened, a share link a visitor opens, and a delete
  // that asks first. The QA account starts with nothing, as on production.
  const docs = new Map<string, { views: number }>();
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
      const send = (html: string) => res.end(`<!doctype html><body style="font:16px sans-serif">${html}</body>`);
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
      if (url.pathname.startsWith('/s/')) {
        const doc = docs.get(url.pathname.slice(3));
        if (doc && !signedIn) {
          doc.views += 1;
        }
        return send(doc ? '<p>Page 1 of 1</p>' : '<p>This link does not exist.</p>');
      }
      if (!signedIn) {
        res.writeHead(302, { location: '/sign-in' });
        return res.end();
      }
      if (url.pathname === '/new') {
        return send(`<label>Title <input id="t"></label><input type="file" onchange="fetch('/api/upload',{method:'POST'}).then(r=>r.text()).then(id=>location.href='/documents/'+id)">`);
      }
      if (url.pathname === '/new-broken') {
        return send('<input type="file"><p>Something went wrong on our end. Try again in a moment.</p>');
      }
      // A page that loads its list from the API, and the API: 200 signed in, 500 when it is broken.
      if (url.pathname === '/library') {
        return send(`<ul id="l"></ul><script>fetch('/api/docs'+location.search).then(r=>r.ok?r.json():[]).then(d=>{document.getElementById('l').innerHTML=d.length?'<li>'+d.length+' documents</li>':'<li>Could not load</li>'})</script>`);
      }
      if (url.pathname === '/api/docs') {
        res.statusCode = url.searchParams.has('broken') ? 500 : 200;
        res.setHeader('content-type', 'application/json');
        return res.end(res.statusCode === 200 ? '[{"title":"Q3 board deck"}]' : '{"error":"engine"}');
      }
      if (url.pathname === '/api/upload') {
        const id = `d${docs.size + 1}`;
        docs.set(id, { views: 0 });
        return res.end(id);
      }
      if (url.pathname.startsWith('/documents/')) {
        const id = url.pathname.split('/')[2]!;
        const doc = docs.get(id);
        if (url.searchParams.has('delete')) {
          docs.delete(id);
          res.writeHead(302, { location: '/' });
          return res.end();
        }
        return send(doc
          ? `<h1>Q3 board deck</h1><p>${doc.views ? 'Last opened just now' : 'Not opened yet'}</p><a href="/s/${id}">Open as a viewer</a><button onclick="if(confirm('Delete?'))location.href='?delete=1'">Delete document</button>`
          : '<p>This document does not exist.</p>');
      }
      return send(`<p>${docs.size ? `${docs.size} documents` : 'Nothing here yet'}</p>`);
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser?.close();
    server?.close();
  });

  const theFlows = () => flows([
    { name: 'upload a document', phase: 'setup', path: '/new', steps: [
      { fill: { selector: '#t', value: 'Vocion live check' } },
      { upload: { selector: 'input[type=file]', megabytes: 0.001, name: 'vocion-live-check.pdf' } },
      { wait_for: 'Not opened yet' },
      { remember: { name: 'documentUrl' } },
      { remember: { name: 'shareUrl', from: 'href', selector: 'Open as a viewer' } },
    ] },
    { name: 'open it once as a visitor', phase: 'setup', signed_in: false, path: '{{shareUrl}}', steps: [{ wait_for: 'Page 1 of 1' }, { pause: 0 }] },
    { name: 'Last opened line', phase: 'check', line: 1, path: '{{documentUrl}}', steps: [{ wait_for: 'Last opened' }, { shoot: 'Last opened line under the title' }] },
    { name: 'delete it', phase: 'cleanup', path: '{{documentUrl}}', steps: [{ click: 'Delete document' }, { wait_for: 'Nothing here yet' }] },
  ]);
  const deps = () => ({
    browser: async () => browser!,
    store: async (_org: string, png: Buffer) => ({ url: `/api/artifacts/files/live-${png.length}.png`, filename: `live-${png.length}.png`, bytes: png.length, contentType: 'image/png' }),
  });

  it('a check opens the page setup ended on as {{setupPage}} (run 3, 2026-10-01)', { skip: !chromium, timeout: 120_000 }, async () => {
    const org = `${ORG}_setup_page`;
    const { releaseId } = await seed(org);
    access.environments = [{ slug: 'relay-web-production', surface: 'web', url: base, login: { signInUrl: `${base}/sign-in`, email: 'qa@relay.example', password: 'fictional-secret', stored: true }, liveSetup: null }];

    const out = await runLiveCheck(org, { releaseId, flows: flows([
      { name: 'upload a document', phase: 'setup', path: '/new', steps: [{ upload: { selector: 'input[type=file]', megabytes: 0.001, name: 'vocion-live-check.pdf' } }, { wait_for: 'Not opened yet' }] },
      { name: 'Not opened line', phase: 'check', line: 1, path: '{{setupPage}}', steps: [{ wait_for: 'Not opened yet' }, { shoot: 'The line under the title' }] },
      { name: 'delete it', phase: 'cleanup', path: '{{setupPage}}', steps: [{ click: 'Delete document' }, { wait_for: 'Nothing here yet' }] },
    ]) }, { author }, deps());

    expect(out.verdict).toMatchObject({ state: 'seen' });
    expect(out.runs.find(r => r.phase === 'check')!.shots[0]!.at).toMatch(/^\/documents\/d\d+$/);
    expect(docs.size).toBe(0);
  });

  it('a setup whose upload failed does not remember the upload page as the record, and no check runs on it (run 3)', { skip: !chromium, timeout: 120_000 }, async () => {
    const org = `${ORG}_setup_stuck`;
    const { releaseId } = await seed(org);
    access.environments = [{ slug: 'relay-web-production', surface: 'web', url: base, login: { signInUrl: `${base}/sign-in`, email: 'qa@relay.example', password: 'fictional-secret', stored: true }, liveSetup: null }];

    const out = await runLiveCheck(org, { releaseId, flows: flows([
      { name: 'upload a document', phase: 'setup', path: '/new-broken', steps: [{ upload: { selector: 'input[type=file]', megabytes: 0.001, name: 'vocion-live-check.pdf' } }, { pause: 1 }, { remember: { name: 'recordUrl' } }] },
      { name: 'Last opened line', phase: 'check', line: 1, path: '{{recordUrl}}', steps: [{ wait_for: 'Last opened' }, { shoot: 'Last opened line' }] },
    ]) }, { author }, deps());

    expect(out.verdict.state).toBe('not_seen');
    expect(out.runs[0]).toMatchObject({ phase: 'setup', ok: false });
    expect(out.runs[0]!.failure).toMatch(/the page never left \/new-broken, where this flow started/);
    // The check never opened the upload page as if it were the record.
    expect(out.runs[1]!.shots).toEqual([]);
  });

  it('prepares its own state as the QA account, sees the change, cleans up, and writes it on the release and the feature', { skip: !chromium, timeout: 120_000 }, async () => {
    const org = `${ORG}_e2e`;
    const { requestId, releaseId } = await seed(org);
    access.environments = [{ slug: 'relay-web-production', surface: 'web', url: base, login: { signInUrl: `${base}/sign-in`, email: 'qa@relay.example', password: 'fictional-secret', stored: true }, liveSetup: null }];

    const out = await runLiveCheck(org, { releaseId, flows: theFlows() }, { author }, deps());

    expect(out.verdict).toMatchObject({ state: 'seen', line: 'Seen live: 1 of 1 state reached' });
    expect(out.problems).toEqual([]);
    expect(out.runs.map(r => [r.phase, r.flow, r.ok])).toEqual([['setup', 'upload a document', true], ['setup', 'open it once as a visitor', true], ['check', 'Last opened line', true], ['cleanup', 'delete it', true]]);
    // Cleaned up: nothing the check made is left on the product.
    expect(docs.size).toBe(0);
    // The password reached the browser and nothing else.
    expect(JSON.stringify(out)).not.toContain('fictional-secret');

    const rel = await meta(releaseId);

    expect(rel).toMatchObject({ liveState: 'seen', liveSummary: 'Seen live: 1 of 1 state reached', liveAttempts: 1, liveProblems: [] });
    expect(rel.liveEvidence).toHaveLength(1);

    const shotId = rel.liveEvidence[0].artifactId as number;

    expect(rel.announcementImageArtifactId).toBe(shotId);

    const [shot] = await db.select().from(artifactSchema).where(and(eq(artifactSchema.orgId, org), eq(artifactSchema.id, shotId)));

    expect(shot).toMatchObject({ recordType: 'object', recordId: String(releaseId), recordRole: 'live-screenshot', kind: 'file' });
    expect((shot!.spec as Record<string, unknown>).caption).toBe('Under the title, a line says when the document was last opened.');

    const req = await meta(requestId);

    expect(req.liveCheck).toMatchObject({ state: 'seen', releaseId, attempt: 1 });
    expect(req.liveCheck.flows).toHaveLength(4);
    expect(req.visuals.afterArtifactIds).toEqual([shotId]);
  });

  it('says it could not reach the change when setup cannot sign in, writes nothing as seen, and still never leaks the password', { skip: !chromium, timeout: 120_000 }, async () => {
    const org = `${ORG}_badlogin`;
    const { requestId, releaseId } = await seed(org);
    access.environments = [{ slug: 'relay-web-production', surface: 'web', url: base, login: { signInUrl: `${base}/sign-in`, email: 'qa@relay.example', password: 'not-the-password', stored: true }, liveSetup: null }];

    const out = await runLiveCheck(org, { releaseId, flows: theFlows() }, { author }, deps());

    expect(out.verdict.state).toBe('not_seen');
    // Said in a sentence from the reason's kind; the check's own words are the detail, one click away.
    expect(out.verdict.line).toBe('Not seen live: QA could not sign in to the live product as its QA account');
    expect(out.verdict.why).toMatchObject({ kind: 'sign_in_failed', flow: 'upload a document' });
    expect(out.verdict.reason).toMatch(/^setup "upload a document" \(desktop\) did not finish: signing in to relay-web-production as the QA account failed: still on the sign-in page after submitting \("Wrong email or password"\)/);
    expect((await meta(releaseId)).liveWhy).toMatchObject({ kind: 'sign_in_failed' });
    expect(JSON.stringify(out)).not.toContain('not-the-password');
    expect((await meta(releaseId)).liveState).toBe('not_seen');
    expect((await meta(requestId)).liveCheck).toMatchObject({ state: 'not_seen' });
  });

  // FE-314 / REL-347 (2026-10-02), fictional: one line production can show (the API answers 200
  // signed in), one only CI could (proven before the merge). QA cites lines by number.
  const API_LINES = [
    { statement: 'CI builds the image three times without exit 132.', met: true, evidence: 'Named test passed: https://ci.example/run/7' },
    { statement: 'After deploy, GET /api/docs with a signed-in session returns 200.' },
  ];
  const apiCheck = (path: string) => flows([{ name: 'documents list', line: 2, criterion: 'A visitor can download the shared file', path, steps: [{ expect_response: { path: '/api/docs', status: 200 } }, { shoot: 'The documents list' }] }]);

  it('proves an API line with a check flow alone: Seen live, with what the API answered, and the line production cannot show proven before merge', { skip: !chromium, timeout: 120_000 }, async () => {
    const org = `${ORG}_api`;
    const { requestId, releaseId } = await seed(org, API_LINES);
    access.environments = [{ slug: 'relay-web-production', surface: 'web', url: base, login: { signInUrl: `${base}/sign-in`, email: 'qa@relay.example', password: 'fictional-secret', stored: true }, liveSetup: null }];

    const out = await runLiveCheck(org, { releaseId, flows: apiCheck('/library'), notObservable: [{ line: 1, why: 'a CI run' }] }, { author }, deps());

    expect(out.runs.map(r => r.phase)).toEqual(['check']);
    expect(out.verdict).toMatchObject({ state: 'seen', line: 'Seen live: 1 of 1 state reached (GET /api/docs returned 200 signed in). 1 more line proven before merge by QA\'s verdict' });

    const rel = await meta(releaseId);

    // The words are the record's, never the flow's.
    expect(rel.liveEvidence[0]).toMatchObject({ line: 2, criterion: 'After deploy, GET /api/docs with a signed-in session returns 200.', status: 'reached', proved: ['GET /api/docs returned 200 signed in'] });
    expect(rel.liveBeforeMerge).toEqual([{ requestId, line: 1, text: 'CI builds the image three times without exit 132.', why: 'a CI run', proven: true }]);

    const [shot] = await db.select().from(artifactSchema).where(and(eq(artifactSchema.orgId, org), eq(artifactSchema.id, rel.liveEvidence[0].artifactId)));

    expect((shot!.spec as Record<string, unknown>).caption).toBe('After deploy, GET /api/docs with a signed-in session returns 200. (GET /api/docs returned 200 signed in)');
    expect((await meta(requestId)).liveCheck).toMatchObject({ state: 'seen', beforeMerge: [{ line: 1, proven: true }] });
  });

  it('says what the API answered when it broke its promise', { skip: !chromium, timeout: 120_000 }, async () => {
    const org = `${ORG}_api_broken`;
    const { releaseId } = await seed(org, API_LINES);
    access.environments = [{ slug: 'relay-web-production', surface: 'web', url: base, login: { signInUrl: `${base}/sign-in`, email: 'qa@relay.example', password: 'fictional-secret', stored: true }, liveSetup: null }];

    const out = await runLiveCheck(org, { releaseId, flows: apiCheck('/library?broken=1'), notObservable: [{ line: 1, why: 'a CI run' }] }, { author }, deps());

    expect(out.verdict.state).toBe('not_seen');
    expect(out.verdict.line).toBe('Not seen live: QA reached the page, but the API did not answer as promised: GET /api/docs returned 500, not 200. 1 more line proven before merge by QA\'s verdict');
  });

  it('explores without writing, and refuses an address that is not the product\'s', { skip: !chromium, timeout: 120_000 }, async () => {
    const org = `${ORG}_explore`;
    const { releaseId } = await seed(org);
    access.environments = [{ slug: 'relay-web-production', surface: 'web', url: base, login: { signInUrl: `${base}/sign-in`, email: 'qa@relay.example', password: 'fictional-secret', stored: true }, liveSetup: null }];

    const out = await runLiveCheck(org, { releaseId, explore: true, flows: flows([
      { name: 'library', path: '/', steps: [{ shoot: 'library' }] },
      { name: 'elsewhere', path: '/', steps: [{ goto: 'http://169.254.169.254/latest/meta-data' }] },
    ]) }, { author }, deps());

    expect(out.written).toBe('nothing written: this was an exploring run');
    expect(out.runs[0]!.shots[0]!.pageText).toContain('Nothing here yet');
    expect(out.runs[1]!.failure).toMatch(/not one of the product's own addresses/);
    expect((await meta(releaseId)).liveState).toBeUndefined();
    expect(await db.select().from(artifactSchema).where(eq(artifactSchema.orgId, org))).toEqual([]);
  });
});

describe('a line the feature never promised', () => {
  it('is refused before anything runs, with the request\'s lines listed by number, and nothing is written', async () => {
    const org = `${ORG}_refused`;
    const { requestId, releaseId } = await seed(org);
    access.environments = [];

    const out = await runLiveCheck(org, { releaseId, flows: flows([{ name: 'visitor download', line: 4, path: '/' }]) }, { author });

    expect(out.refused).toBe(`check flow "visitor download" cites line 4 of request #${requestId}, which has 1.\nrequest #${requestId}'s acceptance lines:\n  1. Under the title, a line says when the document was last opened.\nCite a line by its number (line: n, with request_id when the release shipped more than one request), and name the lines the live product cannot show in not_observable.`);
    expect(out.acceptance).toEqual([{ requestId, lines: [{ n: 1, text: 'Under the title, a line says when the document was last opened.', provenBeforeMerge: false }] }]);
    expect(out.runs).toEqual([]);
    expect((await meta(releaseId)).liveState).toBeUndefined();
    expect((await meta(releaseId)).liveAttempts).toBeUndefined();
  });
});

describe('without a product to check', () => {
  it('says why on the release instead of passing', async () => {
    const org = `${ORG}_noenv`;
    const { releaseId } = await seed(org);
    access.environments = [];

    const out = await runLiveCheck(org, { releaseId, flows: flows([{ name: 'line', line: 1, path: '/' }]) }, { author });

    expect(out.verdict.line).toBe('Not seen live: QA could not reach the change on the live product. Why: no production environment is recorded for relay; an environment record names its product, stage, url and QA sign-in');
    expect((await meta(releaseId)).liveState).toBe('not_seen');
  });
});

describe('when QA\'s fire ends', () => {
  it('asks for the one retry carrying the reason, then writes "could not reach the change" on the release and the feature', async () => {
    const org = `${ORG}_ended`;
    const { requestId, releaseId } = await seed(org);
    const fire = async (attempt: number) => (await db.insert(automationRunSchema).values({ orgId: org, slug: 'release-live-check', kind: 'mission', status: 'completed', input: { releaseId, attempt }, error: 'the agent stopped' }).returning())[0]!.id;

    const first = await liveCheckEnded(org, { automationRunId: await fire(1), attempts: 2 });

    expect(first).toEqual({ releaseId, did: 'retry:2', line: 'the agent stopped' });

    const second = await liveCheckEnded(org, { automationRunId: await fire(2), attempts: 2 });

    expect(second).toEqual({ releaseId, did: 'gave-up', line: 'the agent stopped' });
    expect(await meta(releaseId)).toMatchObject({ liveState: 'not_seen', liveSummary: 'Not seen live: QA could not reach the change on the live product. Why: the agent stopped' });
    expect((await meta(requestId)).liveCheck).toMatchObject({ state: 'not_seen', line: 'Not seen live: QA could not reach the change on the live product. Why: the agent stopped', releaseId });
  });
});
