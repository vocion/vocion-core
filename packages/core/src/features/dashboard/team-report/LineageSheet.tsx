'use client';

import type { LineageFunnel, LineageNode } from '@/services/team-report';
import { ChevronRight, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Link } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';
import { ago } from './format';

/**
 * Outcome lineage (spec, "Outcome lineage"): click the primary outcome →
 * a right-hand sheet with the funnel behind it — outcomes → approved items →
 * recommendations → runs → cost → human review — each node with a count;
 * click a node to list its items with links. Honest about what the record
 * does not tie together.
 * @param props
 * @param props.teamSlug
 * @param props.measureKey
 * @param props.label - The measure's label, for the sheet title.
 * @param props.children - The trigger — the big figure.
 */
export function LineageSheet({ teamSlug, measureKey, label, children }: { teamSlug: string; measureKey: string; label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [funnel, setFunnel] = useState<LineageFunnel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      setFunnel(await client.teamReport.lineage({ teamSlug, measureKey }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the lineage.');
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && !funnel) {
          void load();
        }
      }}
    >
      <SheetTrigger asChild>
        <button type="button" className="rounded-md text-left transition hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-foreground/10 focus-visible:outline-none" title="Where this number comes from" aria-label={`Trace ${label}`}>
          {children}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto p-5 sm:max-w-lg">
        <SheetHeader className="p-0">
          <SheetTitle className="text-base">
            {label}
            <span className="font-normal text-muted-foreground"> · lineage</span>
          </SheetTitle>
          <SheetDescription>
            {funnel
              ? `${funnel.teamName} · ${funnel.window === '24h' ? 'today' : funnel.window === '7d' ? 'this week' : funnel.window === '30d' ? 'last 30 days' : 'this quarter'}`
              : 'From the outcome down to the runs, cost and human review behind it.'}
          </SheetDescription>
        </SheetHeader>

        {!funnel && !error && (
          <p className="mt-6 inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Tracing…
          </p>
        )}
        {error && <p className="mt-6 text-sm text-rose-700 dark:text-rose-400">{error}</p>}

        {funnel && (
          <>
            <ol className="mt-4 divide-y divide-border">
              {funnel.nodes.map((node, i) => (
                <FunnelRow key={node.id} node={node} index={i} open={expanded === node.id} onToggle={() => setExpanded(expanded === node.id ? null : node.id)} />
              ))}
            </ol>
            {funnel.missing.length > 0 && (
              <div className="mt-5 border-t border-border pt-3">
                <div className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">What the record does not tie together</div>
                <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                  {funnel.missing.map(m => <li key={m}>{m}</li>)}
                </ul>
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function FunnelRow({ node, index, open, onToggle }: { node: LineageNode; index: number; open: boolean; onToggle: () => void }) {
  const clickable = node.items.length > 0;
  return (
    <li className="py-2.5">
      <button
        type="button"
        onClick={clickable ? onToggle : undefined}
        className={`flex w-full items-start gap-3 text-left ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
        aria-expanded={clickable ? open : undefined}
        disabled={!clickable}
      >
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-soft text-[10px] font-semibold text-muted-foreground tabular-nums">{index + 1}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium">{node.label}</span>
            <span className="text-base font-semibold tabular-nums">{node.display}</span>
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{node.basis}</span>
        </span>
        {clickable && <ChevronRight className={`mt-1 size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />}
      </button>
      {open && (
        <ul className="mt-2 ml-8 divide-y divide-border/60 border-t border-border/60">
          {node.items.map(item => (
            <li key={item.id} className="flex items-baseline justify-between gap-3 py-1.5 text-xs">
              <span className="min-w-0">
                {item.href
                  ? <Link href={item.href} className="font-medium text-primary hover:underline">{item.title}</Link>
                  : <span className="font-medium">{item.title}</span>}
                {item.detail && <span className="block truncate text-muted-foreground">{item.detail}</span>}
              </span>
              <span className="shrink-0 text-muted-foreground tabular-nums">{ago(item.at ? new Date(item.at) : null)}</span>
            </li>
          ))}
          {node.more > 0 && <li className="py-1.5 text-xs text-muted-foreground">{`+${node.more} more`}</li>}
        </ul>
      )}
    </li>
  );
}
