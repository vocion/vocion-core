'use client';

import type { RecommendedAction } from './types';
import { Check, Plug } from 'lucide-react';
import { providerOfStartHref } from '@/libs/connect/returnTo';
import { Link } from '@/libs/I18nNavigation';
import { LastAttemptLine } from '../LastAttemptLine';
import { ProviderLoginButton } from '../ProviderLoginButton';

/**
 * Whether a card is the connect card `offer_connection` emits (#1080). It is
 * known by its kind, not by a missing action: other cards can also name a
 * page and no action, and must not turn into a login button.
 * @param rec - The card as the chat holds it.
 */
export function isConnectLinkCard(rec: RecommendedAction): boolean {
  return rec.kind === 'link' && Boolean(rec.href);
}

/**
 * "Connect GitHub" becomes "GitHub" for the done line.
 * @param label - The card's label.
 */
function connectedName(label: string): string {
  return label.replace(/^Connect\s+/i, '');
}

/**
 * The connect card. Proposed: the main button starts the provider login (a
 * plain link, because the start route is an API redirect and not a page),
 * "Paste a token" sits beside it, and a failed last attempt is stated with
 * its date under the buttons. Decided: one line, no buttons.
 *
 * While the reply that drew the card is still being written, the login button
 * waits. The card is saved with the reply, at its end, and a login that came
 * back before then could not find the card to mark it connected or to write
 * the failed attempt on it. "Paste a token" never touches the card, so it
 * stays live.
 * @param props - The card and, for tests, the zone to format dates in.
 * @param props.rec - The card.
 * @param props.replyInProgress - True while the reply holding the card is still streaming.
 * @param props.timeZone - IANA zone for the last-attempt date; the browser's by default.
 */
export function ConnectLinkCard({ rec, replyInProgress = false, timeZone }: { rec: RecommendedAction; replyInProgress?: boolean; timeZone?: string }) {
  if (rec.state === 'decided') {
    return (
      <div data-testid="recommended-action-card" data-run-status="done" className="mt-2.5 flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/5 px-3 py-2.5 text-sm font-semibold">
        <Check className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
        <span>{`Connected ${connectedName(rec.label)}`}</span>
      </div>
    );
  }
  const failed = rec.lastAttempt;
  return (
    <div data-testid="recommended-action-card" className="mt-2.5 flex flex-col gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-amber-tint text-brand-amber-deep">
          <Plug className="size-3.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold break-words">{rec.label}</div>
          {/* A login card is its title and its buttons; a paste card keeps the one line saying which key. */}
          {rec.body && <p className="mt-0.5 text-xs break-words text-muted-foreground" data-testid="connect-card-body">{rec.body}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <ProviderLoginButton
          provider={providerOfStartHref(rec.href)}
          href={rec.href}
          waitingTitle={replyInProgress ? 'Ready once the reply finishes' : undefined}
          testId="recommended-action-open"
        >
          {failed ? 'Try again' : (rec.hrefLabel ?? 'Connect')}
        </ProviderLoginButton>
        {rec.secondaryHref && (
          <Link href={rec.secondaryHref} data-testid="recommended-action-secondary" className="text-sm font-medium text-brand-amber-deep hover:underline">
            {rec.secondaryHrefLabel ?? 'Other options'}
          </Link>
        )}
      </div>
      {failed && <LastAttemptLine attempt={failed} timeZone={timeZone} />}
    </div>
  );
}
