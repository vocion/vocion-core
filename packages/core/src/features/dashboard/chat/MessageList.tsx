'use client';

import type { ChatMessage } from './types';
import { useEffect, useRef } from 'react';
import { AgentMessage } from './AgentMessage';
import { UserMessage } from './UserMessage';

/**
 * Message list (Phase C).
 *
 * Pure renderer over an array of `ChatMessage` values. Renders each
 * via `<UserMessage />` or `<AgentMessage />`. Auto-scrolls to the
 * bottom when the array grows. Slide-up animation handled by parent
 * via Tailwind utilities (the message components themselves are
 * unstyled at the wrapper level).
 */

export type MessageListProps = {
  messages: ChatMessage[];
  /** Provided when streaming so the latest message scrolls into view. */
  streaming?: boolean;
};

export function MessageList({ messages, streaming = false }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streaming]);

  return (
    <div className="flex flex-1 flex-col gap-8 overflow-y-auto px-6 py-6">
      <div className="mx-auto w-full max-w-4xl space-y-8">
        {messages.map((msg, i) => msg.role === 'user'
          ? <UserMessage key={i} content={msg.content} />
          : <AgentMessage key={i} message={msg} />)}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
