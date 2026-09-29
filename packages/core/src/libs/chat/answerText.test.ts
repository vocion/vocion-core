import { describe, expect, it } from 'vitest';
import { normalizeAnswerHtml, stripCardNotes } from './answerText';

describe('normalizeAnswerHtml', () => {
  it('turns a literal <br> into a Markdown line break, in any spelling', () => {
    expect(normalizeAnswerHtml('one<br>two<br/>three<BR />four')).toBe('one  \ntwo  \nthree  \nfour');
  });

  it('leaves everything else alone', () => {
    const md = '**bold** and `code <b>` and a [link](/x)\n\n- item';

    expect(normalizeAnswerHtml(md)).toBe(md);
  });
});

describe('stripCardNotes', () => {
  it('drops the card pass\'s "not a card" lines from a stored answer, and the gap they leave', () => {
    const stored = 'Plan 32 is approved.\n\n- **File the planning bug** — not a card: its input does not fit ask.file: title: Invalid input: expected string, received undefined.\n- **Notify the requester of #41** — not a card: its input does not fit notify.requester: steps.0.url: Invalid URL.';

    expect(stripCardNotes(stored)).toBe('Plan 32 is approved.');
  });

  it('keeps an ordinary list, and the words "not a card" anywhere else', () => {
    const md = 'Two moves:\n\n- **Approve plan 32** — it is ready\n- Say it is not a card: that is fine in prose';

    expect(stripCardNotes(md)).toBe(md);
  });
});
