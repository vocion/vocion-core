'use client';

import type { ReactNode } from 'react';
import type { RunLink, RunLogData, RunLogLine, RunStep, RunStepStatus } from '@/libs/worker/runLog';
import { ArrowLeft, Check, CircleCheck, CircleDashed, CircleMinus, CircleX, Copy, LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Accordion, DetailMeta, MetaChip, Section, StatusDot } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Link } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';
import { deriveSteps, focusStep, formatDuration, isLiveStatus, mergeRunLog } from '@/libs/worker/runLog';
import { cn } from '@/utils/Helpers';

/** How often a live run page asks for new lines. */
export const RUN_POLL_MS = 3000;

/**
 * ONE RUN, READ LIKE A RUNNER PAGE (backlog 036; Chris, 2026-09-28: "for
 * live runs, I'd expect it to look like a GitHub runner or Vercel deployment
 * page"). The run's header — status, attempt, duration, cost, pull request —
 * then its steps, each a row with a status mark, a name and a duration that
 * opens onto its log. The running step is open and follows its tail; a
 * failed step opens by itself. While the run is live and the tab visible, the
 * page asks every few seconds for the lines after the last one it has; a run
 * that has finished is not polled at all.
 *
 * One component for both kinds of run: an engineering run's steps come from
 * the worker's step lines, an agent run's from its plan and tool calls
 * (`libs/worker/runLog.ts`). A stopped run keeps its "Fix it from Claude
 * Code" block.
 * @param props
 * @param props.initial - The run as the server read it.
 * @param props.backHref - The Runs list.
 * @param props.pollMs - How often to ask while live; {@link RUN_POLL_MS} unless a test says otherwise.
 */
export function RunDetail({ initial, backHref, pollMs = RUN_POLL_MS }: { initial: RunLogData; backHref: string; pollMs?: number }) {
  const [data, setData] = useState(initial);
  const { header } = data;
  const live = isLiveStatus(header.status);
  const visible = useSyncExternalStore(subscribeVisibility, readVisible, () => true);
  const cursor = useRef(initial.cursor);
  useEffect(() => {
    cursor.current = data.cursor;
  }, [data.cursor]);

  useEffect(() => {
    if (!live || !visible) {
      return;
    }
    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) {
        return;
      }
      inFlight = true;
      try {
        const next = await client.runs.log({ ref: header.ref, after: cursor.current });
        if (!cancelled) {
          setData(prev => mergeRunLog(prev, next));
        }
      } catch {
        // A missed poll is caught up by the next one: `after` has not moved.
      } finally {
        inFlight = false;
      }
    };
    const timer = setInterval(poll, pollMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [live, visible, header.ref, pollMs]);

  // A running step's duration counts up between polls.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) {
      return;
    }
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [live]);

  const steps = useMemo(() => deriveSteps(data), [data]);
  const focus = focusStep(steps);
  // A person's own open / close wins; otherwise the running or failed step is open.
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const open = steps.filter(s => chosen[s.key] ?? s.key === focus).map(s => s.key);
  const onToggle = useCallback((id: string, next: boolean) => setChosen(c => ({ ...c, [id]: next })), []);

  const started = header.startedAt ? Date.parse(header.startedAt) : null;
  const ended = header.endedAt ? Date.parse(header.endedAt) : null;
  const end = ended ?? (live ? now : null);
  const runMs = started !== null && end !== null ? end - started : null;
  const stopped = ['failed', 'lost', 'cancelled'].includes(header.status);

  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col" data-testid="run-detail" data-live={live && visible ? 'on' : 'off'}>
      <Link href={backHref} className="mb-3 inline-flex min-h-8 w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" aria-hidden />
        Back to runs
      </Link>

      <header className="border-b border-rule pb-4">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-1 shrink-0"><StepIcon status={runStepStatus(header.status)} large /></span>
          <h2 className="min-w-0 text-lg font-semibold break-words text-foreground">{header.title}</h2>
        </div>
        {header.objective && <p className="mt-1.5 line-clamp-3 text-sm break-words text-muted-foreground">{header.objective}</p>}
        <DetailMeta
          items={[
            <StatusDot key="status" tone={statusTone(header.status)} label={statusLabel(header.status)} />,
            <span key="run">{`${header.kind === 'agent' ? 'Agent run' : 'Engineering run'} #${header.id}`}</span>,
            header.attempt ? <span key="attempt">{`Attempt ${header.attempt}`}</span> : null,
            runMs !== null ? <span key="took" className="tabular-nums">{formatDuration(runMs)}</span> : null,
            typeof header.cents === 'number' && header.cents > 0
              ? <span key="cost" className="tabular-nums">{`$${(header.cents / 100).toFixed(2)}`}</span>
              : null,
            header.model ? <span key="model">{header.model}</span> : null,
            header.prUrl ? <MetaChip key="pr" href={header.prUrl}>Pull request</MetaChip> : null,
            ...header.links.map(l => <RunLinkChip key={`${l.label}:${l.href}`} link={l} />),
            live ? <span key="live" className="text-[12px]">{visible ? 'live' : 'paused while hidden'}</span> : null,
          ]}
        />
        {stopped && (
          <p className="mt-3 text-sm break-words text-foreground" data-testid="run-stopped">
            <span className="font-medium">Stopped</span>
            {' — '}
            {header.error ? header.error.split('\n')[0]!.slice(0, 300) : 'the run ended without saying why'}
          </p>
        )}
      </header>

      <Section eyebrow="Steps" commentField={null} action={steps.length > 0 ? <span className="text-muted-foreground tabular-nums">{steps.length}</span> : undefined}>
        {steps.length === 0
          ? <p className="text-muted-foreground">{live ? 'Waiting for the run to report its first step.' : 'This run reported no steps.'}</p>
          : (
              <Accordion
                items={steps.map(step => ({
                  id: step.key,
                  icon: <StepIcon status={step.status} />,
                  title: step.name,
                  meta: <span className="tabular-nums">{stepDuration(step, now)}</span>,
                  children: <StepBody step={step} follow={step.status === 'running'} />,
                }))}
                open={open}
                onToggle={onToggle}
              />
            )}
      </Section>

      {header.summary && (
        <Section eyebrow="Summary" commentField={null}>
          <p className="break-words whitespace-pre-wrap">{header.summary}</p>
        </Section>
      )}

      {header.attach && <AttachBlock text={header.attach} />}
    </div>
  );
}

function runStepStatus(status: string): RunStepStatus {
  if (isLiveStatus(status)) {
    return status === 'queued' || status === 'planning' ? 'pending' : 'running';
  }
  if (status === 'completed') {
    return 'passed';
  }
  return ['failed', 'lost', 'cancelled'].includes(status) ? 'failed' : 'pending';
}

function statusTone(status: string): 'pass' | 'amber' | 'fail' | 'neutral' | 'ink' {
  if (status === 'completed') {
    return 'pass';
  }
  if (status === 'failed' || status === 'lost') {
    return 'fail';
  }
  if (status === 'running') {
    return 'ink';
  }
  return status === 'paused' || status === 'awaiting_review' ? 'amber' : 'neutral';
}

function statusLabel(status: string): string {
  return status === 'awaiting_review' ? 'Awaiting review' : status.charAt(0).toUpperCase() + status.slice(1);
}

function stepDuration(step: RunStep, now: number): string {
  if (!step.startedAt) {
    return '';
  }
  const end = step.endedAt ? Date.parse(step.endedAt) : step.status === 'running' ? now : null;
  return end === null ? '' : formatDuration(end - Date.parse(step.startedAt));
}

const STATUS_WORD: Record<RunStepStatus, string> = { pending: 'Not started', running: 'Running', passed: 'Passed', failed: 'Failed', skipped: 'Skipped' };

function StepIcon({ status, large }: { status: RunStepStatus; large?: boolean }) {
  const size = large ? 'size-5' : 'size-4';
  const icon: Record<RunStepStatus, ReactNode> = {
    pending: <CircleDashed className={cn(size, 'text-muted-foreground/60')} aria-hidden />,
    running: <LoaderCircle className={cn(size, 'animate-spin text-foreground motion-reduce:animate-none')} aria-hidden />,
    passed: <CircleCheck className={cn(size, 'text-brand-pass')} aria-hidden />,
    failed: <CircleX className={cn(size, 'text-brand-fail')} aria-hidden />,
    skipped: <CircleMinus className={cn(size, 'text-muted-foreground/60')} aria-hidden />,
  };
  return (
    <span className="inline-flex" data-step-status={status}>
      {icon[status]}
      <span className="sr-only">{STATUS_WORD[status]}</span>
    </span>
  );
}

function RunLinkChip({ link }: { link: RunLink }) {
  if (link.external) {
    return <MetaChip href={link.href}>{link.label}</MetaChip>;
  }
  return (
    <Link href={link.href} className="underline decoration-border underline-offset-2 transition hover:text-foreground hover:decoration-foreground">
      {link.label}
    </Link>
  );
}

function StepBody({ step, follow }: { step: RunStep; follow: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {step.links.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
          {step.links.map(l => <RunLinkChip key={`${l.label}:${l.href}`} link={l} />)}
        </div>
      )}
      {step.lines.length === 0
        ? <p className="text-[13px] text-muted-foreground">No output.</p>
        : <StepLog lines={step.lines} follow={follow} />}
    </div>
  );
}

/**
 * A step's lines: monospace, numbered, each line whole — a long line scrolls
 * inside the box, never the page. While the step runs the box follows the
 * tail, unless the person has scrolled up to read.
 * @param props
 * @param props.lines - The step's lines.
 * @param props.follow - Keep the newest line in view.
 */
function StepLog({ lines, follow }: { lines: RunLogLine[]; follow: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const el = box.current;
    if (el && follow && pinned.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines.length, follow]);
  return (
    <div
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      className="max-h-[28rem] w-full max-w-full overflow-auto rounded-md bg-surface-soft py-2 font-mono text-[12px] leading-5"
      data-testid="run-step-log"
      role="log"
      aria-live={follow ? 'polite' : 'off'}
    >
      <table className="w-max min-w-full border-collapse">
        <tbody>
          {lines.map((l, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <tr key={i} className={cn(l.level === 'error' && 'text-brand-fail', l.level === 'warn' && 'text-brand-borderline')}>
              <td className="w-10 pr-3 pl-2 text-right align-top text-muted-foreground/60 tabular-nums select-none">{i + 1}</td>
              <td className="pr-3 whitespace-pre">{l.text || ' '}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AttachBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Section
      eyebrow="Fix it from Claude Code"
      commentField={null}
      data-testid="run-attach"
      action={(
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="sm" onClick={copy} aria-label="Copy the block for Claude Code">
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Paste it into a Claude Code session</TooltipContent>
        </Tooltip>
      )}
    >
      <p className="mb-2 text-muted-foreground">Paste this into a session:</p>
      <pre className="max-w-full overflow-x-auto rounded-md bg-surface-soft p-3 font-mono text-[12px] leading-5 whitespace-pre">{text}</pre>
    </Section>
  );
}

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

function readVisible(): boolean {
  return document.visibilityState !== 'hidden';
}
