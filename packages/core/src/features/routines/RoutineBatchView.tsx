'use client';

/**
 * A ROUTINE BATCH, AS A QUEUE — one tile per row, every run live at once. On
 * its own page and in the preview pane beside the conversation that started it
 * (`compact`). Top to bottom:
 *
 *   header    the batch, the routine and its version; Build the report
 *   numbers   elapsed, what the runs cost, people's time, the same work by hand
 *   progress  one bar and a chip per status, needs-you first
 *   findings  what the batch found beyond its rows, each with its decision
 *   tiles     the browser as each run sees it, what it is doing and why, and what
 *             it waits on with its answers right there; a done run's receipt
 *
 * A tile keeps its size whatever its run is doing: the lines under the picture
 * are fixed, and what a run waits on replaces what it is doing rather than
 * adding to it. Clicking a picture opens that run's own live view in a sheet
 * (`BrowserRunView`). Re-read every 1.5s while the batch runs and the tab is
 * shown (and at once on a live notice, `routine-batch:<id>`), every 10s after.
 */

import type { BrowserRunView as BrowserRun } from '@/libs/browser/run';
import type { RoutineBatchView as RoutineBatch, RoutineFinding, RoutineReceipt, RoutineRunView } from '@/libs/routines/types';
import { Check, CircleAlert, Clock, Coins, Eye, FileText, Globe, Inbox, Loader2, Timer, User, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DetailMeta, DetailPage, StatusDot } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { BrowserRunView } from '@/features/browser/BrowserRunView';
import { announceConversationAppended } from '@/features/dashboard/chat/conversationAppended';
import { openPreview } from '@/features/preview/previewState';
import { useLive } from '@/hooks/useLive';
import { Link } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';
import { batchProgress, countChips, elapsed, minutesLong, money, peopleTime, RUN_STATUS, span } from '@/libs/routines/display';
import { batchLabel } from '@/libs/routines/types';
import { inboxHref } from '@/services/inbox/inboxRef';
import { cn } from '@/utils/Helpers';
import { ToneChip, TrustChip } from './RoutineChips';

const DOT = { pass: 'pass', amber: 'amber', fail: 'fail', neutral: 'neutral', teal: 'neutral' } as const;
const FAST_MS = 1500;
const SLOW_MS = 10_000;

/* ── Reading the batch ─────────────────────────────────────────────────── */

function useBatch(initial: RoutineBatch): [RoutineBatch, (b: RoutineBatch) => void] {
  const [batch, setBatch] = useState(initial);
  const running = useRef(initial.status === 'running');
  running.current = batch.status === 'running';
  const inflight = useRef(false);
  const pull = useCallback(async () => {
    if (inflight.current) {
      return;
    }
    inflight.current = true;
    try {
      const res = await client.routines.batch({ id: initial.id });
      if (res.batch) {
        setBatch(res.batch);
      }
    } catch {
      /* the next pull tries again */
    } finally {
      inflight.current = false;
    }
  }, [initial.id]);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      if (!document.hidden) {
        await pull();
      }
      if (!stop) {
        timer = setTimeout(loop, running.current ? FAST_MS : SLOW_MS);
      }
    };
    timer = setTimeout(loop, FAST_MS);
    const onShown = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void loop();
      }
    };
    document.addEventListener('visibilitychange', onShown);
    return () => {
      stop = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onShown);
    };
  }, [pull]);

  const soon = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLive([`routine-batch:${initial.id}`], () => {
    if (soon.current) {
      return;
    }
    soon.current = setTimeout(() => {
      soon.current = null;
      void pull();
    }, 200);
  });
  // A new question for the expert, a finding, or the batch's end is said in the conversation it was
  // asked from (a docked Decision, a closing message): tell the open chat to read it again.
  const said = useRef<string>('');
  const ask = [batch.status, ...batch.runs.map(r => r.waiting?.askId ?? 0), ...batch.findings.map(f => `${f.id}:${f.state}`)].join(',');
  useEffect(() => {
    if (said.current && said.current !== ask && batch.conversationId) {
      announceConversationAppended(batch.conversationId);
    }
    said.current = ask;
  }, [ask, batch.conversationId]);
  return [batch, setBatch];
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      return;
    }
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/**
 * A picture that changes without flashing: the next one is loaded before it replaces the last.
 * @param src - Where the picture is now.
 */
function useSteadyImage(src: string | null): string | null {
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (!src) {
      return;
    }
    let live = true;
    const img = new Image();
    img.onload = () => {
      if (live) {
        setShown(src);
      }
    };
    img.src = src;
    return () => {
      live = false;
    };
  }, [src]);
  return src ? shown : null;
}

/* ── The view ──────────────────────────────────────────────────────────── */

export function RoutineBatchView({ initial, compact = false }: { initial: RoutineBatch; compact?: boolean }) {
  const [batch, setBatch] = useBatch(initial);
  const running = batch.status === 'running';
  const now = useNow(running);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [watching, setWatching] = useState<RoutineRunView | null>(null);

  const answer = useCallback(async (run: RoutineRunView, action: 'approve' | 'deny' | 'answer', text?: string) => {
    setBusy(`run:${run.id}`);
    setError(null);
    try {
      const res = await client.routines.answer({ runId: run.id, action, ...(text ? { text } : {}) });
      if (res.batch) {
        setBatch(res.batch);
      }
      if (res.error) {
        setError(res.error);
      }
    } catch {
      setError('That did not go through.');
    } finally {
      setBusy(null);
    }
  }, [setBatch]);

  const decide = useCallback(async (finding: RoutineFinding, text: string) => {
    setBusy(`finding:${finding.id}`);
    setError(null);
    try {
      const res = await client.routines.finding({ batchId: batch.id, findingId: finding.id, answer: text });
      if (res.batch) {
        setBatch(res.batch);
      }
      if (res.error) {
        setError(res.error);
      }
    } catch {
      setError('That did not go through.');
    } finally {
      setBusy(null);
    }
  }, [batch.id, setBatch]);

  const buildReport = useCallback(async () => {
    setBusy('report');
    setError(null);
    try {
      const res = await client.routines.report({ batchId: batch.id });
      if (res.report) {
        setBatch({ ...batch, report: res.report });
        if (compact) {
          openPreview({ type: 'artifact', id: String(res.report.artifactId) }, null);
        }
      }
      if (res.error) {
        setError(res.error);
      }
    } catch {
      setError('The report did not build.');
    } finally {
      setBusy(null);
    }
  }, [batch, compact, setBatch]);

  const report = batch.report
    ? (compact
        ? (
            <Button size="sm" variant="outline" onClick={ev => openPreview({ type: 'artifact', id: String(batch.report!.artifactId) }, ev.currentTarget)} data-routine-report-open>
              <FileText className="size-3.5" aria-hidden />
              Open the report
            </Button>
          )
        : (
            <Button size="sm" variant="outline" asChild>
              <Link href={batch.report.url} data-routine-report-open>
                <FileText className="size-3.5" aria-hidden />
                Open the report
              </Link>
            </Button>
          ))
    : (
        <Button size="sm" variant={running ? 'outline' : 'default'} disabled={busy === 'report'} onClick={() => void buildReport()} data-routine-report>
          {busy === 'report' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <FileText className="size-3.5" aria-hidden />}
          {busy === 'report' ? 'Building…' : 'Build the report'}
        </Button>
      );

  const title = `${batchLabel(batch.id)} · ${batch.routine.name} v${batch.routine.version}`;
  const meta = (
    <DetailMeta
      items={[
        <StatusDot key="s" tone={running ? 'amber' : (batch.counts.failed ?? 0) > 0 ? 'fail' : 'pass'} pulse={running} label={<span className="text-foreground">{running ? 'Running' : 'Done'}</span>} />,
        <TrustChip key="t" trust={batch.routine.trust} />,
        batch.routine.expert && `Expert: ${batch.routine.expert}`,
        !compact && batch.requestedBy && `Asked by ${batch.requestedBy}`,
        <Link key="r" href={`/dashboard/routines/${batch.routine.id}`} className="underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-foreground">The routine</Link>,
      ]}
    />
  );

  const body = (
    <div className={cn('@container', compact ? 'mt-3 space-y-4' : 'mt-5 space-y-6')}>
      <Numbers batch={batch} now={now} compact={compact} />
      <Progress batch={batch} />
      {error && <p className="rounded-lg border border-brand-fail/30 bg-brand-fail-bg px-3 py-2 text-[13px] text-brand-fail" role="alert">{error}</p>}
      {batch.findings.length > 0 && (
        <div className="space-y-3" data-routine-findings>
          {batch.findings.map(f => <FindingCard key={f.id} finding={f} expert={batch.routine.expert} busy={busy === `finding:${f.id}`} compact={compact} onDecide={text => void decide(f, text)} />)}
        </div>
      )}
      <div className="@container">
        <ul className="grid grid-cols-2 gap-2.5 @xl:grid-cols-3 @3xl:grid-cols-4 @5xl:grid-cols-5 @[90rem]:grid-cols-6" data-routine-tiles={batch.runs.length}>
          {batch.runs.map(r => (
            <li key={r.id} className="min-w-0">
              <RunTile run={r} expert={batch.routine.expert} now={now} busy={busy === `run:${r.id}`} onOpen={() => setWatching(r)} onAnswer={(action, text) => void answer(r, action, text)} />
            </li>
          ))}
        </ul>
      </div>
      <RunSheet run={watching ? (batch.runs.find(r => r.id === watching.id) ?? watching) : null} onClose={() => setWatching(null)} />
    </div>
  );

  if (compact) {
    return (
      <div data-routine-batch-view={batch.id} data-batch-status={batch.status}>
        {/* The pane's header already names it. */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1 [&>[data-pattern=detail-meta]]:mt-0">{meta}</div>
          {report}
        </div>
        {body}
      </div>
    );
  }
  return (
    <div data-routine-batch-view={batch.id} data-batch-status={batch.status}>
      <DetailPage
        crumbs={[{ label: 'Routines', href: '/dashboard/routines' }, { label: batch.routine.name, href: `/dashboard/routines/${batch.routine.id}` }, { label: batchLabel(batch.id) }]}
        title={title}
        meta={meta}
        actions={report}
      >
        {body}
      </DetailPage>
    </div>
  );
}

/* ── Numbers and progress ──────────────────────────────────────────────── */

function Numbers({ batch, now, compact }: { batch: RoutineBatch; now: number; compact: boolean }) {
  const took = span(batch.startedAt, batch.endedAt, now) ?? 0;
  const byHand = batch.manualMinutes ? batch.manualMinutes * batch.total : null;
  const items = [
    { icon: Timer, label: batch.status === 'running' ? 'Elapsed' : 'Took', value: elapsed(took) },
    { icon: Coins, label: 'Run cost', value: money(batch.cents) },
    { icon: User, label: 'People’s time', value: peopleTime(batch.humanMs) },
    byHand ? { icon: Clock, label: 'By hand', value: `≈ ${minutesLong(byHand)}` } : null,
  ].filter(Boolean) as Array<{ icon: typeof Timer; label: string; value: string }>;
  return (
    <dl className={cn('grid gap-px overflow-hidden rounded-xl border border-border bg-border', compact ? 'grid-cols-2 @sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-4')} data-routine-numbers>
      {items.map(i => (
        <div key={i.label} className={cn('bg-card', compact ? 'px-2.5 py-2' : 'px-3 py-2.5')}>
          <dt className={cn('flex items-center gap-1.5 font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase', compact ? 'text-[10px]' : 'text-[11px]')}>
            <i.icon className="size-3 shrink-0" aria-hidden />
            {i.label}
          </dt>
          <dd className={cn('mt-0.5 font-semibold whitespace-nowrap text-foreground tabular-nums', compact ? 'text-[14px]' : 'text-lg')}>{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const BAR: Array<{ status: keyof RoutineBatch['counts']; cls: string }> = [
  { status: 'done', cls: 'bg-brand-pass' },
  { status: 'skipped', cls: 'bg-brand-pass/45' },
  { status: 'waiting', cls: 'bg-brand-amber' },
  { status: 'escalated', cls: 'bg-brand-amber/70' },
  { status: 'unknown_outcome', cls: 'bg-brand-fail/60' },
  { status: 'failed', cls: 'bg-brand-fail' },
  { status: 'stopped', cls: 'bg-muted-foreground/40' },
  { status: 'running', cls: 'bg-brand-borderline/45 motion-safe:animate-pulse' },
];

function Progress({ batch }: { batch: RoutineBatch }) {
  const total = Math.max(1, batch.total);
  return (
    <div data-routine-progress>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-soft" role="img" aria-label={batchProgress(batch.counts, batch.total)}>
        {BAR.map(b => (batch.counts[b.status] ?? 0) > 0 && <span key={b.status} className={cn('h-full transition-[width] duration-500', b.cls)} style={{ width: `${((batch.counts[b.status] ?? 0) / total) * 100}%` }} />)}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[13px] font-medium text-foreground tabular-nums">{`${batch.counts.done ?? 0} of ${batch.total} done`}</span>
        {countChips(batch.counts).filter(c => c.status !== 'done').map(c => (
          <button key={c.status} type="button" onClick={() => document.querySelector(`[data-routine-batch-view="${batch.id}"] [data-run-status="${c.status}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="rounded-full focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none" title="Show the first one">
            <ToneChip tone={c.tone} dot pulse={c.pulse}><span data-count={c.status}>{`${c.n} ${c.word}`}</span></ToneChip>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Findings ──────────────────────────────────────────────────────────── */

function FindingCard({ finding: f, expert, busy, compact, onDecide }: { finding: RoutineFinding; expert: string | null; busy: boolean; compact: boolean; onDecide: (text: string) => void }) {
  const cols = useMemo(() => [...new Set(f.items.flatMap(i => Object.keys(i)))], [f.items]);
  const open = f.state === 'open';
  return (
    <section className={cn('rounded-xl border p-4', open ? 'border-brand-amber/50 bg-brand-amber/5' : 'border-border bg-card')} data-routine-finding={f.id} data-finding-state={f.state}>
      <div className="flex flex-wrap items-center gap-2">
        <CircleAlert className={cn('size-4 shrink-0', open ? 'text-brand-amber' : 'text-muted-foreground')} aria-hidden />
        <h3 className="min-w-0 flex-1 text-sm font-semibold text-foreground">{f.title}</h3>
        {open && <ToneChip tone="amber">{`Decision for ${expert ?? 'its expert'}`}</ToneChip>}
        {f.state === 'answered' && <ToneChip tone="pass">Decided</ToneChip>}
      </div>
      {f.detail && <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{f.detail}</p>}
      {f.items.length > 0 && cols.length > 0 && (
        <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-border/70 bg-background">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b border-border">
                {cols.map(c => <th key={c} className="px-2.5 py-1.5 text-left text-[11px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase">{c.replace(/_/g, ' ')}</th>)}
              </tr>
            </thead>
            <tbody>
              {f.items.map((row, i) => (
                // eslint-disable-next-line react/no-array-index-key -- rows have no id of their own
                <tr key={i} className="border-b border-border/60 last:border-b-0">
                  {cols.map(c => <td key={c} className="px-2.5 py-1.5 align-top whitespace-nowrap text-foreground">{row[c] ?? '—'}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (f.options.length > 0 || f.askId) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {f.options.map((o, i) => (
            <Button key={o} size="sm" variant={i === 0 ? 'default' : 'outline'} disabled={busy} onClick={() => onDecide(o)} data-finding-option={o}>
              {i === 0 && busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
              {o}
            </Button>
          ))}
          {f.askId && (
            <Link href={inboxHref('ask', f.askId)} className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground">
              <Inbox className="size-3" aria-hidden />
              Open in Needs you
            </Link>
          )}
        </div>
      )}
      {f.state === 'answered' && f.answer && (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-foreground">
          <Check className="size-3.5 text-brand-pass" aria-hidden />
          {f.answer}
          {f.followUpBatchId && (
            compact
              ? <button type="button" onClick={ev => openPreview({ type: 'routine_batch', id: String(f.followUpBatchId) }, ev.currentTarget)} className="text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground">{`Started ${batchLabel(f.followUpBatchId)}`}</button>
              : <Link href={`/dashboard/routines/batches/${f.followUpBatchId}`} className="text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground">{`Started ${batchLabel(f.followUpBatchId)}`}</Link>
          )}
        </p>
      )}
    </section>
  );
}

/* ── A tile ────────────────────────────────────────────────────────────── */

const MINI = 'inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-medium whitespace-nowrap transition-colors disabled:opacity-50';
const MINI_PRIMARY = `${MINI} bg-action text-action-foreground hover:bg-action/90`;
const MINI_OUTLINE = `${MINI} border border-border bg-background text-foreground hover:bg-surface-hover`;

function pictureOf(run: RoutineRunView): string | null {
  const b = run.browser;
  if (!b) {
    return null;
  }
  if (b.live && run.browserRunId) {
    return `/api/browser-runs/${run.browserRunId}/frame?seq=${b.frameSeq}`;
  }
  return b.finalShotUrl;
}

function RunTile({ run, expert, now, busy, onOpen, onAnswer }: { run: RoutineRunView; expert: string | null; now: number; busy: boolean; onOpen: () => void; onAnswer: (action: 'approve' | 'deny' | 'answer', text?: string) => void }) {
  const s = RUN_STATUS[run.status];
  const picture = useSteadyImage(pictureOf(run));
  const took = span(run.startedAt, run.endedAt, now);
  const live = Boolean(run.browser?.live);
  const w = run.waiting;
  const wants = s.wantsYou || Boolean(w);
  const settled = ['done', 'failed', 'skipped', 'stopped', 'unknown_outcome'].includes(run.status);

  // Two fixed lines under the status: what it waits on, else what it is doing and why, else how it ended.
  const lines = (() => {
    if (w) {
      return <p className="line-clamp-2 text-foreground" title={w.text}>{w.text}</p>;
    }
    if (run.status === 'queued') {
      return <p className="line-clamp-2 text-muted-foreground">Waiting for a browser to come free.</p>;
    }
    if (run.status === 'skipped') {
      return <p className="line-clamp-2 text-muted-foreground">{run.summary ?? 'Already done before; not run again.'}</p>;
    }
    if (run.status === 'failed' || run.status === 'unknown_outcome') {
      return <p className="line-clamp-2 text-brand-fail" title={run.error ?? undefined}>{run.error ?? run.summary ?? (run.status === 'unknown_outcome' ? 'Stopped after a save it could not confirm.' : 'It could not finish.')}</p>;
    }
    if (settled && run.summary) {
      return <p className="line-clamp-2 text-muted-foreground" title={run.summary}>{run.summary}</p>;
    }
    return (
      <>
        <p className="truncate text-foreground" title={run.browser?.step ?? undefined}>{run.browser?.step ?? 'Opening the page…'}</p>
        <p className="truncate text-muted-foreground" title={run.browser?.why ?? undefined}>{run.browser?.why ?? ' '}</p>
      </>
    );
  })();

  return (
    <article
      className={cn(
        '@container flex h-full flex-col overflow-hidden rounded-xl border bg-card shadow-xs transition-shadow',
        wants ? 'border-brand-amber ring-3 ring-brand-amber/25' : 'border-border hover:shadow-sm',
      )}
      data-routine-run={run.id}
      data-run-status={run.status}
    >
      <button type="button" onClick={onOpen} className="group relative block aspect-[16/10] w-full overflow-hidden border-b border-border/70 bg-surface-soft text-left" aria-label={`Watch ${run.label}`}>
        {picture
          // eslint-disable-next-line next/no-img-element -- a live frame, not an optimisable asset
          ? <img src={picture} alt="" className={cn('absolute inset-0 size-full object-cover object-top transition-opacity', run.status === 'stopped' || run.status === 'skipped' ? 'opacity-50' : '')} data-tile-frame />
          : (
              <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                {run.status === 'queued' || run.status === 'running' ? <Loader2 className="size-4 animate-spin opacity-60" aria-hidden /> : <Globe className="size-4 opacity-60" aria-hidden />}
                {run.status === 'queued' ? 'Queued' : run.status === 'running' ? 'Opening the browser' : 'No picture'}
              </span>
            )}
        <span className="absolute top-1.5 left-1.5 rounded-md bg-background/85 px-1.5 py-px text-[10px] font-semibold text-foreground tabular-nums shadow-xs backdrop-blur-sm">{`#${run.n}`}</span>
        {live && (
          <span className="absolute top-1.5 right-1.5 flex items-center gap-1 rounded-md bg-background/85 px-1.5 py-px text-[9px] font-semibold tracking-wide text-brand-fail uppercase shadow-xs backdrop-blur-sm">
            <span className="size-1.5 rounded-full bg-brand-fail motion-safe:animate-pulse" aria-hidden />
            Live
          </span>
        )}
        {run.status === 'done' && run.receipt?.verified && (
          <span className="absolute right-1.5 bottom-1.5 flex size-5 items-center justify-center rounded-full bg-brand-pass text-white shadow-sm" aria-hidden>
            <Check className="size-3" strokeWidth={3} />
          </span>
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-foreground/0 opacity-0 transition group-hover:bg-foreground/10 group-hover:opacity-100 group-focus-visible:opacity-100">
          <span className="flex items-center gap-1 rounded-full bg-background/90 px-2 py-1 text-[11px] font-medium text-foreground shadow-sm">
            <Eye className="size-3" aria-hidden />
            Watch
          </span>
        </span>
      </button>

      <div className="flex min-w-0 flex-1 flex-col px-2.5 pt-2 pb-2">
        <button type="button" onClick={onOpen} className="truncate text-left text-[13px] leading-tight font-medium text-foreground hover:underline" title={run.label}>{run.label}</button>
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <StatusDot tone={DOT[s.tone]} pulse={s.pulse} label={<span className={cn('truncate', wants ? 'font-medium text-foreground' : '')}>{run.status === 'escalated' && expert ? `Escalated to ${expert.split(' ')[0]}` : s.word}</span>} className="min-w-0" />
          <span className="ml-auto shrink-0 tabular-nums">
            {run.browser && run.browser.steps > 0 ? `${run.browser.steps} steps` : ''}
            {run.browser && run.browser.steps > 0 && took !== null ? ' · ' : ''}
            {took !== null ? elapsed(took) : ''}
          </span>
        </div>
        <div className="mt-1.5 h-8 min-w-0 text-[11px] leading-4" data-tile-lines>{lines}</div>
      </div>

      <footer className="flex h-9 min-w-0 shrink-0 items-center gap-1 border-t border-rule px-2" data-tile-footer>
        <TileFooter run={run} expert={expert} busy={busy} onOpen={onOpen} onAnswer={onAnswer} />
      </footer>
    </article>
  );
}

function TileFooter({ run, expert, busy, onOpen, onAnswer }: { run: RoutineRunView; expert: string | null; busy: boolean; onOpen: () => void; onAnswer: (action: 'approve' | 'deny' | 'answer', text?: string) => void }) {
  const w = run.waiting;
  const needs = w?.askId
    ? (
        <Link href={inboxHref('ask', w.askId)} className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground" title="Open in Needs you" data-tile-needs-you>
          <Inbox className="size-3" aria-hidden />
          {w.options.length === 0 && w.kind !== 'approval' && <span>Needs you</span>}
        </Link>
      )
    : null;
  if (w && w.kind === 'approval') {
    return (
      <>
        <button type="button" className={MINI_PRIMARY} disabled={busy} onClick={() => onAnswer('approve')} data-tile-approve>
          <Check className="size-3" aria-hidden />
          Approve
        </button>
        <button type="button" className={MINI_OUTLINE} disabled={busy} onClick={() => onAnswer('deny')} data-tile-deny>
          <X className="size-3" aria-hidden />
          Decline
        </button>
        {needs}
      </>
    );
  }
  if (w) {
    return (
      <>
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none]">
          {w.options.length > 0
            ? w.options.map((o, i) => (
                <button key={o} type="button" className={i === 0 ? MINI_PRIMARY : MINI_OUTLINE} disabled={busy} onClick={() => onAnswer('answer', o)} title={o} data-tile-option={o}>
                  <span className="max-w-[9rem] truncate">{o}</span>
                </button>
              ))
            : <span className="truncate text-[11px] text-muted-foreground">{`With ${expert ?? 'its expert'}`}</span>}
        </div>
        {needs}
      </>
    );
  }
  if (run.status === 'escalated' || run.status === 'unknown_outcome') {
    return <span className="truncate text-[11px] text-muted-foreground">{`${expert ?? 'Its expert'} checks this one`}</span>;
  }
  if (run.receipt) {
    return <ReceiptButton receipt={run.receipt} />;
  }
  return (
    <button type="button" onClick={onOpen} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
      <Eye className="size-3" aria-hidden />
      {run.browserRunId ? `Browser run ${run.browserRunId}` : 'Details'}
    </button>
  );
}

/* ── Receipts ──────────────────────────────────────────────────────────── */

function ReceiptButton({ receipt }: { receipt: RoutineReceipt }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors hover:bg-surface-hover', receipt.verified ? 'text-brand-pass' : 'text-brand-fail')} data-tile-receipt={receipt.verified ? 'verified' : 'mismatch'}>
          {receipt.verified ? <Check className="size-3" strokeWidth={3} aria-hidden /> : <CircleAlert className="size-3" aria-hidden />}
          {receipt.verified ? 'Verified' : 'Did not read back'}
          <span className="font-normal text-muted-foreground">· receipt</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[22rem] max-w-[calc(100vw-2rem)] p-3" align="start">
        <Receipt receipt={receipt} />
      </PopoverContent>
    </Popover>
  );
}

function Receipt({ receipt }: { receipt: RoutineReceipt }) {
  return (
    <div className="text-[12px]" data-routine-receipt>
      <p className={cn('flex items-center gap-1.5 text-[13px] font-semibold', receipt.verified ? 'text-brand-pass' : 'text-brand-fail')}>
        {receipt.verified ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : <CircleAlert className="size-3.5" aria-hidden />}
        {receipt.verified ? 'Verified: every field read back as asked' : 'A field did not read back as asked'}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{`Let through by ${receipt.approvedBy} · ${new Date(receipt.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}</p>
      {receipt.checks.length > 0 && (
        <table className="mt-2.5 w-full">
          <thead>
            <tr className="border-b border-border text-left text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              <th className="py-1 pr-2 font-medium">Field</th>
              <th className="py-1 pr-2 font-medium">Asked</th>
              <th className="py-1 pr-2 font-medium">Read back</th>
              <th className="py-1 font-medium"><span className="sr-only">Check</span></th>
            </tr>
          </thead>
          <tbody>
            {receipt.checks.map(c => (
              <tr key={c.name} className="border-b border-border/60 last:border-b-0" data-check={c.ok ? 'ok' : c.waived ? 'waived' : 'not'} title={c.waived ? `Differs ${c.waived}` : undefined}>
                <td className="py-1 pr-2 align-top font-mono text-[11px] text-muted-foreground">{c.name}</td>
                <td className="py-1 pr-2 align-top break-words text-foreground">{c.expected}</td>
                <td className={cn('py-1 pr-2 align-top break-words', c.ok || c.waived ? 'text-foreground' : 'text-brand-fail')}>
                  {c.actual ?? '—'}
                  {c.waived && <span className="block text-[11px] text-muted-foreground">{`Differs ${c.waived}`}</span>}
                </td>
                <td className="py-1 align-top">{c.ok ? <Check className="size-3.5 text-brand-pass" strokeWidth={3} aria-label="matches" /> : c.waived ? <Check className="size-3.5 text-muted-foreground" strokeWidth={3} aria-label="differs as the expert answered" /> : <X className="size-3.5 text-brand-fail" aria-label="does not match" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {receipt.before && (
        <p className="mt-2.5 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground/80">Before: </span>
          {receipt.before}
        </p>
      )}
    </div>
  );
}

/* ── Watching one run ──────────────────────────────────────────────────── */

function RunSheet({ run, onClose }: { run: RoutineRunView | null; onClose: () => void }) {
  const [browser, setBrowser] = useState<{ id: number; run: BrowserRun } | null>(null);
  const browserRunId = run?.browserRunId ?? null;
  useEffect(() => {
    if (!browserRunId) {
      return;
    }
    let stop = false;
    void client.browser.get({ id: browserRunId })
      .then((j) => {
        if (!stop && j.run) {
          setBrowser({ id: browserRunId, run: j.run });
        }
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [browserRunId]);
  const shown = browser && browser.id === browserRunId ? browser.run : null;
  const inputs = Object.entries(run?.input ?? {});
  return (
    <Sheet open={run !== null} onOpenChange={o => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        {run && (
          <>
            <SheetHeader>
              <SheetTitle>{`#${run.n} · ${run.label}`}</SheetTitle>
              <SheetDescription>{run.browserRunId ? `Browser run ${run.browserRunId}` : RUN_STATUS[run.status].word}</SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-6">
              {run.browserRunId
                ? (shown
                    ? <BrowserRunView key={shown.id} initial={shown} compact />
                    : (
                        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                          Opening the run…
                        </p>
                      ))
                : <p className="text-[13px] text-muted-foreground">{run.status === 'queued' ? 'It starts when a browser comes free.' : run.summary ?? 'This run had no browser of its own.'}</p>}
              {run.receipt && (
                <section className="rounded-lg border border-border p-3">
                  <Receipt receipt={run.receipt} />
                </section>
              )}
              {inputs.length > 0 && (
                <section>
                  <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">This row</h3>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
                    {inputs.map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="font-mono text-muted-foreground">{k}</dt>
                        <dd className="min-w-0 break-words text-foreground">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}
              {(run.cents > 0 || run.humanMs > 0) && (
                <p className="text-[12px] text-muted-foreground">{`Run cost ${money(run.cents)} · people’s time ${peopleTime(run.humanMs)}`}</p>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
