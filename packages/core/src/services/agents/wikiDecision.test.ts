import type { RuntimeContext } from './types';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('./toolCallRecord', () => ({ persistToolCall: vi.fn(async () => {}) }));
vi.mock('@/services/wiki/wikiIndex', async (orig) => {
  const real = await orig<typeof import('@/services/wiki/wikiIndex')>();
  return {
    ...real,
    wikiContextFor: vi.fn(async () => [
      { slug: 'pricing-principles', title: 'Pricing principles', excerpt: 'We never gate a core action behind an upgrade prompt inside the work.', href: '/dashboard/artifacts/41' },
    ]),
  };
});

const { decisionText, wikiPassagesUnread } = await import('./wikiDecision');
const { passagesFrom } = await import('@/services/wiki/wikiIndex');

describe('what a product decision is', () => {
  it('reads a request, plan or product filing and a ruling or recommendation, and nothing else', () => {
    expect(decisionText('objects.propose_candidate', { objectType: 'request', title: 'Copy link on each row', fields: { story: 'I want to copy a link', acceptance: ['every row'] } })).toMatch(/Copy link on each row[\s\S]*every row/);
    expect(decisionText('ask.file', { kind: 'ruling', title: 'Locked rows?', options: ['Show disabled', 'Show with upsell'] })).toMatch(/Show with upsell/);
    expect(decisionText('ask.file', { kind: 'input', title: 'What is your email?' })).toBeNull();
    expect(decisionText('objects.propose_candidate', { objectType: 'lead_brief', title: 'x' })).toBeNull();
    expect(decisionText('gmail.send', { title: 'x' })).toBeNull();
  });
});

describe('a product decision is checked against the wiki, by relevance', () => {
  it('hands the pages that bear on it over once, as data for advice — it never refuses a filing', async () => {
    const ctx = { orgId: 'org_wiki', turnReads: [] } as unknown as RuntimeContext;
    const ruling = { kind: 'ruling', title: 'Copy-link on locked rows?', options: ['Show disabled', 'Show with upsell'] };

    const first = await wikiPassagesUnread(ctx, 'ask.file', ruling);

    expect(first?.some(p => p.slug === 'pricing-principles')).toBe(true);
    // Handed over: the turn has read it now, so it is not handed over twice.
    expect(await wikiPassagesUnread(ctx, 'ask.file', ruling)).toBeNull();
  });

  it('keeps one passage per page, most relevant first', () => {
    const hit = (slug: string, score: number, content: string) => ({ content, title: slug, uri: null, score, metadata: { slug } });

    expect(passagesFrom([hit('a', 0.2, 'low'), hit('b', 0.9, 'high'), hit('b', 0.5, 'dup')], 3).map(p => [p.slug, p.excerpt])).toEqual([['b', 'high'], ['a', 'low']]);
  });
});
