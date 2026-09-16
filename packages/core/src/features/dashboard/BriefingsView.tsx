'use client';

import type { BriefingV2 } from '@/services/briefings/document';
import type { InboxItem } from '@/services/InboxService';
import { Check, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ListRow, ListRows } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { CommentLayerProvider } from '@/features/comments/CommentLayer';
import { BriefingView } from '@/features/dashboard/briefings/BriefingView';
import { Link, useRouter } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';
import { MAX_HISTORY_ENTRIES } from '@/services/briefings/budget';
import { BRIEFING_ARCHIVE_HREF, briefingHref } from '@/services/briefings/links';
import { recordRef } from '@/services/chat/recordContext';
import { BriefingChatStarter } from './BriefingChatStarter';
import { BriefingSections } from './BriefingSections';

/**
 * Briefings — BY TEAM. Tabs: the workspace ROLLUP first, then one per team.
 * Each tab shows the latest brief (rendered), links to the previous ones, and
 * Regenerate (background run of the owning lead).
 *
 * Asking about the brief is the SELECTION path and nothing else: the brief
 * sits in a `CommentLayerProvider`, so highlighting a passage raises the
 * platform's one selection control (`docs/design/patterns.md` § Select →
 * talk). There is no pill, no prefilled prompt and no second composer.
 */

export type BriefRow = {
  id: number;
  title: string;
  content: string;
  createdAt: string;
  teamSlug: string | null;
  /** The typed document, when this brief carries one (docs/specs/briefing-v2.md). */
  document: BriefingV2 | null;
};

export type BriefGroup = {
  /** null = workspace rollup */
  teamSlug: string | null;
  teamName: string;
  /** Agent to chat with about this group's briefs. */
  leadSlug: string | null;
  briefs: BriefRow[];
};

function fmt(d: string): string {
  return new Date(d).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function BriefingsView({ groups, liveDecisions = [], archiveTotal = 0 }: { groups: BriefGroup[]; liveDecisions?: InboxItem[]; archiveTotal?: number }) {
  const router = useRouter();
  const [active, setActive] = useState(0);
  // Regeneration lifecycle: idle → assembling (polling briefings.latest until
  // a NEWER brief than the baseline lands) → landed (auto-refreshed).
  const [regen, setRegen] = useState<'idle' | 'assembling' | 'landed' | 'failed'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const baselineRef = useRef<number | null>(null);

  const g = groups[active];
  const latest = g?.briefs[0];
  const history = (g?.briefs.slice(1) ?? []).slice(0, MAX_HISTORY_ENTRIES);
  // Previous briefs are links now, not a second viewer on this page: one
  // brief lives at one URL (docs/specs/briefing-v2.md §10).
  const viewing = latest;

  const regenerate = async () => {
    // Only reachable from the rendered group, but `g` is optional now that the
    // empty-state guard moved below the hooks.
    if (!g) {
      return;
    }
    setRegen('assembling');
    setElapsed(0);
    baselineRef.current = g.briefs[0]?.id ?? null;
    try {
      const res = await client.briefings.regenerate({ teamSlug: g.teamSlug });
      if (!res.ok) {
        setRegen('failed');
      }
    } catch {
      setRegen('failed');
    }
  };

  // Poll until the fresh brief lands, then pull it in automatically — no
  // manual refresh. Bounded at 5 minutes.
  const teamSlug = g?.teamSlug ?? null;
  const hasGroup = g != null;
  useEffect(() => {
    if (regen !== 'assembling' || !hasGroup) {
      return;
    }
    const startedAt = Date.now();
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    const poll = setInterval(() => {
      void client.briefings.latest({ teamSlug })
        .then((row) => {
          if (row && row.id !== baselineRef.current) {
            setRegen('landed');
            router.refresh();
          } else if (Date.now() - startedAt > 5 * 60_000) {
            setRegen('failed');
          }
        })
        .catch((error) => {
          console.error('Briefing poll failed; will retry on the next tick.', error);
        });
    }, 8000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [regen, teamSlug, hasGroup, router]);

  if (!g) {
    return <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">No teams configured yet.</div>;
  }

  return (
    <div>
      {/* Team tabs — rollup first */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {groups.map((grp, i) => (
          <button
            key={grp.teamSlug ?? '__rollup__'}
            type="button"
            onClick={() => {
              setActive(i);
              setRegen('idle');
            }}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${i === active ? 'bg-brand-amber/15 text-brand-amber-deep' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {grp.teamName}
            {grp.briefs.length > 0 && <span className="ml-1 text-[10px] opacity-60">{grp.briefs.length}</span>}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2">
        {/* A typed brief carries its own title and date line; only a pre-v2
            markdown brief needs one here. */}
        <div className="min-w-0">
          {viewing && !viewing.document && (
            <>
              <h2 className="truncate text-base font-semibold">{viewing.title}</h2>
              <div className="text-xs text-muted-foreground">{fmt(viewing.createdAt)}</div>
            </>
          )}
          {!viewing && (
            <h2 className="text-base font-semibold text-muted-foreground">
              No
              {' '}
              {g.teamName}
              {' '}
              brief yet
            </h2>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={() => void regenerate()} disabled={regen === 'assembling'}>
          {regen === 'assembling' ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          {regen === 'assembling' ? `Assembling… ${elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`}` : 'Regenerate'}
        </Button>
      </div>
      {regen === 'assembling' && (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-brand-amber-deep">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-amber-deep/50" />
            <span className="relative inline-flex size-2 rounded-full bg-brand-amber-deep" />
          </span>
          {g.teamName}
          {' '}
          lead is assembling the brief — it will appear here automatically (usually 1–2 min).
        </p>
      )}
      {regen === 'landed' && (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
          <Check className="size-3.5" aria-hidden />
          Fresh brief loaded.
        </p>
      )}
      {regen === 'failed' && <p className="mt-1 text-xs text-destructive">Regeneration didn't land — check the lead agent's activity or try again.</p>}

      {/* The brief is a commentable document: highlight any passage and the
          platform's one selection control offers *Ask about this*
          (docs/design/patterns.md § Select → talk). The regions are the
          Detail archetype's own `Section`s — the typed document's rendered
          sections — so nothing here traverses headings and nothing here
          invents a control. No `changeIntent`: a briefing has no draft to
          rewrite, so *Add change* is not offered. */}
      {viewing && (
        <CommentLayerProvider
          key={viewing.id}
          targetRef={`briefing:${viewing.id}`}
          record={recordRef('briefing', viewing.id, viewing.title)}
        >
          {viewing.document
            ? (
                <div className="mt-2 min-w-0 flex-1" data-briefing-root>
                  <BriefingView doc={viewing.document} liveDecisions={liveDecisions} />
                </div>
              )
            : (
                <Surface name="brief" as="article" data-briefing-root className="prose prose-sm mt-4 max-w-none p-5 dark:prose-invert">
                  <BriefingSections briefingId={viewing.id} briefingTitle={viewing.title} content={viewing.content} agentSlug={g.leadSlug ?? undefined} />
                </Surface>
              )}
        </CommentLayerProvider>
      )}

      {/* Section 9: the last few briefs, then the archive — never the archive
          itself (docs/specs/briefing-v2.md §10). */}
      {history.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-base font-semibold tracking-tight">Previous briefings</h2>
          <ListRows>
            {history.map(b => (
              <ListRow key={b.id} href={briefingHref(b.id)} title={b.title} subline={fmt(b.createdAt)} />
            ))}
          </ListRows>
          <p className="mt-2 text-[13px]">
            <Link href={BRIEFING_ARCHIVE_HREF} className="text-brand-amber-deep hover:opacity-80">View all briefings</Link>
            {archiveTotal > history.length && <span className="text-muted-foreground">{` — ${archiveTotal} in all`}</span>}
          </p>
        </div>
      )}

      {/* No UI: it declares the brief as the page's record so the rail files
          the turn against it. */}
      {viewing && (
        <BriefingChatStarter
          key={`${g.teamSlug ?? 'rollup'}-${viewing.id}`}
          briefingId={viewing.id}
          briefingTitle={viewing.title}
        />
      )}
    </div>
  );
}
