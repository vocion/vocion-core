import { describe, expect, it } from 'vitest';
import { replacesPrior, REPUBLISH_WINDOW_MS } from './republish';

const NOW = new Date('2026-09-15T14:03:08Z');
const at = (msAgo: number) => new Date(NOW.getTime() - msAgo);

describe('replacesPrior — a republish is the same briefing, not a second one', () => {
  it('replaces a row the same publisher wrote seconds ago in the same scope', () => {
    // The actual pair: founder-gtm-lead at 14:03:02 and again at 14:03:08.
    expect(replacesPrior({ createdAt: at(6_000), publishedBy: 'agent:founder-gtm-lead' }, 'agent:founder-gtm-lead', NOW)).toBe(true);
  });

  it('keeps a row from a different publisher — two agents, two briefs', () => {
    expect(replacesPrior({ createdAt: at(14_000), publishedBy: 'agent:ceo' }, 'agent:team-advisor', NOW)).toBe(false);
  });

  it('keeps a row older than the window — that is a real later edition', () => {
    expect(replacesPrior({ createdAt: at(REPUBLISH_WINDOW_MS), publishedBy: 'agent:revenue-lead' }, 'agent:revenue-lead', NOW)).toBe(false);
    expect(replacesPrior({ createdAt: at(REPUBLISH_WINDOW_MS - 1), publishedBy: 'agent:revenue-lead' }, 'agent:revenue-lead', NOW)).toBe(true);
  });

  it('never replaces when there is no prior, no publisher, or a clock that went backwards', () => {
    expect(replacesPrior(null, 'agent:x', NOW)).toBe(false);
    expect(replacesPrior({ createdAt: at(1_000), publishedBy: null }, null, NOW)).toBe(false);
    expect(replacesPrior({ createdAt: at(-5_000), publishedBy: 'agent:x' }, 'agent:x', NOW)).toBe(false);
  });
});
