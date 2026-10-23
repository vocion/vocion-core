import type { DecisionView } from '@/libs/decisions/decision';
import { describe, expect, it } from 'vitest';
import { decisionTopics, settledElsewhere, settledElsewhereLine } from './dockLive';

/**
 * The dock follows exactly what it shows, and says once when one of those
 * left it from somewhere else. Fixtures are fictional (Northwind).
 * @param id
 * @param subject
 * @param question
 */
const view = (id: number, subject: DecisionView['subject'], question = `Question ${id}`) => ({ id, subject, question }) as DecisionView;

describe('decisionTopics', () => {
  it('follows an ask as ask:<id> and a proposal as card:<id>, once each', () => {
    expect(decisionTopics([view(7, 'ask'), view(12, 'proposal'), view(7, 'ask'), view(3, undefined)])).toEqual(['ask:3', 'ask:7', 'card:12']);
  });
});

describe('settledElsewhere', () => {
  it('names what left without an answer from here, and nothing answered here', () => {
    const before = [view(1, 'ask'), view(2, 'proposal'), view(3, 'ask')];
    const after = [view(3, 'ask')];

    expect(settledElsewhere(before, after, new Set(['ask:1'])).map(d => d.id)).toEqual([2]);
  });

  it('says one line: the question for one, a count for several', () => {
    expect(settledElsewhereLine([view(1, 'ask', 'Draft the Northwind intro?')])).toBe('Settled elsewhere: Draft the Northwind intro?');
    expect(settledElsewhereLine([view(1, 'ask'), view(2, 'ask')])).toBe('2 decisions were settled elsewhere.');
  });
});
