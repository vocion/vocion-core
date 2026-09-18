'use client';

import type { DashboardLinkKind } from './links';
import type { AgentRun, ChatMessage, ConversationAutonomy, IndexedDocument } from './types';
import { AlertCircle, ArrowUpRight, Bot, ClipboardCheck, FileText, Inbox, LayoutDashboard, MessageSquare, Newspaper, Rocket, Target, Users } from 'lucide-react';
import { memo, useState } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ConfidenceIndicator } from '@/components/ui/confidence-indicator';
import { normalizeAnswerHtml } from '@/libs/chat/answerText';
import { Link } from '@/libs/I18nNavigation';
import { AgentMark } from './AgentMark';
import { ArtifactChips } from './ArtifactChips';
import { liveWorkIndex, segmentTurn } from './interleave';
import { classifyDashboardLink } from './links';
import { MessageFeedback } from './MessageFeedback';
import { RecommendedActionStack } from './RecommendedActionStack';
import { formatElapsed, useElapsed } from './useElapsed';
import { WorkTimeline } from './WorkTimeline';

/** One glyph per dashboard entity family, so a chip reads before its label does. */
/** The abstract levels' words for the turn footer — the same words the composer's control shows; never a vendor or a model id. */
const LEVEL_WORDS = {
  strength: { fast: 'Fast', balanced: 'Balanced', deep: 'Deep' },
  thinking: { off: 'off', low: 'light', medium: 'standard', high: 'deep' },
} as const;

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
  /** Opens an artifact this turn produced in the pane beside the conversation. */
  onOpenArtifact?: (id: number) => void;
  /** The thread this turn belongs to — stamped into a failed step's Copy details. */
  conversationId?: number | null;
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

export const AgentMessage = memo(({ message, timestamp, agentName, onShowSources, onCitationClick, streaming = false, activity, onFeedback, autonomy = 'ask', via, onOpenArtifact, conversationId }: AgentMessageProps) => {
  const elapsed = useElapsed(streaming);
  const runs: AgentRun[] = message.runs
    ?? (message.content ? [{ type: 'text', text: message.content }] : []);
  const sourceCount = message.documents?.length ?? message.citationCount ?? 0;
  // A failure is a failure whether it arrived as a legacy run or as a typed
  // trace node — #368 persists the latter, and the badge has to find both.
  const erroredRun = runs.find(r => r.type === 'tool' && r.state === 'error');
  const erroredNode = (message.trace ?? []).find(n => n.status === 'error');
  const hasToolError = Boolean(erroredRun || erroredNode);
  // WHAT failed, not just THAT something did.
  //
  // The badge was a way in to the trace, which is right — but it opened the
  // trace at the failed step, and a failure that arrives as a typed trace node
  // has no row among the tool runs to open to. So a turn whose visible steps
  // all succeeded showed a red "Tool error" that led nowhere. Chris,
  // 2026-09-17: *"it shows a 'Tool error' with no diagnostic info."*
  //
  // The message now travels with the badge, so the diagnosis is one hover or
  // one click away and never depends on another component rendering a row.
  const toolErrorName = (erroredRun?.type === 'tool' ? erroredRun.name : undefined) ?? erroredNode?.label ?? 'A tool';
  const toolErrorDetail = ((erroredRun?.type === 'tool' ? erroredRun.output : undefined) ?? erroredNode?.detail ?? '')
    .toString()
    .replaceAll(/\s+/g, ' ')
    .trim();
  // Bumped by the badge; the work timeline opens to the failed step on change.
  const [inspect, setInspect] = useState(0);
  const [showError, setShowError] = useState(false);
  const [showModel, setShowModel] = useState(false);
  // The turn in the order it happened: passages of prose with the work that
  // fell between them rendered at that point, not hoisted to the top
  // (`interleave.ts`). A message with a typed trace renders the trace only —
  // the flat tool runs are the same steps without the attribution, and a
  // specialist's calls would otherwise show twice, once nested under the
  // delegation and once flat.
  const typed = (message.trace?.length ?? 0) > 0;
  const segments = segmentTurn(runs, message.trace).filter(seg => seg.kind === 'text' || !typed || seg.trace.length > 0);
  // Legacy reasoning text has no anchor; it belongs at the top like it always did.
  if (message.thinkingText && !segments.some(seg => seg.kind === 'work')) {
    segments.unshift({ kind: 'work', runs: [], trace: [], index: 0 });
  }
  const workIndexes = segments.filter(seg => seg.kind === 'work').map(seg => seg.index);
  const firstWork = workIndexes[0];
  const lastWork = workIndexes[workIndexes.length - 1];
  // Only the trailing group is still running; a group the agent has written
  // past is finished, and folds to its one line like Claude Code's tool blocks.
  const liveIndex = streaming ? liveWorkIndex(segments) : null;

  // A small brand mark carries the speaker (2026-09-18) — the uppercase name
  // on every turn was the same two words a hundred times; the surface's
  // header says it once. The name stays for a screen reader and on hover,
  // and a routed turn is still attributed ("via …", §9.10).
  return (
    <div className="group flex">
      {/* Width comes from the column in MessageList, not a second cap here. */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-[11px] tracking-wider text-muted-foreground uppercase">
          <AgentMark name={agentName} />
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
          {message.model && (
            // Which level answered, and how hard it thought — in the person's
            // words (fast / balanced / deep), never a vendor. The concrete id
            // is a detail they can open, not a label they have to read.
            <button
              type="button"
              data-testid="turn-model"
              onClick={() => setShowModel(v => !v)}
              aria-expanded={showModel}
              className="tracking-normal text-muted-foreground/70 normal-case transition hover:text-foreground"
              title={showModel ? 'Hide model details' : 'Show model details'}
            >
              {LEVEL_WORDS.strength[message.model.strength]}
              {message.model.thinking !== 'off' ? ` · thinking: ${LEVEL_WORDS.thinking[message.model.thinking]}` : ''}
            </button>
          )}
          {/* The badge is the way IN to the failure, not a label over it: it
              opens the trace at the failed step, which carries the message and
              a Copy details block (CEO, 2026-09-16). */}
          {hasToolError && (
            <button
              type="button"
              data-testid="tool-error-badge"
              onClick={() => {
                setInspect(n => n + 1);
                setShowError(v => !v);
              }}
              aria-expanded={showError}
              title={toolErrorDetail ? `${toolErrorName}: ${toolErrorDetail}` : undefined}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--brand-fail)]/30 bg-[var(--brand-fail-bg)]/40 px-2 py-0.5 text-[10px] tracking-normal text-[var(--brand-fail)] normal-case transition hover:bg-[var(--brand-fail-bg)]"
            >
              <AlertCircle className="size-2.5 shrink-0" aria-hidden />
              <span className="truncate">{toolErrorName === 'A tool' ? 'Tool error' : `${toolErrorName} failed`}</span>
            </button>
          )}
        </div>
        {message.model && showModel && (
          <div data-testid="turn-model-detail" className="mt-1 font-mono text-[11px] text-muted-foreground">
            {message.model.model}
            {' · '}
            {message.model.provider}
          </div>
        )}
        {hasToolError && showError && (
          <div
            data-testid="tool-error-detail"
            className="mt-2 rounded-md border border-[var(--brand-fail)]/30 bg-[var(--brand-fail-bg)]/30 px-3 py-2 text-[12px] text-foreground/90"
          >
            <div className="font-medium text-[var(--brand-fail)]">
              {toolErrorName}
              {' '}
              failed
            </div>
            <p className="mt-1 break-words whitespace-pre-wrap text-muted-foreground">
              {toolErrorDetail || 'The tool reported a failure but returned no message. The full step is in the activity trace above.'}
            </p>
          </div>
        )}
        <div className="mt-2 text-sm leading-relaxed">
          {segments.map(seg => (seg.kind === 'work'
            ? (
                <WorkTimeline
                  key={`work-${seg.index}`}
                  runs={seg.runs}
                  trace={seg.trace}
                  streaming={liveIndex === seg.index}
                  // The live indicator at the bottom of the turn names the
                  // activity; the group shows its rows, not a second headline.
                  liveHeadline={false}
                  activity={activity}
                  thinkingText={seg.index === firstWork ? message.thinkingText : undefined}
                  documents={seg.index === lastWork ? message.documents : undefined}
                  // The badge opens the group that holds the failure, not every group.
                  inspect={seg.trace.some(n => n.status === 'error') || seg.runs.some(r => r.state === 'error') ? inspect : 0}
                  failureContext={{ turnId: message.id ?? null, conversationId: conversationId ?? null, at: timestamp ?? null }}
                />
              )
            : (
                <div key={`text-${seg.index}`} className="prose prose-sm max-w-none dark:prose-invert">
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
                    {citeLinkify(normalizeAnswerHtml(seg.text))}
                  </Markdown>
                </div>
              )))}
          {/*
            The live indicator sits right under the prose while the turn runs
            — the shape OpenClaw and Claude Code both use. It used to be the
            LAST thing in the turn, under the suggested-action cards, which put
            it a screen away from the sentence that was still being written
            (Chris, 2026-09-17: *"put 'working' indicator above the action
            cards, closer to the text that's pending"*).

            Three things make it work, and the first version here had only one
            of them:

            1. It is ALWAYS present while streaming, not only once prose has
               started. During the tool phase the bottom of the transcript was
               still silent, which is the case Chris hit: the answer looked
               finished while five tool calls were still running.
            2. It carries the elapsed time, so a long pause reads as progress
               rather than as a hang. Same timer as the header, shared, so the
               two can never disagree.
            3. It names the current activity rather than only pulsing.

            The tool blocks interleave with the prose chronologically too now
            (`interleave.ts`) — each group of steps sits where it happened,
            and a group the agent has written past folds to one line.
          */}
          {streaming && (
            <div
              className="mt-3 flex items-center gap-2 text-[12px] text-muted-foreground"
              role="status"
              aria-live="polite"
              data-testid="streaming-indicator"
            >
              <span className="relative flex size-1.5 shrink-0" aria-hidden>
                <span className="absolute inline-flex size-full rounded-full bg-brand-amber opacity-60 motion-safe:animate-ping" />
                <span className="relative inline-flex size-1.5 rounded-full bg-brand-amber" />
              </span>
              <span>{activity ?? 'Working'}</span>
              {elapsed >= 3 && (
                <span className="font-mono text-[11px] text-muted-foreground/70 tabular-nums">{formatElapsed(elapsed)}</span>
              )}
            </div>
          )}
          {/* One card renders directly; several become the in-chat triage
              stepper (skip / save-for-later / queue-all). */}
          {(message.recommendations?.length ?? 0) > 0 && (
            <RecommendedActionStack recs={message.recommendations!} autoPropose={autonomy === 'act-within-bounds'} />
          )}
          {(message.artifacts?.length ?? 0) > 0 && (
            <ArtifactChips artifacts={message.artifacts!} onOpen={onOpenArtifact} />
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
