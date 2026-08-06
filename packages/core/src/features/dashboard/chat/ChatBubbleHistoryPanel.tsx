'use client';

import { useEffect, useState } from 'react';
import { client } from '@/libs/Orpc';

export type ChatBubbleHistoryPanelProps = {
  agentSlug: string;
  activeConversationId: number | null;
  onSelect: (conversationId: number) => void;
};

type ConversationSummary = {
  id: number;
  title: string;
  messageCount: number;
  updatedAt: Date | string;
};

/** Dropdown listing recent conversations for the active agent — title, relative date, message count. */
export function ChatBubbleHistoryPanel({ agentSlug, activeConversationId, onSelect }: ChatBubbleHistoryPanelProps) {
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setConversations(null);
    client.conversations.list({ agentSlug }).then((rows) => {
      if (!cancelled) {
        setConversations(rows);
      }
    }).catch(() => {
      if (!cancelled) {
        setConversations([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [agentSlug]);

  return (
    <div className="absolute inset-x-0 top-full z-10 max-h-72 overflow-y-auto border-b border-border bg-background shadow-lg">
      {conversations === null && (
        <p className="px-4 py-3 text-xs text-muted-foreground">Loading…</p>
      )}
      {conversations !== null && conversations.length === 0 && (
        <p className="px-4 py-3 text-xs text-muted-foreground">No conversations yet.</p>
      )}
      {conversations?.map(c => (
        <button
          key={c.id}
          type="button"
          onClick={() => onSelect(c.id)}
          className={`flex w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left text-sm transition hover:bg-muted/60 ${c.id === activeConversationId ? 'bg-muted/40' : ''}`}
        >
          <span className="w-full truncate">{c.title}</span>
          <span className="text-[11px] text-muted-foreground">
            {formatRelativeTime(new Date(c.updatedAt))}
            {' · '}
            {c.messageCount}
            {' '}
            {c.messageCount === 1 ? 'msg' : 'msgs'}
          </span>
        </button>
      ))}
    </div>
  );
}

function formatRelativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) {
    return 'just now';
  }
  if (min < 60) {
    return `${min}m ago`;
  }
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    return `${hr}h ago`;
  }
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
