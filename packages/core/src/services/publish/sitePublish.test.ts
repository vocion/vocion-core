import { describe, expect, it } from 'vitest';
import { bylineOf, contentHashOf, firstParagraph, markdownToHtml, signedVersionOf, tagsOf } from './sitePublish';

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

describe('the page\'s byline and tags, for the site\'s frontmatter (SEO walk 2)', () => {
  const project = { authors: [{ name: 'Dana Reyes', slug: 'dana-r', default: true }, { name: 'Sam Okafor' }] };

  it('signs with the page\'s author, slugged as the project names them', () => {
    expect(bylineOf({ author: { name: 'Dana Reyes', from: 'planned' } }, project)).toEqual({ name: 'Dana Reyes', slug: 'dana-r' });
    expect(bylineOf({ author: 'Sam Okafor' }, project)).toEqual({ name: 'Sam Okafor', slug: 'sam-okafor' });
  });

  it('falls back to the project\'s default author, and to nobody when it names none', () => {
    expect(bylineOf({}, project)).toEqual({ name: 'Dana Reyes', slug: 'dana-r' });
    expect(bylineOf({}, { authors: [] })).toBeNull();
  });

  it('reads tags as a list or a comma-separated line', () => {
    expect(tagsOf(['heat pumps', ' HVAC ', 'heat pumps'])).toEqual(['heat pumps', 'HVAC']);
    expect(tagsOf('plumbing, water heaters')).toEqual(['plumbing', 'water heaters']);
    expect(tagsOf(undefined)).toEqual([]);
  });
});
