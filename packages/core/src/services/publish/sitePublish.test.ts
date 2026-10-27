import { describe, expect, it } from 'vitest';
import { firstParagraph, markdownToHtml } from './sitePublish';

describe('a page\'s pieces', () => {
  it('takes a description from the draft\'s first paragraph of prose when nobody wrote one', () => {
    expect(firstParagraph('# Title\n\n- a list\n\nA **tent** for [spring](https://northwind-outfitters.example), summer and fall.')).toBe('A tent for spring, summer and fall.');

    const long = firstParagraph(`Intro ${'word '.repeat(60)}`);

    expect(long.length).toBeLessThanOrEqual(156);
    expect(long.endsWith('…')).toBe(true);
  });

  it('renders markdown to HTML with the app\'s own renderer, tables included', async () => {
    expect(await markdownToHtml('## Weight\n\n| a | b |\n| - | - |\n| 1 | 2 |')).toBe('<h2>Weight</h2>\n<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
  });
});
