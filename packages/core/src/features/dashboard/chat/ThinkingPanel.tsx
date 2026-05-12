'use client';

import type { ThinkingStep } from './types';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

/**
 * Collapsible "Show thinking" panel (Phase C).
 *
 * Renders the chronological tool/subagent timeline from a completed
 * message. Default-collapsed; the streaming variant lives in a
 * separate component (`<LiveThinking />`, not yet extracted).
 */

export type ThinkingPanelProps = {
  steps: ThinkingStep[];
  seconds?: number;
};

export function ThinkingPanel({ steps, seconds }: ThinkingPanelProps) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) {
    return null;
  }
  return (
    <div className="mb-3" data-thinking-panel>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-brand-amber-deep"
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <span>
          {open ? 'Hide' : 'Show'}
          {' '}
          thinking
          {seconds !== undefined ? ` · ${seconds}s` : ''}
          {steps.length > 0 ? ` · ${steps.length} step${steps.length === 1 ? '' : 's'}` : ''}
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
