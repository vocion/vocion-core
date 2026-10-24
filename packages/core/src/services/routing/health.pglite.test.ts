/**
 * Is Jev live (ADR 0006, health), against a real database: every reason the
 * code writes sorts into one outcome (a rejected key is `auth`, distinct from
 * a timeout or an unsure answer); each decision type is read from the record
 * it already writes, a turn once however many calls it made; the outcomes on
 * record are joined (runs, another agent answering later, Undo on links); the
 * live check proves the key without returning it; another Org's rows are never
 * read. Jev is never called: fetch is a fake. Every name is invented.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const S = await import('@/models/Schema');
const health = await import('./health');

const WS = 'ws_jev_health';
const OTHER = 'ws_jev_health_other';
const NOW = Date.now();
const FROM = new Date(NOW - 86_400_000);
const TO = new Date(NOW + 60_000);
const at = (minsAgo: number) => new Date(NOW - minsAgo * 60_000);
const V = (type: string) => `${type}-abcd1234`;

describe('jevOutcomeOf', () => {
  it('sorts every reason the code writes', () => {
    const cases: Array<[string | null, boolean, string]> = [
      [null, true, 'used'],
      [null, false, 'used'], // answered from the turn cache
      ['Jev (typesafe) answered HTTP 401', true, 'auth'],
      ['Jev (openrouter) answered HTTP 403', true, 'auth'],
      ['Jev (typesafe) answered HTTP 429', true, 'rate_limited'],
      ['Jev (typesafe) answered HTTP 500', true, 'http_error'],
      ['Jev (typesafe) answered HTTP 400', true, 'http_error'],
      ['no answer within 1500 ms', true, 'timeout'],
      ['Jev (typesafe) could not be reached', true, 'unreachable'],
      ['Jev could not be reached', true, 'unreachable'],
      ['the response carried no answers', true, 'bad_response'],
      ['the candidate answer was missing or not a choice', true, 'bad_response'],
      ['Jev answered none of the questions', true, 'bad_response'],
      ['Jev failed three times in a row; skipped for a minute', false, 'breaker'],
      ['breaker open', false, 'breaker'],
      ['the saved Jev key could not be decrypted', false, 'config'],
      ['Jev\'s confidence 0.41 is below 0.6', true, 'unsure'],
      ['Jev found no candidate fits this request', true, 'unsure'],
      ['Jev picked "x", which is not on the roster', true, 'unsure'],
      ['more than one at the bar', true, 'unsure'],
      ['unsure', true, 'unsure'],
      ['fewer than two seats to choose between', false, 'skipped'],
      ['no candidate is allowed on this installation', false, 'skipped'],
    ];
    for (const [reason, asked, want] of cases) {
      expect([reason, health.jevOutcomeOf(reason, asked)]).toEqual([reason, want]);
    }
  });
});

describe('healthOf', () => {
  it('counts, takes latency over answers only, and calls the newest call', () => {
    const h = health.healthOf('turn', [
      { at: at(1), asked: true, fallback: 'Jev (typesafe) answered HTTP 401', latencyMs: 90, version: V('turn') },
      { at: at(2), asked: true, fallback: null, latencyMs: 120, version: V('turn') },
      { at: at(3), asked: true, fallback: 'Jev\'s confidence 0.4 is below 0.6', latencyMs: 80, version: 'turn-old00000' },
      { at: at(4), asked: false, fallback: 'breaker open', latencyMs: null, version: null },
    ]);

    expect(h).toMatchObject({ decisions: 4, asked: 3, answered: 2, used: 1, failed: 1, status: 'failing', latencyMs: { p50: 120, p95: 120 } });
    expect(h.byOutcome).toMatchObject({ auth: 1, used: 1, unsure: 1, breaker: 1 });
    expect(h.lastFailure).toMatchObject({ outcome: 'auth', reason: 'Jev (typesafe) answered HTTP 401' });
    expect(h.lastAnsweredAt).toBe(at(2).toISOString());
    expect(h.versions).toEqual([{ version: V('turn'), decisions: 2 }, { version: 'turn-old00000', decisions: 1 }]);
    expect(health.healthOf('agent', []).status).toBe('idle');
  });
});

describe('jevHealth and jevOutcomes', () => {
  beforeAll(async () => {
    await db.insert(S.tenantAccountSchema).values([{ id: 'acct_jh', name: 'Acme', slug: 'acme-jh' }, { id: 'acct_jh2', name: 'Other', slug: 'other-jh' }]);
    await db.insert(S.projectSchema).values([{ id: WS, accountId: 'acct_jh', slug: 'jh', name: 'JH' }, { id: OTHER, accountId: 'acct_jh2', slug: 'jh2', name: 'JH2' }]);

    // Factory: one run Jev routed that merged, one that fell back on a 401 and was rerun.
    await db.insert(S.engineRunSchema).values([
      { orgId: WS, engine: 'claude-cli', status: 'done', outcome: 'merged', routeSelector: 'jev', routeDetail: { asked: true, fallback: null, latencyMs: 110, questionVersion: V('engineering') }, prUrl: 'https://example.test/pr/1', qaVerdict: 'approve', merged: true, createdAt: at(10) },
      { orgId: WS, engine: 'claude-cli', status: 'done', outcome: 'failed', routeSelector: 'static', routeDetail: { asked: true, fallback: 'Jev (typesafe) answered HTTP 401', latencyMs: 40, questionVersion: V('engineering') }, qaVerdict: 'changes', attempt: 2, createdAt: at(5) },
      { orgId: WS, engine: 'claude-cli', status: 'done', outcome: 'merged', createdAt: at(4) }, // no key: not Jev's
      { orgId: OTHER, engine: 'claude-cli', status: 'done', outcome: 'merged', routeSelector: 'jev', routeDetail: { asked: true, fallback: null }, createdAt: at(3) },
    ] as never);

    // Turns: one turn of two calls Jev routed, one that timed out.
    await db.insert(S.modelCallSchema).values([
      { orgId: WS, feature: 'agent.turn', model: 'm', traceId: 't1', routeSelector: 'jev', routeDetail: { asked: true, fallback: null, latencyMs: 95, questionVersion: V('turn') }, createdAt: at(9) },
      { orgId: WS, feature: 'agent.turn', model: 'm', traceId: 't1', routeSelector: 'jev', routeDetail: { asked: true, fallback: null, latencyMs: 95, questionVersion: V('turn') }, createdAt: at(8) },
      { orgId: WS, feature: 'agent.turn', model: 'm', traceId: 't2', routeSelector: 'configured', routeDetail: { asked: true, fallback: 'no answer within 1500 ms', latencyMs: 1500, questionVersion: V('turn') }, createdAt: at(7) },
      { orgId: WS, feature: 'agent.turn', model: 'm', traceId: 't3', createdAt: at(6) },
    ] as never);

    // First messages: Jev picked qa and another agent answered later; the model read picked pm.
    const [conv1] = await db.insert(S.conversationSchema).values({ orgId: WS, agentSlug: 'lead', title: 'One' }).returning();
    const [conv2] = await db.insert(S.conversationSchema).values({ orgId: WS, agentSlug: 'lead', title: 'Two' }).returning();
    await db.insert(S.conversationMessageSchema).values([
      { conversationId: conv1!.id, role: 'user', content: 'hi', routingJson: { chosen: 'qa', decidedBy: 'jev', jev: { asked: true, fallback: null, latencyMs: 70, questionVersion: V('agent') } }, createdAt: at(20) },
      { conversationId: conv1!.id, role: 'assistant', content: 'a', agentSlug: 'qa', createdAt: at(19) },
      { conversationId: conv1!.id, role: 'assistant', content: 'b', agentSlug: 'engineer', createdAt: at(18) },
      { conversationId: conv2!.id, role: 'user', content: 'yo', routingJson: { chosen: 'pm', decidedBy: 'model', jev: { asked: true, fallback: 'Jev\'s confidence 0.30 is below 0.6', latencyMs: 60, questionVersion: V('agent') } }, createdAt: at(17) },
      { conversationId: conv2!.id, role: 'assistant', content: 'c', agentSlug: 'pm', createdAt: at(16) },
    ] as never);

    // Duplicates: Jev linked #11 (undone by a person), the exact match linked #12, Jev was skipped once.
    await db.insert(S.recordDuplicateCheckSchema).values([
      { orgId: WS, objectType: 'request', objectId: 11, judge: 'jev', verdict: 'duplicate', duplicateOf: 3, confidence: 0.9, candidates: 4, inputsHash: 'h', latencyMs: 101, questionVersion: V('duplicate'), linked: true, createdAt: at(30) },
      { orgId: WS, objectType: 'request', objectId: 12, judge: 'exact', verdict: 'duplicate', duplicateOf: 4, confidence: 1, candidates: 4, inputsHash: 'h', latencyMs: 0, linked: true, createdAt: at(29) },
      { orgId: WS, objectType: 'request', objectId: 13, judge: 'jev', verdict: 'failed', candidates: 4, inputsHash: 'h', latencyMs: null, fallback: 'breaker open', questionVersion: V('duplicate'), createdAt: at(28) },
    ]);
    await db.insert(S.actionRunSchema).values({ orgId: WS, actionId: 'objects.update_meta', status: 'undone', input: {}, dedupKey: 'objects.update_meta:request:11:duplicateOf' } as never);
  });

  it('reads each decision type from its record, one Org only', async () => {
    const byType = Object.fromEntries((await health.jevHealth({ scope: { orgId: WS }, from: FROM, to: TO })).map(h => [h.type, h]));

    expect(byType.factory).toMatchObject({ decisions: 2, used: 1, failed: 1, status: 'failing', byOutcome: { auth: 1 }, versions: [{ version: V('engineering'), decisions: 2 }] });
    expect(byType.turn).toMatchObject({ decisions: 2, used: 1, failed: 1, byOutcome: { timeout: 1 }, latencyMs: { p50: 95 } });
    expect(byType.agent).toMatchObject({ decisions: 2, used: 1, answered: 2, failed: 0, status: 'live', byOutcome: { unsure: 1 } });
    expect(byType.duplicate).toMatchObject({ decisions: 2, asked: 1, used: 1, byOutcome: { breaker: 1 }, status: 'live' });
  });

  it('joins the outcomes already on record', async () => {
    const o = await health.jevOutcomes({ scope: { orgId: WS }, from: FROM, to: TO });
    const f = Object.fromEntries(o.factory.map(r => [r.selector, r]));

    expect(f.jev).toMatchObject({ runs: 1, prs: 1, qaApproved: 1, qaJudged: 1, merged: 1, reruns: 0 });
    expect(f.static).toMatchObject({ runs: 1, prs: 0, qaApproved: 0, qaJudged: 1, merged: 0, reruns: 1 });
    expect(Object.fromEntries(o.agent.map(r => [r.decidedBy, r]))).toEqual({
      jev: { decidedBy: 'jev', firstMessages: 1, anotherAgentLater: 1 },
      model: { decidedBy: 'model', firstMessages: 1, anotherAgentLater: 0 },
    });
    expect(Object.fromEntries(o.duplicate.map(r => [r.judge, r]))).toEqual({
      jev: { judge: 'jev', linked: 1, undone: 1 },
      exact: { judge: 'exact', linked: 1, undone: 0 },
    });
  });

  it('an Org scope covers its workspaces and no other', async () => {
    const factory = (await health.jevHealth({ scope: { accountId: 'acct_jh2' }, from: FROM, to: TO })).find(h => h.type === 'factory');

    expect(factory).toMatchObject({ decisions: 1, used: 1 });
  });
});

describe('checkJevNow', () => {
  beforeEach(() => health.resetJevChecks());

  const KEY = 'ts-FAKE-not-a-real-key-0000';

  it('proves the key with one tiny call, never returning it, at most every 30 seconds', async () => {
    let t = 1_000_000;
    const fetch = vi.fn(async () => new Response(JSON.stringify({ model: 'jev-1.13.0', answers: { ok: { type: 'noul', noul: 0.97 } } }), { status: 200 }));
    const deps = { resolveKey: async () => ({ key: KEY, scope: 'instance' as const }), fetch: fetch as never, now: () => t };
    const first = await health.checkJevNow(WS, deps);

    expect(first).toMatchObject({ ok: true, outcome: 'used', model: 'jev-1.13.0', keyScope: 'instance', cached: false });
    expect(JSON.stringify(first)).not.toContain(KEY);

    t += 10_000;

    expect(await health.checkJevNow(WS, deps)).toMatchObject({ ok: true, cached: true });

    t += 30_000;
    await health.checkJevNow(WS, deps);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('names a rejected key, a key that will not decrypt, and no key', async () => {
    const rejected = await health.checkJevNow(WS, { resolveKey: async () => ({ key: KEY, scope: 'instance' }), fetch: (async () => new Response('{}', { status: 401 })) as never });

    expect(rejected).toMatchObject({ ok: false, outcome: 'auth', reason: 'Jev (typesafe) answered HTTP 401' });
    expect(JSON.stringify(rejected)).not.toContain(KEY);

    health.resetJevChecks();

    expect(await health.checkJevNow(WS, { resolveKey: async () => {
      throw new Error('bad tag');
    } })).toMatchObject({ ok: false, outcome: 'config' });

    health.resetJevChecks();

    expect(await health.checkJevNow(WS, { resolveKey: async () => null })).toMatchObject({ ok: false, outcome: 'no_key' });
  });
});
