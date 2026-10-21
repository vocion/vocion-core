'use client';

/**
 * A BROWSER RUN, LIVE — in the preview pane beside the conversation, and on
 * its own page. Top to bottom, in the order a person looks:
 *
 *   status   where it stands, in a word, with Stop (or Start, for a suggestion)
 *   browser  the page as the browser sees it now, several frames a second
 *            while it runs: the cursor gliding to what it clicks, the field it
 *            types into outlined (the engine draws them on the page)
 *   waiting  what it is holding for the person — a step that submits, with
 *            a picture of the page, Approve and Decline; or its question
 *   result   what it found, each output by name, a list of rows as a table
 *   steps    what it did, one line each, newest last
 *   inputs   what it was given (a secret as ••••)
 *
 * Re-read about once a second while live (`browser.get` on the RPC route); the
 * picture is fetched as it moves (`/frame`), one request at a time.
 */

import type { BrowserStep, BrowserRunView as Run } from '@/libs/browser/run';
import { Check, Globe, Play, Square, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusDot } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { announceConversationAppended } from '@/features/dashboard/chat/conversationAppended';
import { client } from '@/libs/Orpc';
import { cn } from '@/utils/Helpers';
import { OutputValue } from './OutputValue';

const ACTIVE = new Set(['proposed', 'queued', 'running', 'waiting']);

/** Where the browser ran, as a person reads it (`services/browser/browserHost.ts`). */
const ISOLATION: Record<string, string> = {
  remote: 'Ran in its own isolated container',
  sandboxed: 'Ran in a sandboxed browser',
  unsandboxed: 'Ran in its own browser process, without Chrome\'s sandbox',
};

function statusLine(run: Run): { tone: 'pass' | 'amber' | 'fail' | 'neutral'; word: string; pulse: boolean } {
  switch (run.status) {
    case 'proposed':
      return { tone: 'neutral', word: 'Suggested · ready to start', pulse: false };
    case 'queued':
      return { tone: 'amber', word: run.resuming ? 'Picking up after a restart' : 'Starting the browser', pulse: true };
    case 'running':
      return { tone: 'amber', word: run.resuming ? 'Picking up after a restart' : `Working · step ${run.steps.length}`, pulse: true };
    case 'waiting':
      return { tone: 'amber', word: run.waiting?.kind === 'approval' ? 'Waiting for your approval' : 'Waiting for your answer', pulse: true };
    case 'done':
      return { tone: 'pass', word: `Done${duration(run)}`, pulse: false };
    case 'stopped':
      return { tone: 'neutral', word: 'Stopped', pulse: false };
    default:
      return { tone: 'fail', word: 'Could not finish', pulse: false };
  }
}

function duration(run: Run): string {
  if (!run.startedAt || !run.endedAt) {
    return '';
  }
  const s = Math.round((Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000);
  const t = s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
  return ` · ${t}${run.cents > 0 ? ` · $${(run.cents / 100).toFixed(2)}` : ''}`;
}

/**
 * The live picture: fetched as a blob, one at a time, while the run holds the browser.
 * @param run
 */
function useFrame(run: Run): string | null {
  const [src, setSrc] = useState<string | null>(null);
  const live = ['queued', 'running', 'waiting'].includes(run.status);
  const last = useRef<string | null>(null);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (url: string | null) => {
      if (last.current?.startsWith('blob:')) {
        URL.revokeObjectURL(last.current);
      }
      last.current = url;
      setSrc(url);
    };
    const pull = async () => {
      try {
        const res = await fetch(`/api/browser-runs/${run.id}/frame?t=${Date.now()}`, { cache: 'no-store' });
        if (stop) {
          return;
        }
        if (res.ok && res.status === 200) {
          show(URL.createObjectURL(await res.blob()));
        }
      } catch {
        /* the next pull tries again */
      }
      if (!stop && live) {
        timer = setTimeout(pull, 220);
      }
    };
    void pull();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [run.id, live, run.finalShotUrl]);
  useEffect(() => () => {
    if (last.current?.startsWith('blob:')) {
      URL.revokeObjectURL(last.current);
    }
  }, []);
  return src;
}

function StepRow({ step }: { step: BrowserStep }) {
  return (
    <li className="flex gap-2 py-1 text-[12px] leading-snug" data-browser-step={step.n}>
      <span className="w-5 shrink-0 text-right text-muted-foreground tabular-nums">{step.n}</span>
      <span className="min-w-0">
        <span className={cn('text-foreground', !step.ok && 'text-brand-fail')}>{step.label}</span>
        {step.why && <span className="text-muted-foreground">{` · ${step.why}`}</span>}
        {!step.ok && step.detail && <span className="block text-muted-foreground">{step.detail}</span>}
      </span>
    </li>
  );
}

export function BrowserRunView({ initial, compact = false }: { initial: Run; compact?: boolean }) {
  const [run, setRun] = useState<Run>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const stepsEnd = useRef<HTMLLIElement | null>(null);
  const frame = useFrame(run);
  const active = ACTIVE.has(run.status);

  useEffect(() => {
    if (!active) {
      return;
    }
    let stop = false;
    const timer = setInterval(async () => {
      const res = await client.browser.get({ id: run.id }).catch(() => null);
      if (!stop && res?.run) {
        setRun(res.run);
      }
    }, 1000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [run.id, active]);

  useEffect(() => {
    if (active) {
      stepsEnd.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [run.steps.length, active]);

  // When a run this surface watched ends, its result may have been said in its conversation.
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active && run.conversationId) {
      const id = run.conversationId;
      const t = setTimeout(() => announceConversationAppended(id), 1200);
      wasActive.current = active;
      return () => clearTimeout(t);
    }
    wasActive.current = active;
    return undefined;
  }, [active, run.conversationId]);

  const send = useCallback(async (body: { action: 'start' | 'stop' | 'approve' | 'deny' | 'answer'; text?: string }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await client.browser.act({ id: run.id, ...body });
      if (res.error) {
        setError(res.error);
      }
      if (res.run) {
        setRun(res.run);
        if (!res.error) {
          setReply('');
        }
      }
    } catch {
      setError('That did not go through.');
    } finally {
      setBusy(false);
    }
  }, [run.id]);

  const line = statusLine(run);
  const outputs = Object.entries(run.result ?? {});
  const inputs = Object.entries(run.inputs ?? {});
  const host = (() => {
    try {
      return run.url ? new URL(run.url).host + new URL(run.url).pathname : '';
    } catch {
      return run.url ?? '';
    }
  })();

  return (
    <div className="space-y-4" data-browser-run={run.id} data-browser-status={run.status}>
      <div className="flex items-center justify-between gap-2">
        <StatusDot tone={line.tone} pulse={line.pulse} label={<span className="text-[13px] font-medium text-foreground">{line.word}</span>} />
        {run.status === 'proposed' && (
          <Button size="sm" disabled={busy} onClick={() => send({ action: 'start' })} data-browser-start>
            <Play className="size-3.5" aria-hidden />
            Start
          </Button>
        )}
        {['queued', 'running', 'waiting'].includes(run.status) && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => send({ action: 'stop' })} data-browser-stop>
            <Square className="size-3" aria-hidden />
            Stop
          </Button>
        )}
      </div>

      {!compact && <p className="text-sm leading-relaxed text-foreground">{run.task}</p>}

      {/* The browser, as it sees the page. */}
      <figure className="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
        <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
          <span className="flex gap-1" aria-hidden>
            <span className="size-2 rounded-full bg-[#ff5f57]" />
            <span className="size-2 rounded-full bg-[#febc2e]" />
            <span className="size-2 rounded-full bg-[#28c840]" />
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-1.5 rounded bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
            <Globe className="size-3 shrink-0" aria-hidden />
            <span className="truncate" data-browser-url>{host || 'about:blank'}</span>
          </span>
          {['running', 'waiting', 'queued'].includes(run.status) && (
            <span className="flex items-center gap-1 text-[10px] font-semibold tracking-wide text-brand-fail uppercase">
              <span className="size-1.5 rounded-full bg-brand-fail motion-safe:animate-pulse" aria-hidden />
              Live
            </span>
          )}
        </div>
        <div className="relative aspect-[16/10] w-full bg-muted/30">
          {frame
            // eslint-disable-next-line next/no-img-element -- a live blob, not an optimisable asset
            ? <img src={frame} alt={`The browser on ${host || 'its page'}`} className="absolute inset-0 size-full object-contain object-top" data-browser-frame />
            : (
                <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-[12px] text-muted-foreground">
                  {run.status === 'proposed' ? 'The browser opens when you press Start.' : run.status === 'queued' ? 'Opening the browser…' : 'No picture of this run was kept.'}
                </div>
              )}
        </div>
      </figure>
      {run.isolation && (
        <p className="-mt-2 text-[11px] text-muted-foreground" data-browser-isolation={run.isolation}>
          {ISOLATION[run.isolation] ?? run.isolation}
          {run.resumes > 0 && ` · picked up after ${run.resumes === 1 ? 'a restart' : `${run.resumes} restarts`}`}
        </p>
      )}

      {run.waiting && (
        <div className="rounded-lg border border-brand-amber/50 bg-brand-amber/5 p-3" data-browser-waiting={run.waiting.kind}>
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{run.waiting.kind === 'approval' ? 'Needs your approval' : 'Question for you'}</p>
          <p className="mt-1 text-sm font-medium text-foreground">{run.waiting.text}</p>
          {run.waiting.kind === 'approval'
            ? (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" disabled={busy} onClick={() => send({ action: 'approve' })} data-browser-approve>
                    <Check className="size-3.5" aria-hidden />
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => send({ action: 'deny' })} data-browser-deny>
                    <X className="size-3.5" aria-hidden />
                    Decline
                  </Button>
                </div>
              )
            : (
                <form
                  className="mt-3 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (reply.trim()) {
                      void send({ action: 'answer', text: reply.trim() });
                    }
                  }}
                >
                  <input value={reply} onChange={e => setReply(e.target.value)} className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm" aria-label="Your answer" />
                  <Button size="sm" type="submit" disabled={busy || !reply.trim()}>Send</Button>
                </form>
              )}
        </div>
      )}

      {error && <p className="text-[12px] text-brand-fail" role="alert">{error}</p>}

      {(run.summary || outputs.length > 0) && (
        <section className="space-y-3 border-t border-border/60 pt-3" data-browser-result>
          {run.summary && <p className="text-sm leading-relaxed text-foreground">{run.summary}</p>}
          {outputs.map(([k, v]) => (
            <div key={k}>
              <p className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{k.replace(/_/g, ' ')}</p>
              <OutputValue value={v} />
            </div>
          ))}
        </section>
      )}
      {run.error && run.status === 'failed' && !run.summary && <p className="text-sm text-brand-fail">{run.error}</p>}

      {run.steps.length > 0 && (
        <details open={active || !compact} className="border-t border-border/60 pt-3">
          <summary className="cursor-pointer list-none text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{`Steps · ${run.steps.length}`}</summary>
          <ol className="mt-2 max-h-72 overflow-y-auto">
            {run.steps.map(s => <StepRow key={s.n} step={s} />)}
            <li ref={stepsEnd} aria-hidden />
          </ol>
        </details>
      )}

      {(inputs.length > 0 || run.outputs.length > 0) && (
        <details className="border-t border-border/60 pt-3 text-[12px]">
          <summary className="cursor-pointer list-none text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Inputs and outputs</summary>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {inputs.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k.replace(/_/g, ' ')}</dt>
                <dd className="min-w-0 break-words text-foreground">{v.value}</dd>
              </div>
            ))}
            {run.outputs.map(o => (
              <div key={o.name} className="contents">
                <dt className="text-muted-foreground">{`→ ${o.name.replace(/_/g, ' ')}`}</dt>
                <dd className="min-w-0 text-foreground">{o.description}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}
