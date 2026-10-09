'use client';

import type { DashboardLinkKind } from './links';
import type { AgentRun, ChatMessage, ConversationAutonomy, IndexedDocument } from './types';
import type { FollowExclude, TurnToolStep } from '@/libs/chat/turnFollowups';
import type { TurnRecord } from '@/libs/factory/liveStatus';
import { AlertCircle, ArrowUpRight, Bot, ClipboardCheck, FileText, FolderOpen, Gauge, Inbox, LayoutDashboard, MessageSquare, Newspaper, Rocket, Target, Users } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AgentDot } from '@/components/ui/agent-dot';
import { ConfidenceIndicator } from '@/components/ui/confidence-indicator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { RecordMicrocard } from '@/features/dashboard/factory/WorkStatus';
import { openPreview } from '@/features/preview/previewState';
import { normalizeAnswerHtml, stripCardNotes } from '@/libs/chat/answerText';
import { failureHeadline, failureOneLiner } from '@/libs/chat/redact';
import { splitScratch } from '@/libs/chat/scratch';
import { turnFollowups } from '@/libs/chat/turnFollowups';
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
import { turnFailure } from './turnFailure';
import { useElapsed } from './useElapsed';
import { hasLiveDetail, LiveLine, WorkTimeline } from './WorkTimeline';

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
  onCitationClick?: (n: number, messageId?: number) => void;
  /** Optional handler when the "Sources · N" pill is clicked. Opens the SourcesPanel. */
  onShowSources?: (messageId?: number) => void;
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
  /** The specialist the turn is attributed to: its `AgentDot` sits before the "via" line. */
  viaAgent?: { name: string; accent: string | null };
  /** Opens an artifact this turn produced in the pane beside the conversation. */
  onOpenArtifact?: (id: number) => void;
  /** Build it on a card the turn drew (`ArtifactChips`). */
  onBuildCard?: (card: import('./types').ChatMessageArtifact) => void;
  /** The thread this turn belongs to — stamped into a failed step's Copy details. */
  conversationId?: number | null;
  /** The page's own record: never a follow chip (it refreshes itself). */
  pageRecord?: FollowExclude | null;
  /** The newest turn in the thread — the only one that carries record microcards. */
  latest?: boolean;
  /** The records the thread is about (`useThreadRecords`), drawn under the newest turn beside what it did itself. */
  threadRecords?: TurnRecord[];
};

/**
 * The answer's type: a reading measure, not a document. `prose-sm` alone set
 * an h2 at 20px/700 over 14px text, a near-black code block and backticks
 * around inline code — a turn with one heading in it read like a printed
 * report (Chris, 2026-10-08: "the chat interface could use a little more
 * lightness/polish"). Here the body is 15px on a 1.6 line, headings step down
 * to semibold body sizes with the space ABOVE them, lists sit close, and code
 * — inline or a block — is a soft neutral ground with a hairline, the way the
 * rest of the trace draws a payload (docs/design/patterns.md: "hairlines, not
 * boxes; space, not chrome").
 */
const PROSE = [
  'prose prose-sm prose-neutral dark:prose-invert max-w-none min-w-0 break-words wrap-anywhere',
  'text-[15px] leading-[1.6] text-foreground/90',
  'prose-p:my-3 prose-strong:font-semibold prose-strong:text-foreground',
  'prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-foreground prose-headings:mt-6 prose-headings:mb-2',
  'prose-h1:text-lg prose-h2:text-base prose-h3:text-[15px] prose-h4:text-[15px]',
  'prose-ul:my-3 prose-ol:my-3 prose-li:my-1 prose-li:marker:text-muted-foreground/60',
  'prose-code:rounded prose-code:bg-muted/70 prose-code:px-1 prose-code:py-px prose-code:text-[0.86em] prose-code:font-normal prose-code:before:content-none prose-code:after:content-none',
  'prose-pre:my-3 prose-pre:rounded-lg prose-pre:border prose-pre:border-border prose-pre:bg-surface-soft prose-pre:px-3.5 prose-pre:py-2.5 prose-pre:text-[12.5px] prose-pre:leading-relaxed prose-pre:text-foreground/85',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[1em] [&>:first-child]:mt-0 [&>:last-child]:mb-0',
  'prose-hr:my-6 prose-hr:border-border prose-table:text-[13px] prose-th:font-medium prose-blockquote:font-normal prose-blockquote:text-muted-foreground',
].join(' ');

/** How many microcards the newest turn carries at most. */
const MICROCARDS_SHOWN = 3;

/**
 * The newest turn's microcards: what it filed or changed itself, then what
 * the thread is about — one per record, less the page's own record, at most
 * {@link MICROCARDS_SHOWN}.
 * @param own - The turn's `turn_records`.
 * @param thread - The thread's records.
 * @param pageRecord - The page's own record, which shows itself.
 */
export function microcardsOf(own: readonly TurnRecord[], thread: readonly TurnRecord[], pageRecord?: FollowExclude | null): TurnRecord[] {
  const out: TurnRecord[] = [];
  for (const r of [...own, ...thread]) {
    const onPage = pageRecord?.type === 'object' && pageRecord.id === String(r.id);
    if (!onPage && !out.some(o => o.id === r.id)) {
      out.push(r);
    }
  }
  return out.slice(0, MICROCARDS_SHOWN);
}

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
  if (status === 'interrupted') {
    // Restarted under twice (backlog 056): the one re-run did not finish either.
    return 'The app restarted while answering, twice, so this answer did not finish. Ask again.';
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
  if (status === 'running') {
    // Being answered by the server now (backlog 056): a reload mid-turn shows
    // the turn, and the answer lands when it is done.
    return 'Still answering…';
  }
  return null;
}

export const AgentMessage = memo(({ message, timestamp, agentName, onShowSources, onCitationClick, streaming = false, activity, onFeedback, via, viaReason, viaAgent, onOpenArtifact, onBuildCard, conversationId, pageRecord, latest = false, threadRecords }: AgentMessageProps) => {
  const elapsed = useElapsed(streaming);
  const runs: AgentRun[] = message.runs
    ?? (message.content ? [{ type: 'text', text: message.content }] : []);
  const sourceCount = message.documents?.length ?? message.citationCount ?? 0;
  // THE MICROCARDS: one line per record the turn filed or changed, on the
  // newest turn only, less the page's own record (it shows itself). Each
  // replaces that record's plain follow chip — one shape per record.
  // The turn's own records come first (they carry what a change wrote), then
  // the thread's — one per record, at most three.
  const microcards = useMemo(() => (latest && !streaming ? microcardsOf(message.records ?? [], threadRecords ?? [], pageRecord) : []), [latest, streaming, message.records, threadRecords, pageRecord]);
  // What the turn set moving, less the page's own record, the artifacts the
  // row already shows and the records a microcard already draws.
  const follow = useMemo(() => turnFollowups(message.runs as TurnToolStep[] | undefined, {
    exclude: [...(pageRecord ? [pageRecord] : []), ...(message.artifacts ?? []).map(a => ({ type: 'artifact', id: String(a.id) })), ...microcards.map(r => ({ type: 'object', id: String(r.id) }))],
  }), [message.runs, message.artifacts, pageRecord, microcards]);
  // A failure is a failure whether it arrived as a legacy run or as a typed
  // trace node — #368 persists the latter, and the badge has to find both.
  // A step a later step of the same kind recovered from is not a failure of
  // the turn (`turnFailure.ts`): journey 4 showed "file_request failed" over
  // the request the retry filed.
  const failure = turnFailure(runs, message.trace ?? []);
  const erroredRun = failure.run;
  const erroredNode = failure.node;
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
  // What the reader sees is ONE line (`failureOneLiner`): never a stack trace,
  // a bundle path or a minified name. The raw message stays on the step, where
  // Copy details hands it to whoever debugs it.
  const toolErrorRaw = (erroredRun?.type === 'tool' ? erroredRun.output : undefined)
    ?? erroredNode?.resultDetail ?? erroredNode?.result ?? erroredNode?.detail ?? '';
  const toolErrorDetail = hasToolError ? failureOneLiner(String(toolErrorRaw)) : '';
  // "failed" said once: a failed step's label already carries it, and adding
  // our own read "— failed failed" (2026-10-08). A generic name is no name.
  const failureLabel = failureHeadline(toolErrorName);
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
  // ONE live line per turn (Chris, 2026-10-08: "while thinking we see double
  // status update lines … Can we combine that into 1 line?"). It rides the
  // newest group while that group is the last thing in the turn and has
  // something to open; otherwise — prose has started after it, or nothing
  // has happened yet — it sits at the bottom of the turn. Either way it is
  // there for the whole turn and carries the turn's clock.
  const liveSeg = segments.find(seg => seg.kind === 'work' && seg.index === liveIndex);
  const lineOnGroup = liveSeg?.kind === 'work'
    && hasLiveDetail({ runs: liveSeg.runs, trace: liveSeg.trace, thinkingText: liveSeg.index === firstWork ? message.thinkingText : undefined });
  // What the bottom line says when no step is running: the agent is writing
  // once its words are the newest thing in the turn, thinking before that.
  const bottomLine = activity ?? (segments[segments.length - 1]?.kind === 'text' ? 'Writing…' : 'Thinking…');

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
          {via && viaAgent && <AgentDot name={viaAgent.name} accent={viaAgent.accent} size="xs" decorative />}
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
          {timestamp && <span className="tracking-normal text-muted-foreground/60 normal-case tabular-nums">{formatTime(timestamp)}</span>}
          {sourceCount > 0 && (
            <button
              type="button"
              onClick={() => onShowSources?.(message.id)}
              data-testid="sources-chip"
              // A quiet control, not a pill: the count is the information, the
              // hover fill says it opens (hairlines, not boxes).
              className="-mx-0.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] tracking-normal text-muted-foreground normal-case transition hover:bg-surface-hover hover:text-foreground"
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
              title={toolErrorDetail || undefined}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--brand-fail)]/30 bg-[var(--brand-fail-bg)]/40 px-2 py-0.5 text-[10px] tracking-normal text-[var(--brand-fail)] normal-case transition hover:bg-[var(--brand-fail-bg)]"
            >
              <AlertCircle className="size-2.5 shrink-0" aria-hidden />
              <span className="truncate">{failureLabel}</span>
            </button>
          )}
          {!hasToolError && failure.retried && (
            <span data-testid="tool-retried-badge" className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[10px] tracking-normal text-muted-foreground normal-case">
              {failure.retried.filed ? 'retried · filed' : 'retried · done'}
            </span>
          )}
        </div>
        {hasToolError && showError && (
          <div
            data-testid="tool-error-detail"
            className="mt-2 rounded-md border border-[var(--brand-fail)]/30 bg-[var(--brand-fail-bg)]/30 px-3 py-2 text-[12px] text-foreground/90"
          >
            <div className="font-medium text-[var(--brand-fail)]">{failureLabel}</div>
            <p className="mt-1 break-words whitespace-pre-wrap text-muted-foreground">
              {toolErrorDetail}
            </p>
          </div>
        )}
        <div className="mt-2 text-sm leading-relaxed">
          {segments.map(seg => (seg.kind === 'work'
            ? (
                // The newest group with nothing to open yet draws nothing: the
                // bottom line is the turn's one line until it has.
                liveIndex === seg.index && !lineOnGroup
                  ? null
                  : (
                      <WorkTimeline
                        key={`work-${seg.index}`}
                        runs={seg.runs}
                        trace={seg.trace}
                        // The live group IS the turn's live line; every other
                        // group is folded to the quiet line of finished work.
                        streaming={liveIndex === seg.index}
                        activity={activity}
                        elapsed={elapsed}
                        thinkingText={seg.index === firstWork ? message.thinkingText : undefined}
                        documents={seg.index === lastWork ? message.documents : undefined}
                        // The badge opens the group that holds the failure, not every group.
                        inspect={seg.trace.some(n => n.status === 'error') || seg.runs.some(r => r.state === 'error') ? inspect : 0}
                        failureContext={{ turnId: message.id ?? null, conversationId: conversationId ?? null, at: timestamp ?? null }}
                      />
                    )
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
                    <div key={`text-${seg.index}-${i}`} className={PROSE}>
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
                                  onClick={() => onCitationClick?.(n, message.id)}
                                  // Neutral until pointed at, and `leading-none` so a
                                  // marker never opens a gap in the line above it.
                                  className="ml-0.5 inline-flex min-w-[1.1em] items-baseline justify-center rounded-sm bg-muted px-[0.3em] py-px align-super text-[10px] leading-none font-medium text-muted-foreground no-underline transition hover:bg-brand-amber/15 hover:text-brand-amber-deep"
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
                                  className="mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-background px-1.5 py-px align-baseline text-[13px] leading-snug font-medium text-foreground/85 no-underline transition hover:border-foreground/20 hover:text-foreground"
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
                        {citeLinkify(normalizeAnswerHtml(stripCardNotes(piece.text)))}
                      </Markdown>
                    </div>
                  )))))}
          {/*
            The live line sits right under the newest thing in the turn while
            it runs — the shape OpenClaw and Claude Code both use. It used to
            be the LAST thing in the turn, under the suggested-action cards,
            which put it a screen away from the sentence that was still being
            written (Chris, 2026-09-17: *"put 'working' indicator above the
            action cards, closer to the text that's pending"*).

            Four things make it work:

            1. It is ALWAYS present while streaming, not only once prose has
               started. During the tool phase the bottom of the transcript was
               still silent, which is the case Chris hit: the answer looked
               finished while five tool calls were still running.
            2. It carries the elapsed time, so a long pause reads as progress
               rather than as a hang — the turn's clock, wherever the line is.
            3. It names the current step rather than only pulsing.
            4. There is ONE. While the newest group of steps is the last thing
               in the turn, that group's line is it (`lineOnGroup`); this one
               only draws when prose came after the group, or before any step
               has anything to show. Two lines naming the same moment — the
               group's summary over a status line — was the bulk Chris saw.

            The tool blocks interleave with the prose chronologically too
            (`interleave.ts`) — each group of steps sits where it happened,
            and a group the agent has written past folds to one quiet line.
          */}
          {streaming && !lineOnGroup && (
            <div className="mt-2 min-w-0">
              <LiveLine text={bottomLine} elapsed={elapsed} />
            </div>
          )}
          {/* One card renders directly; several become the in-chat triage
              stepper (skip / save-for-later / queue-all). */}
          {(message.recommendations?.length ?? 0) > 0 && (
            <RecommendedActionStack recs={message.recommendations!} replyInProgress={streaming} />
          )}
          {/* What the turn made and what it set moving, in one row: the
              artifacts, then each run, record or ask its steps started,
              followed live (Chris, 2026-09-29). Not while it streams: a
              chip for a step still running would be a claim. */}
          {microcards.length > 0 && (
            <div className="-mx-2 mt-3 space-y-0.5" data-testid="turn-record-microcards">
              {microcards.map(r => <RecordMicrocard key={r.id} record={r} />)}
            </div>
          )}
          {((message.artifacts?.length ?? 0) > 0 || (!streaming && follow.length > 0)) && (
            <ArtifactChips artifacts={message.artifacts ?? []} follow={streaming ? [] : follow} onOpen={onOpenArtifact} onBuild={streaming ? undefined : onBuildCard} />
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
