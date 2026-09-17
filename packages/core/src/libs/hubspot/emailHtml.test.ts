import { describe, expect, it } from 'vitest';
import { textToEmailHtml } from './emailHtml';

describe('textToEmailHtml', () => {
  it('splits blank lines into paragraphs and single newlines into breaks', () => {
    expect(textToEmailHtml('Musa,\n\nFirst point.\nSecond line.\n\nBest,')).toBe(
      '<p>Musa,</p><p>First point.<br>Second line.</p><p>Best,</p>',
    );
  });

  it('escapes markup so drafted text never becomes tags', () => {
    expect(textToEmailHtml('a < b & c > d')).toBe('<p>a &lt; b &amp; c &gt; d</p>');
  });

  it('drops empty paragraphs from stray blank lines', () => {
    expect(textToEmailHtml('one\n\n\n\ntwo\n\n')).toBe('<p>one</p><p>two</p>');
  });
});
