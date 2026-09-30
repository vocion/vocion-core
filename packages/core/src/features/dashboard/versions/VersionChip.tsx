'use client';

import type { LiveRefreshOptions } from '@/features/dashboard/LiveRefresh';
import { useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useLiveRefresh } from '@/features/dashboard/LiveRefresh';
import { usePreviewOpener } from '@/features/preview/previewState';
import { relativeLabel } from '@/libs/timeAgo';
import { cn } from '@/utils/Helpers';

/**
 * A RECORD'S VERSION, AS ONE CHIP AT THE END OF ITS METADATA LINE (Chris,
 * 2026-09-30, feature #269: the "History" button and the "live · 3s ago" line
 * took two rows under the title for two facts that fit in one word).
 *
 * `v3` is the record's current version (its body artifact's head, backlog
 * 035). Pressing it opens the record's history in the one preview pane
 * (`record_history`), where each version carries Restore. The Tooltip says
 * when it was last updated. While the page is live the chip also carries the
 * page's re-read: a small dot beside the number, green while it re-reads and
 * amber while the tab is hidden, and the Tooltip counts from the last read.
 * @param props
 * @param props.objectId - The record (`business_object.id`).
 * @param props.version - Its current version, or null when it has none yet (the chip then reads "History").
 * @param props.updatedAt - ISO — when that version was written.
 * @param props.live - How the page re-reads itself (`useLiveRefresh`); absent on a page with nothing to follow.
 * @param props.className - Extra classes.
 */
export function VersionChip({ objectId, version, updatedAt, live: liveOpts, className }: { objectId: number; version: number | null; updatedAt?: string | null; live?: LiveRefreshOptions | null; className?: string }) {
  const live = useLiveRefresh(liveOpts ?? null);
  const open = usePreviewOpener({ type: 'record_history', id: String(objectId) });
  // The clock the Tooltip counts from: the live tick, else read as it opens.
  const [openedAt, setOpenedAt] = useState(() => Date.now());
  const now = live?.now ?? openedAt;
  const at = live ? new Date(live.updatedAt) : updatedAt ? new Date(updatedAt) : null;
  const said = [
    'History',
    at && !Number.isNaN(at.getTime()) ? `updated ${relativeLabel(at, now)}` : null,
    live && !live.visible ? 'paused while this tab is hidden' : null,
  ].filter(Boolean).join(' · ');
  const label = version === null ? 'History' : `v${version}`;
  return (
    <Tooltip onOpenChange={next => next && setOpenedAt(Date.now())}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={open}
          aria-label={`${said}${version === null ? '' : ` — version ${version}`}`}
          data-testid="record-version-chip"
          data-live={live ? (live.visible ? 'on' : 'paused') : 'off'}
          className={cn('inline-flex h-6 items-center gap-1.5 rounded-full px-2 font-mono text-[12px] text-muted-foreground tabular-nums transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none', className)}
        >
          {live && <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', live.visible ? 'bg-emerald-500' : 'bg-amber-500')} />}
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent>{said}</TooltipContent>
    </Tooltip>
  );
}
