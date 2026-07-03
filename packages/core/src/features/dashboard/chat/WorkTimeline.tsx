'use client';

import type { AgentRun } from './types';
import { Check, ChevronDown, ChevronRight, CircleAlert, Loader2 } from 'lucide-react';
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
      // prompt ("You are the Pipeline Analyst …") instead of "general-purpose".
      const desc = String(input.description ?? '');
      const m = desc.match(/[Yy]ou are (?:the )?([A-Z][a-z-]+(?: [A-Z][a-z-]+){0,3})/);
      const who = m?.[1]?.trim() ?? String(input.subagent_type ?? 'specialist');
      return { label: live ? `Delegating: ${who}…` : `Delegated: ${who}` };
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
  return s.length > 140 ? `${s.slice(0, 140)}…` : s;
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

export function WorkTimeline({ runs, streaming, activity }: WorkTimelineProps) {
  const [open, setOpen] = useState(false);
  const elapsed = useElapsed(streaming);
  const steps = runs.map(toStep);
  const errors = steps.filter(s => s.state === 'error').length;
  const specialists = runs.filter(r => r.name === 'task').length;
  const expanded = streaming || open;

  if (steps.length === 0 && !streaming) {
    return null;
  }

  const summary = [
    `${steps.length} step${steps.length === 1 ? '' : 's'}`,
    specialists > 0 ? `${specialists} specialist${specialists === 1 ? '' : 's'}` : null,
    errors > 0 ? `${errors} error${errors === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ');

  // While streaming, the header IS the live step: the current activity (or
  // the last in-flight tool), plus an elapsed ticker so long turns visibly
  // progress. "Working…" only as a last resort.
  const pending = runs.filter(r => r.state === 'pending');
  const livePending = pending.length > 0
    ? describeToolCall(pending[pending.length - 1]!.name, pending[pending.length - 1]!.input ?? {}, true).label
    : null;
  const headerLive = activity ?? livePending ?? 'Working…';

  return (
    <div className="my-2 rounded-lg border border-border/70 bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground transition hover:text-foreground"
      >
        {streaming
          ? <Loader2 className="size-3.5 animate-spin text-brand-amber-deep" aria-hidden />
          : expanded
            ? <ChevronDown className="size-3.5" aria-hidden />
            : <ChevronRight className="size-3.5" aria-hidden />}
        <span className="min-w-0 flex-1 truncate font-medium">
          {streaming ? headerLive : `Worked · ${summary}`}
        </span>
        {streaming && elapsed >= 3 && (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
            {elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`}
          </span>
        )}
      </button>

      {expanded && (
        <ol className="space-y-1 border-t border-border/60 px-3 py-2">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2 text-xs">
              {s.state === 'pending'
                ? <Loader2 className="mt-0.5 size-3 shrink-0 animate-spin text-brand-amber-deep" aria-hidden />
                : s.state === 'error'
                  ? <CircleAlert className="mt-0.5 size-3 shrink-0 text-[var(--brand-fail)]" aria-hidden />
                  : <Check className="mt-0.5 size-3 shrink-0 text-[var(--brand-pass)]" aria-hidden />}
              <span className="min-w-0">
                <span className={s.state === 'error' ? 'text-[var(--brand-fail)]' : 'text-foreground/85'}>{s.label}</span>
                {s.detail && (
                  <span className="ml-1.5 text-muted-foreground">{s.detail}</span>
                )}
                {s.output && (
                  <span className="block truncate text-[11px] text-muted-foreground/70">
                    →
                    {' '}
                    {s.output}
                  </span>
                )}
              </span>
            </li>
          ))}
          {streaming && activity && (
            <li className="flex items-start gap-2 text-xs">
              <span className="relative mt-1 flex size-2 shrink-0">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-amber-deep/60" />
                <span className="relative inline-flex size-2 rounded-full bg-brand-amber-deep" />
              </span>
              <span className="text-muted-foreground">{activity}</span>
            </li>
          )}
        </ol>
      )}
    </div>
  );
}
