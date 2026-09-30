'use client';

import type { DotTone } from '@/components/patterns';
import type { LiveRun, RecordStatus, TurnRecord } from '@/libs/factory/liveStatus';
import { ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusDot } from '@/components/patterns';
import { useVersionWritten } from '@/features/dashboard/versions/versionEvents';
import { useLive } from '@/hooks/useLive';
import { elapsedLabel } from '@/libs/factory/liveStatus';
import { liveTopic } from '@/libs/live/topics';
import { cn } from '@/utils/Helpers';
import { PreviewOpen } from './FeatureDrawerLink';

/**
 * WHERE THIS IS: You, Now, Next — one component, drawn on the feature page, at
 * the top of the preview pane and (as a one-line microcard) under the chat
 * turn that filed or changed the record (`libs/factory/liveStatus.ts`).
 *
 * The Now line counts up on its own every second from the moment the read
 * says (queued at, claimed at, started at), and the status re-reads itself
 * whenever the record, its tasks or their runs change, pushed on the live
 * stream; polling every few seconds is only the fallback while the stream is
 * down. A write to the record announced by chat re-reads it at once.
 */

const TONE: Record<RecordStatus['stage']['tone'], DotTone> = { ok: 'pass', warn: 'amber', bad: 'fail', info: 'ink', muted: 'neutral' };

/** How often a status with something running re-reads itself while the live stream is down. */
export const LIVE_POLL_MS = 4000;

/**
 * The record's status, kept current: read once when none was handed in, and
 * again whenever anything it is read from changes — the record, its tasks,
 * their runs (`status.follow`), pushed on the workspace live stream from
 * wherever the change was written (backlog 050). While the stream is down it
 * falls back to re-reading every {@link LIVE_POLL_MS} while something runs
 * (and the tab is visible). A write announced by chat re-reads it at once.
 * @param recordId - The record.
 * @param initial - A status already read (server-rendered), or null to read one.
 * @param opts - Options.
 * @param opts.poll - Whether to keep it current (false: draw `initial` as it is).
 */
export function useRecordStatus(recordId: number, initial: RecordStatus | null, opts: { poll: boolean }): RecordStatus | null {
  // What this hook read itself. A newer server read (the page re-rendered)
  // wins over an older one of ours, so the two never fight.
  const [fetched, setFetched] = useState<RecordStatus | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const status = fetched && (!initial || fetched.readAt >= initial.readAt) ? fetched : initial;

  const read = useCallback(() => {
    fetch(`/api/v1/objects/${recordId}/status`, { credentials: 'same-origin', cache: 'no-store' })
      .then(res => (res.ok ? res.json() as Promise<RecordStatus> : null))
      .then((next) => {
        if (next && alive.current) {
          setFetched(next);
        }
      })
      // A failed read keeps the last status; the next change or tick tries again.
      .catch(() => {});
  }, [recordId]);

  // A burst of changes (a heartbeat, the rollup it causes, the chat's own
  // announcement of the same write) is one read.
  const soon = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readSoon = useCallback(() => {
    if (soon.current) {
      return;
    }
    soon.current = setTimeout(() => {
      soon.current = null;
      read();
    }, 250);
  }, [read]);
  useEffect(() => () => {
    if (soon.current) {
      clearTimeout(soon.current);
    }
  }, []);

  // The first read, when nothing was handed in.
  useEffect(() => {
    if (opts.poll && initial === null) {
      read();
    }
  }, [opts.poll, initial, read]);

  // Pushed: everything the status is read from.
  const follow = opts.poll ? [liveTopic.record(recordId), ...(status?.follow ?? [])] : [];
  const { live } = useLive(follow, readSoon);

  // The fallback: while something runs and the stream is down, re-read on an interval.
  const running = status?.live !== null && status?.live !== undefined;
  useEffect(() => {
    if (!opts.poll || !running || live) {
      return;
    }
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
        read();
      }
    }, LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [opts.poll, running, live, read]);

  // A write to the record (chat's `version_written`) moves it now.
  useVersionWritten(opts.poll ? [{ type: 'object', id: String(recordId) }] : [], readSoon);
  return status;
}

/**
 * A clock that ticks every second while `active`, for elapsed times.
 * @param active - Whether anything is counting.
 */
function useTick(active: boolean): number {
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
 * "queued 3 min", "4 min" — the Now line's clock, from the right moment.
 * @param live - The live run.
 * @param now - The clock.
 */
export function liveClock(live: LiveRun, now: number): string {
  const elapsed = elapsedLabel(now - new Date(live.startedAt).getTime());
  return live.since === 'queued' ? `queued ${elapsed}` : elapsed;
}

/**
 * The Now line: a breathing dot, what is running, its step, how long, and
 * the run itself (opens in the preview pane).
 * @param props
 * @param props.live - The live run, or null.
 * @param props.now - The clock.
 */
function NowLine({ live, now }: { live: LiveRun | null; now: number }) {
  if (!live) {
    return <span className="text-muted-foreground" data-testid="work-status-now">Nothing running</span>;
  }
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5" data-testid="work-status-now" data-live-kind={live.kind}>
      <StatusDot tone="amber" pulse label={<span className="font-medium text-foreground">{live.label}</span>} />
      {live.step && <span className="text-muted-foreground">{`· ${live.step}`}</span>}
      <span className="text-muted-foreground tabular-nums">{`· ${liveClock(live, now)}`}</span>
      <span aria-hidden className="text-muted-foreground/50">·</span>
      <PreviewOpen recordRef={live.runRef} testId="work-status-run">{live.runLabel}</PreviewOpen>
    </span>
  );
}

/**
 * THE THREE LINES, with the stage above them.
 * @param props
 * @param props.status - The status (server-read, or kept current by {@link useRecordStatus}).
 * @param props.youAction - The move, drawn as the page draws it (a Build button). Absent, the move is a link.
 * @param props.className - Extra classes.
 * @param props.hideStage - The surface draws the stage itself (the feature page's headline).
 */
export function WorkStatus({ status, youAction, className, hideStage }: { status: RecordStatus; youAction?: React.ReactNode; className?: string; hideStage?: boolean }) {
  const now = useTick(status.live !== null);
  const row = 'grid grid-cols-[3.25rem_minmax(0,1fr)] items-baseline gap-x-2';
  const key = 'text-[11px] font-medium tracking-wide text-muted-foreground uppercase';
  return (
    <div className={cn('space-y-1.5 text-[13px] leading-relaxed', className)} data-testid="work-status" data-live={status.live ? 'true' : undefined}>
      {!hideStage && (
        <p className="text-[15px] text-foreground" data-testid="work-status-stage">
          <StatusDot tone={TONE[status.stage.tone]} label={<span className="font-semibold">{status.stage.label}</span>} />
        </p>
      )}
      <div className={row}>
        <span className={key}>You</span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" data-testid="work-status-you">
          <span className={status.you.needsYou ? 'font-medium text-foreground' : 'text-muted-foreground'}>{status.you.needsYou ? 'Needs you' : status.you.line}</span>
          {status.you.needsYou && (youAction ?? (status.you.move
            ? <a href={status.you.move.href} className="font-medium text-foreground underline underline-offset-2">{status.you.move.label}</a>
            : null))}
          {status.you.why && <span className="basis-full text-muted-foreground">{status.you.why}</span>}
        </span>
      </div>
      <div className={row}>
        <span className={key}>Now</span>
        <NowLine live={status.live} now={now} />
      </div>
      {status.next && (
        <div className={row}>
          <span className={key}>Next</span>
          <span className="text-muted-foreground" data-testid="work-status-next">{status.next}</span>
        </div>
      )}
    </div>
  );
}

/**
 * The three lines, kept current — for a surface that holds only the record id
 * or a status read on the server (the preview pane).
 * @param props
 * @param props.recordId - The record.
 * @param props.initial - A status already read, or null.
 * @param props.className - Extra classes.
 */
export function LiveWorkStatus({ recordId, initial, className }: { recordId: number; initial: RecordStatus | null; className?: string }) {
  const status = useRecordStatus(recordId, initial, { poll: true });
  return status ? <WorkStatus status={status} className={className} /> : null;
}

/**
 * "acceptance", "acceptance and summary", "3 fields".
 * @param fields - The field keys the version changed.
 */
function fieldsLine(fields: readonly string[]): string {
  const words = fields.map(f => f.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
  if (words.length === 0) {
    return 'fields';
  }
  if (words.length <= 2) {
    return words.join(' and ');
  }
  return `${words.length} fields`;
}

/**
 * THE MICROCARD — one line per record a turn filed or changed: its number
 * and title, then what it is doing now (live dot while running), or what the
 * change wrote. The line opens the record in the preview pane; the change
 * opens the version it made. Kept current while the thread is open.
 * @param props
 * @param props.record - The record, as the turn's event carries it.
 */
export function RecordMicrocard({ record }: { record: TurnRecord }) {
  const status = useRecordStatus(record.id, null, { poll: record.hasStatus });
  const live = status?.live ?? null;
  const now = useTick(live !== null);
  const changed = !record.filed && record.change;
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[13px]" data-testid="record-microcard" data-record-id={record.id} data-live={live ? 'true' : undefined}>
      <PreviewOpen recordRef={{ type: 'object', id: String(record.id) }} look="row" className="min-w-0 flex-1" testId="record-microcard-open">
        <span className="flex min-w-0 items-center gap-1.5 px-2 py-1">
          <StatusDot tone={live ? 'amber' : status ? TONE[status.stage.tone] : 'neutral'} pulse={live !== null} label={<span className="text-foreground/70 tabular-nums">{`#${record.id}`}</span>} />
          <span className="min-w-0 truncate font-medium text-foreground">{record.title}</span>
          {live
            ? <span className="shrink-0 text-muted-foreground" data-testid="record-microcard-now">{`· ${live.label} · ${liveClock(live, now)}`}</span>
            : status && <span className="shrink-0 text-muted-foreground" data-testid="record-microcard-stage">{`· ${status.stage.label}`}</span>}
          {!changed && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
        </span>
      </PreviewOpen>
      {changed && (
        <PreviewOpen recordRef={{ type: 'record_history', id: record.change!.historyRef }} className="shrink-0 text-muted-foreground" testId="record-microcard-change">
          {`Changed ${fieldsLine(record.change!.fields)} · v${record.change!.version} ›`}
        </PreviewOpen>
      )}
    </div>
  );
}
