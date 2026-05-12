'use client';

import type { ThinkingStep } from './types';
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { useState } from 'react';

/**
 * "Thinking" panel — N.4 polish.
 *
 * Was: default-collapsed chevron with muted micro-text. Discoverability
 * was bad — users never opened it.
 *
 * Now: a compact 2-line summary visible by default ("Searched 3 sources
 * · 2 operations · 4s") so the "this is an agent" affordance is above
 * the fold. Chevron expands to the full chronological timeline.
 */

export type ThinkingPanelProps = {
  steps: ThinkingStep[];
  seconds?: number;
};

function summarizeSteps(steps: ThinkingStep[]): string {
  const counts = { thinking: 0, search: 0, skill: 0 };
  let totalDocs = 0;
  for (const s of steps) {
    counts[s.type] += 1;
    if (s.documents) {
      totalDocs += s.documents.length;
    }
  }
  const parts: string[] = [];
  if (counts.search > 0) {
    parts.push(`Searched ${totalDocs || counts.search} ${totalDocs ? 'source' : 'time'}${(totalDocs || counts.search) === 1 ? '' : 's'}`);
  }
  if (counts.skill > 0) {
    parts.push(`${counts.skill} operation${counts.skill === 1 ? '' : 's'}`);
  }
  if (counts.thinking > 0 && parts.length === 0) {
    parts.push(`${counts.thinking} reasoning step${counts.thinking === 1 ? '' : 's'}`);
  }
  return parts.length > 0 ? parts.join(' · ') : `${steps.length} step${steps.length === 1 ? '' : 's'}`;
}

export function ThinkingPanel({ steps, seconds }: ThinkingPanelProps) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) {
    return null;
  }
  const summary = summarizeSteps(steps);
  return (
    <div className="mb-3" data-thinking-panel>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-md border border-border bg-background/50 px-2.5 py-1.5 text-xs text-foreground/80 transition hover:border-primary/30"
        aria-expanded={open}
      >
        <Sparkles className="size-3.5 text-[var(--brand-amber-deep)]" aria-hidden />
        <span>
          {summary}
          {seconds !== undefined ? ` · ${seconds}s` : ''}
        </span>
        <span className="text-muted-foreground">
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </span>
      </button>
      {open && (
        <div className="mt-2 ml-1 space-y-3 border-l-2 border-border/50 pl-4" data-thinking-steps>
          {steps.map((step, i) => (
            <div key={i} className="text-xs">
              <div className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                {step.type === 'thinking' ? 'Reasoning' : step.type === 'search' ? 'Search' : 'Operation'}
                {step.skillSlug ? ` · ${step.skillSlug}` : ''}
              </div>
              <div className="mt-1 text-muted-foreground">{step.content}</div>
              {step.queries && step.queries.length > 0 && (
                <div className="mt-1 text-muted-foreground/80">
                  Queries:
                  {' '}
                  {step.queries.join(' · ')}
                </div>
              )}
              {step.documents && step.documents.length > 0 && (
                <div className="mt-1 text-muted-foreground/80">
                  {step.documents.length}
                  {' '}
                  result
                  {step.documents.length === 1 ? '' : 's'}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
