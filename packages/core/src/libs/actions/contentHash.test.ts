/**
 * The hash a check is derived from.
 *
 * The risk this pins is specific: if the approve route hashed what it received
 * and the surface hashed what it renders by a different rule, every check
 * would read stale and the walk could never complete. There is one exported
 * function and both call sites import it, so the test that matters is the last
 * one here — the route's answer and the client's answer, over the same copy,
 * are the same string.
 */
import { describe, expect, it } from 'vitest';
import { contentHash } from './contentHash';

describe('contentHash', () => {
  it('is stable for the same copy', () => {
    expect(contentHash('Re: your AI line', 'Musa, one more note.'))
      .toBe(contentHash('Re: your AI line', 'Musa, one more note.'));
  });

  it('moves when the body changes — this is what clears a check', () => {
    const before = contentHash('Re: your AI line', 'Musa, one more note.');
    const after = contentHash('Re: your AI line', 'Musa, one more thing.');

    expect(after).not.toBe(before);
  });

  it('moves when the subject changes', () => {
    expect(contentHash('Re: your AI line', 'Same body'))
      .not
      .toBe(contentHash('Re: your automation line', 'Same body'));
  });

  it('ignores surrounding whitespace — a textarea newline is not a change a reviewer made', () => {
    expect(contentHash('  Re: your AI line  ', '\nMusa, one more note.\n'))
      .toBe(contentHash('Re: your AI line', 'Musa, one more note.'));
  });

  it('reads an absent subject and an empty one as the same copy', () => {
    expect(contentHash(undefined, 'Body')).toBe(contentHash('', 'Body'));
  });

  it('does not let the subject and body run together', () => {
    // Without a separator these two would hash alike, and editing a send by
    // moving one word out of its subject would leave its check standing.
    expect(contentHash('ab', 'c')).not.toBe(contentHash('a', 'bc'));
  });

  it('separates two sends whose copy differs only by where the split falls', () => {
    expect(contentHash('One', 'Two')).not.toBe(contentHash('Two', 'One'));
  });

  it('gives the route and the client the same answer over the same copy', () => {
    // The route hashes what it RECEIVED (the payload the client posted); the
    // client hashes what it RENDERS (the edit over the item). Same function,
    // same two strings, so the two can never disagree about what a check
    // refers to.
    const item = { subject: 'Re: your AI line', body: 'Musa, one more note.' };
    const posted = { subject: item.subject, body: item.body };
    const rendered = { subject: undefined as string | undefined, body: undefined as string | undefined };

    const routeSide = contentHash(posted.subject, posted.body);
    const clientSide = contentHash(rendered.subject ?? item.subject, rendered.body ?? item.body);

    expect(clientSide).toBe(routeSide);
  });
});
