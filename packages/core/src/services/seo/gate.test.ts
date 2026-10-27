import type { GatePage } from './gate';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SEO_GATE, evaluateGate, gateConfigFrom, whyNotWritable } from './gate';

/**
 * A batch of `n` pages, each fresh (proposed, nothing written) unless `patch` says otherwise.
 * @param n - How many pages.
 * @param patch - Per page id, what is true of it.
 */
function batch(n: number, patch: Record<number, Partial<GatePage>> = {}): GatePage[] {
  return Array.from({ length: n }, (_, i) => {
    const id = i + 1;
    return { id, order: id, status: 'proposed', written: false, approved: false, changesRequested: false, feedbackFiled: true, ...patch[id] };
  });
}

const written = { status: 'in_review', written: true } as const;
const approved = { status: 'approved', written: true, approved: true } as const;
const sentBack = { status: 'changes_requested', written: true, changesRequested: true, feedbackFiled: false } as const;

/**
 * The first `n` pages approved.
 * @param n - How many.
 */
function approvedThrough(n: number): Record<number, Partial<GatePage>> {
  return Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, approved]));
}

describe('the sample', () => {
  it('releases only the first three of a fresh batch, and says so in one line', () => {
    const g = evaluateGate(batch(40));

    expect(g.stage).toBe('sample');
    expect(g.allowed).toBe(3);
    expect(g.released).toEqual([1, 2, 3]);
    expect(g.writable).toEqual([1, 2, 3]);
    expect(g.line).toBe('0 of 40 written · writing a sample of 3 for your feedback first');
  });

  it('holds everything past the sample while its pages wait on a sign-off', () => {
    const g = evaluateGate(batch(40, { 1: written, 2: written, 3: written }));

    expect(g.stage).toBe('sample');
    expect(g.writable).toEqual([]);
    expect(g.waitingOnSignoff).toEqual([1, 2, 3]);
    expect(g.line).toBe('3 of 40 written · waiting on your feedback on the first 3');
    expect(whyNotWritable(g, 4)).toContain('past the sample');
    expect(whyNotWritable(g, 2)).toContain('waiting on a person');
  });

  it('still holds when two of three are approved: every sample page needs a sign-off', () => {
    const g = evaluateGate(batch(40, { 1: approved, 2: approved, 3: written }));

    expect(g.stage).toBe('sample');
    expect(g.allowed).toBe(3);
    expect(g.writable).toEqual([]);
    expect(g.line).toBe('3 of 40 written · waiting on your feedback on the first 3');
  });

  it('a sample page an agent marked approved without a person\'s sign-off does not count', () => {
    // `approved` is read from the sign-off, never from the status an agent can write.
    const g = evaluateGate(batch(40, { 1: approved, 2: approved, 3: { status: 'approved', written: true, approved: false } }));

    expect(g.stage).toBe('sample');
  });
});

describe('changes requested', () => {
  it('stops every new draft until the feedback is filed', () => {
    const g = evaluateGate(batch(40, { 1: approved, 2: sentBack, 3: written }));

    expect(g.writable).toEqual([]);
    expect(g.feedbackToFile).toEqual([2]);
    expect(g.line).toBe('3 of 40 written · 1 page has feedback to file before more are written');
    expect(whyNotWritable(g, 2)).toContain('has to be filed');
  });

  it('once filed, the page may be redrafted, and the stage still waits for it to be approved', () => {
    const g = evaluateGate(batch(40, { 1: approved, 2: { ...sentBack, feedbackFiled: true }, 3: approved }));

    expect(g.stage).toBe('sample');
    expect(g.writable).toEqual([2]);
    expect(g.feedbackToFile).toEqual([]);
  });

  it('holds the tranche too: unfiled feedback on one tranche page stops the rest of the tranche', () => {
    const g = evaluateGate(batch(40, { ...approvedThrough(3), 4: sentBack, 5: written }));

    expect(g.stage).toBe('tranche');
    expect(g.allowed).toBe(13);
    expect(g.writable).toEqual([]);
    expect(whyNotWritable(g, 6)).toContain('page #4');
  });
});

describe('the tranche, then open', () => {
  it('releases the next ten once the whole sample is approved', () => {
    const g = evaluateGate(batch(40, approvedThrough(3)));

    expect(g.stage).toBe('tranche');
    expect(g.allowed).toBe(13);
    expect(g.writable).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(g.line).toBe('3 of 40 written · sample approved, 13 released');
    expect(whyNotWritable(g, 14)).toContain('past the tranche');
  });

  it('waits on the tranche before opening the rest', () => {
    const tranche = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 4, written]));
    const g = evaluateGate(batch(40, { ...approvedThrough(3), ...tranche }));

    expect(g.stage).toBe('tranche');
    expect(g.writable).toEqual([]);
    expect(g.line).toBe('13 of 40 written · waiting on your feedback on 10 pages');
  });

  it('opens the rest of the batch once every released page is approved', () => {
    const g = evaluateGate(batch(40, approvedThrough(13)));

    expect(g.stage).toBe('open');
    expect(g.allowed).toBe(40);
    expect(g.writable).toHaveLength(27);
    expect(g.writable[0]).toBe(14);
    expect(g.line).toBe('13 of 40 written · open, the rest of the batch is released');
  });

  it('says the batch is done when every page is approved', () => {
    const g = evaluateGate(batch(5, approvedThrough(5)));

    expect(g.stage).toBe('open');
    expect(g.line).toBe('5 of 5 written · all 5 approved');
  });

  it('a batch smaller than the sample releases what it has', () => {
    const g = evaluateGate(batch(2));

    expect(g.allowed).toBe(2);
    expect(g.line).toBe('0 of 2 written · writing a sample of 2 for your feedback first');
  });
});

describe('discarded pages and order', () => {
  it('leaves a discarded page out of the count and moves the next page into the sample', () => {
    const g = evaluateGate(batch(40, { 2: { status: 'rejected', written: true } }));

    expect(g.total).toBe(39);
    expect(g.released).toEqual([1, 3, 4]);
  });

  it('reads the batch in its planned order, not the order the rows arrive in', () => {
    const pages = batch(5).reverse();

    expect(evaluateGate(pages).released).toEqual([1, 2, 3]);
  });

  it('says so when nothing is planned', () => {
    expect(evaluateGate([]).line).toBe('No pages planned yet');
  });
});

describe('the gate sizes', () => {
  it('defaults to a sample of 3 and a tranche of 10', () => {
    expect(gateConfigFrom({})).toEqual(DEFAULT_SEO_GATE);
    expect(gateConfigFrom(null)).toEqual({ sample: 3, tranche: 10 });
  });

  it('reads the project\'s own sizes', () => {
    expect(gateConfigFrom({ seoGate: { sample: 5, tranche: 20 } })).toEqual({ sample: 5, tranche: 20 });
    expect(gateConfigFrom({ seoGate: { sample: 1 } })).toEqual({ sample: 1, tranche: 10 });
  });

  it('never opens the gate on a bad value: each falls back to its default', () => {
    expect(gateConfigFrom({ seoGate: { sample: 0, tranche: -1 } })).toEqual(DEFAULT_SEO_GATE);
    expect(gateConfigFrom({ seoGate: { sample: 2.5, tranche: '50' } })).toEqual(DEFAULT_SEO_GATE);
    expect(gateConfigFrom({ seoGate: { sample: 1000, tranche: 101 } })).toEqual(DEFAULT_SEO_GATE);
    expect(gateConfigFrom({ seoGate: 'open' })).toEqual(DEFAULT_SEO_GATE);
  });

  it('applies the project\'s sizes to the stages', () => {
    const cfg = gateConfigFrom({ seoGate: { sample: 1, tranche: 2 } });

    expect(evaluateGate(batch(10), cfg).released).toEqual([1]);
    expect(evaluateGate(batch(10, approvedThrough(1)), cfg).released).toEqual([1, 2, 3]);
    expect(evaluateGate(batch(10, approvedThrough(3)), cfg).stage).toBe('open');
  });
});
