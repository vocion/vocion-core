import { describe, expect, it } from 'vitest';
import { requestAsk } from './requestAsk';

describe('the ask, and when the work started (one reading for every surface)', () => {
  const created = new Date('2026-10-04T23:03:06Z');

  it('a person\'s ask: their words, their time, and the work starts when they said go', () => {
    const ask = requestAsk({ body: 'On Stamp, give the library keyboard shortcuts.', askedBy: { name: 'Dana Okafor' }, decidedAt: '2026-10-04T23:04:31Z' }, created);

    expect(ask).toEqual({ kind: 'asked', text: 'On Stamp, give the library keyboard shortcuts.', at: created, startedAt: new Date('2026-10-04T23:04:31Z') });
  });

  it('a proposal: the feature as it was put to the person, never the prompt that led the agent there; built from the go-ahead', () => {
    const ask = requestAsk({
      body: 'What\'s one small feature worth building next? Pick one.\\n\\n[PM recommendation from planning pass]: link expiry',
      story: 'As a founder who just sent a deck, I want the link to expire after 7 days.',
      recommendedAt: '2026-09-29T03:23:10Z',
      decidedAt: '2026-10-04T20:35:08Z',
    }, new Date('2026-09-29T03:23:10Z'));

    expect(ask.kind).toBe('proposed');
    expect(ask.text).toBe('As a founder who just sent a deck, I want the link to expire after 7 days.');
    expect(ask.at).toEqual(new Date('2026-09-29T03:23:10Z'));
    expect(ask.startedAt).toEqual(new Date('2026-10-04T20:35:08Z'));
  });

  it('a proposal with a story missing falls back to the outcome, then to nothing', () => {
    expect(requestAsk({ recommendedAt: '2026-09-29T03:23:10Z', outcome: 'Links stop working after a date.' }, created).text).toBe('Links stop working after a date.');
    expect(requestAsk({ recommendedAt: '2026-09-29T03:23:10Z', body: 'the prompt' }, created).text).toBeNull();
  });

  it('a go-ahead stamped before the ask, or missing, leaves the start at the ask', () => {
    expect(requestAsk({ body: 'x', decidedAt: '2026-10-04T22:00:00Z' }, created).startedAt).toEqual(created);
    expect(requestAsk({ body: 'x' }, created).startedAt).toEqual(created);
    expect(requestAsk({}, null)).toEqual({ kind: 'asked', text: null, at: null, startedAt: null });
  });

  it('a proposal somebody then asked for by name reads as their ask', () => {
    expect(requestAsk({ body: 'please build it', askedBy: { name: 'Dana' }, recommendedAt: '2026-09-29T03:23:10Z' }, created).kind).toBe('asked');
  });
});
