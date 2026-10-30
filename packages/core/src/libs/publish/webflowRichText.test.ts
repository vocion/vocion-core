import { describe, expect, it } from 'vitest';
import { firstImageOf, markdownToWebflowRichText } from './webflowRichText';

describe('markdown to Webflow rich text', () => {
  it('writes headings, paragraphs, lists, quotes, links, emphasis and code the way the rich text field holds them', () => {
    const { html, notes } = markdownToWebflowRichText([
      'Three layers, and **when** to shed *each* one. See [the gear list](/blog/gear-list) or [our shop](https://www.northwind-outfitters.example/shop).',
      '',
      '## The base layer',
      '',
      '- Merino',
      '- A synthetic blend',
      '',
      '1. Wick',
      '2. Warm',
      '',
      '> Never cotton.',
      '',
      'Use `merino-150` weight.',
    ].join('\n'));

    expect(html).toBe([
      '<p>Three layers, and <strong>when</strong> to shed <em>each</em> one. See <a href="/blog/gear-list">the gear list</a> or <a href="https://www.northwind-outfitters.example/shop">our shop</a>.</p>',
      '<h2>The base layer</h2>',
      '<ul><li>Merino</li><li>A synthetic blend</li></ul>',
      '<ol><li>Wick</li><li>Warm</li></ol>',
      '<blockquote>Never cotton.</blockquote>',
      '<p>Use <code>merino-150</code> weight.</p>',
    ].join('\n'));
    expect(notes).toEqual([]);
  });

  it('puts images by URL in figures Webflow fetches and hosts, never inside a paragraph', () => {
    const { html, images } = markdownToWebflowRichText('Before the climb.\n\n![A tent at dusk](https://images.example/tent.jpg "Camp at 3,000 m")\n\nAfter ![inline](https://images.example/inline.png) it.');

    expect(html).toBe([
      '<p>Before the climb.</p>',
      '<figure class="w-richtext-figure-type-image w-richtext-align-fullwidth"><div><img src="https://images.example/tent.jpg" alt="A tent at dusk"></div><figcaption>Camp at 3,000 m</figcaption></figure>',
      '<p>After  it.</p>',
      '<figure class="w-richtext-figure-type-image w-richtext-align-fullwidth"><div><img src="https://images.example/inline.png" alt="inline"></div></figure>',
    ].join('\n'));
    expect(images).toEqual(['https://images.example/tent.jpg', 'https://images.example/inline.png']);
  });

  it('says what it changed: an h1 becomes an h2, a table a list, a rule and a local image are left out', () => {
    const { html, notes } = markdownToWebflowRichText('# A second title\n\n| Layer | Fabric |\n|---|---|\n| Base | Merino |\n\n---\n\n![x](./local.png)');

    expect(html).toBe('<h2>A second title</h2>\n<ul><li><strong>Layer:</strong> Base; <strong>Fabric:</strong> Merino</li></ul>');
    expect(notes).toHaveLength(4);
    expect(notes.join(' ')).toMatch(/h2[\s\S]*table[\s\S]*rule[\s\S]*http\(s\)/);
  });

  it('escapes raw HTML and refuses a script link, so the draft can never inject markup', () => {
    const { html } = markdownToWebflowRichText('<script>alert(1)</script> and [click](javascript:void)\n\n```\n<b>code</b>\n```');

    expect(html).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt; and click</p>\n<pre><code>&lt;b&gt;code&lt;/b&gt;</code></pre>');
  });

  it('finds the first image a draft shows, for the post\'s main image', () => {
    expect(firstImageOf('Text\n\n![local](./a.png)\n\n![A tent](https://images.example/tent.jpg)')).toEqual({ url: 'https://images.example/tent.jpg', alt: 'A tent' });
    expect(firstImageOf('No images.')).toBeNull();
  });
});
