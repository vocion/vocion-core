'use client';

import type { RecommendedAction } from './types';
import { Check, Plug } from 'lucide-react';
import { describeLastAttempt } from '@/libs/connect/attemptWording';
import { Link } from '@/libs/I18nNavigation';

const PRIMARY_BUTTON = 'inline-flex items-center gap-1.5 rounded-lg bg-brand-amber-deep px-3.5 py-2 text-sm font-medium text-white transition hover:opacity-90';

/**
 * Whether a card is the connect card `offer_connection` emits (#1028). It is
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
 * The browser's own zone, so the last-attempt date reads in the person's time.
 */
function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * The connect card. Proposed: the main button starts the provider login (a
 * plain link, because the start route is an API redirect and not a page),
 * "Paste a token" sits beside it, and a failed last attempt is stated with
 * its date under the buttons. Decided: one line, no buttons.
 * @param props - The card and, for tests, the zone to format dates in.
 * @param props.rec - The card.
 * @param props.timeZone - IANA zone for the last-attempt date; the browser's by default.
 */
export function ConnectLinkCard({ rec, timeZone }: { rec: RecommendedAction; timeZone?: string }) {
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
          {rec.rationale && <p className="mt-0.5 text-xs break-words text-muted-foreground" data-testid="recommended-action-why">{rec.rationale}</p>}
          {rec.body && <p className="mt-0.5 text-xs break-words text-muted-foreground" data-testid="connect-card-body">{rec.body}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <a href={rec.href} data-testid="recommended-action-open" className={PRIMARY_BUTTON}>
          {failed ? 'Try again' : (rec.hrefLabel ?? 'Connect')}
        </a>
        {rec.secondaryHref && (
          <Link href={rec.secondaryHref} data-testid="recommended-action-secondary" className="text-sm font-medium text-brand-amber-deep hover:underline">
            {rec.secondaryHrefLabel ?? 'Other options'}
          </Link>
        )}
      </div>
      {failed && (
        <p className="text-xs text-muted-foreground" data-testid="connect-last-attempt">
          {describeLastAttempt(failed, timeZone ?? browserTimeZone())}
        </p>
      )}
    </div>
  );
}
