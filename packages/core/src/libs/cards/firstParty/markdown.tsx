/**
 * markdown Card — a note, a brief section, a plan the agent wrote with
 * `render_markdown`. GFM (tables, task lists) on; raw HTML off. Links that
 * start with `/` stay in the app.
 */

import type { MarkdownSpec } from '../specs';
import { defineCard } from '@vocion/sdk';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/utils/Helpers';
import { markdownSpecSchema } from '../specs';

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
