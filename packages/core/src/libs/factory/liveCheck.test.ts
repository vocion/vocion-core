import { describe, expect, it } from 'vitest';
import { acceptanceLines, lineResults, liveAfterRun, liveNeverLooked, liveReasonSentence, liveVerdict, notCheckedLine, pickAnnouncementImage, readLiveReason, readReleaseLive, readRequestLive, recheckDecision, RecordedLineSchema, releaseRecordedCheck, resolveRecordedLines, uncheckedRow } from './liveCheck';

const row = (status: 'reached' | 'not_reached', extra: Record<string, unknown> = {}) => ({ requestId: 41, flow: 'Last opened line', criterion: 'The line says when it was last opened.', viewport: 'desktop', artifactId: null, status, url: null, ...extra });

describe('what the check concluded', () => {
  it('is seen only when every check state was reached', () => {
    expect(liveVerdict([row('reached'), row('reached', { viewport: 'phone' })])).toMatchObject({ state: 'seen', line: 'Seen live: 2 of 2 states reached', reason: null });
  });

  it('says a check that reached nothing could not reach the change, leading with what stopped it', () => {
    const v = liveVerdict([row('not_reached', { reason: 'step 1 (wait_for "Last opened") failed' })], ['setup "upload" (desktop) did not finish: step 2 (upload) failed']);

    expect(v).toMatchObject({ state: 'not_seen', reached: 0, total: 1 });
    expect(v.line).toBe('Not seen live: QA could not reach the change on the live product. Why: setup "upload" (desktop) did not finish: step 2 (upload) failed');
    expect(liveVerdict([], []).line).toBe('Not seen live: QA could not reach the change on the live product. Why: no line was checked on the live product');
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

  it('counts a QA run that never recorded, so a seat that never records cannot loop', () => {
    expect(liveAfterRun({}, { startedAt, reason: 'the QA run ended without calling record_live_check' })).toEqual({ do: 'retry', attempt: 2, reason: 'the QA run ended without calling record_live_check' });
    expect(liveAfterRun({}, { startedAt, reason: 'the QA run ended without calling record_live_check', attempt: 2 })).toEqual({ do: 'give-up', reason: 'the QA run ended without calling record_live_check' });
  });

  it('gives up once both attempts saw nothing, and reads an older check as no check', () => {
    expect(liveAfterRun({ liveState: 'not_seen', liveCheckedAt: after, liveAttempts: 2, liveReason: 'r' }, { startedAt, reason: null })).toEqual({ do: 'give-up', reason: 'r' });
    expect(liveAfterRun({ liveState: 'seen', liveCheckedAt: '2026-09-30T10:00:00Z' }, { startedAt, reason: null }).do).toBe('retry');
    expect(liveAfterRun({ liveState: 'partial', liveCheckedAt: after, liveAttempts: 2 }, { startedAt, reason: null }).do).toBe('done');
  });
});

describe('why it was not seen, said in a sentence (run 2, 2026-10-01: "locator.setInputFiles: Timeout 15000ms exceeded")', () => {
  const RAW = 'setup "Setup upload doc" (desktop) did not finish: step 2 (upload "input[type=file]") failed: locator.setInputFiles: Timeout 15000ms exceeded';

  it('says a line QA looked for and did not see in its own words, and a record the step language wrote still reads as it did', () => {
    const notSeen = { kind: 'not_seen' as const, detail: 'Save stayed enabled with a blank name, and the blank name was saved.' };

    expect(liveReasonSentence(notSeen)).toBe('QA looked on the live product and did not see it: Save stayed enabled with a blank name, and the blank name was saved');
    expect(liveVerdict([row('not_reached', { reason: notSeen.detail, why: notSeen })]).line).toBe('Not seen live: QA looked on the live product and did not see it: Save stayed enabled with a blank name, and the blank name was saved');
    expect(readLiveReason(notSeen)).toMatchObject({ kind: 'not_seen' });

    const why = { kind: 'setup_failed' as const, flow: 'Setup upload doc', step: { n: 2, verb: 'upload', target: 'input[type=file]' }, detail: RAW };

    expect(liveReasonSentence(why)).toBe('QA could not set up the test data it needed: it stopped at uploading a test file (step 2 of "Setup upload doc")');
    expect(liveReasonSentence({ kind: 'not_visible', step: { n: 3, verb: 'wait_for', target: 'Viewed' }, detail: 'x' })).toBe('QA reached the page, but the change was not visible: it waited for "Viewed" and it never appeared');
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
const rec = (line: number, result: 'seen' | 'not_seen' | 'not_observable', extra: Record<string, unknown> = {}) => RecordedLineSchema.parse({ line, result, evidence: result === 'not_observable' ? [] : ['shot-41'], why: result === 'not_observable' ? 'a CI run' : 'the documents list loaded', ...extra });
const others = (but: number) => [1, 2, 3, 4, 5].filter(n => n !== but).map(n => rec(n, 'not_observable'));

describe('QA records every acceptance line by its number (record_live_check)', () => {
  const lines = new Map([[314, acceptanceLines(FE)]]);

  it('reads the lines from the record, numbered, with whether QA proved each before the merge', () => {
    expect(acceptanceLines(FE).map(l => [l.n, l.provenBeforeMerge])).toEqual([[1, true], [2, true], [3, true], [4, true], [5, false]]);
    expect(acceptanceLines({ acceptance: ['A bare line.'] })).toEqual([{ n: 1, text: 'A bare line.', provenBeforeMerge: false }]);
    expect(acceptanceLines({})).toEqual([]);
  });

  it('ties each line to the record\'s words and the one request shipped, and keeps the lines production cannot show', () => {
    const out = resolveRecordedLines([rec(3, 'seen'), ...others(3)], lines);

    expect(out.ok).toBe(true);
    expect(out.ok && out.lines.find(l => l.line.n === 3)).toMatchObject({ requestId: 314, result: 'seen', evidence: ['shot-41'], line: { text: 'After deploy, GET /v1/documents with a signed-in session returns 200.' } });
    expect(out.ok && out.beforeMerge.map(b => [b.line, b.proven])).toEqual([[1, true], [2, true], [4, true], [5, false]]);
  });

  it('refuses a line the request does not have, listing its lines with their numbers', () => {
    const out = resolveRecordedLines([rec(7, 'seen'), ...others(0)], lines);

    expect(out.ok).toBe(false);
    expect(!out.ok && out.refusal).toContain('line 7 of request #314 is not there: it has 5');
    expect(!out.ok && out.refusal).toContain('  3. After deploy, GET /v1/documents with a signed-in session returns 200. (proven before merge by QA\'s verdict)');
    expect(!out.ok && out.refusal).toContain('  5. The revert stays the baseline until the fix lands.\n');
  });

  it('refuses a seen or not-seen line that cites no evidence, and a line recorded twice', () => {
    expect(resolveRecordedLines([rec(3, 'seen', { evidence: [] }), ...others(3)], lines)).toMatchObject({ ok: false, refusal: expect.stringContaining('line 3 of request #314 is recorded seen and cites no evidence') });
    expect(resolveRecordedLines([rec(3, 'not_seen', { evidence: [] }), ...others(3)], lines)).toMatchObject({ ok: false, refusal: expect.stringContaining('recorded not_seen and cites no evidence') });
    expect(resolveRecordedLines([rec(3, 'seen'), rec(3, 'not_seen'), ...others(3)], lines)).toMatchObject({ ok: false, refusal: expect.stringContaining('line 3 of request #314 is recorded twice') });
  });

  it('refuses a request the release did not ship, and asks which request on a release that shipped several', () => {
    expect(resolveRecordedLines([rec(1, 'seen', { request_id: 99 })], lines)).toMatchObject({ ok: false, refusal: expect.stringContaining('request #99, which this release did not ship') });
    expect(resolveRecordedLines([rec(1, 'seen')], new Map([[1, acceptanceLines(FE)], [2, acceptanceLines(FE)]]))).toMatchObject({ ok: false, refusal: expect.stringContaining('names no request_id') });
  });

  it('refuses a recording that leaves a line out, listing each by number (Walk 7: release #363, 1 of 6)', () => {
    const out = resolveRecordedLines([rec(3, 'seen')], lines);

    expect(out.ok).toBe(false);

    const refusal = !out.ok ? out.refusal : '';

    expect(refusal).toContain('4 acceptance lines are not recorded');
    expect(refusal).toContain('request #314: line 1 (CI builds the arm64 image three times without exit 132.); line 2 (The engine in the image is linux-musl-arm64.); line 4 (npm ci targets arm64.); line 5 (The revert stays the baseline until the fix lands.)');
    expect(refusal).not.toMatch(/: line 3 \(/);
    expect(refusal).toContain('  3. After deploy, GET /v1/documents');

    const one = resolveRecordedLines([rec(3, 'seen'), ...[1, 2, 5].map(n => rec(n, 'not_observable'))], lines);

    expect(!one.ok && one.refusal).toContain('An acceptance line is not recorded:\nrequest #314: line 4 (npm ci targets arm64.)');
  });

  it('asks for every line of every request a release shipped', () => {
    const two = new Map([[1, acceptanceLines({ acceptance: ['A'] })], [2, acceptanceLines({ acceptance: ['B', 'C'] })]]);
    const out = resolveRecordedLines([rec(1, 'seen', { request_id: 1 }), rec(1, 'seen', { request_id: 2 })], two);

    expect(!out.ok && out.refusal).toContain('An acceptance line is not recorded:\nrequest #2: line 2 (C)');
    expect(resolveRecordedLines([rec(1, 'seen', { request_id: 1 }), rec(1, 'seen', { request_id: 2 }), rec(2, 'not_observable', { request_id: 2 })], two).ok).toBe(true);
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

  // Walk 19 (FE-432, 2026-10-04): tags live in a team library; the QA account had only a personal
  // one; every line was recorded not_observable and the release read "seen" over nothing seen.
  it('reads not checked, with the fix named, when the QA environment cannot reach the feature — never seen', () => {
    const cannot = [1, 2].map(line => ({ requestId: 432, line, text: `line ${line}`, why: 'The QA account is personal-only; tags need a team library. Needs a team-org QA account.', proven: true, cause: 'environment_cannot_show' as const }));
    const v = liveVerdict([], [], [...cannot, { requestId: 432, line: 3, text: 'line 3', why: 'CI only', proven: true, cause: 'proven_before_merge' as const }]);

    expect(v.state).toBe('not_checked');
    expect(v.why).toMatchObject({ kind: 'environment_cannot_show' });
    expect(v.line).toBe('Could not check live: the QA environment cannot show it (The QA account is personal-only; tags need a team library. Needs a team-org QA account); 2 lines could not be seen. Fix the environment\'s live setup, then Check live again');
    // A line the environment cannot show beside one QA did reach is still a partial look, said as such.
    expect(liveVerdict([row('reached')], [], cannot).state).toBe('seen');
    // Nothing checks it again by itself: the fix is a person's.
    expect(recheckDecision({ mark: { state: 'not_checked', releaseId: 9, checkedAt: '2026-10-04T16:00:00Z', attempts: 0, why: v.why }, releaseMeta: { liveCheckedAt: '2026-10-04T16:00:00Z' }, deploy: { id: 5, at: new Date('2026-10-04T17:00:00Z') }, now: new Date('2026-10-04T18:00:00Z') })).toMatchObject({ do: 'skip', why: expect.stringContaining('a person fixes the environment') });
    expect(readRequestLive({ liveCheck: { state: 'not_checked', line: v.line, releaseId: 9, checkedAt: '2026-10-04T16:00:00Z', attempt: 1, why: v.why } })).toMatchObject({ state: 'not_checked', reasonKind: 'environment_cannot_show' });
    expect(liveReasonSentence(v.why!)).toContain('Fix the environment\'s live setup, then Check live again');
  });

  it('carries the cause QA gave for a line production cannot show', () => {
    const lines = new Map([[432, [{ n: 1, text: 'Tags show as chips.', provenBeforeMerge: true }]]]);
    const r = resolveRecordedLines([RecordedLineSchema.parse({ line: 1, result: 'not_observable', why: 'no team library on the QA account', cause: 'environment_cannot_show' })], lines);

    expect(r.ok && r.beforeMerge[0]).toMatchObject({ line: 1, proven: true, cause: 'environment_cannot_show' });
    expect(RecordedLineSchema.safeParse({ line: 1, result: 'not_observable', why: 'x', cause: 'because' }).success).toBe(false);
  });
});

// FE-392 (2026-10-03), fictional: QA approved the acceptance lines and left one plan-risk line to the
// live check (`live`); the live check was never shown it, saw "4 of 4", and the page read it Unverified.
describe('a line QA\'s verdict left to the live check is one the check must account for', () => {
  const RISK = 'The plan\'s risk is handled: a third badge must not push the menu off the title row on a phone.';
  const OWN = ['The title shows a Shared badge when a link is live.', 'The badge opens the share panel.'];
  const attempt = {
    id: 77,
    meta: {
      requestId: 12,
      acceptanceContract: [...OWN, RISK],
      verdict: { value: 'approve', criteria: [...OWN.map(criterion => ({ criterion, status: 'proven', evidence: 'Screenshot https://kestrel.example/a/1' })), { criterion: RISK, status: 'live' }] },
    },
  };
  const request = { acceptance: OWN.map(statement => ({ statement })) };
  const lines = acceptanceLines(request, { tasks: [attempt], shippedTaskIds: [77] });

  it('follows the acceptance lines, numbered on from them, marked as left to the live check', () => {
    expect(lines).toEqual([
      { n: 1, text: OWN[0], provenBeforeMerge: true },
      { n: 2, text: OWN[1], provenBeforeMerge: true },
      { n: 3, text: RISK, provenBeforeMerge: false, leftToLive: true },
    ]);
    // Without the shipped attempts, only the request's own lines, as before.
    expect(acceptanceLines(request).map(l => l.n)).toEqual([1, 2]);
  });

  it('refuses a recording that leaves it out, and lists it labelled', () => {
    const out = resolveRecordedLines([rec(1, 'seen'), rec(2, 'seen')], new Map([[12, lines]]));

    expect(out.ok).toBe(false);
    expect(!out.ok && out.refusal).toContain('An acceptance line is not recorded:\nrequest #12: line 3 (The plan\'s risk is handled');
    expect(!out.ok && out.refusal).toContain(`  3. ${RISK} (QA left this to the live check)`);

    const all = resolveRecordedLines([rec(1, 'seen'), rec(2, 'seen'), rec(3, 'seen')], new Map([[12, lines]]));

    expect(all.ok && all.lines[2]).toMatchObject({ requestId: 12, line: { n: 3, text: RISK } });
  });

  it('keeps what the check saw of each line by its words, for the feature page', () => {
    const row = (line: number, criterion: string, status: 'reached' | 'not_reached', viewport = 'desktop') => ({ requestId: 12, flow: `line ${line}`, line, criterion, viewport, artifactId: null, status, url: status === 'reached' ? 'https://kestrel.example/documents/9' : null, ...(status === 'not_reached' ? { reason: 'menu not visible' } : {}) });

    expect(lineResults([row(1, OWN[0]!, 'reached'), row(3, RISK, 'reached'), row(3, RISK, 'not_reached', 'phone'), uncheckedRow(12, { n: 2, text: OWN[1]!, provenBeforeMerge: false }, true)])).toEqual([
      { line: 1, text: OWN[0], result: 'reached', url: 'https://kestrel.example/documents/9', reason: null },
      { line: 3, text: RISK, result: 'not_reached', url: 'https://kestrel.example/documents/9', reason: 'menu not visible' },
      { line: 2, text: OWN[1], result: 'not_checked', url: null, reason: expect.stringContaining('cannot be seen on the live product') },
    ]);
  });
});

describe('a live check that never looked (FE-419)', () => {
  const now = new Date('2026-10-03T12:00:00Z');
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
  const noReport = { state: 'not_checked', releaseId: 9, checkedAt: hoursAgo(2), attempts: 0, lastReason: 'the run wrote no report' };

  it('says it could not check, why, and that Vocion checks again; once the rechecks are spent it asks once', () => {
    expect(notCheckedLine('run #12 ended without record_live_check.', 0)).toBe('Couldn\'t check live yet: run #12 ended without record_live_check. Vocion will check again.');
    expect(notCheckedLine('run #12 ended without record_live_check', 2)).toBe('Couldn\'t check live yet: run #12 ended without record_live_check. Vocion will check again.');
    expect(notCheckedLine('run #12 ended without record_live_check', 3)).toBe('Couldn\'t check live: run #12 ended without record_live_check. Vocion checked again 3 times by itself and none recorded a report; press Check live again once what stops it is fixed.');
  });

  it('reads not_checked on the request and the release as its own state, never "not seen"', () => {
    expect(readRequestLive({ liveCheck: { ...noReport, line: 'Couldn\'t check live yet: x. Vocion will check again.' } })).toMatchObject({ state: 'not_checked', line: 'Couldn\'t check live yet: x. Vocion will check again.', releaseId: 9, attempts: 0, detail: 'the run wrote no report' });
    expect(readReleaseLive({ liveState: 'not_checked', liveSummary: 'Couldn\'t check live yet: x. Vocion will check again.', liveReason: 'x' })).toMatchObject({ state: 'not_checked', line: 'Couldn\'t check live yet: x. Vocion will check again.', detail: 'x' });
  });

  it('tells a check that recorded from one that wrote no report by the record, not the words', () => {
    expect(releaseRecordedCheck({ liveAttempts: 1, liveEvidence: [] })).toBe(true);
    expect(releaseRecordedCheck({ liveEvidence: [{ status: 'not_reached' }] })).toBe(true);
    expect(releaseRecordedCheck({ liveState: 'not_seen', liveSummary: 'Not seen live: …', liveAttempts: 0 })).toBe(false);
    expect(liveNeverLooked({ state: 'not_seen' }, { liveState: 'not_seen' })).toBe(true);
    expect(liveNeverLooked({ state: 'not_seen' }, { liveState: 'not_seen', liveAttempts: 1, liveEvidence: [{}] })).toBe(false);
    expect(liveNeverLooked({ state: 'seen' }, {})).toBe(false);
  });

  it('rechecks once per deploy after the round, never twice for one deploy', () => {
    const deploy = { id: 41, at: new Date(hoursAgo(1)) };

    expect(recheckDecision({ mark: noReport, releaseMeta: {}, deploy, now })).toEqual({ do: 'recheck', key: 'deploy 41', attempt: 1 });
    expect(recheckDecision({ mark: { ...noReport, attempts: 1, recheckedFor: 'deploy 41', recheckedAt: hoursAgo(0.5) }, releaseMeta: {}, deploy, now }).do).toBe('skip');
    // A deploy older than the round is not a reason to look again.
    expect(recheckDecision({ mark: noReport, releaseMeta: {}, deploy: { id: 40, at: new Date(hoursAgo(3)) }, now })).toEqual({ do: 'recheck', key: 'delay', attempt: 1 });
    // While a recheck may still run, a newer deploy waits for it.
    expect(recheckDecision({ mark: { ...noReport, attempts: 1, recheckedFor: 'delay', recheckedAt: hoursAgo(0.2) }, releaseMeta: {}, deploy, now }).do).toBe('skip');
  });

  it('rechecks once by itself after a short delay, and only once', () => {
    expect(recheckDecision({ mark: { ...noReport, checkedAt: hoursAgo(0.1) }, releaseMeta: {}, deploy: null, now }).do).toBe('skip');
    expect(recheckDecision({ mark: noReport, releaseMeta: {}, deploy: null, now })).toEqual({ do: 'recheck', key: 'delay', attempt: 1 });
    expect(recheckDecision({ mark: { ...noReport, attempts: 1, recheckedFor: 'delay', recheckedAt: hoursAgo(1) }, releaseMeta: {}, deploy: null, now }).do).toBe('skip');
  });

  it('respects the cap', () => {
    expect(recheckDecision({ mark: { ...noReport, attempts: 3 }, releaseMeta: {}, deploy: { id: 50, at: new Date(hoursAgo(1)) }, now })).toEqual({ do: 'skip', why: 'the rechecks are spent; a person checks it again' });
  });

  it('never rechecks a genuine not seen: QA looked and recorded what failed', () => {
    expect(recheckDecision({ mark: { state: 'not_seen', releaseId: 9, checkedAt: hoursAgo(2), attempt: 1, lines: [{ line: 1, result: 'not_reached' }] }, releaseMeta: { liveState: 'not_seen', liveAttempts: 1, liveEvidence: [{ status: 'not_reached' }] }, deploy: { id: 50, at: new Date(hoursAgo(1)) }, now })).toEqual({ do: 'skip', why: 'the check looked' });
  });
});
