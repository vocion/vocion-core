import { describe, expect, it } from 'vitest';
import { describeTaskFailure } from './failure';

describe('describeTaskFailure', () => {
  it('keeps the message of a plain error', () => {
    const text = describeTaskFailure(new Error('boom'));

    expect(text).toContain('Error: boom');
  });

  it('names every error in an AggregateError, not just the summary', () => {
    const aggregate = new AggregateError(
      [new TypeError('fetch failed for page 2'), new RangeError('page 3 went past the cap')],
      'Multiple errors occurred during superstep 33.',
    );

    const text = describeTaskFailure(aggregate);

    expect(text).toContain('Multiple errors occurred during superstep 33.');
    expect(text).toContain('TypeError: fetch failed for page 2');
    expect(text).toContain('RangeError: page 3 went past the cap');
  });

  it('follows a cause chain to the real failure', () => {
    const inner = new Error('ECONNREFUSED 127.0.0.1:5432');
    const outer = new Error('tool error', { cause: inner });

    const text = describeTaskFailure(outer);

    expect(text).toContain('Error: tool error');
    expect(text).toContain('ECONNREFUSED 127.0.0.1:5432');
  });

  it('indents nested errors so the shape is readable', () => {
    const aggregate = new AggregateError([new Error('first')], 'two failed');

    const lines = describeTaskFailure(aggregate).split('\n');

    expect(lines[0]).toBe('AggregateError: two failed');
    expect(lines.some(line => line.startsWith('  Error: first'))).toBe(true);
  });

  it('describes a thrown non-error', () => {
    expect(describeTaskFailure('just a string')).toContain('just a string');
    expect(describeTaskFailure(undefined)).toContain('Error:');
  });

  it('stops following a cause chain instead of recursing forever', () => {
    const loop: Error & { cause?: unknown } = new Error('outer');
    loop.cause = loop;

    const text = describeTaskFailure(loop);

    expect(text).toContain('nesting cut off');
  });

  it('caps a runaway description', () => {
    const text = describeTaskFailure(new Error('x'.repeat(10_000)));

    expect(text.length).toBeLessThan(4_200);
    expect(text).toContain('(truncated)');
  });
});
