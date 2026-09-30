'use client';

import type { ReportActivity } from '@/services/factory/featureReport';
import { Bot, ChevronRight, Hammer, MessageSquare } from 'lucide-react';
import { usePreviewOpener } from '@/features/preview/previewState';
import { FeatureDrawerLink } from './FeatureDrawerLink';

/**
 * ACTIVITY — WHAT HAPPENED TO THIS FEATURE OVER TIME (named 2026-09-30:
 * Related is what it is connected to, Activity is what happened), one tap
 * from its page. Its first entry is where it started: "Requested in chat by
 * <person>", opening that conversation. Then the
 * conversations it was discussed in, the agent runs that worked on it and the
 * long-running engineering runs building it. A row opens the log in the
 * preview pane — a side panel on a desk, a bottom sheet on a phone (Chris,
 * 2026-09-25: "I should be able to see all chat history and long running eng
 * tasks associated with a feature … log history for agent runs").
 *
 * Compact on the page (2026-09-28): the three newest, and "View all work"
 * opens the whole list in the same pane — no in-page expansion that pushes
 * the plan and the build off the screen.
 */

const ICON = { conversation: MessageSquare, mission_run: Bot, worker_run: Hammer } as const;
const WORD = { conversation: 'Conversation', mission_run: 'Agent run', worker_run: 'Engineering run' } as const;

/** How many rows the page shows before "View all work". */
const WORK_PREVIEW_ROWS = 3;

function ago(at: Date): string {
  const s = Math.max(0, (Date.now() - new Date(at).getTime()) / 1000);
  if (s < 3600) {
    return `${Math.max(1, Math.round(s / 60))}m ago`;
  }
  if (s < 86_400) {
    return `${Math.round(s / 3600)}h ago`;
  }
  return `${Math.round(s / 86_400)}d ago`;
}

function Row({ item }: { item: ReportActivity }) {
  const open = usePreviewOpener({ type: item.kind, id: String(item.id) });
  const Icon = ICON[item.kind];
  return (
    <li>
      <button type="button" onClick={open} data-testid="activity-row" data-origin={item.origin ? 'true' : undefined} className="flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-hover">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          <span className="text-foreground">{item.title}</span>
          <span className="text-muted-foreground">{` · ${item.origin && item.detail ? item.detail : WORD[item.kind]}`}</span>
        </span>
        {item.status && <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{item.status}</span>}
        <span data-clock className="shrink-0 text-xs text-muted-foreground tabular-nums">{ago(item.at)}</span>
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
      </button>
    </li>
  );
}

export function FeatureActivity({ items, requestId }: { items: ReportActivity[]; requestId: number }) {
  if (items.length === 0) {
    return null;
  }
  const counts = (['conversation', 'mission_run', 'worker_run'] as const)
    .map(k => [k, items.filter(i => i.kind === k).length] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${WORD[k].toLowerCase()}${n === 1 ? '' : 's'}`);
  const shown = items.slice(0, WORK_PREVIEW_ROWS);
  return (
    <section id="report-activity-list" className="rounded-lg border border-border" data-testid="feature-activity" aria-labelledby="report-activity-heading">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          <span id="report-activity-heading" className="font-medium text-foreground">Activity</span>
          {counts.length > 0 && ` · ${counts.join(' · ')}`}
        </p>
        {items.length > shown.length && (
          <FeatureDrawerLink requestId={requestId} drawer="work" look="link" className="shrink-0 text-xs">
            View all work
          </FeatureDrawerLink>
        )}
      </div>
      <ul className="p-1">
        {shown.map(i => <Row key={`${i.kind}-${i.id}`} item={i} />)}
      </ul>
    </section>
  );
}
