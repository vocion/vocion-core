import type { WatchState } from '@/services/workspace/watchState';
import { Radar } from 'lucide-react';
import { ListEmpty, StatusDot } from '@/components/patterns';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { relativeLabel } from '@/libs/timeAgo';

/**
 * A page with no rows, saying what is watching for them (a page's
 * `empty.watch`): what the automation watches, and when it last read — or
 * that it watches nothing, is paused, is off, or failed its last read, with
 * the reason. A quiet production and a watch pointed at nothing must never
 * read the same (`services/workspace/watchState.ts`).
 * @param root0 - Props.
 * @param root0.text - The page's own words for an empty page.
 * @param root0.watch - The watch's state, or null when the page names none or it could not be read.
 * @param root0.now - The instant "last read" is measured against.
 */
export function WatchEmpty({ text, watch, now }: { text: string; watch: WatchState | null; now: number }) {
  return (
    <ListEmpty
      icon={Radar}
      title={text}
      description={watch ? <WatchLine watch={watch} now={now} /> : undefined}
      action={watch && watch.state !== 'active' ? { label: 'Open Automations', href: '/dashboard/automations' } : undefined}
    />
  );
}

function WatchLine({ watch, now }: { watch: WatchState; now: number }) {
  if (watch.state === 'missing') {
    return <span data-testid="watch-line">Nothing is watching: this workspace has no automation that fills this page.</span>;
  }
  const what = watch.items.length > 0
    ? <>{`${watch.name} watches ${watch.items.join(', ')}.`}</>
    : <>{`${watch.name} watches nothing yet: name what it should watch in its input.`}</>;
  const state = watch.state === 'paused'
    ? <StatusDot tone="amber" label="Paused by a person, so nothing is being read." />
    : watch.state === 'off'
      ? <StatusDot tone="neutral" label="Turned off, so nothing is being read." />
      : null;
  const read = watch.lastReadAt
    ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <time dateTime={watch.lastReadAt.toISOString()} className="tabular-nums underline decoration-dotted underline-offset-2">{relativeLabel(watch.lastReadAt, now)}</time>
          </TooltipTrigger>
          <TooltipContent>{watch.lastReadAt.toLocaleString()}</TooltipContent>
        </Tooltip>
      )
    : null;
  return (
    <span className="flex flex-col items-center gap-1" data-testid="watch-line">
      <span>{what}</span>
      {state}
      {watch.lastError
        ? <StatusDot tone="fail" label={<span>{`Its last read failed: ${watch.lastError}`}</span>} />
        : read
          ? (
              <span>
                Last read
                {' '}
                {read}
                .
              </span>
            )
          : <span>It has not read yet.</span>}
    </span>
  );
}
