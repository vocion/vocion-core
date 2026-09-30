'use client';

import type { ReactNode } from 'react';
import type { RunContext, RunLink, RunLogData, RunLogLine, RunStep, RunStepStatus } from '@/libs/worker/runLog';
import { Check, CircleCheck, CircleDashed, CircleMinus, CircleX, Copy, LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Accordion, DetailMeta, FactList, MetaChip, Section, StatusDot } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useLive } from '@/hooks/useLive';
import { Link } from '@/libs/I18nNavigation';
import { liveTopic } from '@/libs/live/topics';
import { client } from '@/libs/Orpc';
import { deriveSteps, focusStep, formatDuration, isLiveStatus, mergeRunLog, refusedBeforeStart, stopReason } from '@/libs/worker/runLog';
import { cn } from '@/utils/Helpers';

/** How often a live run page asks for new lines. */
export const RUN_POLL_MS = 3000;

/**
 * ONE RUN, READ LIKE A RUNNER PAGE (backlog 036; Chris, 2026-09-28: "for
 * live runs, I'd expect it to look like a GitHub runner or Vercel deployment
 * page"). The run's header — status, attempt, duration, cost, pull request —
 * then its steps, each a row with a status mark, a name and a duration that
 * opens onto its log. The running step is open and follows its tail; a
 * failed step opens by itself. While the run is live, each heartbeat and
 * status change arrives on the live stream and the page asks for the lines
 * after the last one it has; while the stream is down it asks every few
 * seconds instead (tab visible). A run that has finished is not read again.
 *
 * One component for both kinds of run: an engineering run's steps come from
 * the worker's step lines, an agent run's from its plan and tool calls
 * (`libs/worker/runLog.ts`). A stopped run keeps its "Fix it from Claude
 * Code" block.
 * @param props
 * @param props.initial - The run as the server read it.
 * @param props.pollMs - How often to ask while live; {@link RUN_POLL_MS} unless a test says otherwise.
 */
export function RunDetail({ initial, pollMs = RUN_POLL_MS }: { initial: RunLogData; pollMs?: number }) {
  const [data, setData] = useState(initial);
  const { header } = data;
  const live = isLiveStatus(header.status);
  const visible = useSyncExternalStore(subscribeVisibility, readVisible, () => true);
  const cursor = useRef(initial.cursor);
  useEffect(() => {
    cursor.current = data.cursor;
  }, [data.cursor]);

  // One read of the lines after the last one held; a read already out is not doubled.
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const readMore = useCallback(async () => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    try {
      const next = await client.runs.log({ ref: header.ref, after: cursor.current });
      if (alive.current) {
        setData(prev => mergeRunLog(prev, next));
      }
    } catch {
      // A missed read is caught up by the next one: `after` has not moved.
    } finally {
      inFlight.current = false;
    }
  }, [header.ref]);

  // Pushed (backlog 050): every heartbeat that lands an engineering run's new
  // lines, and every change of its status, is a notice on the run's topic. An
  // agent run's steps are its tool calls, which publish nothing of their own,
  // so an agent run keeps asking on the interval.
  const { live: pushed } = useLive(live && header.kind === 'worker' ? [liveTopic.run(header.id)] : [], () => void readMore());

  // The fallback while the stream is down: ask every few seconds.
  useEffect(() => {
    if (!live || !visible || pushed) {
      return;
    }
    const timer = setInterval(() => void readMore(), pollMs);
    return () => clearInterval(timer);
  }, [live, visible, pushed, readMore, pollMs]);

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
  const refused = refusedBeforeStart(data);

  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col" data-testid="run-detail" data-live={live && visible ? 'on' : 'off'}>
      {/* The page leads with the run: the shell's breadcrumb (Runs › #id)
          says where it is, so there is no second title above this one. */}
      <header className="border-b border-rule pb-4">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-1 shrink-0"><StepIcon status={runStepStatus(header.status)} large /></span>
          <h1 className="min-w-0 text-xl font-semibold tracking-tight break-words text-foreground">{header.title}</h1>
        </div>
        {header.objective && <p className="mt-1.5 line-clamp-3 text-sm break-words text-muted-foreground">{header.objective}</p>}
        <DetailMeta
          items={[
            <StatusDot key="status" tone={statusTone(header.status)} label={statusLabel(header.status)} />,
            <span key="run">{`${header.kind === 'agent' ? 'Agent run' : 'Run'} #${header.id}`}</span>,
            // Which attempt of its feature, when the records say; else the worker's own count.
            header.context?.attempt
              ? <span key="attempt">{`Attempt ${header.context.attempt.n} of ${header.context.attempt.of}`}</span>
              : header.attempt ? <span key="attempt">{`Attempt ${header.attempt}`}</span> : null,
            refused
              ? <span key="took">Refused before it started</span>
              : runMs !== null ? <span key="took" className="tabular-nums">{formatDuration(runMs)}</span> : null,
            typeof header.cents === 'number' && header.cents > 0
              ? <span key="cost" className="tabular-nums">{`$${(header.cents / 100).toFixed(2)}`}</span>
              : null,
            header.model ? <span key="model">{header.model}</span> : null,
            header.prUrl ? <MetaChip key="pr" href={header.prUrl}>Pull request</MetaChip> : null,
            ...header.links.map(l => <RunLinkChip key={`${l.label}:${l.href}`} link={l} />),
            live ? <span key="live" className="text-[12px]">{visible ? 'live' : 'paused while hidden'}</span> : null,
          ]}
        />
        {header.context && <RunContextFacts context={header.context} />}
        {stopped && (
          <p className="mt-3 text-sm break-words text-foreground" data-testid="run-stopped">
            <span className="font-medium">Stopped</span>
            {' — '}
            {header.error ? stopReason(header.error) : 'the run ended without saying why'}
          </p>
        )}
        {stopped && header.recovery && (
          <p className="mt-1.5 text-sm break-words text-muted-foreground" data-testid="run-recovery">{header.recovery}</p>
        )}
      </header>

      <Section eyebrow="Steps" commentField={null} action={steps.length > 0 ? <span className="text-muted-foreground tabular-nums">{steps.length}</span> : undefined}>
        {steps.length === 0
          ? <p className="text-muted-foreground">{live ? 'Waiting for the run to report its first step.' : 'This run reported no steps.'}</p>
          : <RunStepList steps={steps} open={open} onToggle={onToggle} now={now} />}
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

/**
 * A run's steps as rows — status mark, name, duration — each opening onto its
 * numbered log. The run page draws them, and so does the preview pane for an
 * agent run (`features/preview/PreviewPane.tsx`): one shape for a run's steps.
 * @param props
 * @param props.steps - The steps.
 * @param props.open - The keys open now.
 * @param props.onToggle - A row opened or closed.
 * @param props.now - The clock, for a running step's duration.
 */
export function RunStepList({ steps, open, onToggle, now }: { steps: readonly RunStep[]; open: readonly string[]; onToggle: (id: string, next: boolean) => void; now: number }) {
  return (
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
            <tr key={i} data-line-kind={l.kind} className={cn(l.level === 'error' && 'text-brand-fail', l.level === 'warn' && 'text-brand-borderline', l.kind === 'add' && 'bg-brand-pass/10 text-brand-pass', l.kind === 'del' && 'bg-brand-fail/10 text-brand-fail', l.kind === 'out' && 'text-muted-foreground')}>
              <td className="w-10 pr-3 pl-2 text-right align-top text-muted-foreground/60 tabular-nums select-none">{i + 1}</td>
              {l.kind === 'say'
                // The engineer's words read as prose, wrapped, like the terminal's commentary.
                ? <td className="max-w-[70ch] py-1 pr-3 font-sans text-[13px] leading-5 whitespace-pre-wrap text-foreground">{l.text}</td>
                : <td className="pr-3 whitespace-pre">{l.text || ' '}</td>}
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

/**
 * WHERE THIS RUN BELONGS, in four facts under its header (Chris, 2026-09-29:
 * "When I'm on the active run I should have context of the
 * implementation/plan/history"): the feature it builds, the plan it follows,
 * the other attempts, and what it must prove — each one move away. The
 * patterns' fact list, not a second layout.
 * @param props
 * @param props.context - From the run's records (`RunLogService.runContext`).
 */
function RunContextFacts({ context: c }: { context: RunContext }) {
  const link = 'underline decoration-border underline-offset-2 hover:decoration-foreground';
  return (
    <FactList
      className="mt-3"
      facts={[
        c.feature && { key: 'feature', label: 'Feature', value: <Link href={c.feature.href} className={link} data-testid="run-context-feature">{`#${c.feature.id} ${c.feature.title}`}</Link> },
        c.plan && { key: 'plan', label: 'Plan', value: <Link href={c.plan.href} className={link} data-testid="run-context-plan">{`#${c.plan.id} ${c.plan.title}`}</Link> },
        c.attempt && c.attempt.others.length > 0 && {
          key: 'attempts',
          label: 'Other attempts',
          value: (
            <span className="flex flex-wrap gap-x-3 gap-y-1" data-testid="run-context-attempts">
              {c.attempt.others.map(o => (
                <Link key={o.runId} href={o.href} className={link}>{`Run #${o.runId} · ${o.status}`}</Link>
              ))}
            </span>
          ),
        },
        c.acceptance && { key: 'acceptance', label: 'Acceptance', value: <Link href={c.acceptance.href} className={link} data-testid="run-context-acceptance">{`${c.acceptance.count} criteri${c.acceptance.count === 1 ? 'on' : 'a'}`}</Link> },
      ]}
    />
  );
}
