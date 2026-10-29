import { describe, expect, it } from 'vitest';
import { emptyTurnSeen, fallbackTurnLine, observeTurnEvent, saidNothing } from './turnFallbackLine';

/**
 * A wordless turn ends on one line made from what it did (2026-10-29: three
 * SEO turns stored '' after filing a card or running their tools).
 */
describe('fallbackTurnLine', () => {
  it('a connect card: says what it asked for and what happens next', () => {
    const seen = emptyTurnSeen();
    observeTurnEvent(seen, { type: 'card', card: { kind: 'link', title: 'Connect GitHub', state: 'proposed', source: { tool: 'offer_connection' } } });

    expect(fallbackTurnLine(seen)).toBe('Asked you to connect GitHub. Once it\'s connected, I\'ll carry on from here.');
  });

  it('a connect step whose card the dock holds reads from the step itself', () => {
    const line = fallbackTurnLine({ cards: [], artifacts: [], steps: [{ tool: 'offer_connection', input: { connector: 'jira' } }] });

    expect(line).toBe('Asked you to connect Jira. Once it\'s connected, I\'ll carry on from here.');
  });

  it('a keyword plan filed: says it in the words the person sees, over the generic decision line', () => {
    const seen = emptyTurnSeen();
    seen.steps.push({ tool: 'keyword_cluster', input: { keywords: ['a', 'b'] } }, { tool: 'seo_plan_batch', output: 'Planned batch #7 "Trail shoes" with 3 pages (/p/seo_batch/7).' });
    observeTurnEvent(seen, { type: 'decision', decision: { question: 'Sign off the keyword plan for Trail shoes?', state: 'open' } });

    expect(fallbackTurnLine(seen)).toBe('Filed the keyword plan for your sign-off.');
  });

  it('a refused plan is never said as filed', () => {
    const line = fallbackTurnLine({ cards: [], artifacts: [], steps: [{ tool: 'seo_plan_batch', output: 'Not planned: name the client project.' }] });

    expect(line).not.toContain('Filed');
  });

  it('a decision on its own is asked, in its own words', () => {
    const seen = emptyTurnSeen();
    observeTurnEvent(seen, { type: 'decision', decision: { question: 'Which page goes first?', state: 'open' } });

    expect(fallbackTurnLine(seen)).toBe('One question for you: Which page goes first?');
  });

  it('cards to sign off: one by name, several counted and named', () => {
    const one = emptyTurnSeen();
    observeTurnEvent(one, { type: 'recommended_action', recommendation: { label: 'Publish the pricing page.' } });

    expect(fallbackTurnLine(one)).toBe('Filed “Publish the pricing page” for your sign-off.');

    const many = emptyTurnSeen();
    for (const label of ['A', 'B', 'C', 'D']) {
      observeTurnEvent(many, { type: 'recommended_action', recommendation: { label } });
    }

    expect(fallbackTurnLine(many)).toBe('Filed 4 items for your sign-off: “A”, “B”, “C” and 1 more.');
  });

  it('a decided or unfiled card is not something waiting on them', () => {
    const seen = emptyTurnSeen();
    observeTurnEvent(seen, { type: 'card', card: { kind: 'action', title: 'Old card', state: 'decided' } });

    expect(seen.cards).toEqual([]);
  });

  it('a document written is the answer; a pending shell is not', () => {
    const seen = emptyTurnSeen();
    observeTurnEvent(seen, { type: 'artifact', artifact: { title: 'SERP brief: trail shoes' }, pending: true });
    observeTurnEvent(seen, { type: 'artifact', artifact: { title: 'SERP brief: trail shoes' } });
    observeTurnEvent(seen, { type: 'artifact', artifact: { title: 'SERP brief: trail shoes' } });

    expect(fallbackTurnLine(seen)).toBe('Wrote “SERP brief: trail shoes”.');
  });

  it('steps and nothing else: names the last one and offers the summary', () => {
    const line = fallbackTurnLine({ cards: [], artifacts: [], steps: [{ tool: 'write_todos' }, { tool: 'web_search', input: { query: 'x' } }, { tool: 'serp_search', input: { query: 'trail shoes' } }] });

    expect(line).toBe('Read Google\'s top 10 for “trail shoes”, after 1 other step. Ask and I\'ll sum up what I found.');
  });

  it('nothing at all still says something', () => {
    expect(fallbackTurnLine(emptyTurnSeen())).toMatch(/^I didn't get to an answer/);
  });

  it('says at most two sentences', () => {
    const seen = emptyTurnSeen();
    observeTurnEvent(seen, { type: 'card', card: { kind: 'connect-systems', title: 'Connect Search Console', state: 'proposed' } });
    seen.steps.push({ tool: 'seo_plan_batch', output: 'Planned batch #2' });
    observeTurnEvent(seen, { type: 'recommended_action', recommendation: { label: 'X' } });

    expect(fallbackTurnLine(seen)).toBe('Asked you to connect Search Console. Once it\'s connected, I\'ll carry on from here. Filed the keyword plan for your sign-off.');
  });
});

describe('saidNothing', () => {
  it('reads markup and whitespace as nothing', () => {
    expect(saidNothing('')).toBe(true);
    expect(saidNothing(' \n<p></p> ')).toBe(true);
    expect(saidNothing('Done.')).toBe(false);
  });
});
