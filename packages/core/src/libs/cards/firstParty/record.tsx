/**
 * record Card — one entity (a deal, a contact, an agent, a mission) with a
 * few fields and a link into the app. `render_record` produces it when the
 * answer IS a thing a person will open, not a paragraph about it.
 */

import type { RecordSpec } from '../specs';
import { defineCard } from '@vocion/sdk';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/utils/Helpers';
import { recordSpecSchema } from '../specs';

export const RECORD_SLUG = 'record';

export function RecordCardView({ data, surface }: { data: RecordSpec; surface: string }) {
  const dense = surface !== 'artifact';
  const internal = data.href?.startsWith('/');
  const Title = data.href
    ? (
        <a href={data.href} target={internal ? undefined : '_blank'} rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-foreground hover:underline">
          {data.label}
          <ArrowUpRight className="size-3.5 text-muted-foreground" />
        </a>
      )
    : <span className="font-medium text-foreground">{data.label}</span>;
  return (
    <div className={cn('min-w-0 rounded-md border border-border', dense ? 'p-3 text-xs' : 'p-4 text-sm')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] tracking-wide text-muted-foreground uppercase">{data.type}</div>
          <div className={cn('truncate', dense ? 'text-sm' : 'text-base')}>{Title}</div>
        </div>
        {data.status && <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] leading-4 text-foreground/80">{data.status}</span>}
      </div>
      {data.fields.length > 0 && (
        <dl className={cn('mt-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4', dense ? 'gap-y-1' : 'gap-y-1.5')}>
          {data.fields.map(f => (
            <div key={f.k} className="contents">
              <dt className="text-muted-foreground">{f.k}</dt>
              <dd className="truncate text-foreground">{f.v === null ? '—' : String(f.v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export const recordCard = defineCard({
  slug: RECORD_SLUG,
  name: 'Record',
  description: 'Renders one entity — a deal, contact, agent, mission, run — as a compact card with its type, a few fields, an optional status pill, and a link into the app. Use when the answer is a thing the person will open.',
  surfaces: ['chat', 'artifact', 'workflow-run', 'review-queue', 'activity-feed'],
  dataSchema: recordSpecSchema,
  Renderer: ({ data, surface }) => <RecordCardView data={data} surface={surface} />,
});
