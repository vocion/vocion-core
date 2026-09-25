'use client';

import type { ChatMessage, ConversationAutonomy } from './types';
import { Quote } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef } from 'react';
import { AgentMessage } from './AgentMessage';
import { SelectionToolbar } from './SelectionToolbar';
import { UserMessage } from './UserMessage';
import { useSelectionReply } from './useSelectionReply';

/**
 * Message list (Phase C).
 *
 * Pure renderer over an array of `ChatMessage` values. Renders each
 * via `<UserMessage />` or `<AgentMessage />`. Slide-up animation
 * handled by parent via Tailwind utilities (the message components
 * themselves are unstyled at the wrapper level).
 *
 * Scrolling is STICK-TO-BOTTOM: while the user is at (or near) the
 * bottom, streaming updates keep the newest content in view with an
 * instant scroll — no per-token smooth animations fighting each other.
 * The moment the user scrolls up to read, auto-scroll disengages and
 * the stream stops moving the page; sending a new message re-pins.
 */

export type MessageListProps = {
  messages: ChatMessage[];
  /** Speaker label rendered above each agent message. Passed through to AgentMessage. */
  agentName: string;
  /** Provided when streaming so the latest message scrolls into view. */
  streaming?: boolean;
  /** Live status line while streaming — rendered in the last agent message's work timeline. */
  activity?: string | null;
  /** Opens the Sources drawer when a message's "Sources · N" pill is clicked. */
  onShowSources?: () => void;
  /** Opens the Sources drawer focused on citation `[n]` when an inline marker is tapped. */
  onCitationClick?: (n: number) => void;
  /**
   * Non-message content that lives in the transcript at a position (058):
   * the dock's guided review cards. `afterIndex` is the message the block
   * follows; -1 puts it before the first message. Blocks scroll with the
   * conversation and re-pin the view when they move, like a new message.
   */
  blocks?: Array<{ key: string; afterIndex: number; node: React.ReactNode }>;
  /** Persists a thumb + note on an assistant turn (0094). */
  onFeedback?: (messageId: number, rating: 'up' | 'down' | null, note?: string | null) => void | Promise<void>;
  /** How recommended actions in this thread behave (0094). */
  autonomy?: ConversationAutonomy;
  /** Opens an artifact a turn produced in the pane beside the conversation (0101). */
  onOpenArtifact?: (id: number) => void;
  /** The thread — stamped into a failed step's Copy details block. */
  conversationId?: number | null;
};

/** How close to the bottom (px) still counts as "pinned". */
const PIN_THRESHOLD = 48;

export function MessageList({ messages, agentName, streaming = false, activity, onShowSources, onCitationClick, blocks = [], onFeedback, autonomy, onOpenArtifact, conversationId }: MessageListProps) {
  const t = useTranslations('Chat');
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Whether the view should follow the stream. A ref (not state): scroll
  // position changes must never themselves cause a re-render.
  const pinnedRef = useRef(true);
  // Highlight a passage → "Reply" quotes it on the next turn (`useSelectionReply`).
  const selection = useSelectionReply(containerRef);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD;
  }, []);

  // A new message was added (the user just sent), or a block moved — re-pin
  // and jump down.
  const blocksKey = blocks.map(b => `${b.key}@${b.afterIndex}`).join('|');
  useEffect(() => {
    pinnedRef.current = true;
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, blocksKey]);

  // Streaming content grew — follow it only while pinned. Instant, not
  // `smooth`: overlapping smooth animations are what made streaming look
  // choppy, and an instant scroll on already-visible growth is invisible.
  useEffect(() => {
    if (!pinnedRef.current) {
      return;
    }
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, streaming, activity]);

  const lastIdx = messages.length - 1;
  const blocksAfter = (i: number) => blocks.filter(b => b.afterIndex === i || (i === lastIdx && b.afterIndex > lastIdx)).map(b => <div key={b.key}>{b.node}</div>);
  return (
    <div ref={containerRef} onScroll={handleScroll} className="relative flex min-h-0 flex-1 flex-col gap-8 overflow-x-clip overflow-y-auto px-4 pt-16 pb-6 sm:px-6">
      {selection.hit && (
        <SelectionToolbar
          x={selection.hit.x}
          y={selection.hit.y}
          width={selection.hit.width}
          actions={[{ label: 'Reply', icon: Quote, onClick: selection.reply }]}
          testId="transcript"
        />
      )}
      {/*
        One column edge. This container, the agent's prose and the composer
        used to cap at three different widths (4xl / 2xl / 3xl), so a reply
        stopped 224px short of the input box below it inside a container wider
        than both — which read as a ragged left gutter rather than a column.
        They are all 3xl now. The cap itself stays: a centred, measured reading
        column is the point, and the width freed up goes to the sources rail,
        which is the panel that actually needed it.
      */}
      {/* `min-w-0`: `max-w-3xl` is the reading MEASURE, i.e. a ceiling. Without
          it the column's min-content is that same 768px, and a grid or flex
          parent sized off min-content hands the transcript 768px on a 390px
          phone. */}
      <div className="mx-auto w-full max-w-3xl min-w-0 space-y-8">
        {blocksAfter(-1)}
        {messages.map((msg, i) => (
          <div key={i} className="space-y-8">
            {msg.role === 'user'
              ? <UserMessage content={msg.content} attachments={msg.attachments} />
              : (
                  <AgentMessage
                    message={msg}
                    agentName={agentName}
                    // A routed turn (`@agent`, `/search`, a delegation) is
                    // attributed, never re-identified: "via <specialist>" (§9.10).
                    via={msg.agentName && msg.agentName !== agentName ? t('via', { name: msg.agentName }) : undefined}
                    viaReason={msg.routing?.reason}
                    streaming={streaming && i === lastIdx}
                    activity={i === lastIdx ? activity : undefined}
                    onShowSources={onShowSources}
                    onCitationClick={onCitationClick}
                    onFeedback={onFeedback}
                    autonomy={autonomy}
                    onOpenArtifact={onOpenArtifact}
                    conversationId={conversationId}
                  />
                )}
            {blocksAfter(i)}
          </div>
        ))}
        {messages.length === 0 && blocks.filter(b => b.afterIndex > -1).map(b => <div key={b.key}>{b.node}</div>)}
      </div>
    </div>
  );
}
