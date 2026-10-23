import { describe, expect, it } from 'vitest';
import { firstMessageTitle, plainText } from './threadTitle';

describe('a first-message title reads as words, not markdown (2026-10-23)', () => {
  it('drops images, keeps link words, and takes off emphasis, code and heading marks', () => {
    expect(plainText('![](/kestrel/src/rfi.svg#icon) **Project status** for `Job 214`')).toBe('Project status for Job 214');
    expect(plainText('## See [the RFI log](https://example.com/rfi) _today_')).toBe('See the RFI log today');
    expect(plainText('> quoted line\n- a list item')).toBe('quoted line\na list item');
  });

  it('leaves plain words, snake_case and arithmetic alone', () => {
    expect(plainText('Where does the Contoso Supply renewal stand?')).toBe('Where does the Contoso Supply renewal stand?');
    expect(plainText('rename lead_score to fit_score')).toBe('rename lead_score to fit_score');
    expect(plainText('2 * 3 is six')).toBe('2 * 3 is six');
  });

  it('titles a markdown-led message by its words', () => {
    expect(firstMessageTitle('![](/x.svg#icon) **Draft RFI-112** for the pour')).toBe('Draft RFI-112 for the pour');
  });
});
