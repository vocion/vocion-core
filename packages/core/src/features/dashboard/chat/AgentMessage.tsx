'use client';

import type { AgentRun, ChatMessage, OnyxDocument } from './types';
import { AlertCircle, FileText, Sparkles } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ConfidenceIndicator } from '@/components/ui/confidence-indicator';
import { ToolBreadcrumb } from './ToolBreadcrumb';

/**
 * Agent message (Phase C).
 *
 * Renders the assistant's reply as a sequence of `AgentRun` items:
 *   - text  → Markdown (react-markdown + remark-gfm)
 *   - tool  → `<ToolBreadcrumb />` (inline rev-ai-style breadcrumb)
 *
 * Falls back to plain `content` when no `runs` array is present
 * (older persisted messages from before Phase 5).
 *
 * Citation rendering, document preview clicks, and skill-result
 * cards (EmailDraftCard / ProposalCard) are not handled here yet —
 * they'll wire in via the parent `<ChatShell />` so this component
 * stays a dumb renderer.
 */

export type AgentMessageProps = {
  message: ChatMessage;
  timestamp?: number;
  onDocumentClick?: (doc: OnyxDocument, num: string) => void;
  onCitationClick?: (n: number) => void;
  /** Optional handler when the "Sources · N" pill is clicked. Opens the SourcesPanel. */
  onShowSources?: () => void;
};

function formatTime(ts: number | undefined): string {
  if (!ts) {
    return '';
  }
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function AgentMessage({ message, timestamp, onShowSources }: AgentMessageProps) {
  const runs: AgentRun[] = message.runs
    ?? (message.content ? [{ type: 'text', text: message.content }] : []);
  const sourceCount = message.documents?.length ?? message.citationCount ?? 0;
  const hasToolError = runs.some(r => r.type === 'tool' && r.state === 'error');

  return (
    <div className="flex gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-amber-tint text-brand-amber-deep">
        <Sparkles className="size-4" aria-hidden="true" />
      </div>
      <div className="max-w-2xl min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-[11px] tracking-wider text-muted-foreground uppercase">
          <span>Sales Assistant</span>
          {timestamp && <span className="tracking-normal normal-case">{formatTime(timestamp)}</span>}
          {sourceCount > 0 && (
            <button
              type="button"
              onClick={onShowSources}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] tracking-normal normal-case text-foreground/80 transition hover:border-primary/30 hover:text-foreground"
            >
              <FileText className="size-2.5" aria-hidden />
              Sources · {sourceCount}
            </button>
          )}
          {hasToolError && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--brand-fail)]/30 bg-[var(--brand-fail-bg)]/40 px-2 py-0.5 text-[10px] tracking-normal normal-case text-[var(--brand-fail)]">
              <AlertCircle className="size-2.5" aria-hidden />
              Tool error
            </span>
          )}
        </div>
        <div className="mt-2 text-sm leading-relaxed">
          {runs.map((run, i) => {
            if (run.type === 'text') {
              return (
                <div key={i} className="prose prose-sm max-w-none dark:prose-invert">
                  <Markdown remarkPlugins={[remarkGfm]}>{run.text}</Markdown>
                </div>
              );
            }
            // N.4: full first 2 input args legible (2-line clamp in the
            // breadcrumb component); output preview truncated to ~80 chars.
            const inputPreview = run.input
              ? Object.entries(run.input)
                  .slice(0, 2)
                  .map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v}"` : JSON.stringify(v)}`)
                  .join(', ')
              : undefined;
            const outputPreview = run.output
              ? (run.output.length > 80 ? `${run.output.slice(0, 80)}…` : run.output)
              : undefined;
            return (
              <ToolBreadcrumb
                key={i}
                name={run.name}
                state={run.state ?? 'done'}
                inputPreview={inputPreview}
                outputPreview={outputPreview}
              />
            );
          })}
        </div>
        {message.confidence && (
          <div className="mt-2 flex justify-end">
            <ConfidenceIndicator level={message.confidence} />
          </div>
        )}
      </div>
    </div>
  );
}
