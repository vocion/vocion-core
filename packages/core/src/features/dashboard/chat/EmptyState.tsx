'use client';

import type { ReactNode } from 'react';
import type { TeamMember } from './emptyChat';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { greetingFor, isReturning, LAST_SEEN_KEY } from './emptyChat';
import { TeamCluster } from './TeamCluster';

/**
 * Empty state: the team and one warm line, and nothing else.
 *
 * "Chat should always start with a much warmer intro with very little on the
 * chat screen. Not jump right to big asks. Maybe a soft nudge or chip. If
 * that." (founder, 2026-10-08), with the Claude iOS app's empty chat as the
 * reference: one small mark centred, one short personal line in a serif
 * face, the composer at the bottom, whitespace everywhere else.
 *
 * So: the workspace's team at the centre (`TeamCluster`; nothing when there is
 * no agent — the chat body never shows a brand logo), and one or two short lines in Vocion's own
 * display face, varied by the time and by a return ("Welcome back, Sam." /
 * "Northwind's team is on it."). No heading naming the workspace, no starter chips,
 * no cards, no lists. The one thing that may join it is a soft nudge the
 * surface passes in, only when something is actually waiting, tucked at the
 * bottom by the composer rather than in the centre (`emptyChat.ts`).
 *
 * The same on a phone and a desktop. The pane scrolls on its own if a very
 * short screen cannot hold it.
 */

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
  /** The workspace's agents, lead first: the centre of the screen. Empty or omitted, the greeting stands alone. */
  team?: readonly TeamMember[];
  /** A second short line under the greeting ("Northwind's team is on it."). */
  secondLine?: string | null;
};

/**
 * Vocion's own display face: the Org's heading face when its brand names one,
 * else Outfit, the face vocion.ai's headings use. Never a serif (founder,
 * 2026-10-09: the serif "looks too much like Claude").
 */
const DISPLAY_FACE = 'var(--org-font-heading, var(--font-outfit, var(--font-sans)))';

function readReturning(): boolean {
  try {
    const last = Number(globalThis.localStorage?.getItem(LAST_SEEN_KEY) ?? '');
    return isReturning(Number.isFinite(last) && last > 0 ? last : null, Date.now());
  } catch {
    return false;
  }
}

/**
 * The team and the line.
 * @param props - See {@link EmptyStateProps}.
 * @param props.firstName - The person's first name.
 * @param props.nudge - The one soft nudge, when something waits.
 * @param props.hour - The hour the line is for.
 * @param props.returning - Whether the person is coming back after a while.
 * @param props.line - The one line, when the surface has its own.
 * @param props.team - The workspace's agents, lead first.
 * @param props.secondLine - A second short line under the greeting.
 */
export function EmptyState({ firstName, nudge, hour, returning, line: ownLine, team = [], secondLine }: EmptyStateProps) {
  const t = useTranslations('Chat');
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

  return (
    <div data-testid="chat-empty-state" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 sm:px-6">
      <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
        {/* The team, when there is one; never a brand logo — the chat body
            shows no brand (one brand per region, `libs/branding/chrome.ts`). */}
        {team.length > 0 && <TeamCluster members={team} />}
        {/* The time and the return are the person's clock and browser, which the server does not know. */}
        <h2
          className="mt-5 max-w-md text-[1.6rem] leading-tight font-normal tracking-tight text-balance text-foreground sm:text-[1.85rem]"
          style={{ fontFamily: DISPLAY_FACE }}
          data-testid="chat-greeting"
          suppressHydrationWarning
        >
          {line}
        </h2>
        {secondLine && (
          <p className="mt-1.5 max-w-md text-[1.05rem] leading-snug text-balance text-muted-foreground" style={{ fontFamily: DISPLAY_FACE }} data-testid="chat-greeting-team">
            {secondLine}
          </p>
        )}
      </div>
      {nudge && <div className="flex shrink-0 justify-center pb-3">{nudge}</div>}
    </div>
  );
}
