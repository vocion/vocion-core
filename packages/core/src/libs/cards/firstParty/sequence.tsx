/**
 * sequence Card — a drafted outreach sequence, read-only.
 *
 * The draft sequence is one of the three artifacts the personalization lead
 * page is built from, and it is STRUCTURED rather than prose
 * (`docs/specs/personalization-v2.md`): "the draft sequence is a typed
 * artifact, not markdown, and its editor is the sequence editor rather than a
 * textarea." This card is the artifact's PREVIEW — what it looks like in the
 * artifacts log, in the preview pane, or cited in a turn. The editor lives on
 * the lead page's Sequence tab, where the decision is.
 *
 * Hairlines between sends, no box around each one: a bordered surface never
 * contains another bordered surface (`docs/design/patterns.md`, Never).
 */

import type { SequenceSpec } from '../specs';
import { defineCard } from '@vocion/sdk';
import { cn } from '@/utils/Helpers';
import { sequenceSpecSchema } from '../specs';

export const SEQUENCE_SLUG = 'sequence';

export function SequenceCardView({ data, surface }: { data: SequenceSpec; surface: string }) {
  const dense = surface !== 'artifact';
  const header = [data.sequenceName, data.sends.length > 0 ? `${data.sends.length} ${data.sends.length === 1 ? 'send' : 'sends'}` : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className={cn('min-w-0', dense ? 'text-xs' : 'text-sm')}>
      {header && <p className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">{header}</p>}
      {data.rationale && <p className="mt-1 text-muted-foreground">{data.rationale}</p>}
      {data.sends.length === 0
        ? <p className="mt-2 text-muted-foreground">No sends drafted yet.</p>
        : (
            <ul className="mt-2 divide-y divide-rule border-t border-rule">
              {data.sends.map(send => (
                <li key={send.step} className="py-2">
                  <p className="text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
                    {send.day === undefined ? `Send ${send.step}` : `Day ${send.day}`}
                  </p>
                  <p className="font-medium break-words">{send.subject}</p>
                  <p className="mt-0.5 leading-relaxed whitespace-pre-line text-foreground/80">{send.body}</p>
                </li>
              ))}
            </ul>
          )}
    </div>
  );
}

export const sequenceCard = defineCard({
  slug: SEQUENCE_SLUG,
  name: 'Sequence',
  description: 'Renders a drafted outreach sequence — the sends in order, with their cadence and the rationale for the sequence choice. Read-only: the sends are edited and decided on the record page that owns them.',
  surfaces: ['chat', 'artifact', 'workflow-run', 'review-queue', 'activity-feed'],
  dataSchema: sequenceSpecSchema,
  Renderer: ({ data, surface }) => <SequenceCardView data={data} surface={surface} />,
});
