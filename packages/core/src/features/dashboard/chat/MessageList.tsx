'use client';

import type { ChatMessage } from './types';
import { useCallback, useEffect, useRef } from 'react';
import { AgentMessage } from './AgentMessage';
import { UserMessage } from './UserMessage';

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
};

/** How close to the bottom (px) still counts as "pinned". */
const PIN_THRESHOLD = 48;

export function MessageList({ messages, agentName, streaming = false, activity, onShowSources, onCitationClick, blocks = [] }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Whether the view should follow the stream. A ref (not state): scroll
  // position changes must never themselves cause a re-render.
  const pinnedRef = useRef(true);

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
    <div ref={containerRef} onScroll={handleScroll} className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-4 pt-16 pb-6 sm:px-6">
      <div className="mx-auto w-full max-w-4xl space-y-8">
        {blocksAfter(-1)}
        {messages.map((msg, i) => (
          <div key={i} className="space-y-8">
            {msg.role === 'user'
              ? <UserMessage content={msg.content} />
              : (
                  <AgentMessage
                    message={msg}
                    agentName={agentName}
                    streaming={streaming && i === lastIdx}
                    activity={i === lastIdx ? activity : undefined}
                    onShowSources={onShowSources}
                    onCitationClick={onCitationClick}
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
