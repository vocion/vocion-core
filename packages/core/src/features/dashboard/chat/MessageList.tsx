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
};

/** How close to the bottom (px) still counts as "pinned". */
const PIN_THRESHOLD = 48;

export function MessageList({ messages, agentName, streaming = false, activity }: MessageListProps) {
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

  // A new message was added (the user just sent) — re-pin and jump down.
  useEffect(() => {
    pinnedRef.current = true;
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

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
  return (
    <div ref={containerRef} onScroll={handleScroll} className="flex flex-1 flex-col gap-8 overflow-y-auto px-6 py-6">
      <div className="mx-auto w-full max-w-4xl space-y-8">
        {messages.map((msg, i) => msg.role === 'user'
          ? <UserMessage key={i} content={msg.content} />
          : (
              <AgentMessage
                key={i}
                message={msg}
                agentName={agentName}
                streaming={streaming && i === lastIdx}
                activity={i === lastIdx ? activity : undefined}
              />
            ))}
      </div>
    </div>
  );
}
