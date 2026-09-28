'use client';

import type { ReportActivity } from '@/services/factory/featureReport';
import { Bot, ChevronRight, Hammer, MessageSquare } from 'lucide-react';
import { useState } from 'react';
import { PreviewPanel } from '@/features/preview/PreviewPanel';
import { usePreviewOpener } from '@/features/preview/previewState';

/**
 * EVERYTHING THAT HAPPENED TO THIS FEATURE, one tap from its page: the
 * conversations it was discussed in, the agent runs that worked on it and the
 * long-running engineering runs building it. A row opens the log in the
 * preview pane — a side panel on a desk, a bottom sheet on a phone (Chris,
 * 2026-09-25: "I should be able to see all chat history and long running eng
 * tasks associated with a feature … log history for agent runs").
 */

const ICON = { conversation: MessageSquare, mission_run: Bot, worker_run: Hammer } as const;
const WORD = { conversation: 'Conversation', mission_run: 'Agent run', worker_run: 'Engineering run' } as const;

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
      <button type="button" onClick={open} data-testid="activity-row" className="flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-hover">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          <span className="text-foreground">{item.title}</span>
          <span className="text-muted-foreground">{` · ${WORD[item.kind]}${item.detail ? ` · ${item.detail}` : ''}`}</span>
        </span>
        {item.status && <span className="shrink-0 text-xs text-muted-foreground">{item.status}</span>}
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{ago(item.at)}</span>
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
      </button>
    </li>
  );
}

export function FeatureActivity({ items }: { items: ReportActivity[] }) {
  const [all, setAll] = useState(false);
  if (items.length === 0) {
    return null;
  }
  const counts = (['conversation', 'mission_run', 'worker_run'] as const)
    .map(k => [k, items.filter(i => i.kind === k).length] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${WORD[k].toLowerCase()}${n === 1 ? '' : 's'}`);
  const shown = all ? items : items.slice(0, 5);
  return (
    <section id="report-activity-list" className="rounded-lg border border-border" data-testid="feature-activity">
      <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">{counts.join(' · ')}</p>
      <ul className="p-1">
        {shown.map(i => <Row key={`${i.kind}-${i.id}`} item={i} />)}
      </ul>
      {items.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="w-full border-t border-border px-3 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground">
          {`Show all ${items.length}`}
        </button>
      )}
      <PreviewPanel />
    </section>
  );
}
