import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
// node --test packages/runner/src/qa.test.mjs
// The pure parts of the QA evidence pass: what a before shot loads, what the artifacts look like,
// what the report says when nothing was captured, and whether the presigned url is a real SigV4.
import { describe, it } from 'node:test';
import {
  buildSurface,
  caption,
  captionForShotFile,
  captionForVideoFile,
  captureEvidence,
  collectRepoTestShots,
  collectRepoTestVideos,
  detectErrorState,
  duplicateOf,
  ERROR_STATE_PATTERNS,
  errorPatternsFor,
  evidenceKey,
  evidenceTitle,
  excludeShotsDir,
  findPlaceholder,
  firstListItemHref,
  hasPlaceholder,
  isSelector,
  LIST_ROUTE_FALLBACKS,
  listRoutesFor,
  otherTasksShots,
  pageAt,
  PLACEHOLDER_SEGMENT_RE,
  presignGet,
  productionBase,
  qaReportMarkdown,
  reportArtifact,
  resolveRoutePlaceholders,
  screenshotArtifact,
  shotNote,
  signPut,
  stepFailureText,
  stepTarget,
  substitutePlaceholder,
  surfaceOf,
  videoArtifact,
  VIEWPORTS,
} from './qa.mjs';

/**
 * A Playwright page double: `routes` maps a pathname to the hrefs its anchors hold (`undefined` for
 * a path that 404s, `[]` for a page with none). Enough to drive firstListItemHref /
 * resolveRoutePlaceholders without a browser.
 */
function fakePage(routes, { text = '' } = {}) {
  let current = null;
  return {
    async goto(url) {
      current = new URL(url).pathname;
      if (!(current in routes)) {
        return null;
      }
      return { ok: () => true };
    },
    async waitForLoadState() {},
    async $$eval(_selector, fn) {
      const hrefs = routes[current] || [];
      return fn(hrefs.map(h => ({ getAttribute: () => h })));
    },
    async evaluate() {
      return text;
    },
  };
}

const MIDDOT = String.fromCharCode(0xB7);

describe('where a before shot comes from', () => {
  const surfaces = { app: { live_url: 'https://app.northwind.example/' }, marketing: { live_url: 'https://northwind.example' } };

  it('reads the live URL of the surface the contract names, from the contract', () => {
    assert.equal(productionBase({ surface: 'app', surfaces }), 'https://app.northwind.example');
    assert.equal(productionBase({ surface: 'marketing', surfaces }), 'https://northwind.example');
    assert.equal(productionBase({ surfaces }), 'https://app.northwind.example');
    // Nothing about a product is in the runner: no surfaces, no live URL.
    assert.equal(productionBase({ surface: 'app' }), '');
    assert.deepEqual(surfaceOf({ surface: 'admin', surfaces }), {});
  });

  it('lets the contract override it, without a trailing slash', () => {
    assert.equal(productionBase({ surface: 'app', surfaces, before_url: 'https://staging.northwind.example/' }), 'https://staging.northwind.example');
  });

  it('draws desktop at 1440 and phone at 390 with touch', () => {
    assert.equal(VIEWPORTS.desktop.width, 1440);
    assert.equal(VIEWPORTS.phone.width, 390);
    assert.equal(VIEWPORTS.phone.hasTouch, true);
    assert.equal(VIEWPORTS.desktop.hasTouch, false);
  });
});

describe('captions and keys', () => {
  it('captions every shot "<flow> - <viewport> - <side>"', () => {
    assert.equal(caption('document page', 'phone', 'before'), `document page ${MIDDOT} phone ${MIDDOT} before`);
    assert.equal(caption('document page', 'desktop', 'after'), `document page ${MIDDOT} desktop ${MIDDOT} after`);
  });

  it('puts the reason for an absence after the caption, not instead of it', () => {
    assert.equal(caption('new page', 'desktop', 'before', 'New surface, nothing to compare'), `new page ${MIDDOT} desktop ${MIDDOT} before: New surface, nothing to compare`);
  });

  it('keeps the gallery heading inside 100 characters', () => {
    assert.ok(evidenceTitle('x'.repeat(200), 'desktop', 'before').length <= 100);
  });

  it('stores one prefix per run, so a second attempt never overwrites the first', () => {
    assert.equal(evidenceKey('send-0010-qa', 421, 'document page', 'phone', 'after', 'png'), 'qa/send-0010-qa/421/document-page-phone-after.png');
    assert.notEqual(evidenceKey('t', 1, 'f', 'desktop', 'after', 'png'), evidenceKey('t', 2, 'f', 'desktop', 'after', 'png'));
  });
});

describe('the artifacts the feature report reads', () => {
  it('posts a screenshot on the engineering task, not on the request', () => {
    const a = screenshotArtifact({ recordId: 90, flowName: 'document page', viewport: 'desktop', side: 'after', url: 'https://s3/x.png', bytes: 12 });
    assert.equal(a.recordType, 'object');
    assert.equal(a.recordId, '90');
    assert.equal(a.recordRole, 'qa-screenshot');
    assert.equal(a.title, `document page ${MIDDOT} desktop ${MIDDOT} after`);
    assert.equal(a.spec.url, 'https://s3/x.png');
    assert.equal(a.spec.href, 'https://s3/x.png');
    assert.equal(a.spec.caption, `document page ${MIDDOT} desktop ${MIDDOT} after`);
    assert.equal(a.spec.description, a.spec.caption);
  });

  it('records an absence as a markdown artifact carrying the reason, never as silence', () => {
    const a = screenshotArtifact({ recordId: 90, flowName: 'new page', viewport: 'phone', side: 'before', url: '', note: 'New surface, nothing to compare' });
    assert.equal(a.recordRole, 'qa-screenshot');
    assert.equal(a.kind, 'markdown');
    assert.match(a.spec.caption, /New surface, nothing to compare$/);
    assert.equal(a.spec.url, undefined);
  });

  it('says what the video cost in its own caption', () => {
    const a = videoArtifact({ recordId: 90, flowName: 'document page', viewport: 'desktop', url: 'https://s3/x.webm', seconds: 9, bytes: 1024 * 640 });
    assert.equal(a.recordRole, 'qa-video');
    assert.match(a.spec.caption, /after video: 9s, 640 KB$/);
  });

  it('posts one report, as markdown, with the summary as its caption', () => {
    const a = reportArtifact({ recordId: 90, taskId: 'send-0010-qa', markdown: '# x', summary: '4 of 4 shots stored, 0 problems' });
    assert.equal(a.recordRole, 'qa-report');
    assert.equal(a.kind, 'markdown');
    assert.equal(a.spec.md, '# x');
    assert.equal(a.spec.summary, '4 of 4 shots stored, 0 problems');
  });
});

describe('the report when things go wrong', () => {
  const rows = [
    { flow: 'document page', viewport: 'desktop', side: 'before', url: '', note: 'New surface, nothing to compare' },
    { flow: 'document page', viewport: 'desktop', side: 'after', url: 'https://s3/a.png', note: '' },
  ];

  it('names the absence in a row rather than leaving the row out', () => {
    const md = qaReportMarkdown({ taskId: 't', runId: 1, base: 'https://app.northwind.example', qa: { surface: 'app' }, rows });
    assert.match(md, /\| document page \| desktop \| before \| New surface, nothing to compare \|/);
    assert.match(md, /\| document page \| desktop \| after \| captured \|/);
    assert.match(md, /Nothing failed\./);
  });

  it('says what broke, with the scope, when the pass failed', () => {
    const md = qaReportMarkdown({ taskId: 't', runId: 1, base: 'b', qa: {}, rows: [], failures: [{ scope: 'build', message: 'npm run build failed (1)' }] });
    assert.match(md, /## What failed/);
    assert.match(md, /\*\*build\*\*: npm run build failed \(1\)/);
    assert.match(md, /no flow produced a shot/);
  });

  it('carries no em dash, whatever a failure message held', () => {
    const md = qaReportMarkdown({ taskId: 't', runId: 1, base: 'b', qa: {}, rows: [], failures: [{ scope: 'x', message: `a ${String.fromCharCode(0x2014)} b` }] });
    assert.equal(md.includes(String.fromCharCode(0x2014)), false);
  });
});

describe('signing, without the AWS SDK', () => {
  const now = new Date('2026-09-21T12:00:00Z');
  const args = { bucket: 'runner-evidence-example', key: 'qa/t/1/a.png', region: 'us-west-2', accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret', now };

  it('presigns a GET that lasts seven days and names every part AWS checks', () => {
    const url = presignGet(args);
    assert.match(url, /^https:\/\/runner-evidence-example\.s3\.us-west-2\.amazonaws\.com\/qa\/t\/1\/a\.png\?/);
    assert.match(url, /X-Amz-Algorithm=AWS4-HMAC-SHA256/);
    assert.match(url, /X-Amz-Credential=AKIAEXAMPLE%2F20260921%2Fus-west-2%2Fs3%2Faws4_request/);
    assert.match(url, /X-Amz-Date=20260921T120000Z/);
    assert.match(url, /X-Amz-Expires=604800/);
    assert.match(url, /&X-Amz-Signature=[0-9a-f]{64}$/);
  });

  it('signs the same request the same way twice, and a different key differently', () => {
    assert.equal(presignGet(args), presignGet(args));
    assert.notEqual(presignGet(args), presignGet({ ...args, key: 'qa/t/1/b.png' }));
  });

  it('does not escape the slashes in the path, and does escape them in the query', () => {
    const url = presignGet(args);
    assert.ok(url.includes('/qa/t/1/a.png?'));
    assert.ok(url.includes('%2Fus-west-2%2Fs3%2F'));
  });

  it('signs a PUT with the payload hash and carries a session token when there is one', () => {
    const { url, headers } = signPut({ ...args, body: Buffer.from('png'), contentType: 'image/png', credentials: { accessKeyId: 'AKIA', secretAccessKey: 's', sessionToken: 'tok' }, now });
    assert.equal(url, 'https://runner-evidence-example.s3.us-west-2.amazonaws.com/qa/t/1/a.png');
    assert.equal(headers['x-amz-security-token'], 'tok');
    assert.match(headers['x-amz-content-sha256'], /^[0-9a-f]{64}$/);
    assert.match(headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIA\/20260921\/us-west-2\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token, Signature=[0-9a-f]{64}$/);
  });

  it('leaves the session token out when the credentials have none', () => {
    const { headers } = signPut({ ...args, body: Buffer.from('png'), contentType: 'image/png', credentials: { accessKeyId: 'AKIA', secretAccessKey: 's' }, now });
    assert.equal(headers['x-amz-security-token'], undefined);
    assert.match(headers.authorization, /SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date,/);
  });
});

describe('the url on every shot', () => {
  it('names the path and query the page was at, because a screenshot shows no address bar', () => {
    assert.equal(pageAt({ url: () => 'http://127.0.0.1:5274/?q=board&status=live' }), '/?q=board&status=live');
    assert.equal(pageAt({ url: () => 'not a url' }), '');
    assert.equal(shotNote({ label: 'live filter', at: '/?status=live' }), 'live filter · at /?status=live');
    assert.equal(shotNote({ label: '', at: '/' }), 'at /');
  });
});

describe('serving the built branch', () => {
  it('falls back to a free port when the usual one is taken (run 384)', async () => {
    const { serveDist } = await import('./qa.mjs');
    const holder = http.createServer(() => {});
    await new Promise(r => holder.listen(0, '127.0.0.1', r));
    const taken = holder.address().port;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-serve-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<p>ok</p>');
    const server = await serveDist(dir, taken, { spaFallback: true });
    try {
      assert.notEqual(server.address().port, taken);
      const body = await (await fetch(`http://127.0.0.1:${server.address().port}/`)).text();
      assert.match(body, /ok/);
    } finally {
      server.closeAllConnections();
      server.close();
      holder.close();
    }
  });
});

describe('the bad-connection verbs', () => {
  it('generates a PDF-shaped file of the size asked for', async () => {
    const { samplePdf } = await import('./qa.mjs');
    const b = samplePdf(9 * 1024 * 1024);
    assert.equal(b.length, 9 * 1024 * 1024);
    assert.equal(b.subarray(0, 8).toString(), '%PDF-1.4');
    assert.match(b.subarray(b.length - 7).toString(), /%%EOF/);
  });
});

describe('route placeholders (#214: /documents/[id] loaded the literal id "[id]")', () => {
  it('recognizes [id], [slug], :id and {id} as placeholders, and a real value as none', () => {
    assert.equal(PLACEHOLDER_SEGMENT_RE.test('[id]'), true);
    assert.equal(PLACEHOLDER_SEGMENT_RE.test('[slug]'), true);
    assert.equal(PLACEHOLDER_SEGMENT_RE.test(':id'), true);
    assert.equal(PLACEHOLDER_SEGMENT_RE.test('{id}'), true);
    assert.equal(PLACEHOLDER_SEGMENT_RE.test('doc_q3'), false);
    assert.equal(hasPlaceholder('/documents/[id]'), true);
    assert.equal(hasPlaceholder('/documents/doc_q3'), false);
  });

  it('finds the placeholder, its bare name, and the list route it sits under', () => {
    assert.deepEqual(findPlaceholder('/documents/[id]'), { index: 2, segments: ['', 'documents', '[id]'], name: 'id', prefix: '/documents' });
    assert.equal(findPlaceholder('/documents/[id]/edit').prefix, '/documents');
    assert.equal(findPlaceholder('/documents/doc_q3'), null);
    assert.equal(findPlaceholder('/:id').prefix, '/');
  });

  it('substitutes only the placeholder segment, leaving the rest of the path alone', () => {
    const found = findPlaceholder('/documents/[id]/edit');
    assert.equal(substitutePlaceholder('/documents/[id]/edit', found.index, found.segments, 'doc_q3'), '/documents/doc_q3/edit');
  });

  it('takes the first link under the prefix from a list page', async () => {
    const page = fakePage({ '/documents': ['/documents/doc_q3', '/documents/doc_msa'] });
    assert.equal(await firstListItemHref(page, 'http://x', '/documents', '/documents'), '/documents/doc_q3');
  });

  it('ignores links that do not match the prefix, and links with no id after it', async () => {
    const page = fakePage({ '/': ['/new', '/team', '/documents'] });
    assert.equal(await firstListItemHref(page, 'http://x', '/', '/documents'), null);
  });

  it('returns null for a page that 404s rather than throwing', async () => {
    const page = fakePage({});
    assert.equal(await firstListItemHref(page, 'http://x', '/documents', '/documents'), null);
  });

  it('strips the query and hash off a matched link', async () => {
    const page = fakePage({ '/documents': ['/documents/doc_q3?ref=qa#top'] });
    assert.equal(await firstListItemHref(page, 'http://x', '/documents', '/documents'), '/documents/doc_q3');
  });

  it('resolves [id] straight off the prefix when that page lists it', async () => {
    const page = fakePage({ '/documents': ['/documents/doc_q3'] });
    const events = [];
    const r = await resolveRoutePlaceholders({ page, base: 'http://x', path: '/documents/[id]', log: (e, d) => events.push([e, d]) });
    assert.equal(r.ok, true);
    assert.equal(r.path, '/documents/doc_q3');
    assert.deepEqual(events, [['qa.path.resolved', { from: '/documents/[id]', to: '/documents/doc_q3' }]]);
  });

  it('falls back to the surface\'s own list route, then to root, when the prefix itself has nothing (the library is at /)', async () => {
    const page = fakePage({
      '/documents': [], // no index route for the resource itself: an app 404/empty page
      '/library': [], // no such route either
      '/': ['/new', '/documents/doc_msa', '/documents/doc_q3'], // the real library page
    });
    const fallbacks = listRoutesFor({ list_routes: ['/library'] });
    assert.deepEqual(fallbacks, ['/library', '/']);
    const r = await resolveRoutePlaceholders({ page, base: 'http://x', path: '/documents/[id]', log: () => {}, fallbacks });
    assert.equal(r.ok, true);
    assert.equal(r.path, '/documents/doc_msa');
    assert.deepEqual(LIST_ROUTE_FALLBACKS, ['/']);
  });

  it('resolves a placeholder that is not the last segment, keeping the rest of the path', async () => {
    const page = fakePage({ '/documents': ['/documents/doc_q3'] });
    const r = await resolveRoutePlaceholders({ page, base: 'http://x', path: '/documents/[id]/versions', log: () => {} });
    assert.equal(r.path, '/documents/doc_q3/versions');
  });

  it('fails the flow, naming the placeholder, when nothing resolves it (never a silent 404 screenshot)', async () => {
    const page = fakePage({ '/documents': [], '/library': [], '/': ['/sign-in'] });
    const r = await resolveRoutePlaceholders({ page, base: 'http://x', path: '/documents/[id]', log: () => {} });
    assert.equal(r.ok, false);
    assert.equal(r.unresolved.name, 'id');
    assert.equal(r.unresolved.prefix, '/documents');
  });

  it('is a no-op, ok, on a path with no placeholder', async () => {
    const page = fakePage({});
    const r = await resolveRoutePlaceholders({ page, base: 'http://x', path: '/team', log: () => {} });
    assert.deepEqual(r, { path: '/team', ok: true, replacements: [] });
  });
});

describe('a screenshot that shows the app broke, not the feature', () => {
  it('flags the exact phrasing DocumentPage and the mock use for a bad id (#214)', async () => {
    const page = fakePage({}, { text: 'Could not load this document\nThat document does not exist.' });
    assert.equal(await detectErrorState(page), true);
  });

  it('flags a surface\'s own 404 wording, which it names on the contract', async () => {
    const page = fakePage({}, { text: 'There is nothing at this address' });
    assert.equal(await detectErrorState(page), false);
    assert.equal(await detectErrorState(page, errorPatternsFor({ error_text: ['nothing at this address'] })), true);
    // A phrase is matched as written, never as a pattern.
    assert.equal(await detectErrorState(fakePage({}, { text: 'a.b' }), errorPatternsFor({ error_text: ['a*b'] })), false);
  });

  it('leaves an ordinary page alone', async () => {
    const page = fakePage({}, { text: 'Q3 board deck\n14 pages' });
    assert.equal(await detectErrorState(page), false);
  });

  it('never throws when the page cannot be evaluated', async () => {
    const page = { evaluate: async () => {
      throw new Error('closed');
    } };
    assert.equal(await detectErrorState(page), false);
  });

  it('checks every pattern against real product copy', () => {
    assert.ok(ERROR_STATE_PATTERNS.some(re => re.test('Could not load this space')));
    assert.ok(ERROR_STATE_PATTERNS.some(re => re.test('That team does not exist.')));
  });
});

// #130 runs 409 and 410 (2026-09-29): every interactive flow's steps failed on valid Playwright
// selectors, the at-rest page went out as the proof, and two criteria shared one picture.
describe('selectors the engineer writes', () => {
  it('reads Playwright engine selectors and CSS with quoted spaces as selectors', () => {
    for (const t of ['text=Remind', 'role=switch', 'button:text-is(\'Send reminder\')', 'button[role=switch]:has-text(\'Remind automatically\')', 'input[type=search]', '#to', '.row', '[data-testid="remind"]', 'textarea']) {
      assert.equal(isSelector(t), t !== 'textarea', t);
    }
  });

  it('reads words a person sees as text, even with a colon', () => {
    for (const t of ['Remind', 'Send reminder', 'Remind automatically', 'Days after sending', 'Note: optional']) {
      assert.equal(isSelector(t), false, t);
    }
  });
});

describe('a flow that did not reach its state', () => {
  it('names the step that failed, its verb and its target', () => {
    assert.equal(stepTarget({ click: 'text=Remind' }), 'text=Remind');
    assert.equal(stepTarget({ fill: { selector: 'textarea', value: 'hi' } }), 'textarea');
    assert.equal(stepFailureText({ index: 1, verb: 'click', target: 'text=Remind', error: 'locator.click: Timeout 15000ms exceeded.' }), 'step 2 (click "text=Remind") failed: locator.click: Timeout 15000ms exceeded.');
  });

  it('marks a shot identical to another flow\'s as its duplicate, and never a flow as its own', () => {
    const seen = new Map();
    assert.equal(duplicateOf(seen, 'h1', 'document page'), '');
    assert.equal(duplicateOf(seen, 'h1', 'document page'), '');
    assert.equal(duplicateOf(seen, 'h1', 'Remind dialog'), 'document page');
    assert.equal(duplicateOf(seen, 'h2', 'Remind dialog'), '');
  });
});

describe('the capture pass, end to end in a real browser', async () => {
  let chromiumOk = false;
  try {
    const pw = await import('playwright'); const b = await pw.chromium.launch(); await b.close(); chromiumOk = true;
  } catch {
    chromiumOk = false;
  }

  it('shoots a clicked dialog, and marks a failed step and a duplicate as not evidence', { skip: chromiumOk ? false : 'playwright chromium is not installed here', timeout: 90000 }, async () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-e2e-'));
    const html = '<!doctype html><html><body style="font:16px sans-serif"><main><h1>Q3 board deck</h1><p>Sent to</p>'
      + '<button onclick="document.getElementById(\'d\').hidden=false">Remind</button>'
      + '<div id="d" role="dialog" hidden style="border:2px solid #333;padding:24px;margin:16px">Remind lee<textarea></textarea></div></main></body></html>';
    const run = () => {
      const d = path.join(repoDir, 'apps/acme-web/dist'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'index.html'), html); return { code: 0, stdout: '', stderr: '' };
    };
    const flow = (name, steps) => ({ name, path: '/documents/doc_q3', viewports: ['desktop'], sign_in: false, before: 'none', steps });
    const qa = { surface: 'app', surfaces: { app: { build: { command: 'true', dist: 'apps/acme-web/dist', spa_fallback: true } } }, video: false, flows: [
      flow('document page', []),
      flow('Remind dialog', [{ click: 'text=Remind' }, { wait_for: '[role=dialog]' }]),
      flow('Reminder listed', [{ click: 'button:text-is(\'Send reminder\')' }]),
    ] };
    const logs = [];
    const r = await captureEvidence({ qa, taskId: 't1', runId: 'r1', recordId: null, repoDir, outDir: path.join(repoDir, 'qa'), aws: { bucket: '', region: 'us-west-2', presign: {} }, run, log: (phase, f) => logs.push({ phase, ...f }), post: null, refusedFlows: ['flows[3] (Auto toggle): the criterion names an interaction'] });
    const after = name => r.rows.find(x => x.flow === name && x.side === 'after');
    assert.equal(after('document page').not_evidence, undefined);
    assert.equal(after('Remind dialog').not_evidence, undefined, 'text=Remind clicks the button, so the dialog is a new picture');
    assert.equal(after('Reminder listed').duplicate_of, 'document page');
    assert.match(after('Reminder listed').note, /not the state: step 1 \(click .*Send reminder.*\) failed/);
    assert.match(after('Reminder listed').note, /duplicate of document page/);
    assert.ok(r.failures.some(f => f.scope === 'Reminder listed/desktop/after' && /duplicate of document page/.test(f.message)));
    assert.ok(r.failures.some(f => f.scope === 'engineer flow refused'));
    assert.match(r.markdown, /duplicate of document page/);
    assert.match(r.summary, /not evidence/);
    assert.ok(logs.some(l => l.phase === 'qa.shot.duplicate' && l.duplicate_of === 'document page'));
    fs.rmSync(repoDir, { recursive: true, force: true });
  });
});

describe('building the branch, with the build the contract names', () => {
  const qa = (flows, build) => ({ surface: 'app', surfaces: { app: { build } }, flows });

  it('runs the surface\'s command with its env, and the signed-in env when a flow needs an account', () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-build-'));
    const calls = [];
    const run = (cmd, args, opts) => {
      calls.push({ cmd, args, env: opts.env }); fs.mkdirSync(path.join(repoDir, 'out'), { recursive: true }); fs.writeFileSync(path.join(repoDir, 'out/index.html'), 'x'); return { code: 0, stdout: '', stderr: '' };
    };
    const build = { command: 'npm run build -w @northwind/web', dist: 'out', port: 5274, spa_fallback: true, env: { VITE_API_URL: 'https://api.northwind.example' }, signed_in_env: { VITE_MOCK_API: '1', VITE_API_URL: 'http://127.0.0.1:1' } };
    const open = buildSurface(repoDir, qa([{ name: 'a', path: '/', sign_in: false }], build), run);
    assert.equal(open.ok, true);
    assert.equal(open.mock, false);
    assert.deepEqual(open.app, { dist: 'out', port: 5274, spaFallback: true });
    assert.deepEqual(calls[0], { cmd: 'sh', args: ['-c', 'npm run build -w @northwind/web'], env: { VITE_API_URL: 'https://api.northwind.example' } });
    const signed = buildSurface(repoDir, qa([{ name: 'a', path: '/', sign_in: true }], build), run);
    assert.equal(signed.mock, true);
    assert.deepEqual(calls[1].env, { VITE_API_URL: 'http://127.0.0.1:1', VITE_MOCK_API: '1' });
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('says what is missing when the contract names no build, and runs nothing', () => {
    let ran = false;
    const r = buildSurface('/nowhere', { surface: 'app', flows: [] }, () => {
      ran = true; return { code: 0 };
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /names no build for surface "app"/);
    assert.equal(ran, false);
  });
});

describe('a flow that prepares its own state (the live check, 2026-10-01)', async () => {
  const { addressOf, fillVars, samplePdf, shootFlow } = await import('./qa.mjs');

  it('reads {{name}} from what an earlier step remembered, inside objects too, and names one never kept', () => {
    assert.deepEqual(fillVars({ goto: '{{documentUrl}}', fill: { selector: '#t', value: 'Hi {{ who }}' } }, { documentUrl: '/documents/d1', who: 'Lee' }), { goto: '/documents/d1', fill: { selector: '#t', value: 'Hi Lee' } });
    assert.throws(() => fillVars('{{shareUrl}}', {}), /\{\{shareUrl\}\} was never remembered by an earlier step/);
    assert.equal(fillVars(3, {}), 3);
  });

  it('opens a path on the product and an absolute address as it is', () => {
    assert.equal(addressOf('https://app.acme.example/', '/new'), 'https://app.acme.example/new');
    assert.equal(addressOf('https://app.acme.example', 'https://app.acme.example/d/abc'), 'https://app.acme.example/d/abc');
  });

  it('writes a real one-page PDF of the size asked for, its cross-references pointing at its objects', () => {
    for (const size of [700, 4096, 2 * 1024 * 1024]) {
      const pdf = samplePdf(size).toString('latin1');
      assert.equal(pdf.length, size);
      const xref = Number(/startxref\n(\d+)/.exec(pdf)[1]);
      assert.equal(pdf.slice(xref, xref + 4), 'xref');
      const first = Number(/0000000000 65535 f \n(\d{10})/.exec(pdf)[1]);
      assert.equal(pdf.slice(first, first + 7), '1 0 obj');
    }
  });

  let chromiumOk = false;
  try {
    const pw = await import('playwright'); const b = await pw.chromium.launch(); await b.close(); chromiumOk = true;
  } catch {
    chromiumOk = false;
  }

  it('uploads, remembers where the record landed and the link it shares, opens it, and refuses a foreign address', { skip: chromiumOk ? false : 'playwright chromium is not installed here', timeout: 90000 }, async () => {
    const views = { d1: 0 };
    const server = http.createServer((req, res) => {
      res.setHeader('content-type', 'text/html');
      if (req.url === '/new') {
        return res.end('<input type="file" onchange="location.href=\'/documents/d1\'">');
      }
      if (req.url === '/broken') {
        return res.end('<input type="file"><p>Something went wrong on our end.</p>');
      }
      if (req.url === '/documents/d1') {
        return res.end(`<h1>Q3 board deck</h1><p>${views.d1 ? 'Last opened just now' : 'Not opened yet'}</p><a href="/s/abc">Open as a viewer</a>`);
      }
      if (req.url === '/s/abc') {
        views.d1 += 1;
        return res.end('<p>Page 1 of 1</p>');
      }
      res.statusCode = 404;
      return res.end('not here');
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const pw = await import('playwright');
    const browser = await pw.chromium.launch();
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-live-'));
    const vars = {};
    const allow = url => new URL(url).origin === base;
    try {
      const setup = await shootFlow({ browser, base, viewport: 'desktop', side: 'live', outDir, vars, allow, withText: true, stopAtFailure: true, flow: { name: 'setup', path: '/new', steps: [
        { upload: { selector: 'input[type=file]', megabytes: 0.001, name: 'qa.pdf' } },
        { wait_for: 'Not opened yet' },
        { remember: { name: 'documentUrl' } },
        { remember: { name: 'shareUrl', from: 'href', selector: 'Open as a viewer' } },
      ] } });
      assert.deepEqual(setup.stepFailures, []);
      assert.equal(vars.documentUrl, `${base}/documents/d1`);
      assert.equal(vars.shareUrl, `${base}/s/abc`);
      const visit = await shootFlow({ browser, base, viewport: 'desktop', side: 'live', outDir, vars, allow, flow: { name: 'visitor', path: '{{shareUrl}}', steps: [{ pause: 0 }] } });
      assert.deepEqual(visit.stepFailures, []);
      const check = await shootFlow({ browser, base, viewport: 'desktop', side: 'live', outDir, vars, allow, withText: true, stopAtFailure: true, flow: { name: 'check', path: '/', steps: [{ goto: '{{documentUrl}}' }, { wait_for: 'Last opened' }, { shoot: 'Last opened line' }] } });
      assert.deepEqual(check.stepFailures, []);
      assert.equal(check.shots[0].label, 'Last opened line');
      assert.match(check.shots[0].text, /Last opened just now/);
      // The upload failed on production and the page stayed put (run 3, 2026-10-01): the setup
      // does not remember the upload page as the record, it fails and says why.
      const stuckVars = {};
      const stuck = await shootFlow({ browser, base, viewport: 'desktop', side: 'live', outDir, vars: stuckVars, allow, stopAtFailure: true, urlMoveTimeoutMs: 500, flow: { name: 'setup', path: '/broken', steps: [
        { upload: { selector: 'input[type=file]', megabytes: 0.001, name: 'qa.pdf' } },
        { remember: { name: 'documentUrl' } },
      ] } });
      assert.equal(stuck.stepFailures[0]?.verb, 'remember');
      assert.match(stuck.stepFailures[0].error, /the page never left \/broken, where this flow started/);
      assert.equal(stuckVars.documentUrl, undefined);
      const foreign = await shootFlow({ browser, base, viewport: 'desktop', side: 'live', outDir, vars, allow, stopAtFailure: true, flow: { name: 'away', path: '/documents/d1', steps: [{ goto: 'http://169.254.169.254/latest' }] } });
      assert.match(foreign.stepFailures[0].error, /not one of the product's own addresses/);
    } finally {
      await browser.close();
      server.close();
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});

describe('a flow that proves what an API answered (expect_response, FE-314 2026-10-02)', async () => {
  const { matchResponse, shootFlow, stepTarget } = await import('./qa.mjs');
  const seen = [
    { method: 'GET', url: 'https://app.acme.example/documents', status: 200, type: 'document' },
    { method: 'OPTIONS', url: 'https://api.acme.example/v1/documents', status: 204, type: 'preflight' },
    { method: 'GET', url: 'https://api.acme.example/v1/documents?page=1', status: 200, type: 'fetch' },
    { method: 'GET', url: 'https://api.acme.example/v1/me', status: 500, type: 'fetch' },
    { method: 'GET', url: 'https://app.acme.example/logo.svg', status: 200, type: 'image' },
  ];

  it('passes on a response whose path is or ends with the one named, on any host, with the status promised', () => {
    assert.deepEqual(matchResponse(seen, { path: '/v1/documents', status: 200 }), { ok: true, line: 'GET /v1/documents returned 200', match: { method: 'GET', path: '/v1/documents', status: 200 } });
    assert.equal(matchResponse(seen, { path: 'https://api.acme.example/v1/documents', status: 200, method: 'get' }).ok, true);
    // A segment, not a substring: /documents ends /v1/documents, mydocuments ends nothing.
    assert.equal(matchResponse(seen, { path: 'documents', status: 200 }).ok, true);
    assert.equal(matchResponse([{ method: 'GET', url: 'https://x.example/mydocuments', status: 200 }], { path: '/documents', status: 200 }).ok, false);
  });

  it('fails with what the API answered instead, never counting a CORS preflight when no method is named', () => {
    assert.deepEqual(matchResponse(seen, { path: '/v1/me', status: 200 }), { ok: false, line: 'GET /v1/me returned 500, not 200' });
    assert.equal(matchResponse(seen, { path: '/v1/documents', status: 204 }).line, 'GET /v1/documents returned 200, not 204');
    assert.equal(matchResponse(seen, { path: '/v1/documents', status: 204, method: 'OPTIONS' }).ok, true);
  });

  it('fails with no such request, naming what the page did call (not its images)', () => {
    assert.equal(matchResponse(seen, { path: '/v1/orgs', status: 200 }).line, 'no request to /v1/orgs was made (the page made: GET /documents 200, GET /v1/documents 200, GET /v1/me 500)');
    assert.equal(matchResponse([], { path: '/v1/orgs', status: 200, method: 'POST' }).line, 'no POST request to /v1/orgs was made');
    assert.equal(stepTarget({ expect_response: { path: '/v1/orgs', status: 200 } }), '/v1/orgs');
  });

  let chromiumOk = false;
  try {
    const pw = await import('playwright'); const b = await pw.chromium.launch(); await b.close(); chromiumOk = true;
  } catch {
    chromiumOk = false;
  }

  it('reads the responses the page itself made, and reports the ones that answered as promised', { skip: chromiumOk ? false : 'playwright chromium is not installed here', timeout: 90000 }, async () => {
    let status = 200;
    const server = http.createServer((req, res) => {
      if (req.url === '/v1/documents') {
        res.statusCode = status;
        res.setHeader('content-type', 'application/json');
        return res.end(status === 200 ? '[{"title":"Q3 board deck"}]' : '{"error":"engine"}');
      }
      res.setHeader('content-type', 'text/html');
      return res.end('<ul id="list"></ul><script>fetch("/v1/documents").then(r=>r.ok?r.json():[]).then(d=>{document.getElementById("list").innerHTML=d.map(x=>"<li>"+x.title+"</li>").join("")||"<li>Could not load documents</li>"})</script>');
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const pw = await import('playwright');
    const browser = await pw.chromium.launch();
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-resp-'));
    const flow = { name: 'documents', path: '/documents', steps: [{ expect_response: { path: '/v1/documents', status: 200 } }, { shoot: 'Documents list' }] };
    try {
      const ok = await shootFlow({ browser, base, viewport: 'desktop', side: 'live', outDir, stopAtFailure: true, flow });
      assert.deepEqual(ok.stepFailures, []);
      assert.deepEqual(ok.responses, [{ method: 'GET', path: '/v1/documents', status: 200 }]);
      status = 500;
      const bad = await shootFlow({ browser, base, viewport: 'desktop', side: 'live', outDir, stopAtFailure: true, expectResponseTimeoutMs: 500, flow });
      assert.equal(bad.stepFailures[0]?.verb, 'expect_response');
      assert.equal(bad.stepFailures[0].error, 'GET /v1/documents returned 500, not 200');
      assert.deepEqual(bad.responses, []);
    } finally {
      await browser.close();
      server.close();
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});

describe('the repo\'s own test screenshots (FE-398, 2026-10-03)', () => {
  it('reads a trailing -phone, -desktop or -<width> as the viewport, and turns dashes into spaces', () => {
    assert.deepEqual(captionForShotFile('title-line-phone.png'), { caption: `title line ${String.fromCharCode(0xB7)} phone`, viewport: 'phone' });
    assert.deepEqual(captionForShotFile('empty-state-desktop.jpg'), { caption: `empty state ${String.fromCharCode(0xB7)} desktop`, viewport: 'desktop' });
    assert.deepEqual(captionForShotFile('filter-chip-375.png'), { caption: `filter chip ${String.fromCharCode(0xB7)} 375`, viewport: '375' });
    assert.deepEqual(captionForShotFile('search-box.png'), { caption: 'search box', viewport: '' });
  });

  it('with no shots directory, uploads and skips nothing', async () => {
    const r = await collectRepoTestShots({ dir: path.join(os.tmpdir(), 'no-such-qa-shots-dir'), taskId: 't1', runId: 'r1', recordId: null, aws: { bucket: 'b', region: 'us-west-2', presign: {} }, post: null });
    assert.deepEqual(r, { uploaded: [], skipped: [], evidence: [] });
  });

  it('stores each picture inline in Vocion when no bucket is reachable but the task can be posted to (Walk 17)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-shots-'));
    fs.writeFileSync(path.join(dir, 'archived-link-desktop.png'), Buffer.from('fake png'));
    const savedEnv = { AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY, AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI, AWS_CONTAINER_CREDENTIALS_FULL_URI: process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI };
    for (const k of Object.keys(savedEnv)) {
      delete process.env[k];
    }
    const posted = [];
    const post = async (p, body) => {
      posted.push({ p, body });
      return { ok: true, json: { artifact: { id: 77 } } };
    };
    try {
      const r = await collectRepoTestShots({ dir, taskId: 't1', runId: 'r1', recordId: 'TK-9', aws: { bucket: '', region: 'us-west-2', presign: {} }, post });
      assert.equal(r.skipped.length, 0);
      assert.equal(r.uploaded.length, 1);
      assert.match(r.uploaded[0].url, /^data:image\/png;base64,/);
      assert.equal(posted.length, 1);
      assert.equal(posted[0].body.recordRole, 'qa-screenshot');
      assert.equal(r.evidence[0].artifactId, 77);
    } finally {
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) {
          delete process.env[k];
        } else {
          process.env[k] = v;
        }
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips every file, named, when no credentials can reach the evidence bucket', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-shots-'));
    fs.writeFileSync(path.join(dir, 'title-line-phone.png'), Buffer.from('fake png'));
    fs.mkdirSync(path.join(dir, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'nested', 'empty-state-desktop.png'), Buffer.from('fake png too'));
    const savedEnv = { AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY, AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI, AWS_CONTAINER_CREDENTIALS_FULL_URI: process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI };
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
    delete process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
    try {
      const r = await collectRepoTestShots({ dir, taskId: 't1', runId: 'r1', recordId: null, aws: { bucket: 'b', region: 'us-west-2', presign: {} }, post: null });
      assert.equal(r.uploaded.length, 0);
      assert.equal(r.skipped.length, 2);
      assert.ok(r.skipped.every(s => /could not reach the evidence bucket/.test(s.reason)));
      // Recursive, and sorted so the report reads the same way twice.
      assert.deepEqual(r.skipped.map(s => s.file).sort(), ['nested/empty-state-desktop.png', 'title-line-phone.png']);
    } finally {
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) {
          delete process.env[k];
        } else {
          process.env[k] = v;
        }
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips a file over the byte cap, naming its size', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-shots-'));
    fs.writeFileSync(path.join(dir, 'huge-desktop.png'), Buffer.alloc(10));
    const r = await collectRepoTestShots({ dir, taskId: 't1', runId: 'r1', recordId: null, aws: { bucket: 'b', region: 'us-west-2', presign: {} }, post: null, maxBytes: 5 });
    assert.equal(r.uploaded.length, 0);
    assert.match(r.skipped[0].reason, /over the 0 MB cap/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('uploads up to the limit and caps the rest, with S3 PUT and presign exercised for real', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-shots-'));
    for (let i = 0; i < 3; i++) {
      fs.writeFileSync(path.join(dir, `line-${i}-desktop.png`), Buffer.from(`fake png ${i}`));
    }
    const puts = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      puts.push({ url: String(url), method: opts?.method });
      return { ok: true, status: 200, text: async () => '' };
    };
    process.env.AWS_ACCESS_KEY_ID = 'AKIAFAKETESTKEY0001';
    process.env.AWS_SECRET_ACCESS_KEY = 'fakeSecretKeyForTestsOnly0000000000000000';
    try {
      const posted = [];
      const post = async (p, body) => {
        posted.push({ p, body }); return { ok: true, status: 200, json: { id: `art-${posted.length}` } };
      };
      const r = await collectRepoTestShots({
        dir,
        taskId: 't1',
        runId: 'r1',
        recordId: 42,
        aws: { bucket: 'vocion-qa-test', region: 'us-west-2', presign: { accessKeyId: 'AKIAFAKETESTKEY0001', secretAccessKey: 'fakeSecretKeyForTestsOnly0000000000000000' } },
        post,
        limit: 2,
      });
      assert.equal(r.uploaded.length, 2);
      assert.equal(r.skipped.length, 1);
      assert.match(r.skipped[0].reason, /over the limit of 2 files/);
      assert.equal(puts.length, 2);
      assert.ok(puts.every(p => p.method === 'PUT' && p.url.includes('vocion-qa-test.s3.us-west-2.amazonaws.com')));
      assert.ok(r.uploaded.every(u => /^https:\/\/vocion-qa-test\.s3\.us-west-2\.amazonaws\.com\//.test(u.url) && u.url.includes('X-Amz-Signature=')));
      assert.equal(posted.length, 2);
      assert.equal(posted[0].body.recordRole, 'qa-screenshot');
      assert.equal(posted[0].body.recordId, '42');
      assert.deepEqual(r.evidence.map(e => e.source), ['repo-test', 'repo-test']);
      assert.ok(r.evidence.every(e => e.artifactId));
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is its own heading in the qa report, with what uploaded and what did not', () => {
    const md = qaReportMarkdown({
      taskId: 't1',
      runId: 'r1',
      base: 'https://example.test',
      qa: { surface: 'app', video: false },
      rows: [],
      failures: [],
      repoShots: { uploaded: [{ file: 'title-line-phone.png', caption: 'title line', viewport: 'phone' }], skipped: [{ file: 'huge.png', reason: 'over the 5 MB cap' }] },
    });
    assert.match(md, /## From the repo's own tests/);
    assert.match(md, /title-line-phone\.png/);
    assert.match(md, /title line/);
    assert.match(md, /huge\.png.*over the 5 MB cap/);
  });

  it('does not add the heading when there is nothing from the repo\'s tests', () => {
    const md = qaReportMarkdown({ taskId: 't1', runId: 'r1', base: '', qa: { surface: 'app' }, rows: [], failures: [], repoShots: { uploaded: [], skipped: [] } });
    assert.doesNotMatch(md, /From the repo's own tests/);
  });
});

describe('the repo\'s own test recordings (2026-10-03)', () => {
  it('captions a recording by its name, or by its folder when Playwright called it video.webm', () => {
    assert.deepEqual(captionForVideoFile('rename-save-disabled-desktop.webm'), { caption: `rename save disabled ${String.fromCharCode(0xB7)} desktop`, viewport: 'desktop' });
    assert.deepEqual(captionForVideoFile('rename-blank-name-phone/video.webm'), { caption: `rename blank name ${String.fromCharCode(0xB7)} phone`, viewport: 'phone' });
  });

  it('sends each recording to Vocion as raw bytes with its type, and leaves the pictures to the shots pass', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-shots-'));
    fs.writeFileSync(path.join(dir, 'rename-desktop.webm'), Buffer.from('fake webm'));
    fs.writeFileSync(path.join(dir, 'rename-desktop.png'), Buffer.from('fake png'));
    fs.mkdirSync(path.join(dir, 'library-phone'));
    fs.writeFileSync(path.join(dir, 'library-phone', 'video.mp4'), Buffer.from('fake mp4'));
    const sent = [];
    const upload = async (p, bytes, type) => {
      sent.push({ p, bytes: bytes.toString(), type });
      return { ok: true, status: 201, json: { url: `/api/media/41/v-${sent.length}.webm`, artifactIds: [900 + sent.length, 950 + sent.length] } };
    };
    try {
      const r = await collectRepoTestVideos({ dir, recordId: 77, upload });
      assert.equal(r.skipped.length, 0);
      assert.deepEqual(sent.map(x => [x.type, x.bytes]), [['video/mp4', 'fake mp4'], ['video/webm', 'fake webm']]);
      const q = new URLSearchParams(sent[1].p.split('?')[1]);
      assert.ok(sent[1].p.startsWith('/artifacts/video?'));
      assert.equal(q.get('recordId'), '77');
      assert.equal(q.get('role'), 'qa-video');
      assert.match(q.get('caption'), /rename .* desktop .* before merge$/);
      assert.deepEqual(r.evidence.map(e => [e.role, e.source, e.url]), [['qa-video', 'repo-test', '/api/media/41/v-1.webm'], ['qa-video', 'repo-test', '/api/media/41/v-2.webm']]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('names what it did not send: over the cap, refused by Vocion, or with no task to file it on', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-shots-'));
    fs.writeFileSync(path.join(dir, 'a-desktop.webm'), Buffer.alloc(10));
    fs.writeFileSync(path.join(dir, 'b-desktop.webm'), Buffer.alloc(2));
    try {
      const refused = async () => ({ ok: false, status: 413, json: { error: { message: 'A recording may be 200 MB at most; this one is larger.' } } });
      const r = await collectRepoTestVideos({ dir, recordId: 77, upload: refused, maxBytes: 5 });
      assert.match(r.skipped.find(s => s.file === 'a-desktop.webm').reason, /over the 0 MB cap/);
      assert.match(r.skipped.find(s => s.file === 'b-desktop.webm').reason, /Vocion refused it: A recording may be 200 MB at most/);
      const none = await collectRepoTestVideos({ dir, recordId: null, upload: refused });
      assert.ok(none.skipped.every(s => /no task record/.test(s.reason)));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('keeping the repo\'s own shots out of the branch', () => {
  it('appends an ignore line to .git/info/exclude, once, never .gitignore', () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-exclude-'));
    fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });
    excludeShotsDir(repoDir, 'qa-shots');
    excludeShotsDir(repoDir, 'qa-shots'); // idempotent: a second run must not duplicate the line
    const exclude = fs.readFileSync(path.join(repoDir, '.git', 'info', 'exclude'), 'utf8');
    assert.equal(exclude.split('\n').filter(l => l.trim() === '/qa-shots/').length, 1);
    assert.ok(!fs.existsSync(path.join(repoDir, '.gitignore')));
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('keeps an existing exclude file\'s other lines', () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-exclude-'));
    fs.mkdirSync(path.join(repoDir, '.git', 'info'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, '.git', 'info', 'exclude'), '*.local\n');
    excludeShotsDir(repoDir, 'screens');
    const exclude = fs.readFileSync(path.join(repoDir, '.git', 'info', 'exclude'), 'utf8');
    assert.match(exclude, /\*\.local/);
    assert.match(exclude, /\/screens\//);
    fs.rmSync(repoDir, { recursive: true, force: true });
  });
});

describe('pictures in the shots directory that are another task\'s (2026-10-04, walks 17-18)', () => {
  it('names every image or recording outside this task\'s folder, and none inside it', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-shots-root-'));
    const mine = path.join(root, 'FE-9');
    fs.mkdirSync(path.join(mine, 'nested'), { recursive: true });
    fs.mkdirSync(path.join(root, 'FE-8'), { recursive: true });
    fs.writeFileSync(path.join(mine, 'sort-by-name-desktop.png'), 'mine');
    fs.writeFileSync(path.join(mine, 'nested', 'sort-by-name-phone.webm'), 'mine too');
    fs.writeFileSync(path.join(root, 'archive-action-desktop.png'), 'an earlier task, saved at the root');
    fs.writeFileSync(path.join(root, 'FE-8', 'archived-link-desktop.png'), 'an earlier task, in its folder');
    fs.writeFileSync(path.join(root, 'notes.txt'), 'not a picture');
    try {
      assert.deepEqual(otherTasksShots(root, mine), ['FE-8/archived-link-desktop.png', 'archive-action-desktop.png']);
      assert.deepEqual(otherTasksShots(root, path.join(root, 'FE-8')), ['FE-9/nested/sort-by-name-phone.webm', 'FE-9/sort-by-name-desktop.png', 'archive-action-desktop.png']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('with no shots directory, names nothing', () => {
    assert.deepEqual(otherTasksShots(path.join(os.tmpdir(), 'no-such-qa-shots-dir'), path.join(os.tmpdir(), 'no-such-qa-shots-dir', 'x')), []);
  });
});

// ---------- the preview demo (backlog 058) ----------
describe('the preview demo recorded from the branch', async () => {
  const { DEMO_DWELL, demoAddress, demoLine, demoSpecHeader, dwellMs, recordPreviewDemo } = await import('./qa.mjs');

  it('holds the screen the time a line takes to say, within bounds, the same figures as core', () => {
    assert.equal(dwellMs(''), DEMO_DWELL.min);
    const line = 'Starred documents sort first.';
    assert.equal(dwellMs(line), 400 + Math.round((line.length / 14) * 1000));
    assert.equal(dwellMs('x'.repeat(2000)), DEMO_DWELL.max);
  });

  it('says the acceptance line a flow was written for, closed as a sentence, else its name', () => {
    assert.equal(demoLine({ name: 'star', criterion: 'A starred document shows a filled star' }), 'A starred document shows a filled star.');
    assert.equal(demoLine({ name: 'Archive two at once' }), 'Archive two at once.');
    assert.equal(demoLine({ name: 'already closed?' }), 'already closed?');
    assert.equal(demoLine({}), '');
  });

  it('shows the path in the address bar, never the container host', () => {
    assert.equal(demoAddress('http://127.0.0.1:4173/library?sort=starred'), '/library?sort=starred');
    assert.equal(demoAddress('http://127.0.0.1:4173'), '/');
  });

  it('writes the header core reads: moments with their address, lines with their time, bounded', () => {
    const spec = JSON.parse(demoSpecHeader(
      [{ atMs: 10.4, what: 'open /library', url: '/library', ok: true }, { atMs: 3000, what: 'click Star', url: '/library' }],
      [{ atMs: 400, text: 'I open the library.' }, { atMs: 3400, text: 'Two documents are starred.' }],
    ));
    assert.deepEqual(spec.timeline, [{ atMs: 10, what: 'open /library', url: '/library', ok: true }, { atMs: 3000, what: 'click Star', url: '/library' }]);
    assert.deepEqual(spec.script, [{ atMs: 400, text: 'I open the library.' }, { atMs: 3400, text: 'Two documents are starred.' }]);
  });

  it('walks the flows in one take, says each criterion and each shoot label, logs each move, and stops a flow at its first failed step', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-'));
    const webm = path.join(dir, 'demo', 'take.webm');
    let clock = 0;
    const calls = [];
    // A locator that chains `.or()` the way Playwright's does, and clicks by its target's name.
    const loc = name => ({
      or: () => loc(name),
      first: () => ({
        async click() {
          if (name === 'text=Vanish') {
            throw new Error('no element matches text=Vanish');
          }
          calls.push(`click ${name}`);
        },
        async waitFor() {},
        async fill(v) { calls.push(`fill ${name}=${v}`); },
      }),
    });
    const page = {
      async goto(url) { calls.push(`goto ${url}`); this._url = url; },
      async waitForLoadState() {},
      async waitForTimeout(ms) { clock += ms; },
      url() { return this._url; },
      locator(sel) { return loc(sel); },
      getByRole(_role, { name }) { return loc(name); },
      getByText(text) { return loc(text); },
      video() { return { path: async () => { fs.mkdirSync(path.dirname(webm), { recursive: true }); fs.writeFileSync(webm, 'x'); return webm; } }; },
    };
    const browser = { async newContext(opts) { calls.push(`context ${opts.recordVideo.size.width}x${opts.recordVideo.size.height}`); return { newPage: async () => page, close: async () => {} }; } };
    const flows = [
      { name: 'Star two documents', criterion: 'Two selected documents are starred in one move', path: '/library', steps: [{ click: 'Select all' }, { shoot: 'Both rows show a filled star' }] },
      { name: 'Copy links', path: '/library?tab=links', steps: [{ click: 'text=Vanish' }, { shoot: 'never reached' }] },
    ];
    const r = await recordPreviewDemo({ browser, base: 'http://127.0.0.1:4173', flows, outDir: dir, now: () => (clock += 100), waitMs: async ms => { clock += ms; } });

    assert.equal(r.error, undefined);
    assert.equal(r.videoPath, webm);
    assert.deepEqual(r.lines.map(l => l.text), ['Two selected documents are starred in one move.', 'Both rows show a filled star', 'Copy links.']);
    assert.deepEqual(r.moments.map(m => m.what), [
      'open /library',
      'click Select all',
      'Both rows show a filled star',
      'open /library?tab=links',
      'click text=Vanish failed: no element matches text=Vanish',
    ]);
    assert.equal(r.moments[0].url, '/library');
    assert.ok(r.lines[1].atMs > r.lines[0].atMs);
    assert.deepEqual(calls, ['context 1440x900', 'goto http://127.0.0.1:4173/library', 'click Select all', 'goto http://127.0.0.1:4173/library?tab=links']);
    assert.ok(r.seconds > 0);
  });

  it('says so when there is nothing to demo', async () => {
    const r = await recordPreviewDemo({ browser: {}, base: 'http://127.0.0.1:4173', flows: [], outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'demo-')) });
    assert.deepEqual(r, { error: 'no flow to demo' });
  });
});
