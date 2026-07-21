'use client';

import type { AgentRun } from './types';
import { Brain, Check, ChevronDown, ChevronRight, CircleAlert, Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * WorkTimeline — the chain-of-thought surface.
 *
 * One consolidated, collapsible block per agent message showing the team's
 * work as legible steps — "Delegated: Pipeline Analyst", "Searched sources
 * ('open deals…')", "Proposed CRM update (0.88 confidence)" — instead of
 * scattered raw tool breadcrumbs with kwargs dumps.
 *
 *   - streaming: expanded; the HEADER is the live current step ("Delegating:
 *     Pipeline Analyst · 32s"), completed steps show output snippets, and the
 *     current activity pulses as the last row.
 *   - done: collapses to a one-line summary ("Worked · 5 steps · 2 specialists")
 *     that expands on click for the audit trail.
 */

export type WorkTimelineProps = {
  runs: Extract<AgentRun, { type: 'tool' }>[];
  streaming: boolean;
  /** Live status text while streaming (from ChatShell's event reducer). */
  activity?: string | null;
  /**
   * Accumulated chain-of-thought text (Anthropic extended thinking).
   * While streaming, the live tail renders as the first timeline step;
   * once done it collapses into an expandable "Reasoning" step.
   */
  thinkingText?: string;
};

type Step = {
  label: string;
  detail?: string;
  output?: string;
  state: 'pending' | 'done' | 'error';
};

/**
 * One human-legible description per tool call — shared by the timeline steps
 * AND the live activity line, so "what it's doing" and "what it did" agree.
 * @param name
 * @param input
 * @param live - present-tense phrasing for the live activity line
 */
export function describeToolCall(name: string, input: Record<string, unknown>, live = false): { label: string; detail?: string } {
  switch (name) {
    case 'task': {
      // deepagents subagent dispatch — recover the specialist's name from its
      // prompt ("You are the Pipeline Analyst …"). The raw runtime name is
      // "general-purpose" (plumbing, not human), so soften anything that looks
      // like a code name to a plain "a specialist".
      const desc = String(input.description ?? '');
      const m = desc.match(/[Yy]ou are (?:the )?([A-Z][a-z-]+(?: [A-Z][a-z-]+){0,3})/);
      let who = (m?.[1] ?? String(input.subagent_type ?? '')).trim();
      if (!who || who.includes('-') || /^(?:general.?purpose|specialist)$/i.test(who)) {
        who = 'a specialist';
      }
      // Surface WHAT the specialist was asked to do — strip the "You are…"
      // role boilerplate and quote a short summary of the actual task.
      const summary = desc.replace(/^.*?[Yy]ou are[^.]*\.\s*/, '').replace(/\s+/g, ' ').trim();
      const detail = summary ? `“${summary.slice(0, 100)}${summary.length > 100 ? '…' : ''}”` : undefined;
      return { label: live ? `Handing off to ${who}…` : `Delegated to ${who}`, detail };
    }
    case 'search_knowledge': {
      const q = String(input.query ?? '');
      return { label: live ? 'Searching sources…' : 'Searched sources', detail: q ? `“${q.slice(0, 90)}”` : undefined };
    }
    case 'lookup_objects':
      return { label: live ? 'Looking up records…' : 'Looked up records', detail: String(input.type ?? input.object_type ?? '') || undefined };
    case 'propose_action': {
      const actionId = String(input.action_id ?? 'action');
      const conf = typeof input.confidence === 'number' ? ` · ${Math.round((input.confidence as number) * 100)}% confidence` : '';
      return { label: live ? `Proposing: ${actionId}${conf}…` : `Proposed: ${actionId}${conf}`, detail: live ? undefined : 'queued for your approval' };
    }
    case 'create_artifact':
      return { label: live ? 'Creating artifact…' : 'Created artifact', detail: String(input.kind ?? '') || undefined };
    case 'request_human_review':
      return { label: live ? 'Requesting approval…' : 'Requested approval' };
    case 'run_operation':
      return { label: `${live ? 'Running' : 'Ran'} skill: ${String(input.operation ?? input.slug ?? '')}` };
    case 'web_search':
      return { label: live ? 'Searching the web…' : 'Searched the web', detail: String(input.query ?? '').slice(0, 90) || undefined };
    case 'write_todos':
      return { label: live ? 'Planning…' : 'Planned the work' };
    case 'read_file':
    case 'ls':
    case 'glob':
    case 'grep':
      return { label: live ? 'Reading context…' : 'Read context', detail: String(input.file_path ?? input.pattern ?? '') || undefined };
    default:
      return { label: `${live ? 'Running' : 'Ran'} ${name.replace(/[-_]/g, ' ')}${live ? '…' : ''}` };
  }
}

/**
 * Trim a tool output into a one-line snippet for the audit trail.
 * @param output
 */
function outputSnippet(output: unknown): string | undefined {
  const s = String(output ?? '').replaceAll(/\s+/g, ' ').trim();
  if (!s || s.length < 3) {
    return undefined;
  }
  // Never surface raw structured payloads — tool kwargs / state dumps like
  // write_todos' `{"lg_name":"Command","update":{...}}`. They're noise to a
  // human and, unwrapped, blow out the layout width. Plain-language labels
  // (describeToolCall) already say what happened; the raw object adds nothing.
  if (/^[[{]/.test(s) || (s.includes('":') && s.includes('{'))) {
    return undefined;
  }
  return s.length > 140 ? `${s.slice(0, 140)}…` : s;
}

/**
 * lookup_objects returns a JSON record array (kept out of the answer). Surface
 * it HERE instead — a count + the contact/title names — so the source data the
 * agent used is visible on demand in the chain of thought, never dumped in the
 * reply. Returns null for non-record output.
 * @param raw - The tool's output string.
 */
function summarizeRecords(raw: unknown): { detail: string; names: string } | null {
  try {
    const arr = JSON.parse(String(raw ?? '')) as Array<Record<string, unknown>>;
    if (!Array.isArray(arr) || arr.length === 0) {
      return null;
    }
    const names = arr
      .map(r => String(r.contact ?? r.title ?? '').trim())
      .filter(Boolean);
    const shown = names.slice(0, 6).join(', ');
    const more = names.length > 6 ? ` +${names.length - 6} more` : '';
    return { detail: `${arr.length} record${arr.length === 1 ? '' : 's'}`, names: `${shown}${more}` };
  } catch {
    return null;
  }
}

/**
 * Turn a raw tool run into a human-legible step.
 * @param run
 */
function toStep(run: Extract<AgentRun, { type: 'tool' }>): Step {
  const input = run.input ?? {};
  const state = run.state ?? 'done';
  if (run.name === 'error') {
    return { label: 'Error', detail: String(run.output ?? '').slice(0, 160), state: 'error' };
  }
  const { label, detail } = describeToolCall(run.name, input);
  // Records are the one tool output worth showing in the timeline — the count
  // and who, so "Looked up records" isn't an empty step.
  if (run.name === 'lookup_objects' && state === 'done') {
    const summary = summarizeRecords(run.output);
    if (summary) {
      return { label, detail: summary.detail, output: summary.names, state };
    }
  }
  return {
    label,
    detail,
    output: state === 'done' ? outputSnippet(run.output) : undefined,
    state,
  };
}

/**
 * Seconds-elapsed ticker for the streaming header.
 * @param active
 */
function useElapsed(active: boolean): number {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    if (!active) {
      return;
    }
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return Math.floor((now - start) / 1000);
}

export function WorkTimeline({ runs, streaming, activity, thinkingText }: WorkTimelineProps) {
  // Collapsed by DEFAULT — even while streaming. The header carries the single
  // live status line; tap to open the full chain of thought (a bottom sheet on
  // mobile, an inline panel on desktop). No duplicated status lines.
  const [open, setOpen] = useState(false);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const elapsed = useElapsed(streaming);
  const steps = runs.map(toStep);
  const errors = steps.filter(s => s.state === 'error').length;
  const specialists = runs.filter(r => r.name === 'task').length;
  const hasReasoning = Boolean(thinkingText && thinkingText.trim().length > 0);

  if (steps.length === 0 && !streaming && !hasReasoning) {
    return null;
  }

  const summary = [
    hasReasoning ? 'reasoned' : null,
    `${steps.length} step${steps.length === 1 ? '' : 's'}`,
    specialists > 0 ? `${specialists} specialist${specialists === 1 ? '' : 's'}` : null,
    errors > 0 ? `${errors} error${errors === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ');

  // The header's live text: the current activity (or the last in-flight tool).
  // Shown ONLY here — never repeated in the panel — so there's one status line.
  const pending = runs.filter(r => r.state === 'pending');
  const livePending = pending.length > 0
    ? describeToolCall(pending[pending.length - 1]!.name, pending[pending.length - 1]!.input ?? {}, true).label
    : null;
  const headerLive = activity ?? livePending ?? 'Working…';
  const headerText = streaming ? headerLive : `Worked · ${summary}`;
  const hasDetail = steps.length > 0 || hasReasoning;

  return (
    <div className="my-2">
      <button
        type="button"
        onClick={() => hasDetail && setOpen(v => !v)}
        aria-expanded={open}
        disabled={!hasDetail}
        className="flex w-full items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-left text-xs text-muted-foreground transition enabled:hover:text-foreground"
      >
        {streaming
          ? <Loader2 className="size-3.5 shrink-0 animate-spin text-brand-amber-deep" aria-hidden />
          : <Brain className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden />}
        <span className="min-w-0 flex-1 truncate font-medium">{headerText}</span>
        {streaming && elapsed >= 3 && (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
            {elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`}
          </span>
        )}
        {hasDetail && (
          <ChevronDown className={`size-3.5 shrink-0 text-muted-foreground/70 transition ${open ? 'rotate-180' : ''}`} aria-hidden />
        )}
      </button>

      {open && hasDetail && (
        <>
          {/* Mobile: dim, tap-to-close backdrop. Desktop: none (inline panel). */}
          <button
            type="button"
            aria-label="Close details"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-black/40 sm:hidden"
          />
          <div className="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-border bg-background p-4 shadow-2xl sm:static sm:z-auto sm:mt-1 sm:max-h-none sm:rounded-lg sm:border sm:border-border/60 sm:bg-muted/20 sm:p-3 sm:shadow-none">
            <div className="mb-3 flex items-center justify-between sm:hidden">
              <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Chain of thought</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <ol className="space-y-2">
              {hasReasoning && (
                <li className="flex items-start gap-2 text-xs">
                  <Brain className="mt-0.5 size-3 shrink-0 text-brand-amber-deep" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => setReasoningOpen(v => !v)}
                      className="inline-flex items-center gap-1 font-medium text-foreground/85 transition hover:text-foreground"
                    >
                      Reasoning & data reviewed
                      {reasoningOpen
                        ? <ChevronDown className="size-3" aria-hidden />
                        : <ChevronRight className="size-3" aria-hidden />}
                    </button>
                    <span className={`mt-1.5 block break-words whitespace-pre-wrap rounded-md bg-muted/50 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground ${reasoningOpen ? 'max-h-72 overflow-y-auto' : 'line-clamp-3'}`}>
                      {thinkingText}
                    </span>
                  </span>
                </li>
              )}
              {steps.map((s, i) => (
                <li key={i} className="flex min-w-0 items-start gap-2 text-xs">
                  {s.state === 'pending'
                    ? <Loader2 className="mt-0.5 size-3 shrink-0 animate-spin text-brand-amber-deep" aria-hidden />
                    : s.state === 'error'
                      ? <CircleAlert className="mt-0.5 size-3 shrink-0 text-[var(--brand-fail)]" aria-hidden />
                      : <Check className="mt-0.5 size-3 shrink-0 text-[var(--brand-pass)]" aria-hidden />}
                  <span className="min-w-0 flex-1 break-words">
                    <span className={s.state === 'error' ? 'text-[var(--brand-fail)]' : 'text-foreground/85'}>{s.label}</span>
                    {s.detail && (
                      <span className="ml-1.5 text-muted-foreground">{s.detail}</span>
                    )}
                    {s.output && (
                      <span className="mt-0.5 line-clamp-2 block break-words text-[11px] text-muted-foreground/70">
                        →
                        {' '}
                        {s.output}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </div>
  );
}
