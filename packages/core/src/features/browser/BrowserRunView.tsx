'use client';

/**
 * A BROWSER RUN, LIVE — in the preview pane beside the conversation, and on
 * its own page. Top to bottom, in the order a person looks:
 *
 *   status   where it stands, in a word, with Stop (or Start, for a suggestion)
 *   browser  the page as the browser sees it now, several frames a second
 *            while it runs: the cursor gliding to what it clicks, the field it
 *            types into outlined (the engine draws them on the page)
 *   waiting  what it is holding for the person — a step that submits, or its
 *            question — as the one Decision card (`DockedDecision`)
 *   result   what it found, each output by name, a list of rows as a table
 *   steps    what it did, one line each, newest last; a step with a picture
 *            shows the page just after it in the browser above
 *   media    any picture opens full screen in the one media viewer
 *            (`MediaLightbox`): live now, each step's page, the run's recording
 *   inputs   what it was given (a secret as ••••)
 *
 * Re-read about once a second while live (`browser.get` on the RPC route); the
 * picture is fetched as it moves (`/frame`), one request at a time.
 */

import type { ReactNode } from 'react';
import type { MediaSlide } from '@/features/dashboard/factory/MediaCarousel';
import type { BrowserStep, BrowserRunView as Run } from '@/libs/browser/run';
import { Globe, Maximize2, Play, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FactList, StatusDot } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { announceConversationAppended } from '@/features/dashboard/chat/conversationAppended';
import { DockedDecision } from '@/features/dashboard/connect-systems/DockedDecision';
import { MediaLightbox } from '@/features/dashboard/factory/MediaCarousel';
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

/**
 * Re-reads the live picture when it moves, not on every re-render.
 * @param run
 */
function frameSeqKey(run: Run): number {
  return run.frameSeq;
}

/**
 * Everything this run can show full screen, in order: each step's page, the page it ended on (or
 * the page now, while it runs), then its recording.
 * @param run - The run.
 * @param live - It holds the browser now.
 * @param seq - The live picture's frame, so "now" is fetched fresh.
 */
function mediaOf(run: Run, live: boolean, seq: number): MediaSlide[] {
  const slides: MediaSlide[] = run.steps
    .filter(st => st.shotUrl)
    .map(st => ({ id: st.n, src: st.shotUrl!, label: `Step ${st.n}`, title: st.label, caption: st.why ? `${st.label} · ${st.why}` : st.label }));
  if (live) {
    slides.push({ id: -1, src: `/api/browser-runs/${run.id}/frame?t=${seq}`, label: 'Live', title: 'The browser now', caption: 'The browser now' });
  } else if (run.finalShotUrl) {
    slides.push({ id: -1, src: run.finalShotUrl, label: 'End', title: 'Where it ended', caption: run.summary?.slice(0, 200) ?? 'Where it ended' });
  }
  if (run.videoUrl && !live) {
    slides.push({ id: -2, src: run.videoUrl, kind: 'video', type: 'video/webm', label: 'Recording', title: 'The whole run', caption: 'The whole run, recorded' });
  }
  return slides;
}

/**
 * What a run's question offers: its typed choices, else the plain answers an older run gave.
 * @param w - What it waits on.
 */
function waitingChoices(w: NonNullable<Run['waiting']>): Array<{ label: string; consequence?: string }> {
  return w.choices ?? (w.options ?? []).map(label => ({ label }));
}

/**
 * Under a run's question: the rule that sent it to the person, then what it found, each a fact.
 * An older run's question carries its findings in its text instead.
 * @param w - What it waits on.
 */
function waitingBody(w: NonNullable<Run['waiting']>): ReactNode {
  if (!w.question) {
    return w.text.includes('\n\n') ? w.text.split('\n\n').slice(1).join('\n\n') : undefined;
  }
  return (
    <div className="space-y-2">
      {w.rule && <p>{w.rule}</p>}
      {w.found && w.found.length > 0 && (
        <FactList facts={w.found.map((f, i) => ({ key: `f${i}`, label: f.label, value: f.value }))} />
      )}
    </div>
  );
}

function StepRow({ step, shown, onShow }: { step: BrowserStep; shown: boolean; onShow: (step: BrowserStep) => void }) {
  const body = (
    <>
      <span className="w-5 shrink-0 text-right text-muted-foreground tabular-nums">{step.n}</span>
      <span className="min-w-0">
        <span className={cn('text-foreground', !step.ok && 'text-brand-fail')}>{step.label}</span>
        {step.why && <span className="text-muted-foreground">{` · ${step.why}`}</span>}
        {!step.ok && step.detail && <span className="block text-muted-foreground">{step.detail}</span>}
      </span>
    </>
  );
  return (
    <li className="text-[12px] leading-snug" data-browser-step={step.n}>
      {step.shotUrl
        ? (
            <button
              type="button"
              onClick={() => onShow(step)}
              aria-pressed={shown}
              className={cn('flex w-full gap-2 rounded px-1 py-1 text-left hover:bg-muted/50', shown && 'bg-muted')}
              data-browser-step-shot
            >
              {body}
            </button>
          )
        : <div className="flex gap-2 px-1 py-1">{body}</div>}
    </li>
  );
}

export function BrowserRunView({ initial, compact = false }: { initial: Run; compact?: boolean }) {
  const [run, setRun] = useState<Run>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stepsEnd = useRef<HTMLLIElement | null>(null);
  const frame = useFrame(run);
  // A step's own picture, chosen from the steps; or the run's recording, played back.
  const [shown, setShown] = useState<BrowserStep | null>(null);
  const showStep = useCallback((s: BrowserStep) => {
    setShown(cur => (cur?.n === s.n ? null : s));
  }, []);
  const [viewing, setViewing] = useState<number | null>(null);
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
  const live = ['running', 'waiting', 'queued'].includes(run.status);
  const slides = mediaOf(run, live, frameSeqKey(run));
  const openAt = (which: 'video' | 'now' | number) => {
    const i = which === 'video'
      ? slides.findIndex(x => x.kind === 'video')
      : typeof which === 'number'
        ? slides.findIndex(x => x.id === which)
        : slides.length - 1 - (slides.at(-1)?.kind === 'video' ? 1 : 0);
    if (i >= 0) {
      setViewing(i);
    }
  };
  const shownUrl = shown ? (shown.url ?? [...run.steps].reverse().find(x => x.n <= shown.n && x.url)?.url ?? null) : run.url;
  const host = (() => {
    try {
      return shownUrl ? new URL(shownUrl).host + new URL(shownUrl).pathname : '';
    } catch {
      return shownUrl ?? '';
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
          {shown && (
            <button type="button" onClick={() => setShown(null)} className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground" data-browser-step-shown={shown.n}>
              {`Step ${shown.n} · back to ${ACTIVE.has(run.status) ? 'live' : 'the end'}`}
            </button>
          )}
          {!shown && live && (
            <span className="flex items-center gap-1 text-[10px] font-semibold tracking-wide text-brand-fail uppercase">
              <span className="size-1.5 rounded-full bg-brand-fail motion-safe:animate-pulse" aria-hidden />
              Live
            </span>
          )}
          {slides.length > 0 && (
            <button type="button" onClick={() => openAt(shown ? shown.n : 'now')} aria-label="View full screen" title="View full screen" className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground" data-browser-fullscreen>
              <Maximize2 className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
        <div className="relative aspect-[16/10] w-full bg-muted/30">
          {(shown?.shotUrl ?? frame)
            ? (
                <button type="button" onClick={() => openAt(shown ? shown.n : 'now')} className="absolute inset-0 size-full cursor-zoom-in" aria-label="View full screen">
                  {shown?.shotUrl
                    // eslint-disable-next-line next/no-img-element -- a stored step picture, not an optimisable asset
                    ? <img key={shown.n} src={shown.shotUrl} alt={`The page after step ${shown.n}: ${shown.label}`} className="size-full object-contain object-top" data-browser-step-frame={shown.n} />
                    // eslint-disable-next-line next/no-img-element -- a live blob, not an optimisable asset
                    : <img src={frame!} alt={`The browser on ${host || 'its page'}`} className="size-full object-contain object-top" data-browser-frame />}
                </button>
              )
            : (
                <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-[12px] text-muted-foreground">
                  {run.status === 'proposed' ? 'The browser opens when you press Start.' : run.status === 'queued' ? 'Opening the browser…' : 'No picture of this run was kept.'}
                </div>
              )}
        </div>
      </figure>
      {run.videoUrl && !ACTIVE.has(run.status) && (
        <Button size="sm" variant="outline" className="-mt-2" onClick={() => openAt('video')} data-browser-watch>
          <Play className="size-3.5" aria-hidden />
          Watch the run
        </Button>
      )}
      {viewing !== null && slides.length > 0 && (
        <MediaLightbox slides={slides} start={Math.min(viewing, slides.length - 1)} onClose={() => setViewing(null)} />
      )}
      {run.isolation && (
        <p className="-mt-2 text-[11px] text-muted-foreground" data-browser-isolation={run.isolation}>
          {ISOLATION[run.isolation] ?? run.isolation}
          {run.resumes > 0 && ` · picked up after ${run.resumes === 1 ? 'a restart' : `${run.resumes} restarts`}`}
        </p>
      )}

      {run.waiting && (
        <div data-browser-waiting={run.waiting.kind}>
          {run.waiting.kind === 'approval'
            ? (
                <DockedDecision
                  id={`browser-${run.id}-${run.waiting.at}`}
                  eyebrow="Needs your approval"
                  question={run.waiting.step ? `Approve “${run.waiting.step.replace(/^Click /, '')}”?` : run.waiting.text}
                  body={run.waiting.step ? run.waiting.text : undefined}
                  options={[{ id: 'approve', label: 'Approve', recommended: true }, { id: 'deny', label: 'Decline' }]}
                  allowOther={false}
                  skipLabel={null}
                  busy={busy}
                  error={error}
                  takeFocus={false}
                  onAnswer={(a) => {
                    if (a.kind === 'option') {
                      void send({ action: a.optionIds[0] === 'approve' ? 'approve' : 'deny' });
                    }
                  }}
                />
              )
            : (
                <DockedDecision
                  id={`browser-${run.id}-${run.waiting.at}`}
                  eyebrow="Question for you"
                  question={run.waiting.question ?? run.waiting.text.split('\n\n')[0]!}
                  body={waitingBody(run.waiting)}
                  options={waitingChoices(run.waiting).map((c, i) => ({ id: `o${i + 1}`, label: c.label, ...(c.consequence ? { consequence: c.consequence } : {}), ...(i === 0 ? { recommended: true } : {}) }))}
                  allowOther
                  skipLabel={null}
                  busy={busy}
                  error={error}
                  takeFocus={false}
                  onAnswer={(a) => {
                    const choices = run.waiting ? waitingChoices(run.waiting) : [];
                    const text = a.kind === 'free_text' ? a.text : a.kind === 'option' ? choices[Number(a.optionIds[0]?.slice(1)) - 1]?.label : null;
                    if (text?.trim()) {
                      void send({ action: 'answer', text: text.trim() });
                    }
                  }}
                />
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
            {run.steps.map(s => <StepRow key={s.n} step={s} shown={shown?.n === s.n} onShow={showStep} />)}
            <li ref={stepsEnd} aria-hidden />
          </ol>
        </details>
      )}

      {(inputs.length > 0 || run.outputs.length > 0) && (
        <details className="border-t border-border/60 pt-3 text-[12px]">
          <summary className="cursor-pointer list-none text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Inputs and outputs</summary>
          <FactList
            className="mt-2"
            facts={[
              ...inputs.map(([k, v]) => ({ key: `in-${k}`, label: k.replace(/_/g, ' '), value: v.value })),
              ...run.outputs.map(o => ({ key: `out-${o.name}`, label: `→ ${o.name.replace(/_/g, ' ')}`, value: o.description })),
            ]}
          />
        </details>
      )}
    </div>
  );
}
