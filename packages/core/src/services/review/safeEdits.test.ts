/**
 * Nothing a client posts is trusted, and nothing it did not touch is rewritten.
 *
 * Those are the two halves of this boundary, and the second is as important as
 * the first: sanitizing an agent's plain-text draft into paragraphs would
 * change copy nobody edited, change the hash a check is drawn from, and take
 * a reviewer's approval back for no reason.
 */
import { describe, expect, it } from 'vitest';
import { safeBody, safeContentEdits } from './safeEdits';

describe('a body on its way into storage', () => {
  it('leaves an agent\'s prose exactly as it was', () => {
    const prose = 'Rowan, saw the hires.\n\nWorth twenty minutes?';

    expect(safeBody(prose)).toBe(prose);
  });

  it('keeps the formatting a reviewer composed', () => {
    const html = '<p>Rowan, saw the <strong>hires</strong>.</p>';

    expect(safeBody(html)).toBe(html);
  });

  it('strips a script a client had no business posting', () => {
    expect(safeBody('<p>Hi</p><script>fetch("//evil.test")</script>')).toBe('<p>Hi</p>');
  });

  it('strips an event handler off a tag it otherwise allows', () => {
    expect(safeBody('<p onmouseover="steal()">Hi</p>')).toBe('<p>Hi</p>');
  });

  it('refuses a javascript: link', () => {
    expect(safeBody('<p><a href="javascript:alert(1)">read more</a></p>')).toBe('<p><a>read more</a></p>');
  });
});

describe('the reviewer\'s edits', () => {
  it('sanitizes every body and leaves subjects alone', () => {
    const edits = safeContentEdits([
      { id: 'send-1', subject: 'Your platform hires', body: '<p>Clean</p><script>x()</script>' },
      { id: 'send-2', body: 'Still prose.' },
    ]);

    expect(edits).toEqual([
      { id: 'send-1', subject: 'Your platform hires', body: '<p>Clean</p>' },
      { id: 'send-2', body: 'Still prose.' },
    ]);
  });

  it('passes an edit with no body through untouched', () => {
    expect(safeContentEdits([{ id: 'send-1', subject: 'Only the subject' }]))
      .toEqual([{ id: 'send-1', subject: 'Only the subject' }]);
  });
});
