'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useOrgBrand } from '@/features/branding/BrandContext';
import { VOCION_PRIMARY_MARK } from '@/templates/VocionLogo';
import { greetingFor, isReturning, LAST_SEEN_KEY } from './emptyChat';

/**
 * Empty state: a mark and one warm line, and nothing else.
 *
 * "Chat should always start with a much warmer intro with very little on the
 * chat screen. Not jump right to big asks. Maybe a soft nudge or chip. If
 * that." (founder, 2026-10-08), with the Claude iOS app's empty chat as the
 * reference: one small mark centred, one short personal line in a serif
 * face, the composer at the bottom, whitespace everywhere else.
 *
 * So: the Org's own mark (Vocion's when it has none), and ONE line varied by
 * the time and by whether the person is coming back ("Good evening, Sam.",
 * "Welcome back, Sam."). No heading naming the workspace, no starter chips,
 * no cards, no lists. The one thing that may join it is a soft nudge the
 * surface passes in, only when something is actually waiting, tucked at the
 * bottom by the composer rather than in the centre (`emptyChat.ts`).
 *
 * The same on a phone and a desktop. The pane scrolls on its own if a very
 * short screen cannot hold it, and there the mark steps aside.
 */

const DEFAULT_MARK = process.env.NEXT_PUBLIC_BRAND_MARK || VOCION_PRIMARY_MARK;

export type EmptyStateProps = {
  /** The person's first name, for the line. Null or omitted greets without a name. */
  firstName?: string | null;
  /** The one soft nudge by the composer (what waits on the person), when there is one. */
  nudge?: ReactNode;
  /** The hour the line is for (0–23). Default: the person's clock now. */
  hour?: number;
  /** Whether the person is coming back after a while. Default: read from this browser. */
  returning?: boolean;
  /** The one line, when the surface has its own (a new workspace's lead saying hello). Default: the time-and-return greeting. */
  line?: string;
};

function readReturning(): boolean {
  try {
    const last = Number(globalThis.localStorage?.getItem(LAST_SEEN_KEY) ?? '');
    return isReturning(Number.isFinite(last) && last > 0 ? last : null, Date.now());
  } catch {
    return false;
  }
}

/**
 * The mark and the line.
 * @param props - See {@link EmptyStateProps}.
 * @param props.firstName - The person's first name.
 * @param props.nudge - The one soft nudge, when something waits.
 * @param props.hour - The hour the line is for.
 * @param props.returning - Whether the person is coming back after a while.
 * @param props.line - The one line, when the surface has its own.
 */
export function EmptyState({ firstName, nudge, hour, returning, line: ownLine }: EmptyStateProps) {
  const t = useTranslations('Chat');
  const brand = useOrgBrand();
  // Read once, before this visit is written, so a return reads as one.
  const [cameBack] = useState(() => returning ?? readReturning());
  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(LAST_SEEN_KEY, String(Date.now()));
    } catch {
      // Blocked storage: every visit greets by the time of day, which is fine.
    }
  }, []);
  const line = ownLine ?? greetingFor({ hour: hour ?? new Date().getHours(), returning: cameBack, firstName }, (key, values) => t(key, values));
  const markLight = brand?.mark.light ?? DEFAULT_MARK;
  const markDark = brand?.mark.light ? brand.mark.dark : undefined;

  return (
    <div data-testid="chat-empty-state" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 sm:px-6">
      <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
        {/* eslint-disable-next-line next/no-img-element */}
        <img src={markLight} alt="" aria-hidden data-testid="chat-empty-mark" className={`size-9 select-none [@media(max-height:480px)]:hidden ${markDark ? 'dark:hidden' : ''}`} draggable={false} />
        {markDark && (
          // eslint-disable-next-line next/no-img-element
          <img src={markDark} alt="" aria-hidden className="hidden size-9 select-none dark:block [@media(max-height:480px)]:hidden" draggable={false} />
        )}
        {/* The time and the return are the person's clock and browser, which the server does not know. */}
        <h2
          className="mt-4 text-[1.75rem] leading-tight font-normal tracking-tight text-foreground/90 sm:text-[2rem]"
          style={{ fontFamily: 'var(--font-source-serif-4), Georgia, "Times New Roman", serif' }}
          data-testid="chat-greeting"
          suppressHydrationWarning
        >
          {line}
        </h2>
      </div>
      {nudge && <div className="flex shrink-0 justify-center pb-3">{nudge}</div>}
    </div>
  );
}
