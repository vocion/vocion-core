import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { describe, expect, it } from 'vitest';
import { remarkDropHtmlComments, shownSpec, withoutTitleHeading } from './markdownDisplay';

const BRIEF = [
  '# SERP brief: water heater repair Fairview',
  '<!-- serp-brief {"query":"water heater repair Fairview","google":true,"provider":"serper"} -->',
  '',
  'Top 3 for **water heater repair Fairview**.',
  '',
  'Intent <!-- inline note --> first.',
  '',
  '```html',
  '<!-- kept: this is code -->',
  '```',
].join('\n');

function html(md: string, plugins: unknown[] = [remarkGfm, remarkDropHtmlComments]): string {
  return renderToStaticMarkup(createElement(Markdown, { remarkPlugins: plugins as never }, md));
}

describe('HTML comments never render as text (2026-10-29)', () => {
  it('drops a block comment and an inline one, and keeps a comment inside a code fence', () => {
    const out = html(BRIEF);

    expect(out).not.toContain('serp-brief {');
    expect(out).not.toContain('inline note');
    expect(out).toContain('Intent');
    expect(out).toContain('first.');
    expect(out).toContain('&lt;!-- kept: this is code --&gt;');
  });

  it('without it, react-markdown prints the comment as words — the bug', () => {
    expect(html(BRIEF, [remarkGfm])).toContain('serp-brief {');
  });
});

describe('the title once (2026-10-29)', () => {
  it('drops an opening H1 that says the title the pane already shows', () => {
    const md = withoutTitleHeading(BRIEF, 'SERP brief: water heater repair Fairview');

    expect(md.startsWith('<!-- serp-brief')).toBe(true);
    expect(md).not.toContain('# SERP brief');
  });

  it('keeps an H1 that says something else, and a body with no H1', () => {
    expect(withoutTitleHeading('# Keyword map\n\nBody', 'SERP brief: x')).toBe('# Keyword map\n\nBody');
    expect(withoutTitleHeading('## SERP brief: x\n\nBody', 'SERP brief: x')).toBe('## SERP brief: x\n\nBody');
    expect(withoutTitleHeading('Body', null)).toBe('Body');
  });

  it('in the pane only: a chat card still shows its heading, and the stored spec is untouched', () => {
    const artifact = { kind: 'markdown' as const, title: 'SERP brief: water heater repair Fairview', spec: { title: 'SERP brief: water heater repair Fairview', md: BRIEF } };

    expect(shownSpec(artifact, 'artifact')).toEqual({ md: withoutTitleHeading(BRIEF, artifact.title) });
    expect(shownSpec(artifact, 'chat')).toBe(artifact.spec);
    expect(artifact.spec.md).toBe(BRIEF);
  });
});
