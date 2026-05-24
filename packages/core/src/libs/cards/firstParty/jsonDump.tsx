/**
 * Terminal-fallback Card. Renders any payload as pretty-printed JSON.
 *
 * Reached when (a) the payload has no `__card` discriminator, (b) the named
 * card isn't registered, (c) the payload fails the card's schema, or (d)
 * future LLM-picked / A2UI mechanisms haven't matched. Every surface uses
 * this as the last fallback — there is no "unrenderable" state.
 *
 * Visual: matches today's `HitlGate` `<pre>` so behavior is consistent with
 * the pre-Cards-SDK surfaces. Stage 2 may give this a richer key-value
 * rendering for object payloads.
 */

import { defineCard } from '@vocion/sdk';
import { z } from 'zod';

export const JSON_DUMP_SLUG = 'json-dump';

export const jsonDumpCard = defineCard({
  slug: JSON_DUMP_SLUG,
  name: 'Raw JSON',
  description: 'Generic fallback that renders any payload as pretty-printed JSON. Used when no more-specific card matches the payload shape.',
  surfaces: ['chat', 'workflow-run', 'review-queue', 'activity-feed'],
  dataSchema: z.unknown(),
  Renderer: ({ data, surface }) => {
    const dense = surface === 'chat' || surface === 'activity-feed';
    return (
      <pre
        className={
          dense
            ? 'overflow-x-auto rounded border border-border bg-muted/40 p-2 font-mono text-xs leading-snug'
            : 'overflow-x-auto rounded-lg border border-border bg-muted/40 p-4 font-mono text-xs leading-relaxed'
        }
      >
        {JSON.stringify(data, null, 2)}
      </pre>
    );
  },
});
