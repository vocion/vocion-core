'use client';

import type { DashboardLinkKind } from './links';
import type { AgentRun, ChatMessage, ConversationAutonomy, IndexedDocument } from './types';
import { AlertCircle, ArrowUpRight, Bot, ClipboardCheck, FileText, FolderOpen, Gauge, Inbox, LayoutDashboard, MessageSquare, Newspaper, Rocket, Target, Users } from 'lucide-react';
import { memo, useState } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ConfidenceIndicator } from '@/components/ui/confidence-indicator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { openPreview } from '@/features/preview/previewState';
import { normalizeAnswerHtml } from '@/libs/chat/answerText';
import { splitScratch } from '@/libs/chat/scratch';
import { Link } from '@/libs/I18nNavigation';
import { isFailure } from '@/services/chat/turnStatus';
import { AgentMark } from './AgentMark';
import { ArtifactChips } from './ArtifactChips';
import { liveWorkIndex, segmentTurn } from './interleave';
import { classifyDashboardLink, previewRefFor } from './links';
import { MessageFeedback } from './MessageFeedback';
import { RecommendedActionStack } from './RecommendedActionStack';
import { ScratchFold } from './ScratchFold';
import { SelfUpdateChips } from './SelfUpdateChips';
import { useElapsed } from './useElapsed';
import { LiveStatus, WorkTimeline } from './WorkTimeline';

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
  'room': FolderOpen,
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
  /** Why the workspace routed the turn there, when it chose (`RoutingDecision.reason`) — shown on hover, so the attribution can be checked. */
  viaReason?: string;
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

/**
 * What to tell the person about how this turn ended, when it owes them a reason.
 *
 * Three endings do: the answer broke mid-sentence, the turn never got going,
 * or the workspace declined to run it. Each needs different words — "ask
 * again" is useless advice for a spent budget — and every other ending needs
 * no notice at all.
 * @param status - How the turn ended, as stored on the row (#114).
 * @param saidSomething - Whether the turn left any answer text on screen.
 * @returns The sentence to show, or null when this ending needs no notice.
 */
function turnEndingNotice(status: ChatMessage['status'], saidSomething: boolean): string | null {
  if (!isFailure(status)) {
    return null;
  }
  if (status === 'failed') {
    return 'This turn did not run, so there is no answer above. Ask again.';
  }
  if (status === 'refused') {
    // A turn refused partway (it reached its budget, #272) keeps what it said;
    // "was not run" under that text would contradict the screen.
    return saidSomething
      ? 'This answer stopped before it finished. Nothing is broken — something needs changing before this agent can go on.'
      : 'This turn was not run. Nothing is broken — something needs changing before this agent can answer.';
  }
  if (status === 'stalled') {
    // The work happened; the answer did not. Say both, because the steps
    // above are real and the person should not re-run them blind.
    return 'The work above ran, and this turn ended without saying what it found. Ask again — it does not need to start over.';
  }
  return 'This answer stopped partway through, so what you see above is unfinished. Ask again for a complete one.';
}

/**
 * The quiet line under an ending that is nobody's fault.
 *
 * These three did what was asked: the person stopped the turn, or a surface
 * split one answer across two messages. They need a marker so the short text
 * above is not read as the whole story — not a warning.
 * @param status - How the turn ended.
 * @returns The line to show, or null when this ending needs no marker.
 */
function turnEndingMarker(status: ChatMessage['status']): string | null {
  if (status === 'stopped') {
    return 'You stopped this answer.';
  }
  if (status === 'truncated') {
    return 'This answer was cut off at a time limit; the rest is in the next message.';
  }
  if (status === 'continued') {
    return 'This is the rest of the answer above.';
  }
  return null;
}

export const AgentMessage = memo(({ message, timestamp, agentName, onShowSources, onCitationClick, streaming = false, activity, onFeedback, autonomy = 'ask', via, viaReason, onOpenArtifact, conversationId }: AgentMessageProps) => {
  const elapsed = useElapsed(streaming);
  const runs: AgentRun[] = message.runs
    ?? (message.content ? [{ type: 'text', text: message.content }] : []);
  const sourceCount = message.documents?.length ?? message.citationCount ?? 0;
  // A failure is a failure whether it arrived as a legacy run or as a typed
  // trace node — #368 persists the latter, and the badge has to find both.
  const erroredRun = runs.find(r => r.type === 'tool' && r.state === 'error');
  const erroredNode = (message.trace ?? []).find(n => n.status === 'error');
  const hasToolError = Boolean(erroredRun || erroredNode);
  // How this turn ended, read once: an explanation when it owes one, a quiet
  // line when it does not, nothing at all when it simply finished (#114).
  const endingMarker = turnEndingMarker(message.status);
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
  // A GENERIC name is not a name. When the failure arrives with nothing but
  // "Error" on it — a provider that refused the whole turn, a missing key, a
  // network that went away — `${name} failed` renders as "error failed",
  // which is two words that say the same nothing twice.
  const namedFailure = !['a tool', 'error', 'failed', ''].includes(toolErrorName.trim().toLowerCase());
  const failureLabel = namedFailure ? `${toolErrorName} failed` : 'This turn failed';
  // Did the turn say ANYTHING? A tool that failed mid-answer leaves prose
  // around it and the badge is rightly a way in. A turn that failed outright
  // leaves an empty bubble, and then hiding the reason behind a tap means the
  // screen's whole content is a red chip reading "failed" — on a phone, with
  // no hover to fall back on. So the reason opens with it.
  const turnSaidSomething = Boolean(message.content?.trim()) || runs.some(r => r.type === 'text' && r.text?.trim());
  const endingNotice = turnEndingNotice(message.status, turnSaidSomething);
  // Bumped by the badge; the work timeline opens to the failed step on change.
  const [inspect, setInspect] = useState(0);
  const [showError, setShowError] = useState(hasToolError && !turnSaidSomething);
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
            viaReason
              ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span data-testid="via-eyebrow" className="tracking-normal text-muted-foreground/80 normal-case">{via}</span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="start" collisionPadding={8}>{viaReason}</TooltipContent>
                  </Tooltip>
                )
              : <span data-testid="via-eyebrow" className="tracking-normal text-muted-foreground/80 normal-case">{via}</span>
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
            // Which level answered — one quiet icon (Chris, 2026-09-18: "the
            // icon is enough … at most put it in a tooltip"). The words live in
            // the tooltip; never a vendor or a model id.
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  data-testid="turn-model"
                  aria-label={`Answered at ${LEVEL_WORDS.strength[message.model.strength]}`}
                  className="inline-flex items-center text-muted-foreground/60"
                >
                  <Gauge className="size-3" aria-hidden />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" collisionPadding={8}>
                {`${LEVEL_WORDS.strength[message.model.strength]}${message.model.thinking !== 'off' ? ` · thinking ${LEVEL_WORDS.thinking[message.model.thinking]}` : ''}`}
              </TooltipContent>
            </Tooltip>
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
              <span className="truncate">{failureLabel}</span>
            </button>
          )}
        </div>
        {hasToolError && showError && (
          <div
            data-testid="tool-error-detail"
            className="mt-2 rounded-md border border-[var(--brand-fail)]/30 bg-[var(--brand-fail-bg)]/30 px-3 py-2 text-[12px] text-foreground/90"
          >
            <div className="font-medium text-[var(--brand-fail)]">{failureLabel}</div>
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
            // A `<scratch>` block inside a stored text run is the model
            // thinking, folded (`ScratchFold`); the prose around it renders
            // as it always did. The live turn never carries one — the streamer
            // set it aside — so this is the reload path and the audit trail.
            : splitScratch(seg.text).map((piece, i) => (piece.kind === 'scratch'
                ? <ScratchFold key={`text-${seg.index}-${i}`} text={piece.text} />
                : (
                    // `break-words`: agent prose carries URLs, ids and inline
                    // code that are single unbreakable words — a 527px
                    // identifier was cut off both edges of a 390px phone
                    // (the owner's screenshot, 2026-09-19). Wrapping is the
                    // answer for prose; a genuinely wide block gets its own
                    // scroller instead (the `table` renderer below).
                    <div key={`text-${seg.index}-${i}`} className="prose prose-sm max-w-none min-w-0 break-words wrap-anywhere dark:prose-invert">
                      <Markdown
                        remarkPlugins={[remarkGfm]}
                        // Keep our private citation scheme; react-markdown's default
                        // sanitizer would strip `vocion-cite:` and drop the link.
                        urlTransform={url => (url.startsWith('vocion-cite:') ? url : defaultUrlTransform(url))}
                        components={{
                          // A table is the one thing in a turn that cannot
                          // wrap: its width is the sum of its columns, and a
                          // column holding an identifier has a min-content of
                          // its own. So it scrolls INSIDE its own box rather
                          // than pushing the transcript — the same rule the
                          // typography plugin already gives `pre`.
                          table({ children, ...props }) {
                            return (
                              <div className="max-w-full overflow-x-auto">
                                <table {...props}>{children}</table>
                              </div>
                            );
                          },
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
                                  // A room peeks on a plain click and navigates on ⌘-click,
                                  // the same rule as a list row (`usePreviewList`).
                                  onClick={(e) => {
                                    const peek = previewRefFor(inApp);
                                    if (peek && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
                                      e.preventDefault();
                                      openPreview(peek, e.currentTarget);
                                    }
                                  }}
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
                        {citeLinkify(normalizeAnswerHtml(piece.text))}
                      </Markdown>
                    </div>
                  )))))}
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
            <div className="mt-3 min-w-0" data-testid="streaming-indicator">
              <LiveStatus text={activity ?? 'Working…'} elapsed={elapsed} />
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
          {(message.selfUpdates?.length ?? 0) > 0 && (
            <SelfUpdateChips updates={message.selfUpdates!} />
          )}
        </div>
        {/* How the turn ended, when that is not "it finished" (#114). Three
            endings owe the person an explanation and get the notice below;
            `stopped` and `truncated` are ordinary and get a quiet line; a
            finished turn says nothing at all. A half-answer rendered like a
            whole one is worse than no answer, and a refusal rendered as a
            fault sends someone hunting a bug that is not there. */}
        {endingNotice && (
          <div
            data-testid="incomplete-turn-notice"
            role="status"
            data-ending={message.status}
            // A refusal is a setting to change, not a fault: amber, where a
            // turn that broke is red.
            className={message.status === 'refused'
              ? 'mt-2 flex items-start gap-1.5 rounded-md border border-[var(--brand-amber)]/40 bg-[var(--brand-amber-tint)]/40 px-3 py-2 text-[12px] text-foreground/90'
              : 'mt-2 flex items-start gap-1.5 rounded-md border border-[var(--brand-fail)]/30 bg-[var(--brand-fail-bg)]/30 px-3 py-2 text-[12px] text-foreground/90'}
          >
            <AlertCircle className={`mt-0.5 size-3 shrink-0 ${message.status === 'refused' ? 'text-[var(--brand-amber-deep)]' : 'text-[var(--brand-fail)]'}`} aria-hidden />
            <span>
              {endingNotice}
              {message.statusReason && (
                <span className="mt-1 block text-foreground/60">
                  {/* A refused turn was just told nothing is broken; calling the
                      reason "what went wrong" would take that back. */}
                  {message.status === 'refused' ? 'Why:' : 'What went wrong:'}
                  {' '}
                  {message.statusReason}
                </span>
              )}
            </span>
          </div>
        )}
        {endingMarker && (
          <div data-testid="turn-ending-marker" className="mt-2 text-[12px] text-foreground/55">
            {endingMarker}
          </div>
        )}
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
