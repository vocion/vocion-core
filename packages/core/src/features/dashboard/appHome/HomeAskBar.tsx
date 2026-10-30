'use client';

import { ArrowUp } from 'lucide-react';
import { useState } from 'react';
import { useRouter } from '@/libs/I18nNavigation';
import { askHref } from '@/libs/workspace/appHomeLinks';
import { cn } from '@/utils/Helpers';

/**
 * The ask bar on an app's home: one line, "Ask the SEO team…". Sending opens
 * Chat with the words as the person's first message in a new conversation
 * (`?ask=`). The home is the app's own page, so the sidebar has already said
 * which app the person is in, and the turn routes to the app's lead (#1529,
 * `services/chat/appScope.ts`).
 * @param props
 * @param props.placeholder - "Ask the SEO team…".
 * @param props.sendLabel - The send button's name.
 * @param props.focusOnLoad - Take focus on an empty home, where it is the thing to do.
 */
export function HomeAskBar({ placeholder, sendLabel, focusOnLoad = false }: { placeholder: string; sendLabel: string; focusOnLoad?: boolean }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const ready = text.trim().length > 0 && !sending;
  return (
    <form
      data-testid="home-ask-bar"
      className="flex w-full items-center gap-2 rounded-2xl border border-border bg-background py-1.5 pr-1.5 pl-4 shadow-xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) {
          return;
        }
        setSending(true);
        router.push(askHref(text));
      }}
    >
      <input
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- an empty home has one thing to do; the bar is it
        autoFocus={focusOnLoad}
        className="min-h-10 min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-hidden placeholder:text-muted-foreground"
      />
      <button
        type="submit"
        aria-label={sendLabel}
        disabled={!ready}
        className={cn('grid size-9 shrink-0 place-items-center rounded-xl bg-action text-action-foreground transition-opacity', !ready && 'opacity-40')}
      >
        <ArrowUp className="size-4" aria-hidden />
      </button>
    </form>
  );
}
