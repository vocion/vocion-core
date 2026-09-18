import { describe, expect, it } from 'vitest';
import { normalizeAnswerHtml } from './answerText';

describe('normalizeAnswerHtml', () => {
  it('turns a literal <br> into a Markdown line break, in any spelling', () => {
    expect(normalizeAnswerHtml('one<br>two<br/>three<BR />four')).toBe('one  \ntwo  \nthree  \nfour');
  });

  it('leaves everything else alone', () => {
    const md = '**bold** and `code <b>` and a [link](/x)\n\n- item';

    expect(normalizeAnswerHtml(md)).toBe(md);
  });
});
