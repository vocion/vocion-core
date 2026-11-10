import type { BrowserStep } from '@/libs/browser/run';
import { describe, expect, it } from 'vitest';
import { ruleStepLabel } from '@/libs/browser/run';
import { rulesAddedByVersion, rulesFollowedIn, ruleSourceWords } from './ruleUse';

const LMFT = 'LMFTs go through Hospital and other providers.';
const TAX = 'Type the tax ID by hand.';
const from = { askId: 41, by: 'Marcus Hale', on: '2026-11-04T15:00:00.000Z', version: 3 };

function step(n: number, extra: Partial<BrowserStep> = {}): BrowserStep {
  return { n, at: '2026-11-05T15:00:00.000Z', kind: 'click', label: `Step ${n}`, ok: true, ...extra };
}

function followed(n: number, text: string, decided: string, withFrom = true): BrowserStep {
  return step(n, { kind: 'rule', label: 'Followed', why: decided, rule: { n: 2, text, ...(withFrom ? { from: { askId: from.askId, by: from.by, version: from.version } } : {}) } });
}

describe('a rule a run followed', () => {
  it('says whose rule it is and the version it entered, or only the rule when no one is named', () => {
    expect(ruleStepLabel({ text: LMFT, from: { askId: 41, by: 'Marcus Hale', version: 3 } })).toBe(`Followed Marcus’s rule (v3): ${LMFT}`);
    expect(ruleStepLabel({ text: TAX })).toBe(`Followed the automation’s rule: ${TAX}`);
    expect(ruleSourceWords({ by: 'Marcus Hale', askId: 41 })).toBe('Marcus’s answer');
    expect(ruleSourceWords({ by: 'Marcus Hale', askId: null })).toBe('Marcus');
    expect(ruleSourceWords(null)).toBeNull();
  });

  it('is counted once per run, with what it decided there', () => {
    const runs = [
      { n: 1, label: 'Cedar Hollow Counseling Group, LLC', browserRunId: 902, steps: [step(1), followed(2, LMFT, 'Ruth Calloway (LMFT) goes through Hospital and other providers'), followed(3, LMFT, 'again')] },
      { n: 2, label: 'Cedar Hollow Family Therapy, LLC', browserRunId: 903, steps: [step(1)] },
    ];
    const f = rulesFollowedIn(runs);

    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ text: LMFT, from: { askId: 41, version: 3 }, runs: [{ n: 1, browserRunId: 902, decided: 'Ruth Calloway (LMFT) goes through Hospital and other providers' }] });
  });
});

describe('the version history', () => {
  it('lists each rule under the version that added it, with the runs that followed it since', () => {
    const versions = [
      { n: 2, rules: [{ text: TAX, at: 348 }] },
      { n: 3, rules: [{ text: TAX, at: 348 }, { text: LMFT, at: null, from }] },
    ];
    const runs = [
      { n: 1, label: 'Evanston', browserRunId: 905, steps: [followed(4, LMFT, 'Ruth Calloway')] },
      { n: 3, label: 'Oak Park', browserRunId: 904, steps: [followed(4, LMFT, 'Samuel Okafor')] },
      { n: 2, label: 'Naperville', browserRunId: 903, steps: [followed(4, LMFT, 'A third LMFT')] },
      { n: 1, label: 'Old', browserRunId: 901, steps: [followed(4, LMFT, 'Fourth')] },
    ];
    const by = rulesAddedByVersion(versions, runs);

    // v2's rule came from the recording and no run followed it: no line.
    expect(by.has(2)).toBe(false);
    expect(by.get(3)).toEqual([{ text: LMFT, from, runs: 4, recent: [
      { browserRunId: 905, label: 'Evanston', decided: 'Ruth Calloway' },
      { browserRunId: 904, label: 'Oak Park', decided: 'Samuel Okafor' },
      { browserRunId: 903, label: 'Naperville', decided: 'A third LMFT' },
    ] }]);
  });

  it('lists a rule taught from the recording once a run followed it, with no source', () => {
    const by = rulesAddedByVersion([{ n: 1, rules: [{ text: TAX, at: 348 }] }], [{ n: 1, label: 'Evanston', browserRunId: 905, steps: [followed(2, TAX, 'typed it', false)] }]);

    expect(by.get(1)).toEqual([{ text: TAX, from: null, runs: 1, recent: [{ browserRunId: 905, label: 'Evanston', decided: 'typed it' }] }]);
  });

  it('lists a rule the expert added before any run followed it, with no count', () => {
    const by = rulesAddedByVersion([{ n: 3, rules: [{ text: LMFT, at: null, from }] }], []);

    expect(by.get(3)).toEqual([{ text: LMFT, from, runs: 0, recent: [] }]);
  });
});
