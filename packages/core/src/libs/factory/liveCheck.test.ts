import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fromRepoRoot } from '@/libs/repo-root';
import { acceptanceLines, keptShots, LIVE_STEP_VERBS, liveAfterRun, LiveFlowSchema, liveReasonSentence, liveVerdict, orderedFlows, pickAnnouncementImage, readLiveReason, readReleaseLive, readRequestLive, resolveLines, shotStatus, stepReason, uncheckedRow } from './liveCheck';

const row = (status: 'reached' | 'not_reached', extra: Record<string, unknown> = {}) => ({ requestId: 41, flow: 'Last opened line', criterion: 'The line says when it was last opened.', viewport: 'desktop', artifactId: null, status, url: null, ...extra });

describe('the live flow', () => {
  it('speaks the runner\'s own step vocabulary — one contract both sides hold to', async () => {
    const runner = await import(pathToFileURL(fromRepoRoot('packages/runner/src/contract.mjs')).href) as { QA_STEP_VERBS: string[] };

    expect([...LIVE_STEP_VERBS]).toEqual(runner.QA_STEP_VERBS);
  });

  it('defaults to a signed-in check on desktop, and refuses a step that names no verb or two', () => {
    expect(LiveFlowSchema.parse({ name: 'Last opened line', path: '{{documentUrl}}' })).toMatchObject({ phase: 'check', signed_in: true, viewports: ['desktop'], steps: [] });
    expect(LiveFlowSchema.safeParse({ name: 'x', path: '/', steps: [{ click: 'Share', shoot: 'Share' }] }).success).toBe(false);
    expect(LiveFlowSchema.safeParse({ name: 'x', path: '/', steps: [{ hover: 'Share' }] }).success).toBe(false);
  });

  it('runs setup, then the checks, then cleanup, each in the order written', () => {
    const flows = [{ name: 'c1', phase: 'check' }, { name: 'z', phase: 'cleanup' }, { name: 's1', phase: 'setup' }, { name: 'c2', phase: 'check' }, { name: 's2', phase: 'setup' }] as const;

    expect(orderedFlows(flows).map(f => f.name)).toEqual(['s1', 's2', 'c1', 'c2', 'z']);
  });
});

describe('what one shot shows', () => {
  it('is not reached when a step failed, when production sent it to sign-in, or when the page shows an app error', () => {
    expect(shotStatus('/documents/d1', { file: 'a.png', label: 'line', at: '/documents/d1', shortOf: 'step 2 (wait_for "Last opened") failed' })).toEqual({ status: 'not_reached', reason: 'step 2 (wait_for "Last opened") failed', kind: 'not_visible' });
    expect(shotStatus('/documents/d1', { file: 'a.png', label: '', at: '/sign-in?next=%2F' })).toEqual({ status: 'not_reached', reason: 'production sent the page to sign-in (/sign-in) after QA signed in', kind: 'sign_in_failed' });
    expect(shotStatus('/documents/d1', { file: 'a.png', label: '', at: '/documents/d1', errorState: true }).status).toBe('not_reached');
    expect(shotStatus('/documents/d1', { file: 'a.png', label: 'line', at: '/documents/d1' })).toEqual({ status: 'reached' });
  });

  it('a signed-out flow sent to sign-in opened a page behind sign-in; it is not a failed sign-in (Walk 10, release #386)', () => {
    // Four signed-in flows reached their pages; the fifth ran as a visitor on the signed-in
    // library and was bounced, and the release read "QA could not sign in as its QA account".
    const visitor = shotStatus('/', { file: 'a.png', label: 'Visitor view', at: '/sign-in' }, false);

    expect(visitor).toEqual({ status: 'not_reached', reason: 'the flow ran signed out and production sent / to sign-in (/sign-in)', kind: 'visitor_sent_to_sign_in', path: '/' });
    expect(liveReasonSentence({ kind: 'visitor_sent_to_sign_in', flow: 'Check line 4: visitor view', path: '/', detail: visitor.reason! })).toBe('"Check line 4: visitor view" ran signed out, and the page it opened (/) needs sign-in');
    expect(readLiveReason({ kind: 'visitor_sent_to_sign_in', detail: 'x' })).toMatchObject({ kind: 'visitor_sent_to_sign_in' });
    // Signed in, the same bounce is the session not holding.
    expect(shotStatus('/', { file: 'a.png', label: '', at: '/sign-in' }, true).kind).toBe('sign_in_failed');
    expect(keptShots('/', { shots: [{ file: '1', label: 'v', at: '/sign-in' }], stepFailures: [] }, false)[0]).toMatchObject({ kind: 'visitor_sent_to_sign_in' });
  });

  it('keeps each named shot, and the last picture only when nothing was named or a step failed', () => {
    const named = { shots: [{ file: '1', label: 'Last opened line', at: '/d' }, { file: '2', label: '', at: '/d' }], stepFailures: [] };

    expect(keptShots('/d', named).map(k => k.shot.file)).toEqual(['1']);
    expect(keptShots('/d', { ...named, stepFailures: [{}] }).map(k => k.shot.file)).toEqual(['1', '2']);
    expect(keptShots('/d', { shots: [{ file: '2', label: '', at: '/d' }], stepFailures: [] }).map(k => k.shot.file)).toEqual(['2']);
  });
});

describe('what the check concluded', () => {
  it('is seen only when every check state was reached', () => {
    expect(liveVerdict([row('reached'), row('reached', { viewport: 'phone' })])).toMatchObject({ state: 'seen', line: 'Seen live: 2 of 2 states reached', reason: null });
  });

  it('says a check that reached nothing could not reach the change, leading with what stopped it', () => {
    const v = liveVerdict([row('not_reached', { reason: 'step 1 (wait_for "Last opened") failed' })], ['setup "upload" (desktop) did not finish: step 2 (upload) failed']);

    expect(v).toMatchObject({ state: 'not_seen', reached: 0, total: 1 });
    expect(v.line).toBe('Not seen live: QA could not reach the change on the live product. Why: setup "upload" (desktop) did not finish: step 2 (upload) failed');
    expect(liveVerdict([], []).line).toBe('Not seen live: QA could not reach the change on the live product. Why: no check flow was run');
  });

  it('says partly seen, with what was not', () => {
    expect(liveVerdict([row('reached'), row('not_reached', { reason: 'the page shows an app error' })]).line).toBe('Partly seen live: 1 of 2 states reached. Not reached: the page shows an app error');
  });

  it('leads the announcement with the first reached shot of a criterion, desktop first', () => {
    expect(pickAnnouncementImage([row('reached', { viewport: 'phone', artifactId: 9 }), row('reached', { artifactId: 8 }), row('not_reached', { artifactId: 7 })])).toBe(8);
    expect(pickAnnouncementImage([row('not_reached', { artifactId: 7 })])).toBeNull();
  });
});

describe('reading it back', () => {
  it('reads a release checked before liveState from its rows: 0 of 6 is not seen (release #280)', () => {
    const rows = Array.from({ length: 6 }, () => ({ flow: 'f', status: 'not_reached', reason: 'step 1 (wait_for "text=Last opened 2 hours ago by maya@acme.example") failed' }));

    expect(readReleaseLive({ liveEvidence: rows, liveSummary: '0 of 6 live states reached' })).toMatchObject({ state: 'not_seen' });
    expect(readReleaseLive({})).toBeNull();
    expect(readReleaseLive({ liveState: 'seen', liveSummary: 'Seen live: 1 of 1 state reached', liveCheckedAt: '2026-10-01T10:00:00Z' })).toEqual({ state: 'seen', line: 'Seen live: 1 of 1 state reached', checkedAt: '2026-10-01T10:00:00Z', detail: null });
  });

  it('reads a feature\'s own mark', () => {
    expect(readRequestLive({ liveCheck: { state: 'not_seen', line: 'Live check could not reach the change: x', releaseId: 280 } })).toMatchObject({ state: 'not_seen', releaseId: 280 });
    expect(readRequestLive({})).toBeNull();
  });
});

describe('when QA\'s fire ends', () => {
  const startedAt = new Date('2026-10-01T10:00:00Z');
  const after = '2026-10-01T10:05:00Z';

  it('is done when this fire saw the change', () => {
    expect(liveAfterRun({ liveState: 'seen', liveCheckedAt: after, liveAttempts: 1 }, { startedAt, reason: null })).toEqual({ do: 'done', why: 'seen live' });
  });

  it('checks once more, carrying why, when the first attempt did not see it', () => {
    expect(liveAfterRun({ liveState: 'not_seen', liveCheckedAt: after, liveAttempts: 1, liveReason: 'step 2 (wait_for "Last opened") failed' }, { startedAt, reason: null })).toEqual({ do: 'retry', attempt: 2, reason: 'step 2 (wait_for "Last opened") failed' });
  });

  it('counts a QA run that never checked, so a seat that never calls check_live cannot loop', () => {
    expect(liveAfterRun({}, { startedAt, reason: 'the QA run ended without calling check_live' })).toEqual({ do: 'retry', attempt: 2, reason: 'the QA run ended without calling check_live' });
    expect(liveAfterRun({}, { startedAt, reason: 'the QA run ended without calling check_live', attempt: 2 })).toEqual({ do: 'give-up', reason: 'the QA run ended without calling check_live' });
  });

  it('gives up once both attempts saw nothing, and reads an older check as no check', () => {
    expect(liveAfterRun({ liveState: 'not_seen', liveCheckedAt: after, liveAttempts: 2, liveReason: 'r' }, { startedAt, reason: null })).toEqual({ do: 'give-up', reason: 'r' });
    expect(liveAfterRun({ liveState: 'seen', liveCheckedAt: '2026-09-30T10:00:00Z' }, { startedAt, reason: null }).do).toBe('retry');
    expect(liveAfterRun({ liveState: 'partial', liveCheckedAt: after, liveAttempts: 2 }, { startedAt, reason: null }).do).toBe('done');
  });
});

describe('why it was not seen, said in a sentence (run 2, 2026-10-01: "locator.setInputFiles: Timeout 15000ms exceeded")', () => {
  const RAW = 'setup "Setup upload doc" (desktop) did not finish: step 2 (upload "input[type=file]") failed: locator.setInputFiles: Timeout 15000ms exceeded';

  it('says which setup step could not make the test data, with the raw words kept as the detail', () => {
    const why = stepReason('setup', 'Setup upload doc', { index: 1, verb: 'upload', target: 'input[type=file]', error: 'locator.setInputFiles: Timeout 15000ms exceeded' }, RAW);

    expect(why).toMatchObject({ kind: 'setup_failed', flow: 'Setup upload doc', step: { n: 2, verb: 'upload' }, detail: RAW });
    expect(liveReasonSentence(why)).toBe('QA could not set up the test data it needed: it stopped at uploading a test file (step 2 of "Setup upload doc")');

    const verdict = liveVerdict([row('not_reached', { reason: RAW, why })], [why]);

    expect(verdict.line).toBe('Not seen live: QA could not set up the test data it needed: it stopped at uploading a test file (step 2 of "Setup upload doc")');
    expect(verdict.line).not.toContain('locator');
    expect(verdict.reason).toBe(RAW);
    expect(verdict.why).toMatchObject({ kind: 'setup_failed' });
  });

  it('a check step says the page was not there, or the change was not visible', () => {
    expect(liveReasonSentence(stepReason('check', 'C1', { index: 0, verb: 'goto', target: '/d/abc', error: 'net::ERR' }, 'x'))).toBe('The page QA opened was not there on the live product (/d/abc)');
    expect(liveReasonSentence(stepReason('check', 'C1', { index: 2, verb: 'wait_for', target: 'Viewed', error: 'Timeout' }, 'x'))).toBe('QA reached the page, but the change was not visible: it waited for "Viewed" and it never appeared');
    expect(liveReasonSentence({ kind: 'sign_in_failed', detail: 'x' })).toBe('QA could not sign in to the live product as its QA account');
    expect(liveReasonSentence({ kind: 'app_error', detail: 'x' })).toBe('The page showed an error instead of the change');
  });

  it('reads back from the release and the feature: the sentence on the line, the raw words as the detail', () => {
    const why = { kind: 'setup_failed', flow: 'Setup upload doc', step: { n: 2, verb: 'upload', target: 'input[type=file]' }, detail: RAW };

    expect(readLiveReason(why)).toMatchObject({ kind: 'setup_failed', step: { n: 2 } });
    expect(readLiveReason({ kind: 'nonsense', detail: 'x' })).toBeNull();
    expect(readReleaseLive({ liveState: 'not_seen', liveReason: RAW, liveWhy: why, liveAttempts: 2 })).toMatchObject({
      line: expect.stringMatching(/^Not seen live: QA could not set up the test data it needed: it stopped at uploading a test file/),
      detail: RAW,
    });
    expect(readRequestLive({ liveCheck: { state: 'not_seen', line: 'Not seen live: QA could not set up the test data it needed', releaseId: 302, why } })).toMatchObject({ detail: RAW });
    // A release checked before reasons were typed still reads in the check's own words.
    expect(readReleaseLive({ liveState: 'not_seen', liveReason: 'no state was reached' })?.line).toMatch(/^Not seen live: QA could not reach the change on the live product\. Why: no state was reached/);
  });
});

// FE-314 / REL-347 (2026-10-02), fictional: five lines, four only provable before the merge, one on
// production. QA checked a line the feature never had, and the release read "Not seen live".
const proven = (statement: string) => ({ statement, met: true, evidence: 'Named test passed: https://ci.example/run/7' });
const FE = {
  acceptance: [
    proven('CI builds the arm64 image three times without exit 132.'),
    proven('The engine in the image is linux-musl-arm64.'),
    proven('After deploy, GET /v1/documents with a signed-in session returns 200.'),
    proven('npm ci targets arm64.'),
    { statement: 'The revert stays the baseline until the fix lands.' },
  ],
};
const check = (extra: Record<string, unknown>) => LiveFlowSchema.parse({ name: 'documents list', path: '/documents', steps: [{ expect_response: { path: '/v1/documents', status: 200 } }, { shoot: 'Documents list' }], ...extra });

describe('a check flow cites an acceptance line by its number', () => {
  const lines = new Map([[314, acceptanceLines(FE)]]);

  it('reads the lines from the record, numbered, with whether QA proved each before the merge', () => {
    expect(acceptanceLines(FE).map(l => [l.n, l.provenBeforeMerge])).toEqual([[1, true], [2, true], [3, true], [4, true], [5, false]]);
    expect(acceptanceLines({ acceptance: ['A bare line.'] })).toEqual([{ n: 1, text: 'A bare line.', provenBeforeMerge: false }]);
    expect(acceptanceLines({})).toEqual([]);
  });

  it('writes the line\'s words from the record, never QA\'s, and ties it to the one request shipped', () => {
    const out = resolveLines([check({ line: 3, criterion: 'A visitor can download the shared file' })], [], lines, { explore: true });

    expect(out.ok).toBe(true);
    expect(out.ok && out.flows[0]).toMatchObject({ request_id: 314, line: 3, criterion: 'After deploy, GET /v1/documents with a signed-in session returns 200.' });
  });

  it('refuses a line the request does not have, listing its lines with their numbers', () => {
    const out = resolveLines([check({ line: 7 })], [], lines);

    expect(out.ok).toBe(false);
    expect(!out.ok && out.refusal).toContain('cites line 7 of request #314, which has 5');
    expect(!out.ok && out.refusal).toContain('  3. After deploy, GET /v1/documents with a signed-in session returns 200. (proven before merge by QA\'s verdict)');
    expect(!out.ok && out.refusal).toContain('  5. The revert stays the baseline until the fix lands.\n');
  });

  it('refuses a check that cites nothing when the request has lines, except while exploring', () => {
    expect(resolveLines([check({})], [], lines)).toMatchObject({ ok: false, refusal: expect.stringContaining('cites no acceptance line') });
    expect(resolveLines([check({})], [], lines, { explore: true }).ok).toBe(true);
    // A request with no lines has nothing to cite: its check runs, as before.
    expect(resolveLines([check({})], [], new Map([[9, []]])).ok).toBe(true);
  });

  it('refuses a request the release did not ship, and asks which request on a release that shipped several', () => {
    expect(resolveLines([check({ line: 1, request_id: 99 })], [], lines)).toMatchObject({ ok: false, refusal: expect.stringContaining('request #99, which this release did not ship') });
    expect(resolveLines([check({ line: 1 })], [], new Map([[1, acceptanceLines(FE)], [2, acceptanceLines(FE)]]))).toMatchObject({ ok: false, refusal: expect.stringContaining('names no request_id') });
  });

  it('keeps the lines production cannot show, and says which no flow and no word covered', () => {
    const out = resolveLines([check({ line: 3 })], [{ line: 1, why: 'a CI run' }, { line: 2, why: 'the image' }, { line: 5, why: 'before the merge' }, { line: 3, why: 'checked anyway' }], lines, { explore: true });

    expect(out.ok && out.beforeMerge.map(b => [b.line, b.proven])).toEqual([[1, true], [2, true], [5, false]]);
    expect(out.ok && out.uncovered.map(u => u.line.n)).toEqual([4]);
    expect(resolveLines([check({ line: 3 })], [{ line: 6, why: 'x' }], lines)).toMatchObject({ ok: false, refusal: expect.stringContaining('not_observable line 6 of request #314 is not there') });
  });

  it('refuses a recording call that leaves a line neither cited nor named, listing each by number (Walk 7: release #363, 1 of 6)', () => {
    // QA cited line 3 and said nothing of the other four.
    const out = resolveLines([check({ line: 3 })], [], lines);

    expect(out.ok).toBe(false);

    const refusal = !out.ok ? out.refusal : '';

    expect(refusal).toContain('4 acceptance lines are neither cited by a check flow nor named in not_observable');
    expect(refusal).toContain('request #314: line 1 (CI builds the arm64 image three times without exit 132.); line 2 (The engine in the image is linux-musl-arm64.); line 4 (npm ci targets arm64.); line 5 (The revert stays the baseline until the fix lands.)');
    expect(refusal).not.toMatch(/: line 3 \(/);
    expect(refusal).toContain('  3. After deploy, GET /v1/documents');

    // One left: named in the singular.
    const one = resolveLines([check({ line: 3 })], [1, 2, 5].map(line => ({ line, why: 'pre-merge' })), lines);

    expect(!one.ok && one.refusal).toContain('An acceptance line is neither cited by a check flow nor named in not_observable:\nrequest #314: line 4 (npm ci targets arm64.)');
  });

  it('asks for every line of every request a release shipped, and stays free while exploring', () => {
    const two = new Map([[1, acceptanceLines({ acceptance: ['A'] })], [2, acceptanceLines({ acceptance: ['B', 'C'] })]]);
    const out = resolveLines([check({ line: 1, request_id: 1 }), check({ line: 1, request_id: 2 })], [], two);

    expect(!out.ok && out.refusal).toContain('An acceptance line is neither cited by a check flow nor named in not_observable:\nrequest #2: line 2 (C)');
    expect(resolveLines([check({ line: 1, request_id: 1 }), check({ line: 1, request_id: 2 })], [{ request_id: 2, line: 2, why: 'a CI run' }], two).ok).toBe(true);
    expect(resolveLines([check({ line: 1, request_id: 1 })], [], two, { explore: true }).ok).toBe(true);
  });

  it('runs a check flow alone: no setup is asked for', () => {
    const out = resolveLines([check({ line: 3 })], [1, 2, 4, 5].map(line => ({ line, why: 'pre-merge' })), lines);

    expect(out.ok && out.flows.map(f => f.phase)).toEqual(['check']);
    expect(out.ok && out.uncovered).toEqual([]);
  });
});

describe('the live state counts only what production can show', () => {
  const before = [1, 2, 4].map(line => ({ requestId: 314, line, text: `line ${line}`, why: 'pre-merge', proven: true }));

  it('reads Seen live when every live-observable line was reached, with what the API answered and the lines proven before merge', () => {
    const v = liveVerdict([row('reached', { proved: ['GET /v1/documents returned 200 signed in'] })], [], before);

    expect(v.state).toBe('seen');
    expect(v.line).toBe('Seen live: 1 of 1 state reached (GET /v1/documents returned 200 signed in). 3 more lines proven before merge by QA\'s verdict');
  });

  it('counts a line QA never covered, or one production cannot show that QA never proved, as unreached, saying why', () => {
    const v = liveVerdict([row('reached'), uncheckedRow(314, { n: 5, text: 'The revert stays the baseline.', provenBeforeMerge: false }, true)], [], before);

    expect(v.state).toBe('partial');
    expect(v.line).toContain('Not reached: Line 5 of request #314 cannot be seen on the live product, and QA\'s verdict did not prove it before merge');
    expect(liveVerdict([uncheckedRow(314, { n: 4, text: 'x', provenBeforeMerge: true }, false)]).line).toBe('Not seen live: QA did not check line 4 of request #314 on the live product, and did not say production cannot show it');
  });

  it('reads Nothing to see when every line was proven before merge and none can be seen live', () => {
    expect(liveVerdict([], [], before)).toMatchObject({ state: 'seen', line: 'Nothing to see on the live product: 3 lines proven before merge by QA\'s verdict' });
    expect(liveVerdict([], ['the browser would not start'], before).state).toBe('not_seen');
  });
});

describe('expect_response', () => {
  it('takes {path, status, method?} and refuses anything else', () => {
    expect(LiveFlowSchema.safeParse({ name: 'x', path: '/', steps: [{ expect_response: { path: '/v1/documents', status: 200, method: 'GET' } }] }).success).toBe(true);
    expect(LiveFlowSchema.safeParse({ name: 'x', path: '/', steps: [{ expect_response: { path: '/v1/documents' } }] }).success).toBe(false);
    expect(LiveFlowSchema.safeParse({ name: 'x', path: '/', steps: [{ expect_response: '/v1/documents' }] }).success).toBe(false);
  });

  it('says what the API answered instead, from the runner\'s own words for the step', () => {
    const why = stepReason('check', 'documents list', { index: 1, verb: 'expect_response', target: '/v1/documents', error: 'GET /v1/documents returned 500, not 200' }, 'step 2 failed');

    expect(liveReasonSentence(why)).toBe('QA reached the page, but the API did not answer as promised: GET /v1/documents returned 500, not 200');
    expect(readLiveReason(JSON.parse(JSON.stringify(why)))?.step?.error).toBe('GET /v1/documents returned 500, not 200');
  });
});
