'use client';

import { Check, Clock, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from '@/libs/I18nNavigation';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { client } from '@/libs/Orpc';
import { BriefingChatStarter } from './BriefingChatStarter';

/**
 * Briefings — BY TEAM. Tabs: the workspace ROLLUP first, then one per team.
 * Each tab shows the latest brief (rendered), a history explorer of previous
 * briefs, and Regenerate (background run of the owning lead). The floating
 * chat pill is scoped to the ACTIVE tab's brief + lead — submitting moves to
 * /chat with the brief as visible context.
 */

export type BriefRow = {
  id: number;
  title: string;
  content: string;
  createdAt: string;
  teamSlug: string | null;
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

export function BriefingsView({ groups }: { groups: BriefGroup[] }) {
  const router = useRouter();
  const [active, setActive] = useState(0);
  // Regeneration lifecycle: idle → assembling (polling briefings.latest until
  // a NEWER brief than the baseline lands) → landed (auto-refreshed).
  const [regen, setRegen] = useState<'idle' | 'assembling' | 'landed' | 'failed'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const baselineRef = useRef<number | null>(null);
  const [openHistory, setOpenHistory] = useState<number | null>(null);

  const g = groups[active];
  if (!g) {
    return <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">No teams configured yet.</div>;
  }
  const latest = g.briefs[0];
  const history = g.briefs.slice(1);
  const viewing = openHistory != null ? g.briefs.find(b => b.id === openHistory) ?? latest : latest;

  const regenerate = async () => {
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
  const teamSlug = g.teamSlug;
  useEffect(() => {
    if (regen !== 'assembling') {
      return;
    }
    const startedAt = Date.now();
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    const poll = setInterval(() => {
      void client.briefings.latest({ teamSlug })
        .then((row) => {
          if (row && row.id !== baselineRef.current) {
            setRegen('landed');
            setOpenHistory(null);
            router.refresh();
          } else if (Date.now() - startedAt > 5 * 60_000) {
            setRegen('failed');
          }
        })
        .catch(() => {});
    }, 8000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [regen, teamSlug, router]);

  return (
    <div>
      {/* Team tabs — rollup first */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {groups.map((grp, i) => (
          <button
            key={grp.teamSlug ?? '__rollup__'}
            type="button"
            onClick={() => { setActive(i); setOpenHistory(null); setRegen('idle'); }}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${i === active ? 'bg-brand-amber/15 text-brand-amber-deep' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {grp.teamName}
            {grp.briefs.length > 0 && <span className="ml-1 text-[10px] opacity-60">{grp.briefs.length}</span>}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          {viewing
            ? (
                <>
                  <h2 className="truncate text-base font-semibold">{viewing.title}</h2>
                  <div className="text-xs text-muted-foreground">
                    {fmt(viewing.createdAt)}
                    {openHistory != null && ' · historical — '}
                    {openHistory != null && (
                      <button type="button" className="text-brand-amber-deep hover:opacity-80" onClick={() => setOpenHistory(null)}>back to latest</button>
                    )}
                  </div>
                </>
              )
            : <h2 className="text-base font-semibold text-muted-foreground">No {g.teamName} brief yet</h2>}
        </div>
        <Button size="sm" variant="outline" onClick={() => void regenerate()} disabled={regen === 'assembling'}>
          {regen === 'assembling' ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          {regen === 'assembling' ? `Assembling… ${elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`}` : 'Regenerate'}
        </Button>
      </div>
      {regen === 'assembling' && (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-brand-amber-deep">
          <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-amber-deep/50" /><span className="relative inline-flex size-2 rounded-full bg-brand-amber-deep" /></span>
          {g.teamName} lead is assembling the brief — it will appear here automatically (usually 1–2 min).
        </p>
      )}
      {regen === 'landed' && (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
          <Check className="size-3.5" aria-hidden />
          Fresh brief loaded.
        </p>
      )}
      {regen === 'failed' && <p className="mt-1 text-xs text-destructive">Regeneration didn't land — check the lead agent's activity or try again.</p>}

      {viewing && (
        <div data-briefing-root className="prose prose-sm mt-4 max-w-none rounded-2xl border border-border bg-card p-5 dark:prose-invert">
          <Markdown remarkPlugins={[remarkGfm]}>{viewing.content}</Markdown>
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
            <Clock className="size-3.5" aria-hidden />
            Previous briefs
          </div>
          <ul className="space-y-1">
            {history.map(b => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => setOpenHistory(b.id)}
                  className={`flex w-full items-baseline gap-2 rounded-lg border px-3 py-2 text-left text-xs transition hover:border-brand-amber/40 ${openHistory === b.id ? 'border-brand-amber' : 'border-border/60'}`}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{b.title}</span>
                  <span className="shrink-0 text-muted-foreground">{fmt(b.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Floating "chat with this brief" pill — scoped to the active tab. */}
      {viewing && (
        <BriefingChatStarter
          key={`${g.teamSlug ?? 'rollup'}-${viewing.id}`}
          briefingTitle={viewing.title}
          briefingContent={viewing.content}
          agentSlug={g.leadSlug ?? undefined}
        />
      )}
    </div>
  );
}
