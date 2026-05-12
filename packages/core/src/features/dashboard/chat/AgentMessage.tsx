'use client';

import type { AgentRun, ChatMessage, OnyxDocument } from './types';
import { Sparkles } from 'lucide-react';
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
};

function formatTime(ts: number | undefined): string {
  if (!ts) {
    return '';
  }
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function AgentMessage({ message, timestamp }: AgentMessageProps) {
  const runs: AgentRun[] = message.runs
    ?? (message.content ? [{ type: 'text', text: message.content }] : []);

  return (
    <div className="flex gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-amber-tint text-brand-amber-deep">
        <Sparkles className="size-4" aria-hidden="true" />
      </div>
      <div className="max-w-2xl min-w-0 flex-1">
        <div className="text-[11px] tracking-wider text-muted-foreground uppercase">
          Sales Assistant
          {timestamp ? <span className="ml-2 tracking-normal normal-case">{formatTime(timestamp)}</span> : null}
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
            const inputPreview = run.input
              ? Object.entries(run.input)
                  .slice(0, 1)
                  .map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v.slice(0, 40)}"` : JSON.stringify(v).slice(0, 40)}`)
                  .join(', ')
              : undefined;
            return (
              <ToolBreadcrumb
                key={i}
                name={run.name}
                state={run.state ?? 'done'}
                inputPreview={inputPreview}
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
