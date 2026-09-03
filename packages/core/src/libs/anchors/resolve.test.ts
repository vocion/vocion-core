import { describe, expect, it } from 'vitest';
import { buildAnchor, resolveAnchor } from './resolve';

const TEXT = 'The angle rests on two sourced facts. The weakest point is the unverified email address.';

describe('anchor resolution', () => {
  it('round-trips a selection', () => {
    const start = TEXT.indexOf('two sourced facts');
    const anchor = buildAnchor(TEXT, start, start + 'two sourced facts'.length)!;

    expect(anchor.quote).toBe('two sourced facts');
    expect(resolveAnchor(TEXT, anchor)).toMatchObject({ start, end: start + 17 });
  });

  it('survives an edit elsewhere in the document', () => {
    const start = TEXT.indexOf('unverified email address');
    const anchor = buildAnchor(TEXT, start, start + 'unverified email address'.length)!;

    const edited = TEXT.replace('The angle rests on two sourced facts.', 'The angle now rests on three sourced facts, including the hiring signal.');
    const resolved = resolveAnchor(edited, anchor)!;

    expect(edited.slice(resolved.start, resolved.end)).toBe('unverified email address');
  });

  it('picks the right occurrence of a repeated phrase using its context', () => {
    const text = 'compliance updates in the first paragraph. Later, compliance updates in the second paragraph.';
    const secondStart = text.lastIndexOf('compliance updates');
    const anchor = buildAnchor(text, secondStart, secondStart + 'compliance updates'.length)!;

    const resolved = resolveAnchor(text, anchor)!;

    expect(resolved.start).toBe(secondStart);
    expect(resolved.exact).toBe(true);
  });

  it('orphans rather than guessing when the quote is gone', () => {
    const start = TEXT.indexOf('two sourced facts');
    const anchor = buildAnchor(TEXT, start, start + 'two sourced facts'.length)!;

    expect(resolveAnchor('An entirely rewritten brief with none of the old words.', anchor)).toBeNull();
  });

  it('an edit INSIDE the anchored span orphans it — the note is never re-pointed at different words', () => {
    const start = TEXT.indexOf('two sourced facts');
    const anchor = buildAnchor(TEXT, start, start + 'two sourced facts'.length)!;

    const edited = TEXT.replace('two sourced facts', 'three sourced facts');

    expect(resolveAnchor(edited, anchor)).toBeNull();
  });

  it('refuses an empty range', () => {
    expect(buildAnchor(TEXT, 5, 5)).toBeNull();
  });
});
