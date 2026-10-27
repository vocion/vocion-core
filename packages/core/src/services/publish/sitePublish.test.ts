import { describe, expect, it } from 'vitest';
import { contentHashOf, firstParagraph, markdownToHtml, signedVersionOf } from './sitePublish';

describe('a page\'s pieces', () => {
  it('takes a description from the draft\'s first paragraph of prose when nobody wrote one', () => {
    expect(firstParagraph('# Title\n\n- a list\n\nA **tent** for [spring](https://northwind-outfitters.example), summer and fall.')).toBe('A tent for spring, summer and fall.');

    const long = firstParagraph(`Intro ${'word '.repeat(60)}`);

    expect(long.length).toBeLessThanOrEqual(156);
    expect(long.endsWith('…')).toBe(true);
  });

  it('renders markdown to plain HTML, escaped, with no inline styles, tables included', async () => {
    expect(await markdownToHtml('## Weight\n\nUnder **2 kg** <b>x</b>\n\n| a | b |\n| --- | --- |\n| 1 | 2 |')).toBe('<h2>Weight</h2>\n<p>Under <strong>2 kg</strong> &lt;b&gt;x&lt;/b&gt;</p>\n<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>');
  });

  it('reads what a sign-off covered, in whichever field it was written', async () => {
    expect(signedVersionOf({ signoff: { version: 3 } })).toEqual({ version: 3, contentHash: null });
    expect(signedVersionOf({ signoff: { signedOffVersion: 2, contentHash: 'h' } })).toEqual({ version: 2, contentHash: 'h' });
    expect(signedVersionOf({ signedOffVersion: 5 })).toEqual({ version: 5, contentHash: null });
    expect(signedVersionOf({})).toEqual({ version: null, contentHash: null });
    expect(await contentHashOf('a')).toBe('ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
  });
});
