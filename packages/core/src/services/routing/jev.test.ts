/**
 * Jev as a classifier (ADR 0006): the request Vocion sends, how the documented
 * response is read, and that every failure comes back as a value, never a
 * throw, with no key in it. Jev itself is never called: fetch is a fake.
 */
import { describe, expect, it } from 'vitest';
import { decide, DEFAULT_JEV_MODEL, jevRequestBody, jevSettings, readJevResponse } from './jev';

const KEY = 'sk-or-v1-FAKE-not-a-real-key-000000';
const TWO = { state: { task: 'Rename a variable' }, candidates: [{ id: 'c1', text: 'cheap' }, { id: 'c2', text: 'strong' }] };
const ONE = { state: { task: 'Rename a variable' }, candidates: [{ id: 'c1', text: 'only' }] };

/** The documented response shape (openrouter.ai Decisions API reference), with our question ids. */
const OK = {
  id: 'gen-dec-1',
  model: 'typesafe/jev-1.13-20260917',
  provider: 'TypeSafe',
  answers: {
    candidate: { type: 'choice', choice: 'c2', confidence: 0.81, probabilities: { c1: 0.1, c2: 0.88, none: 0.02 } },
    effort: { type: 'score', score: 1.9, confidence: 0.92, probabilities: { 0: 0, 1: 0.1, 2: 0.9 }, legend: { 0: 'low', 1: 'medium', 2: 'high' } },
  },
  usage: { input_tokens: 400, output_tokens: 60, cost: 0.000017 },
};

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('the request', () => {
  it('asks a choice over the candidates plus none, and a three-level effort score', () => {
    const body = jevRequestBody(TWO, 'typesafe/jev-1.13') as { model: string; questions: Record<string, { type: string; criteria: unknown }> };

    expect(body.model).toBe('typesafe/jev-1.13');
    expect(body.questions.candidate!.type).toBe('choice');
    expect(Object.keys(body.questions.candidate!.criteria as object)).toEqual(['c1', 'c2', 'none']);
    expect(body.questions.effort!.type).toBe('score');
    expect(body.questions.effort!.criteria).toHaveLength(3);
  });

  it('with one candidate asks for the effort only', () => {
    const body = jevRequestBody(ONE, 'm/x') as { questions: Record<string, unknown> };

    expect(Object.keys(body.questions)).toEqual(['effort']);
  });

  it('pins jev-1.13 unless the installation names another, and keeps the threshold and timeout in range', () => {
    expect(jevSettings({})).toEqual({ model: DEFAULT_JEV_MODEL, minConfidence: 0.6, timeoutMs: 3000 });
    expect(jevSettings({ VOCION_JEV_MODEL: 'typesafe/jev-1.14', VOCION_JEV_MIN_CONFIDENCE: '0.75', VOCION_JEV_TIMEOUT_MS: '1500' })).toEqual({ model: 'typesafe/jev-1.14', minConfidence: 0.75, timeoutMs: 1500 });
    expect(jevSettings({ VOCION_JEV_MODEL: 'not a model', VOCION_JEV_MIN_CONFIDENCE: '7', VOCION_JEV_TIMEOUT_MS: '60000' })).toEqual({ model: DEFAULT_JEV_MODEL, minConfidence: 0.6, timeoutMs: 3000 });
  });
});

describe('reading the answer', () => {
  it('maps the documented shape onto choice, confidence, effort, build, cost', () => {
    expect(readJevResponse(OK, TWO, 120)).toEqual({
      choice: 'c2',
      confidence: 0.81,
      probabilities: { c1: 0.1, c2: 0.88, none: 0.02 },
      effort: 'high',
      effortConfidence: 0.92,
      model: 'typesafe/jev-1.13-20260917',
      costUsd: 0.000017,
      latencyMs: 120,
    });
  });

  it('rounds the effort score to its level', () => {
    const at = (score: number) => readJevResponse({ ...OK, answers: { ...OK.answers, effort: { type: 'score', score } } }, TWO, 1);

    expect(at(0.2)).toMatchObject({ effort: 'low' });
    expect(at(1.4)).toMatchObject({ effort: 'medium' });
    expect(at(2)).toMatchObject({ effort: 'high' });
  });

  it('treats a missing answer or the wrong type as a bad response, never a default', () => {
    expect(readJevResponse({}, TWO, 1)).toMatchObject({ failed: true, kind: 'bad_response' });
    expect(readJevResponse({ answers: { effort: OK.answers.effort } }, TWO, 1)).toMatchObject({ failed: true, kind: 'bad_response' });
    expect(readJevResponse({ answers: { candidate: { type: 'score', score: 1 }, effort: OK.answers.effort } }, TWO, 1)).toMatchObject({ failed: true });
    expect(readJevResponse({ answers: { candidate: OK.answers.candidate, effort: { type: 'choice', choice: 'x' } } }, TWO, 1)).toMatchObject({ failed: true });
  });
});

describe('calling Jev', () => {
  it('posts to the Decisions API with the key as a bearer token', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse(OK);
    }) as unknown as typeof globalThis.fetch;
    const r = await decide(KEY, TWO, { model: 'typesafe/jev-1.13', timeoutMs: 3000 }, { fetch });

    expect(r).toMatchObject({ choice: 'c2', effort: 'high' });
    expect(calls[0]!.url).toBe('https://openrouter.ai/api/alpha/decisions');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(calls[0]!.init.body)).model).toBe('typesafe/jev-1.13');
  });

  it('returns a 4xx or 5xx as a failure that names the status and not the key', async () => {
    for (const status of [401, 429, 500, 503]) {
      const fetch = (async () => jsonResponse({ error: { message: `bad key ${KEY}` } }, status)) as unknown as typeof globalThis.fetch;
      const r = await decide(KEY, TWO, { model: 'm/x', timeoutMs: 3000 }, { fetch });

      expect(r).toMatchObject({ failed: true, kind: 'http', status });
      expect(JSON.stringify(r)).not.toContain(KEY);
    }
  });

  it('gives up at the timeout instead of holding the dispatch', async () => {
    const fetch = ((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })) as unknown as typeof globalThis.fetch;
    const started = Date.now();
    const r = await decide(KEY, TWO, { model: 'm/x', timeoutMs: 300 }, { fetch });

    expect(r).toMatchObject({ failed: true, kind: 'timeout' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('returns a network error or an unreadable body as a failure', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof globalThis.fetch;
    const garbage = (async () => new Response('<html>', { status: 200 })) as unknown as typeof globalThis.fetch;

    expect(await decide(KEY, TWO, { model: 'm/x', timeoutMs: 3000 }, { fetch: down })).toMatchObject({ failed: true, kind: 'network' });
    expect(await decide(KEY, TWO, { model: 'm/x', timeoutMs: 3000 }, { fetch: garbage })).toMatchObject({ failed: true, kind: 'bad_response' });
  });
});
