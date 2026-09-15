'use client';

import type { DashboardLinkKind } from './links';
import type { AgentRun, ChatMessage, ConversationAutonomy, IndexedDocument } from './types';
import { AlertCircle, ArrowUpRight, Bot, ClipboardCheck, FileText, Inbox, LayoutDashboard, MessageSquare, Newspaper, Rocket, Target, Users } from 'lucide-react';
import { memo } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ConfidenceIndicator } from '@/components/ui/confidence-indicator';
import { Link } from '@/libs/I18nNavigation';
import { classifyDashboardLink } from './links';
import { MessageFeedback } from './MessageFeedback';
import { RecommendedActionStack } from './RecommendedActionStack';
import { WorkTimeline } from './WorkTimeline';

/** One glyph per dashboard entity family, so a chip reads before its label does. */
const LINK_ICON: Record<DashboardLinkKind, typeof Bot> = {
  'agent': Bot,
  'team': Users,
  'mission': Target,
  'mission-run': Rocket,
  'ask': Inbox,
  'briefing': Newspaper,
  'object': LayoutDashboard,
  'review': ClipboardCheck,
  'learning': FileText,
  'eval': ClipboardCheck,
  'connector': LayoutDashboard,
  'workflow': Rocket,
  'team-report': Users,
  'chat': MessageSquare,
  'page': ArrowUpRight,
};

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
  /** Display name for the speaker label above the message body. Passed through from ChatShell's active agent. */
  agentName: string;
  onDocumentClick?: (doc: IndexedDocument, num: string) => void;
  onCitationClick?: (n: number) => void;
  /** Optional handler when the "Sources · N" pill is clicked. Opens the SourcesPanel. */
  onShowSources?: () => void;
  /** True while this message is still streaming — the work timeline stays expanded + live. */
  streaming?: boolean;
  /** Live status line while streaming (rendered inside the work timeline). */
  activity?: string | null;
  /** Persists a thumb + note on this turn (0094). Absent = no feedback control. */
  onFeedback?: (messageId: number, rating: 'up' | 'down' | null, note?: string | null) => void | Promise<void>;
  /** How recommended actions in this thread behave (0094). */
  autonomy?: ConversationAutonomy;
  /** Preformatted attribution for a routed turn ("via Proposal Writer") — the workspace stays the speaker (§9.10). */
  via?: string;
};

function formatTime(ts: number | undefined): string {
  if (!ts) {
    return '';
  }
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Memoized: during streaming only the LAST message's object identity
 * changes per flush (ChatShell's reducer replaces just that element),
 * so every completed message — including its markdown parse — skips
 * re-rendering entirely while tokens stream in below it.
 */
/**
 * Turn inline `[n]` citation markers the model emits into real markdown links
 * with a private scheme, so react-markdown's `a` renderer can make them
 * tappable superscripts. Skips `[n](…)` (already a link) and `[n]:` (link defs).
 * @param text
 */
function citeLinkify(text: string): string {
  return text.replace(/\[(\d{1,3})\](?!\(|:)/g, (_m, n: string) => `[${n}](vocion-cite:${n})`);
}

export const AgentMessage = memo(({ message, timestamp, agentName, onShowSources, onCitationClick, streaming = false, activity, onFeedback, autonomy = 'ask', via }: AgentMessageProps) => {
  const runs: AgentRun[] = message.runs
    ?? (message.content ? [{ type: 'text', text: message.content }] : []);
  const sourceCount = message.documents?.length ?? message.citationCount ?? 0;
  const hasToolError = runs.some(r => r.type === 'tool' && r.state === 'error');
  // One consolidated work timeline instead of breadcrumbs scattered through
  // the transcript; text runs render below it in order.
  const toolRuns = runs.filter((r): r is Extract<AgentRun, { type: 'tool' }> => r.type === 'tool');
  const textRuns = runs.filter((r): r is Extract<AgentRun, { type: 'text' }> => r.type === 'text');

  // No avatar glyph — the transcript is text-first (Claude-app pattern).
  // The small speaker label carries identity; with named humans and
  // multiple agents sharing a surface, the NAME is the signal, not a
  // decorative circle.
  return (
    <div className="group flex">
      <div className="max-w-2xl min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-[11px] tracking-wider text-muted-foreground uppercase">
          <span>{agentName}</span>
          {via && (
            <span data-testid="via-eyebrow" className="tracking-normal text-muted-foreground/80 normal-case">{via}</span>
          )}
          {timestamp && <span className="tracking-normal normal-case">{formatTime(timestamp)}</span>}
          {sourceCount > 0 && (
            <button
              type="button"
              onClick={onShowSources}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] tracking-normal text-foreground/80 normal-case transition hover:border-primary/30 hover:text-foreground"
            >
              <FileText className="size-2.5" aria-hidden />
              Sources ·
              {' '}
              {sourceCount}
            </button>
          )}
          {hasToolError && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--brand-fail)]/30 bg-[var(--brand-fail-bg)]/40 px-2 py-0.5 text-[10px] tracking-normal text-[var(--brand-fail)] normal-case">
              <AlertCircle className="size-2.5" aria-hidden />
              Tool error
            </span>
          )}
        </div>
        <div className="mt-2 text-sm leading-relaxed">
          {(toolRuns.length > 0 || streaming || message.thinkingText || (message.trace?.length ?? 0) > 0) && (
            <WorkTimeline runs={toolRuns} streaming={streaming} activity={activity} thinkingText={message.thinkingText} documents={message.documents} trace={message.trace} />
          )}
          {textRuns.map((run, i) => (
            <div key={i} className="prose prose-sm max-w-none dark:prose-invert">
              <Markdown
                remarkPlugins={[remarkGfm]}
                // Keep our private citation scheme; react-markdown's default
                // sanitizer would strip `vocion-cite:` and drop the link.
                urlTransform={url => (url.startsWith('vocion-cite:') ? url : defaultUrlTransform(url))}
                components={{
                  a({ href, children, ...props }) {
                    const m = typeof href === 'string' && href.startsWith('vocion-cite:') ? href.slice('vocion-cite:'.length) : null;
                    if (m !== null) {
                      const n = Number(m);
                      return (
                        <button
                          type="button"
                          onClick={() => onCitationClick?.(n)}
                          className="mx-0.5 inline-flex items-baseline rounded-sm bg-brand-amber/15 px-1 align-super text-[10px] font-semibold text-brand-amber-deep no-underline transition hover:bg-brand-amber/30"
                          aria-label={`Open source ${n}`}
                        >
                          {n}
                        </button>
                      );
                    }
                    // A same-origin dashboard route becomes a chip that
                    // navigates in place (§9); anything else stays an
                    // ordinary external link in a new tab.
                    const inApp = classifyDashboardLink(href, typeof window === 'undefined' ? undefined : window.location.origin);
                    if (inApp) {
                      const Icon = LINK_ICON[inApp.kind];
                      return (
                        <Link
                          href={inApp.href}
                          data-link-kind={inApp.kind}
                          className="mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 align-baseline text-[12px] font-medium text-foreground/85 no-underline transition hover:border-brand-amber/40 hover:text-foreground"
                        >
                          <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="truncate">{children}</span>
                        </Link>
                      );
                    }
                    return <a href={href} target="_blank" rel="noreferrer" {...props}>{children}</a>;
                  },
                }}
              >
                {citeLinkify(run.text)}
              </Markdown>
            </div>
          ))}
          {/* One card renders directly; several become the in-chat triage
              stepper (skip / save-for-later / queue-all). */}
          {(message.recommendations?.length ?? 0) > 0 && (
            <RecommendedActionStack recs={message.recommendations!} autoPropose={autonomy === 'act-within-bounds'} />
          )}
        </div>
        {message.confidence && (
          <div className="mt-2 flex justify-end">
            <ConfidenceIndicator level={message.confidence} />
          </div>
        )}
        {/* The thumb lives under the turn once the row is persisted (0094). */}
        {onFeedback && typeof message.id === 'number' && !streaming && (
          <MessageFeedback
            messageId={message.id}
            rating={message.feedback?.rating ?? null}
            note={message.feedback?.note ?? null}
            onFeedback={onFeedback}
          />
        )}
      </div>
    </div>
  );
});
