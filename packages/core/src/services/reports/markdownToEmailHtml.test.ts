import { describe, expect, it } from 'vitest';
import { escapeHtml, markdownToEmailHtml, markdownToPlainText, parseBlocks, renderInline } from './markdownToEmailHtml';

const ST = {
  h1: 'H1',
  h2: 'H2',
  h3: 'H3',
  p: 'P',
  ul: 'UL',
  ol: 'OL',
  li: 'LI',
  a: 'A',
  code: 'CODE',
  hr: 'HR',
  table: 'TABLE',
  th: 'TH',
  td: 'TD',
  blockquote: 'BQ',
};

describe('markdownToEmailHtml', () => {
  it('escapes agent text before any markup is applied', () => {
    const html = markdownToEmailHtml('<script>alert(1)</script> & **bold**', ST);

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; <strong>bold</strong>');
  });

  it('parses the briefing grammar: headings, lists, tables, rules, quotes, code fences', () => {
    const md = [
      '# Title',
      '',
      'Para one',
      'continues.',
      '',
      '- a',
      '- b',
      '  wrapped',
      '',
      '1. one',
      '2) two',
      '',
      '| H1 | H2 |',
      '|---|---|',
      '| c1 | c2 |',
      '',
      '---',
      '',
      '> quoted',
      '',
      '```',
      'code <here>',
      '```',
    ].join('\n');
    const blocks = parseBlocks(md);

    expect(blocks.map(b => b.t)).toEqual(['h', 'p', 'ul', 'ol', 'table', 'hr', 'quote', 'quote']);
    expect(blocks[1]).toEqual({ t: 'p', text: 'Para one continues.' });
    expect(blocks[2]).toEqual({ t: 'ul', items: ['a', 'b wrapped'] });
    expect(blocks[4]).toEqual({ t: 'table', head: ['H1', 'H2'], rows: [['c1', 'c2']] });

    const html = markdownToEmailHtml(md, ST);

    expect(html).toContain('<h1 style="H1">Title</h1>');
    expect(html).toContain('<th style="TH">H1</th>');
    expect(html).toContain('<blockquote style="BQ">code &lt;here&gt;</blockquote>');
  });

  it('keeps http(s)/mailto links and neutralises anything else', () => {
    expect(renderInline(escapeHtml('[ok](https://x.test/a?b=1&c=2)'), ST)).toBe('<a href="https://x.test/a?b=1&amp;c=2" style="A">ok</a>');
    expect(renderInline(escapeHtml('[bad](javascript:alert(1))'), ST)).toBe('bad (javascript:alert(1))');
  });

  it('renders inline code, bold and italic without eating asterisks in bold', () => {
    expect(renderInline('`x` **b** *i*', ST)).toBe('<code style="CODE">x</code> <strong>b</strong> <em>i</em>');
  });

  it('produces readable plain text', () => {
    const text = markdownToPlainText('## Head\n\n- **a** [l](https://x.test)\n\n| a | b |\n|---|---|\n| 1 | 2 |');

    expect(text).toBe('Head\n\n• a l (https://x.test)\n\n| a | b |\n\n| 1 | 2 |');
  });
});
