'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The invite link, and copying it — one implementation for the two places an
 * admin takes a link away: the invite dialog, right after creating one, and
 * an invite's row on the People lane, any time after.
 *
 * No email is sent; the link IS the invite. `/sign-up?invite=<token>` is the
 * page that reads it (`app/[locale]/(auth)/(center)/sign-up`).
 */

/**
 * The URL an invitee opens.
 * @param token - The invite's token.
 * @param origin - Where this deployment is served; the page's own by default.
 */
export function inviteUrl(token: string, origin: string = window.location.origin): string {
  return `${origin}/sign-up?invite=${token}`;
}

/**
 * Copy an invite's link, and say so for a moment afterwards.
 *
 * A refused clipboard (denied permission, an insecure origin) leaves `copied`
 * false: nothing was copied, so nothing may claim otherwise.
 * @returns `[copied, copy]` — `copied` is true for two seconds after a copy.
 */
export function useCopyInviteLink(): [boolean, (token: string) => Promise<void>] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
  }, []);

  const copy = useCallback(async (token: string) => {
    try {
      await navigator.clipboard.writeText(inviteUrl(token));
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => setCopied(false), 2000);
  }, []);

  return [copied, copy];
}
