'use client';

import type { LeadDossier } from './LeadContext';
import type { ReviewCardRun } from '@/features/review/ReviewActionCard';
import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { StatusPill } from '@/components/ui/status-pill';
import { ReviewActionCard } from '@/features/review/ReviewActionCard';
import { Link } from '@/libs/I18nNavigation';
import { confidenceLevel } from './confidence';
import { entranceLabel, LANE_PILL, LeadContext, shortDate } from './LeadContext';

/**
 * The lead page body — one lead's whole record on its own URL. The header and
 * the research context (brief, reference articles, claims, missing,
 * confidence, timeline) are constant; only the top of the main column
 * changes. A lead with a pending personalization.enroll run leads with the
 * SAME decidable card the review queue shows, deciding the SAME run through
 * the shared decide path (the server resolves the run by the row's back-link,
 * under the same pending predicate the queue's feed applies). A lead with no
 * decision waiting leads with the outreach record: what was drafted, what was
 * decided, by whom.
 */

/** The full lead row, dates already ISO across the server/client boundary. */
export type LeadRow = LeadDossier & {
  contactRef: string;
  contactTitle: string | null;
  companyName: string | null;
  entranceSource: string | null;
  utmCampaign: string | null;
  engagementSent: number;
  engagementOpened: number;
  status: string;
  draftSequence: Array<{ step: number; day?: number; subject: string; body: string }>;
  recommendedSequence: { id: string; name: string; reason?: string } | null;
  reviewActionRunId: number | null;
  draftError: string | null;
  mqlAt: string | null;
  arrivedAt: string | null;
  briefedAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
};

/** What the server resolved the lead's back-linked run into. */
export type LeadRunState = {
  /** The pending run, card built — present exactly when a decision is waiting. */
  run: ReviewCardRun | null;
  /** Set when the run is pending but snoozed away — the date it returns. */
  snoozedUntil: string | null;
  /** True when the approved run failed in execution, so the lane never flipped. */
  runFailed: boolean;
};

/** Fixed locale + UTC so the server render and the client render agree. */
const FULL_DATE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

function fullDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : FULL_DATE.format(d);
}

/**
 * The unique URL sources across the claims — what the research actually read.
 * @param claims
 */
function referenceArticles(claims: LeadDossier['claims']): Array<{ href: string; label: string }> {
  const urls = [...new Set(claims.map(c => c.source).filter(s => /^https?:\/\//i.test(s)))];
  return urls.map((href) => {
    try {
      const u = new URL(href);
      const path = u.pathname === '/' ? '' : u.pathname;
      return { href, label: `${u.hostname.replace(/^www\./, '')}${path}` };
    } catch {
      return { href, label: href };
    }
  });
}

/**
 * What happened to this lead, as one line above the read-only sends.
 * @param lead
 * @param state
 */
function decisionLine(lead: LeadRow, state: LeadRunState): string | null {
  const by = lead.decidedBy ? ` by ${lead.decidedBy}` : '';
  const on = lead.decidedAt ? ` · ${fullDate(lead.decidedAt)}` : '';
  if (lead.status === 'handed_off') {
    const seq = lead.recommendedSequence ? ` in ${lead.recommendedSequence.name}` : '';
    return `Enrolled${seq}${by}${on}`;
  }
  if (lead.status === 'held') {
    return `Held${by}${on} · the decline reason is in the review history`;
  }
  if (lead.status === 'sent') {
    return `Sent${by ? ` · enrolled${by}` : ''}${on}`;
  }
  if (state.snoozedUntil) {
    return `Snoozed · the card returns ${fullDate(state.snoozedUntil)}`;
  }
  if (state.runFailed) {
    return 'The approved enrollment failed to execute · the error is in the review history';
  }
  return null;
}

const Timeline = ({ lead }: { lead: LeadRow }) => {
  const steps = [
    lead.arrivedAt && { label: 'Arrived', value: fullDate(lead.arrivedAt) },
    lead.mqlAt && { label: 'Became MQL', value: fullDate(lead.mqlAt) },
    lead.briefedAt && { label: 'Briefed', value: fullDate(lead.briefedAt) },
    lead.decidedAt && {
      label: 'Decided',
      value: `${fullDate(lead.decidedAt)}${lead.decidedBy ? ` · ${lead.decidedBy}` : ''}`,
    },
  ].filter(Boolean) as Array<{ label: string; value: string }>;
  if (steps.length === 0) {
    return null;
  }
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Timeline
      </h3>
      <ul className="flex flex-col gap-1.5">
        {steps.map(step => (
          <li key={step.label} className="flex gap-2">
            <span className="w-24 shrink-0 text-muted-foreground">{step.label}</span>
            <span>{step.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

/**
 * The presentational page, so stories and tests can put it in either state
 * directly.
 * @param props
 * @param props.lead
 * @param props.contactHref - HubSpot deep link, when the portal id resolves.
 * @param props.runState
 * @param props.onDecided
 */
export const LeadView = (props: {
  lead: LeadRow;
  contactHref: string | null;
  runState: LeadRunState;
  onDecided: () => void;
}) => {
  const { lead, runState } = props;
  const run = runState.run;
  const level = confidenceLevel(lead.confidence);
  const pill = LANE_PILL[lead.status] ?? { status: 'pending' as const, label: lead.status };
  const articles = referenceArticles(lead.claims);
  const line = decisionLine(lead, runState);

  const chips = [
    lead.entranceSource ? entranceLabel(lead.entranceSource) : null,
    lead.utmCampaign,
    lead.mqlAt ? `MQL ${shortDate(lead.mqlAt)}` : lead.arrivedAt ? `Arrived ${shortDate(lead.arrivedAt)}` : null,
    lead.engagementSent > 0 ? `${lead.engagementSent} sent` : null,
    lead.engagementOpened > 0 ? `${lead.engagementOpened} opened` : null,
    level ? `${level} ${lead.confidence?.toFixed(2)}` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="flex flex-col gap-6">
      <div className="border-b border-border pb-4">
        <Link
          href="/gtm/personalization"
          className="inline-flex items-center gap-1 text-[13px] text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Personalization
        </Link>
        <div className="mt-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold">{lead.contactName}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {[lead.contactTitle, lead.companyName].filter(Boolean).join(' · ')}
              {props.contactHref && (
                <>
                  {(lead.contactTitle || lead.companyName) && ' · '}
                  <a
                    href={props.contactHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    Open in HubSpot ↗
                  </a>
                </>
              )}
            </p>
            {chips.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {chips.map(chip => (
                  <span
                    key={chip}
                    className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            )}
          </div>
          <StatusPill status={pill.status} label={pill.label} size="sm" />
        </div>
      </div>

      {/* The decision zone — the card when a decision is waiting, the record
          of the one already made otherwise. */}
      {run
        ? (
            <div className="max-w-3xl">
              <ReviewActionCard run={run} onDecided={props.onDecided} />
            </div>
          )
        : (lead.draftSequence.length > 0 || line || lead.draftError) && (
            <div className="max-w-3xl rounded-md border border-border bg-muted/30 p-3">
              <div className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Outreach
                {lead.recommendedSequence ? ` · ${lead.recommendedSequence.name}` : lead.draftSequence.length > 0 ? ' · drafted' : ''}
              </div>
              {line && <p className="text-sm font-medium">{line}</p>}
              {lead.draftSequence.map(send => (
                <div key={send.step} className="border-t border-border/60 py-2 text-sm first:border-t-0">
                  <div className="font-semibold">
                    {send.day !== undefined ? `Day ${send.day}` : `Send ${send.step}`}
                    {' · '}
                    {send.subject}
                  </div>
                  <p className="mt-1 whitespace-pre-line text-muted-foreground">{send.body}</p>
                </div>
              ))}
              {lead.draftSequence.length === 0 && lead.draftError && (
                <p className="text-[13px] text-muted-foreground">
                  Drafting has not produced sends yet:
                  {' '}
                  {lead.draftError}
                </p>
              )}
            </div>
          )}

      <LeadContext
        row={lead}
        railTop={articles.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Reference articles
            </h3>
            <ul className="flex flex-col gap-1">
              {articles.map(article => (
                <li key={article.href} className="truncate">
                  <a
                    href={article.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    {article.label}
                    {' '}
                    ↗
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        railBottom={<Timeline lead={lead} />}
      />
    </div>
  );
};

/**
 * The live page: the server resolved the run; deciding refreshes the route so
 * the lane flip renders.
 * @param props
 * @param props.lead
 * @param props.contactHref - HubSpot deep link, when the portal id resolves.
 * @param props.runState
 */
export const LeadDetail = (props: {
  lead: LeadRow;
  contactHref: string | null;
  runState: LeadRunState;
}) => {
  const router = useRouter();
  return (
    <LeadView
      lead={props.lead}
      contactHref={props.contactHref}
      runState={props.runState}
      onDecided={() => router.refresh()}
    />
  );
};
