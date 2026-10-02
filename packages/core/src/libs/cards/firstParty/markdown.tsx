/**
 * markdown Card — a note, a brief section, a plan the agent wrote with
 * `render_markdown`. GFM (tables, task lists) on; raw HTML off. Links that
 * start with `/` stay in the app.
 */

import type { Components } from 'react-markdown';
import type { MarkdownSpec } from '../specs';
import { defineCard } from '@vocion/sdk';
import { Children, isValidElement } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/utils/Helpers';
import { anchorCounter, headingText } from '../headingAnchor';
import { markdownSpecSchema } from '../specs';

/**
 * A heading's words, from what react-markdown hands the component.
 * @param children - The heading's children.
 */
function textOf(children: React.ReactNode): string {
  return Children.toArray(children).map(c => (typeof c === 'string' || typeof c === 'number' ? String(c) : isValidElement<{ children?: React.ReactNode }>(c) ? textOf(c.props.children) : '')).join('');
}

/**
 * Headings with ids, on the artifact's own page only: a link can open the
 * document at a section (`libs/cards/headingAnchor.ts` — a release's named
 * test opens the test run at the criterion it proves). One counter per
 * drawing, so a repeated heading is numbered the way the link numbers it.
 */
function anchoredHeadings(): Components {
  const next = anchorCounter();
  const heading = (Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') => ({ children }: { children?: React.ReactNode }) => (
    <Tag id={next(headingText(textOf(children)))} className="scroll-mt-4">{children}</Tag>
  );
  return { h1: heading('h1'), h2: heading('h2'), h3: heading('h3'), h4: heading('h4'), h5: heading('h5'), h6: heading('h6') };
}

export const MARKDOWN_SLUG = 'markdown';

export function MarkdownCardView({ data, surface }: { data: MarkdownSpec; surface: string }) {
  const dense = surface !== 'artifact';
  return (
    <article className={cn('min-w-0', dense ? 'text-sm' : 'text-[15px] leading-7')}>
      {data.title && <h3 className={cn('mb-2 font-semibold text-foreground', dense ? 'text-sm' : 'text-base')}>{data.title}</h3>}
      <div className={cn('prose prose-sm max-w-none text-foreground prose-headings:font-semibold prose-a:text-foreground prose-a:underline prose-a:decoration-border prose-a:underline-offset-2 dark:prose-invert', dense && 'line-clamp-[14]')}>
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{
            ...(dense ? {} : anchoredHeadings()),
            a: ({ href, children }) => (
              <a href={href} target={href?.startsWith('/') ? undefined : '_blank'} rel="noreferrer">{children}</a>
            ),
          }}
        >
          {data.md}
        </Markdown>
      </div>
    </article>
  );
}

export const markdownCard = defineCard({
  slug: MARKDOWN_SLUG,
  name: 'Markdown',
  description: 'Renders a markdown document — a note, a plan, a brief section, a checklist — with GFM tables and task lists. Use when the agent wrote prose a person will keep beside the conversation rather than read once in it.',
  surfaces: ['chat', 'artifact', 'workflow-run', 'review-queue', 'activity-feed'],
  dataSchema: markdownSpecSchema,
  Renderer: ({ data, surface }) => <MarkdownCardView data={data} surface={surface} />,
});
