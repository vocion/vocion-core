import { describe, expect, it } from 'vitest';
import { stepProgressLabel } from './stepLabels';
import { stepProgress } from './stepProgress';

function harness() {
  const sent: string[] = [];
  let t = 0;
  const progress = stepProgress(e => sent.push(e.note), 'keyword_cluster', { now: () => t });
  return { sent, progress, at: (ms: number) => {
    t = ms;
  } };
}

describe('stepProgress', () => {
  it('sends the first count at once, then at most one every 15 seconds', () => {
    const { sent, progress, at } = harness();
    for (let i = 1; i <= 12; i++) {
      at((i - 1) * 4_000); // a keyword every 4s: 0s, 4s, … 44s
      progress.count(i, 12);
    }

    // 0s → 1 of 12; 16s → 5 of 12; 32s → 9 of 12. Never every keyword.
    expect(sent).toEqual(['1 of 12', '5 of 12', '9 of 12']);
  });

  it('a loop of one, or a nonsense total, says nothing', () => {
    const { sent, progress } = harness();
    progress.count(1, 1);
    progress.count(Number.NaN, 4);

    expect(sent).toEqual([]);
  });

  it('a stage note goes out at once, and a repeat is dropped', () => {
    const { sent, progress } = harness();
    progress.note('laying the slides out');
    progress.note('laying the slides out');
    progress.note(' writing the file ');

    expect(sent).toEqual(['laying the slides out', 'writing the file']);
  });

  it('an open-ended pulse is throttled like a count', () => {
    const { sent, progress, at } = harness();
    progress.pulse('step 1 · Opened the sign-in page');
    at(5_000);
    progress.pulse('step 2 · Typed the email');
    at(16_000);
    progress.pulse('step 5 · Clicked “Sign in”');

    expect(sent).toEqual(['step 1 · Opened the sign-in page', 'step 5 · Clicked “Sign in”']);
  });

  it('a closed stream never fails the work', () => {
    const progress = stepProgress(() => {
      throw new Error('closed');
    }, 'serp_compare');

    expect(() => progress.count(1, 10)).not.toThrow();
  });
});

describe('stepProgressLabel with a count', () => {
  it('puts a bare count in brackets after the running label', () => {
    expect(stepProgressLabel('Reading Google\'s results for 12 keywords…', '4 of 12')).toBe('Reading Google\'s results for 12 keywords (4 of 12)');
  });

  it('leaves any other note as it was', () => {
    expect(stepProgressLabel('Rendering the document…', 'sheet 7 of 12')).toBe('Rendering the document… sheet 7 of 12');
  });
});
