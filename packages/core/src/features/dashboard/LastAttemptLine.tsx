'use client';

import { describeLastAttempt } from '@/libs/connect/attemptWording';

/** A failed connect attempt as the browser receives it: an ISO time and its worded reason. */
export type FailedAttempt = { at: string; summary: string };

/**
 * The browser's own zone, so the attempt's date reads in the person's time.
 */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * "Last attempt Oct 1, 4:12 PM: GitHub denied access". The chat card and the
 * Connectors page both show it, so a failed login reads the same in both places.
 * The date is always there: a bare time of day is how a stale failure gets read as today's.
 * @param props - The attempt and, for tests, the zone to format in.
 * @param props.attempt - The failed attempt.
 * @param props.timeZone - IANA zone; the browser's by default.
 */
export function LastAttemptLine({ attempt, timeZone }: { attempt: FailedAttempt; timeZone?: string }) {
  return (
    <p className="text-xs text-muted-foreground" data-testid="connect-last-attempt">
      {describeLastAttempt(attempt, timeZone ?? browserTimeZone())}
    </p>
  );
}
