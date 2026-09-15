/**
 * link Card — a destination with a title and a line of context. In-app
 * routes (`/dashboard/...`) open in place; everything else opens in a new tab.
 * File artifacts render through this card too (see `cardPayloadFor`).
 */

import type { LinkSpec } from '../specs';
import { defineCard } from '@vocion/sdk';
import { ArrowUpRight, FileText } from 'lucide-react';
import { cn } from '@/utils/Helpers';
import { linkSpecSchema } from '../specs';

export const LINK_SLUG = 'link';

export function LinkCardView({ data, surface }: { data: LinkSpec; surface: string }) {
  const dense = surface !== 'artifact';
  const internal = data.href.startsWith('/');
  return (
    <a
      href={data.href}
      target={internal ? undefined : '_blank'}
      rel="noreferrer"
      className={cn('flex min-w-0 items-start gap-3 rounded-md border border-border hover:bg-muted/40', dense ? 'p-3 text-xs' : 'p-4 text-sm')}
    >
      <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground">{data.title}</span>
        {data.description && <span className="block truncate text-muted-foreground">{data.description}</span>}
      </span>
      <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
    </a>
  );
}

export const linkCard = defineCard({
  slug: LINK_SLUG,
  name: 'Link',
  description: 'Renders a destination — an in-app page, a file the agent produced, or an external URL — as a titled row with one line of context. Use instead of pasting a bare URL.',
  surfaces: ['chat', 'artifact', 'workflow-run', 'review-queue', 'activity-feed'],
  dataSchema: linkSpecSchema,
  Renderer: ({ data, surface }) => <LinkCardView data={data} surface={surface} />,
});
