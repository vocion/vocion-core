'use client';

import { MessageSquare, Send } from 'lucide-react';
import { useState } from 'react';
import { useRouter } from '@/libs/I18nNavigation';

/** sessionStorage key ChatShell reads on mount to start a handoff chat. */
export const CHAT_HANDOFF_KEY = 'vocion_chat_handoff';

export type ChatHandoff = {
  question: string;
  contextTitle: string;
  context: string;
};

/**
 * Floating composer at the bottom of the Briefings page. Typing here moves
 * the conversation to /chat: the briefing rides along as context, a new
 * chat opens against the team lead, and the question is answered there.
 * @param props
 * @param props.briefingTitle
 * @param props.briefingContent
 */
export const BriefingChatStarter = (props: { briefingTitle: string; briefingContent: string }) => {
  const router = useRouter();
  const [value, setValue] = useState('');

  const start = () => {
    const question = value.trim();
    if (!question) {
      return;
    }
    const handoff: ChatHandoff = {
      question,
      contextTitle: props.briefingTitle,
      context: props.briefingContent,
    };
    sessionStorage.setItem(CHAT_HANDOFF_KEY, JSON.stringify(handoff));
    router.push('/dashboard/chat');
  };

  return (
    <div className="pointer-events-none sticky bottom-4 z-40 mt-6 flex justify-center">
      <div className="pointer-events-auto flex w-full max-w-2xl items-center gap-2 rounded-full border border-border bg-background px-4 py-2 shadow-lg">
        <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              start();
            }
          }}
          placeholder="Ask about this briefing — opens a chat with the team lead…"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onClick={start}
          disabled={!value.trim()}
          aria-label="Start chat"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
        >
          <Send className="size-4" />
        </button>
      </div>
    </div>
  );
};
