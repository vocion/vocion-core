import { describe, expect, it } from 'vitest';
import { evaluateCondition, holds, interpolateString, interpolateText, interpolateValue, parseCondition, referencedPaths } from './expressions';

const scope = {
  input: { page_id: 42, keyword: 'boiler repair', target: 'none', batch_ref: 'SB-512', pages: [{ id: 1 }, { id: 2 }] },
  steps: {
    'review': { output: { verdict: 'revise', findings: ['Thin intro', 'No local proof'] } },
    'refresh-mail': { output: { gmail: 'synced' } },
  },
  trigger: { event: 'object.created' },
  repeat: { round: 2, max: 3 },
};

describe('interpolation', () => {
  it('keeps the type of a whole-string reference', () => {
    expect(interpolateString('{{input.pages}}', scope)).toEqual([{ id: 1 }, { id: 2 }]);
    expect(interpolateString('{{input.page_id}}', scope)).toBe(42);
  });

  it('writes references inside text as text, and a missing one as nothing', () => {
    expect(interpolateText('Research page {{input.page_id}} for "{{input.keyword}}"{{input.nope}}', scope)).toBe('Research page 42 for "boiler repair"');
  });

  it('reads step names with dashes, the repeat round, and the trigger', () => {
    expect(interpolateText('{{steps.refresh-mail.output.gmail}} · round {{repeat.round}} of {{repeat.max}} · {{trigger.event}}', scope)).toBe('synced · round 2 of 3 · object.created');
  });

  it('writes a list inside text as JSON', () => {
    expect(interpolateText('Fix: {{steps.review.output.findings}}', scope)).toBe('Fix: ["Thin intro","No local proof"]');
  });

  it('interpolates every string leaf of an input', () => {
    expect(interpolateValue({ to: '{{input.batch_ref}}', n: 3, nested: ['{{input.keyword}}'] }, scope)).toEqual({ to: 'SB-512', n: 3, nested: ['boiler repair'] });
  });

  it('lists the paths a string reads', () => {
    expect(referencedPaths('{{steps.review.output.verdict}} == {{ input.x }}')).toEqual(['steps.review.output.verdict', 'input.x']);
  });
});

describe('conditions', () => {
  it('compares a reference with a quoted string', () => {
    expect(evaluateCondition('{{steps.review.output.verdict}} == \'pass\'', scope)).toBe(false);
    expect(evaluateCondition('{{steps.review.output.verdict}} == "revise"', scope)).toBe(true);
    expect(evaluateCondition('{{input.target}} != \'none\'', scope)).toBe(false);
  });

  it('reads a missing value as empty', () => {
    expect(evaluateCondition('{{input.missing}} != \'none\'', scope)).toBe(true);
    expect(evaluateCondition('{{input.missing}} == \'\'', scope)).toBe(true);
    expect(evaluateCondition('{{input.missing}} == null', scope)).toBe(true);
  });

  it('compares numbers and booleans as text', () => {
    expect(evaluateCondition('{{input.page_id}} == 42', scope)).toBe(true);
    expect(evaluateCondition('{{repeat.round}} != 3', scope)).toBe(true);
  });

  it('reads a bare reference as whether it holds something', () => {
    expect(evaluateCondition('{{steps.review.output.findings}}', scope)).toBe(true);
    expect(evaluateCondition('{{input.missing}}', scope)).toBe(false);
  });

  it('refuses what is not one comparison', () => {
    expect(parseCondition('{{a}} > 3').ok).toBe(false);
    expect(parseCondition('verdict == pass').ok).toBe(false);
    expect(parseCondition('{{a}} == \'x\' && {{b}}').ok).toBe(false);
    expect(parseCondition('\'a\' == \'a\'').ok).toBe(false);
    expect(() => evaluateCondition('{{a}} ~ 1', scope)).toThrow(/not a condition/);
  });

  it('accepts surrounding space', () => {
    expect(parseCondition('  {{ steps.review.output.verdict }}  ==  \'pass\' ').ok).toBe(true);
  });

  it('says what holds', () => {
    for (const v of [undefined, null, false, 0, '', ' ', 'false', 'No', '0', [], {}]) {
      expect(holds(v)).toBe(false);
    }
    for (const v of [true, 1, 'yes', 'pass', [0], { a: 1 }]) {
      expect(holds(v)).toBe(true);
    }
  });
});
