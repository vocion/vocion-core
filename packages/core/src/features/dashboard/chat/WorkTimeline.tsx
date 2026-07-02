'use client';

import type { AgentRun } from './types';
import { Check, ChevronDown, ChevronRight, CircleAlert, Loader2 } from 'lucide-react';
import { useState } from 'react';

/**
 * WorkTimeline — the chain-of-thought surface.
 *
 * One consolidated, collapsible block per agent message showing the team's
 * work as legible steps — "Delegated: Pipeline Analyst", "Searched sources
 * ('open deals…')", "Proposed CRM update (0.88 confidence)" — instead of
 * scattered raw tool breadcrumbs with kwargs dumps.
 *
 *   - streaming: expanded, live statuses (spinner on the active step) and the
 *     current activity line as the last row.
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
  state: 'pending' | 'done' | 'error';
};

/** Turn a raw tool run into a human-legible step. */
function toStep(run: Extract<AgentRun, { type: 'tool' }>): Step {
  const input = run.input ?? {};
  const state = run.state ?? 'done';

  switch (run.name) {
    case 'task': {
      // deepagents subagent dispatch — recover the specialist's name from its
      // prompt ("You are the Pipeline Analyst …") instead of "general-purpose".
      const desc = String(input.description ?? '');
      const m = desc.match(/[Yy]ou are (?:the )?([A-Z][a-z-]+(?: [A-Z][a-z-]+){0,3})/);
      const who = m?.[1]?.trim() ?? String(input.subagent_type ?? 'specialist');
      return { label: `Delegated: ${who}`, detail: undefined, state };
    }
    case 'search_knowledge': {
      const q = String(input.query ?? '');
      return { label: 'Searched sources', detail: q ? `“${q.slice(0, 90)}”` : undefined, state };
    }
    case 'propose_action': {
      const actionId = String(input.action_id ?? 'action');
      const conf = typeof input.confidence === 'number' ? ` · ${Math.round((input.confidence as number) * 100)}% confidence` : '';
      return { label: `Proposed: ${actionId}${conf}`, detail: 'queued for your approval', state };
    }
    case 'create_artifact':
      return { label: 'Created artifact', detail: String(input.kind ?? ''), state };
    case 'request_human_review':
      return { label: 'Requested approval', state };
    case 'run_operation':
      return { label: `Ran skill: ${String(input.operation ?? input.slug ?? '')}`, state };
    case 'web_search':
      return { label: 'Searched the web', detail: String(input.query ?? '').slice(0, 90), state };
    case 'error':
      return { label: 'Error', detail: String(run.output ?? '').slice(0, 160), state: 'error' };
    default:
      return { label: run.name.replace(/[-_]/g, ' '), state };
  }
}

export function WorkTimeline({ runs, streaming, activity }: WorkTimelineProps) {
  const [open, setOpen] = useState(false);
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
        <span className="font-medium">
          {streaming ? 'Working…' : `Worked · ${summary}`}
        </span>
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
