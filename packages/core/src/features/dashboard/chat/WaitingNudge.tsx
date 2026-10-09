'use client';

import { ArrowRight, X } from 'lucide-react';
import { SessionContext } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { use, useState } from 'react';
import { Link } from '@/libs/I18nNavigation';
import { firstNameOf, waitingNudgeCount } from './emptyChat';

/** Session-storage key: the person waved the nudge away in this browser session. */
const DISMISSED_KEY = 'vocion:waiting-nudge-dismissed';

function readDismissed(): boolean {
  try {
    return globalThis.sessionStorage?.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    globalThis.sessionStorage?.setItem(DISMISSED_KEY, '1');
  } catch {
    // Blocked storage: the chip comes back on the next empty chat, which is harmless.
  }
}

/**
 * What waits on the person, on an empty conversation: ONE soft chip, "3
 * things waiting on you →", that opens Review, and an × that puts it away
 * for this browser session. Never the cards themselves: those live on Review,
 * and in a conversation once the person is in one (`emptyChat.ts`).
 * @param props - The chip's inputs.
 * @param props.count - How many proposals, asks and approvals wait on the person.
 * @param props.href - Where the chip goes. Default: Review.
 */
export function WaitingNudge({ count, href = '/dashboard/inbox' }: { count: number; href?: string }) {
  const t = useTranslations('Chat');
  const [dismissed, setDismissed] = useState(readDismissed);
  const shown = waitingNudgeCount({ waiting: count, dismissed });
  if (shown === null) {
    return null;
  }
  return (
    <span data-testid="waiting-nudge" className="inline-flex max-w-full animate-in items-center rounded-full border border-border/70 bg-background text-[12.5px] text-muted-foreground fade-in">
      <Link href={href} className="inline-flex min-w-0 items-center gap-1.5 rounded-l-full py-1.5 pr-1 pl-3 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none">
        <span className="size-1.5 shrink-0 rounded-full bg-brand-amber" aria-hidden />
        <span className="truncate">{t('waiting_nudge', { count: shown })}</span>
        <ArrowRight className="size-3.5 shrink-0" aria-hidden />
      </Link>
      <button
        type="button"
        onClick={() => {
          writeDismissed();
          setDismissed(true);
        }}
        aria-label={t('waiting_nudge_dismiss')}
        data-testid="waiting-nudge-dismiss"
        className="mr-1 grid size-6 shrink-0 place-items-center rounded-full transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <X className="size-3" aria-hidden />
      </button>
    </span>
  );
}

/**
 * The signed-in person's first name, for a greeting; null outside a session
 * (a story, a test) or when the name is only an email address.
 */
export function usePersonFirstName(): string | null {
  // The context, not `useSession`: that throws outside a provider, and a
  // greeting without a name is a fine greeting.
  const session = use(SessionContext);
  return firstNameOf(session?.data?.user?.name);
}
