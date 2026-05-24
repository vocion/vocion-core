/**
 * Generic key-value Card. Renders a list of `{ key, value }` pairs as a
 * two-column grid; the kind of thing you'd otherwise reach for `<dl>` for.
 *
 * Useful as a deliberate intermediate fallback for any payload whose author
 * doesn't want to ship a custom Card but wants something less raw than the
 * JsonDump. Producers opt in with `__card: 'key-value'` and an explicit
 * `pairs` array.
 */

import { defineCard } from '@vocion/sdk';
import { z } from 'zod';

export const KEY_VALUE_SLUG = 'key-value';

const keyValueSchema = z.object({
  title: z.string().optional(),
  pairs: z.array(z.object({
    key: z.string(),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  })),
});

export const keyValueCard = defineCard({
  slug: KEY_VALUE_SLUG,
  name: 'Key / value',
  description: 'Renders a payload as a two-column table of key/value pairs. Use for structured-but-simple outputs where a custom card would be overkill (status snapshots, summaries, attribute lists).',
  surfaces: ['chat', 'workflow-run', 'review-queue', 'activity-feed'],
  dataSchema: keyValueSchema,
  Renderer: ({ data, surface }) => {
    const dense = surface === 'chat' || surface === 'activity-feed';
    return (
      <div className={dense ? 'rounded border border-border bg-background p-3' : 'rounded-lg border border-border bg-background p-4'}>
        {data.title && (
          <div className={dense ? 'mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase' : 'mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase'}>
            {data.title}
          </div>
        )}
        <dl className={dense ? 'grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs' : 'grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm'}>
          {data.pairs.map(({ key, value }) => (
            <div key={key} className="contents">
              <dt className="font-mono text-muted-foreground">{key}</dt>
              <dd className="break-words">{value === null ? <span className="text-muted-foreground italic">null</span> : String(value)}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  },
});
