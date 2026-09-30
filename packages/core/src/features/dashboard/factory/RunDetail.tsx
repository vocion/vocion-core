'use client';

import type { RunContext, RunHeader, RunLink, RunLogData, RunLogLine, RunStep } from '@/libs/worker/runLog';
import { Check, Copy } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Accordion, FactList, MetaChip, OpenInPreview, Section } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useLive } from '@/hooks/useLive';
import { Link } from '@/libs/I18nNavigation';
import { liveTopic } from '@/libs/live/topics';
import { client } from '@/libs/Orpc';
import { deriveSteps, focusStep, isLiveStatus, mergeRunLog, refusedBeforeStart, runNow, stopReason } from '@/libs/worker/runLog';
import { cn } from '@/utils/Helpers';
import { RunNowLine, RunTitleBlock, RunWhyLine, stepDuration, StepIcon, useRunClock } from './RunHeader';

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
  const now = useRunClock(live);

  const steps = useMemo(() => deriveSteps(data), [data]);
  const focus = focusStep(steps);
  // A person's own open / close wins; otherwise the running or failed step is open.
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const open = steps.filter(s => chosen[s.key] ?? s.key === focus).map(s => s.key);
  const onToggle = useCallback((id: string, next: boolean) => setChosen(c => ({ ...c, [id]: next })), []);

  const stopped = ['failed', 'lost', 'cancelled'].includes(header.status);
  const refused = refusedBeforeStart(data);

  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col" data-testid="run-detail" data-live={live && visible ? 'on' : 'off'}>
      {/* The page leads with the run: the shell's breadcrumb (Runs › #id)
          says where it is, so there is no second title above this one. */}
      <header className="border-b border-rule pb-4">
        <RunTitleBlock
          header={header}
          now={now}
          refused={refused}
          extra={live ? <span key="live" className="text-[12px]">{visible ? 'live' : 'paused while hidden'}</span> : null}
        />
        <RunWhyLine why={header.context?.why} />
        {header.objective && <Contract text={header.objective} />}
        <RunFacts header={header} />
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
        {/* Pinned above the steps: where the run is, in the engineer's words. */}
        <RunNowLine now={runNow(data, steps)} />
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
 * WHERE THIS RUN BELONGS, as the patterns' fact rows under its header (Chris,
 * 2026-09-29: "When I'm on the active run I should have context of the
 * implementation/plan/history"; 2026-09-30: branch and PR, and the machine id
 * out of the title). Each row names one thing one move away: its link text
 * goes to the full page, and a record the pane can show carries "Open in
 * preview" (`OpenInPreview`). A pull request or a branch lives on GitHub: it
 * opens in a new tab and has no preview.
 * @param props
 * @param props.header - The run.
 */
function RunFacts({ header: h }: { header: RunHeader }) {
  const c: RunContext | null = h.context ?? null;
  const link = 'underline decoration-border underline-offset-2 hover:decoration-foreground';
  const [openCriteria, setOpenCriteria] = useState(false);
  const criteria = c?.acceptance?.criteria ?? [];
  const judged = criteria.some(x => x.state !== null);
  const proven = criteria.filter(x => x.state === 'proven').length;
  const others = c?.others ?? [];
  return (
    <FactList
      className="mt-3"
      facts={[
        c?.feature && { key: 'feature', label: 'Feature', preview: { type: 'object', id: String(c.feature.id) }, value: <Link href={c.feature.href} className={link} data-testid="run-context-feature">{`#${c.feature.id} ${c.feature.title}`}</Link> },
        c?.plan && { key: 'plan', label: 'Plan', preview: { type: 'object', id: String(c.plan.id) }, value: <Link href={c.plan.href} className={link} data-testid="run-context-plan">{`#${c.plan.id} ${c.plan.title}`}</Link> },
        {
          key: 'run',
          label: 'Run',
          preview: c?.task ? { type: 'object', id: String(c.task.id) } : null,
          value: (
            <span className="font-mono text-[12px]" data-testid="run-context-task">
              {`${h.kind === 'agent' ? 'Agent run' : 'Run'} #${h.id}`}
              {h.taskId && (
                <>
                  {' · '}
                  {c?.task ? <Link href={c.task.href} className={link}>{h.taskId}</Link> : h.taskId}
                </>
              )}
            </span>
          ),
        },
        others.length > 0 && {
          key: 'attempts',
          label: 'Other attempts',
          value: (
            <span className="flex flex-wrap gap-x-3 gap-y-1" data-testid="run-context-attempts">
              {others.map(o => (
                <span key={o.runId} className="group/row inline-flex items-center gap-1">
                  <Link href={o.href} className={link}>{`Run #${o.runId} · ${o.status}`}</Link>
                  <OpenInPreview recordRef={{ type: 'worker_run', id: String(o.runId) }} label={`Open run #${o.runId} in preview`} />
                </span>
              ))}
            </span>
          ),
        },
        c?.acceptance && {
          key: 'acceptance',
          label: 'Acceptance',
          preview: c.feature ? { type: 'feature_section', id: `${c.feature.id}.acceptance` } : null,
          value: criteria.length > 0
            ? (
                <div data-testid="run-context-acceptance">
                  <button type="button" onClick={() => setOpenCriteria(o => !o)} aria-expanded={openCriteria} className={cn(link, 'text-left')} data-testid="run-criteria-toggle">
                    {`${c.acceptance.count} criteri${c.acceptance.count === 1 ? 'on' : 'a'}${judged ? ` · ${proven} proven` : ''}`}
                  </button>
                  {openCriteria && (
                    <ul className="mt-2 space-y-1.5" data-testid="run-criteria">
                      {criteria.map((x, i) => (
                        // eslint-disable-next-line react/no-array-index-key
                        <li key={i} className="flex items-start gap-2 text-[13px]" data-state={x.state ?? 'unjudged'}>
                          <StepIcon status={x.state === 'proven' ? 'passed' : x.state === 'open' ? 'failed' : 'pending'} />
                          <span className="min-w-0 flex-1 break-words">{x.text}</span>
                          {x.state && <span className="shrink-0 text-[12px] text-muted-foreground">{x.state === 'proven' ? 'proven' : 'open'}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            : <Link href={c.acceptance.href} className={link} data-testid="run-context-acceptance">{`${c.acceptance.count} criteri${c.acceptance.count === 1 ? 'on' : 'a'}`}</Link>,
        },
        c?.branch && {
          key: 'branch',
          label: 'Branch',
          value: c.branch.href
            ? <a href={c.branch.href} target="_blank" rel="noopener noreferrer" className={cn(link, 'font-mono text-[12px]')} data-testid="run-context-branch">{c.branch.name}</a>
            : <span className="font-mono text-[12px]" data-testid="run-context-branch">{c.branch.name}</span>,
        },
        h.prUrl && { key: 'pr', label: 'Pull request', value: <a href={h.prUrl} target="_blank" rel="noopener noreferrer" className={link} data-testid="run-context-pr">{prLabel(h.prUrl)}</a> },
        typeof h.cents === 'number' && h.cents > 0 && { key: 'cost', label: 'Cost', value: <span className="tabular-nums">{`$${(h.cents / 100).toFixed(2)}`}</span> },
        h.model && { key: 'model', label: 'Model', value: h.model },
        h.links.length > 0 && {
          key: 'links',
          label: 'Documents',
          value: <span className="flex flex-wrap gap-x-3 gap-y-1">{h.links.map(l => <RunLinkChip key={`${l.label}:${l.href}`} link={l} />)}</span>,
        },
      ]}
    />
  );
}

/**
 * "PR #27" off a pull request URL, or the URL's last segment.
 * @param url - The pull request.
 */
function prLabel(url: string): string {
  const n = /\/(?:pull|merge_requests)\/(\d+)/.exec(url)?.[1];
  return n ? `PR #${n}` : url.split('/').filter(Boolean).at(-1) ?? url;
}

/**
 * The contract the run was given, two lines until asked for the rest: it is
 * what the run was told, not what it did (Chris, 2026-09-30).
 * @param props
 * @param props.text - The objective.
 */
function Contract({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2" id="contract" data-testid="run-contract">
      <p className={cn('text-sm break-words whitespace-pre-wrap text-muted-foreground', !open && 'line-clamp-2')}>{text}</p>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="mt-1 text-[13px] text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground" data-testid="run-contract-toggle">
        {open ? 'Hide contract' : 'Show contract'}
      </button>
    </div>
  );
}
