'use client';

import type { LeadDossier } from './LeadContext';
import type { ReviewCardRun } from '@/features/review/ReviewActionCard';
import type { ReviewContent } from '@/libs/actions/types';
import { AlarmClock, Check, Loader2, RefreshCw, TriangleAlert, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Accordion,
  ConfidenceMeter,
  DetailMeta,
  DetailPage,
  FactList,
  MetaChip,
  Section,
  StatusDot,
  StickyActionBar,
} from '@/components/patterns';
import { contentKindRenderer } from '@/features/review/contentKinds';
import { useReviewDecision } from '@/features/review/useReviewDecision';
import { cn } from '@/utils/Helpers';
import { confidenceLevel } from './confidence';
import { savedGuidedEdits } from './GuidedReview';
import { entranceLabel, HandoffBriefZone, LANE_PILL, LeadContext, shortDate } from './LeadContext';

/**
 * The lead page body — one lead's whole record on its own URL, on the Detail
 * archetype (`components/patterns`, `docs/design/patterns.md`): breadcrumb,
 * the lead as the H1, ONE meta row (system · lane · proposed by · confidence
 * · arrival · engagement · the CRM door), then hairline sections with the
 * evidence column beside them, and the decision in a sticky bar that never
 * scrolls away.
 *
 * A lead with a pending personalization.enroll run decides the SAME run the
 * review queue shows, through the SAME decide path (`useReviewDecision` —
 * the card's wiring as a hook; the server resolves the run by the row's
 * back-link, under the same pending predicate the queue's feed applies). A
 * lead with no decision waiting leads with the outreach record: what was
 * drafted, what was decided, by whom.
 *
 * The recommendation is stated once, in the "Recommended action" section;
 * the header no longer repeats the card's title above it.
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
  /** The call prep written when the lead left the agent; empty until a handoff (055). */
  handoffSections: Array<{ heading: string; body: string }>;
  handoffTrigger: string | null;
  handoffAt: string | null;
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

const LANE_TONE: Record<string, 'pass' | 'amber' | 'fail' | 'neutral'> = {
  pending: 'amber',
  approved: 'pass',
  paused: 'amber',
  completed: 'pass',
};

const SNOOZES = [
  { label: 'Tomorrow', days: 1 },
  { label: '3 days', days: 3 },
  { label: 'Next week', days: 7 },
];

// Inline fields: text until touched, a soft fill on hover/focus.
const INLINE_FIELD = 'w-full rounded-md bg-transparent px-2 py-1.5 text-sm transition outline-none hover:bg-surface-hover focus:bg-surface-soft disabled:opacity-60';

/**
 * A quiet, hairline notice — regenerating, stale, failed. Not a banner box.
 * @param props
 * @param props.tone
 * @param props.icon
 * @param props.children
 * @param props.testid
 */
const Notice = (props: { tone: 'amber' | 'red'; icon: React.ReactNode; children: React.ReactNode; testid: string }) => (
  <div
    data-testid={props.testid}
    className={cn('flex items-start gap-2.5 border-l-2 py-1 pl-3 text-sm', props.tone === 'red' ? 'border-brand-fail' : 'border-brand-borderline')}
  >
    <span className={cn('mt-0.5 shrink-0', props.tone === 'red' ? 'text-brand-fail' : 'text-brand-borderline')}>{props.icon}</span>
    <div className="min-w-0">{props.children}</div>
  </div>
);

/**
 * The Timeline section for the evidence column.
 * @param props
 * @param props.lead
 */
const Timeline = ({ lead }: { lead: LeadRow }) => {
  const facts = [
    lead.arrivedAt && { label: 'Arrived', value: fullDate(lead.arrivedAt) },
    lead.mqlAt && { label: 'Became MQL', value: fullDate(lead.mqlAt) },
    lead.briefedAt && { label: 'Briefed', value: fullDate(lead.briefedAt) },
    lead.decidedAt && {
      label: 'Decided',
      value: `${fullDate(lead.decidedAt)}${lead.decidedBy ? ` · ${lead.decidedBy}` : ''}`,
    },
  ];
  if (!facts.some(Boolean)) {
    return null;
  }
  return (
    <Section tone="quiet" eyebrow="Timeline">
      <FactList layout="column" facts={facts} />
    </Section>
  );
};

/**
 * The sends of a draft sequence — the record state, read-only.
 * @param props
 * @param props.sends
 */
const DraftSends = ({ sends }: { sends: LeadRow['draftSequence'] }) => {
  const [open, setOpen] = useState<string[]>(sends.length > 0 ? [String(sends[0]!.step)] : []);
  return (
    <Accordion
      items={sends.map(send => ({
        id: String(send.step),
        label: send.day !== undefined ? `Day ${send.day}` : `Send ${send.step}`,
        title: send.subject,
        children: <p className="text-sm leading-relaxed whitespace-pre-line text-foreground/80">{send.body}</p>,
      }))}
      open={open}
      onToggle={(id, on) => setOpen(o => (on ? [...o, id] : o.filter(x => x !== id)))}
    />
  );
};

/**
 * The frame every lead state shares: crumbs, H1, the meta row, the record.
 * `decision` sits above the brief in the content column; `bar` under the
 * columns. The decision surface and its bar are separate props because the
 * bar spans the page while the decision lives in a column.
 * @param props
 * @param props.lead
 * @param props.contactHref
 * @param props.run
 * @param props.decision
 * @param props.bar
 */
const LeadFrame = (props: {
  lead: LeadRow;
  contactHref: string | null;
  run: ReviewCardRun | null;
  decision: React.ReactNode;
  bar?: React.ReactNode;
}) => {
  const { lead, run } = props;
  const level = confidenceLevel(lead.confidence);
  const pill = LANE_PILL[lead.status] ?? { status: 'pending' as const, label: lead.status };
  const articles = referenceArticles(lead.claims);
  const subtitle = [lead.contactTitle, lead.companyName].filter(Boolean).join(' · ');

  return (
    <DetailPage
      data-testid="lead-page"
      crumbs={[
        { label: 'Workspace', href: '/dashboard' },
        { label: 'Personalization', href: '/gtm/personalization' },
        { label: lead.contactName },
      ]}
      title={lead.contactName}
      subtitle={subtitle || undefined}
      meta={(
        <DetailMeta
          items={[
            <MetaChip key="system">{run?.card.system ?? 'Personalization'}</MetaChip>,
            <StatusDot key="lane" tone={LANE_TONE[pill.status] ?? 'neutral'} label={run ? 'Ready for review' : pill.label} />,
            run?.invokedBy ? run.invokedBy.replace('agent:', 'proposed by ') : null,
            level && lead.confidence !== null
              ? (
                  <ConfidenceMeter
                    key="confidence"
                    value={lead.confidence}
                    label={level}
                    format="score"
                    rationale={run?.proposal?.rationale ?? 'How well the evidence supports this brief and its angle — the agent\'s own reading, not a prediction that the lead replies.'}
                  />
                )
              : null,
            lead.entranceSource ? entranceLabel(lead.entranceSource) : null,
            lead.utmCampaign ? `via ${lead.utmCampaign}` : null,
            lead.mqlAt ? `MQL ${shortDate(lead.mqlAt)}` : lead.arrivedAt ? `Arrived ${shortDate(lead.arrivedAt)}` : null,
            lead.engagementSent > 0 ? `${lead.engagementSent} sent` : null,
            lead.engagementOpened > 0 ? `${lead.engagementOpened} opened` : null,
            props.contactHref ? <MetaChip key="crm" href={props.contactHref}>Open in HubSpot ↗</MetaChip> : null,
          ]}
        />
      )}
      bar={props.bar}
    >
      <LeadContext
        row={lead}
        lead={props.decision}
        // Beneath the review brief: the call prep, once the lead has left the
        // agent. Read-only; no decision lives here (055).
        tail={<HandoffBriefZone sections={lead.handoffSections} trigger={lead.handoffTrigger} at={lead.handoffAt} />}
        railTimeline={<Timeline lead={lead} />}
        railArticles={articles.length > 0 && (
          <Section tone="quiet" eyebrow="Reference articles">
            <ul className="flex flex-col gap-1">
              {articles.map(article => (
                <li key={article.href} className="truncate">
                  <a
                    href={article.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-foreground"
                  >
                    {`${article.label} ↗`}
                  </a>
                </li>
              ))}
            </ul>
          </Section>
        )}
      />
    </DetailPage>
  );
};

/**
 * The record state: no decision waiting. The outreach section carries what
 * happened (the decision line) and the sends as read-only rows.
 * @param props
 * @param props.lead
 * @param props.contactHref
 * @param props.runState
 */
const LeadRecord = (props: { lead: LeadRow; contactHref: string | null; runState: LeadRunState }) => {
  const { lead, runState } = props;
  const line = decisionLine(lead, runState);
  const hasOutreach = lead.draftSequence.length > 0 || line || lead.draftError;
  const eyebrow = `Outreach${lead.recommendedSequence ? ` · ${lead.recommendedSequence.name}` : lead.draftSequence.length > 0 ? ' · drafted' : ''}`;
  return (
    <LeadFrame
      lead={lead}
      contactHref={props.contactHref}
      run={null}
      decision={hasOutreach && (
        <Section eyebrow={eyebrow} data-testid="outreach-record">
          {line && <p className="mb-2 text-sm font-medium">{line}</p>}
          {lead.draftSequence.length > 0 && <DraftSends sends={lead.draftSequence} />}
          {lead.draftSequence.length === 0 && lead.draftError && (
            <p className="text-[13px] text-muted-foreground">{`Drafting has not produced sends yet: ${lead.draftError}`}</p>
          )}
        </Section>
      )}
    />
  );
};

/**
 * The decision state: the pending enroll run, decided here through the
 * card's own path. The recommendation is one section; the sends are an
 * accordion, editable in place (your version is what runs) unless the
 * guided review beside the page owns the rewrite; the verbs are the sticky
 * bar, with the ONE feedback field collapsed under it.
 * @param props
 * @param props.lead
 * @param props.contactHref
 * @param props.run
 * @param props.onDecided
 * @param props.guided
 */
const LeadDecision = (props: {
  lead: LeadRow;
  contactHref: string | null;
  run: ReviewCardRun;
  onDecided: () => void;
  guided: boolean;
}) => {
  const { lead, run, guided } = props;
  const card = run.card;
  const d = useReviewDecision(run, {
    onDecided: props.onDecided,
    onRegenerated: props.onDecided,
    // A rewrite asked for in the conversation rides a decision taken here.
    extraContentEdits: guided ? () => savedGuidedEdits(run) : undefined,
  });
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const content = card.content ?? [];
  const emails = content.filter((c): c is Extract<ReviewContent, { kind: 'email' }> => c.kind === 'email');
  const [open, setOpen] = useState<string[]>(emails.length > 0 ? [emails[0]!.id] : []);
  const allOpen = emails.length > 0 && emails.every(e => open.includes(e.id));
  const ownPath = `/gtm/lead/${lead.contactRef.split(':')[1]}`;
  const links = (card.links ?? []).filter(l => !l.href.endsWith(ownPath));
  const approveLabel = card.verbs?.approve ?? 'Approve';

  return (
    <LeadFrame
      lead={lead}
      contactHref={props.contactHref}
      run={run}
      decision={(
        <div data-testid="review-action-card" className={cn(d.regenerating && 'opacity-90')}>
          {/* Regenerating — server truth: the surface stays mounted and held
              with the instruction visible, on every surface and across
              reloads. Past staleness the hold expires and the notice flips to
              a caution. */}
          {(d.regenerating || d.regenStale || d.execError) && (
            <div className="flex flex-col gap-2 py-4">
              {d.regenerating && (
                <Notice tone="amber" icon={<Loader2 className="size-4 animate-spin" aria-hidden />} testid="regenerating-banner">
                  <span className="font-medium">Regenerating…</span>
                  <span className="text-muted-foreground"> the page re-enables here when the new version lands.</span>
                  {d.regen?.note && <p className="mt-0.5 truncate text-[13px] text-muted-foreground" title={d.regen.note}>{`“${d.regen.note}”`}</p>}
                </Notice>
              )}
              {d.regenStale && (
                <Notice tone="amber" icon={<TriangleAlert className="size-4" aria-hidden />} testid="regenerating-stale-banner">
                  <p className="text-muted-foreground">This regeneration is taking longer than expected. The decision is open again; the regenerated version updates the page if it still arrives.</p>
                </Notice>
              )}
              {d.execError && (
                <Notice tone="red" icon={<TriangleAlert className="size-4" aria-hidden />} testid="execution-failed-banner">
                  <p className="font-medium text-brand-fail">The approval did not go through</p>
                  <p className="mt-0.5 text-[13px] break-words text-muted-foreground">{d.execError}</p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">{`Fix the cause if it names one, then ${approveLabel} again to retry.`}</p>
                </Notice>
              )}
            </div>
          )}

          {/* One statement of the recommendation. The header does not repeat it. */}
          {(card.recommendation || card.title) && (
            <Section
              eyebrow="Recommended action"
              data-testid="recommended-action"
              action={links.length > 0 && (
                <span className="flex flex-wrap gap-1">
                  {links.map(l => (
                    <a key={l.href} href={l.href} className="inline-flex h-8 items-center rounded-lg px-2 text-[13px] text-muted-foreground transition hover:bg-surface-hover hover:text-foreground">{l.label}</a>
                  ))}
                </span>
              )}
            >
              <p className="text-[15px] leading-snug font-semibold break-words">{card.recommendation?.headline ?? card.title}</p>
              {(card.recommendation?.detail ?? card.summary ?? run.proposal?.rationale) && (
                <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-foreground/80">{card.recommendation?.detail ?? card.summary ?? run.proposal?.rationale}</p>
              )}
              {card.nextAction && <p className="mt-1.5 text-sm font-medium">{card.nextAction}</p>}
            </Section>
          )}

          {/* The provenance the card carries, and its labeled rows, as facts. */}
          {((card.provenance?.length ?? 0) > 0 || card.fields.length > 0) && (
            <Section eyebrow="Prospect facts">
              <FactList facts={[...(card.provenance ?? []), ...card.fields].map(f => ({ label: f.label, value: f.value, href: 'href' in f && typeof f.href === 'string' ? f.href : undefined }))} />
            </Section>
          )}

          {/* The sends — what is being approved. Edit in place; your version
              is what runs. With the guided review beside the page, rewrites
              happen in the conversation and ride the decision from there. */}
          {content.length > 0 && (
            <Section
              eyebrow={card.contentHeading ? `${card.contentHeading.label}${card.contentHeading.meta ? ` · ${card.contentHeading.meta}` : ''}` : `Outreach · ${content.length} ${content.length === 1 ? 'send' : 'sends'}`}
              data-testid="outreach-sends"
              action={emails.length > 1 && (
                <button
                  type="button"
                  onClick={() => setOpen(allOpen ? [] : emails.map(e => e.id))}
                  className="inline-flex h-8 items-center rounded-lg px-2 text-[13px] text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
                >
                  {allOpen ? 'Collapse all' : guided ? 'Open all' : 'Edit all'}
                </button>
              )}
            >
              <Accordion
                open={open}
                onToggle={(id, on) => setOpen(o => (on ? [...o, id] : o.filter(x => x !== id)))}
                items={content.map((item, i) => {
                  if (item.kind !== 'email') {
                    const Renderer = contentKindRenderer(item.kind);
                    return { id: item.id, label: item.label, title: item.id, children: <Renderer item={item} position={i + 1} disabled={d.held} /> };
                  }
                  const edit = d.contentEdits[item.id];
                  const subject = edit?.subject ?? item.subject ?? '';
                  const body = edit?.body ?? item.body;
                  const edited = edit !== undefined && (edit.subject !== undefined || edit.body !== undefined);
                  return {
                    id: item.id,
                    label: item.label,
                    title: subject || body.split('\n')[0],
                    meta: edited ? 'edited' : undefined,
                    children: guided
                      ? (
                          <div className="flex flex-col gap-1.5">
                            {subject && <p className="text-sm font-medium">{subject}</p>}
                            <p className="text-sm leading-relaxed whitespace-pre-line text-foreground/80">{body}</p>
                          </div>
                        )
                      : (
                          <div className="flex flex-col gap-1">
                            <label className="block">
                              <span className="sr-only">Subject</span>
                              <input className={cn(INLINE_FIELD, 'font-medium')} value={subject} onChange={ev => d.editContent(item.id, { subject: ev.target.value })} disabled={d.held} aria-label={`${item.label} subject`} />
                            </label>
                            <label className="block">
                              <span className="sr-only">Body</span>
                              <textarea className={cn(INLINE_FIELD, 'min-h-28 resize-y leading-relaxed')} value={body} onChange={ev => d.editContent(item.id, { body: ev.target.value })} disabled={d.held} aria-label={`${item.label} body`} />
                            </label>
                          </div>
                        ),
                  };
                })}
              />
              {guided && <p className="mt-2 text-[12px] text-muted-foreground">To change a send, ask for the rewrite in the conversation beside this page; it rides your decision here.</p>}
            </Section>
          )}

          {/* Property updates (cards with no typed content): editable in place. */}
          {d.hasProperties && (
            <Section eyebrow="The changes — edit in place; your version is what runs">
              <div className="flex flex-col gap-1">
                {Object.entries(d.propertyEdits).map(([k, v]) => (
                  <label key={k} className="flex gap-4 text-sm">
                    <span className="w-32 shrink-0 pt-1.5 text-[12px] text-muted-foreground">{k}</span>
                    {k === 'notes'
                      ? <textarea className={cn(INLINE_FIELD, 'min-h-24 resize-y leading-relaxed')} value={v} onChange={ev => d.editProperty(k, ev.target.value)} disabled={d.held} />
                      : <input className={INLINE_FIELD} value={v} onChange={ev => d.editProperty(k, ev.target.value)} disabled={d.held} />}
                  </label>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}
      bar={(
        // No page-gutter bleed here: a conversation rail sits beside this
        // page, and the bar must end where the column does.
        <StickyActionBar
          className="mx-0 px-0 sm:mx-0 sm:px-0"
          primary={{
            'label': d.execError ? `Retry ${approveLabel}` : approveLabel,
            'onClick': () => void d.decide('approve'),
            'disabled': d.held,
            'busy': d.busy,
            'icon': Check,
            'data-testid': 'decide-approve',
          }}
          secondary={[
            { label: 'Snooze', onClick: () => setSnoozeOpen(o => !o), disabled: d.held, icon: AlarmClock },
            { 'label': card.verbs?.reject ?? 'Reject', 'onClick': () => void d.decide('reject'), 'disabled': d.held, 'icon': X, 'tone': 'danger', 'data-testid': 'decide-reject' },
          ]}
          aside={snoozeOpen && (
            <span className="inline-flex items-center gap-1 text-[13px] text-muted-foreground" data-testid="snooze-picker">
              <span className="px-1">Until</span>
              {SNOOZES.map(s => (
                <button key={s.days} type="button" onClick={() => void d.snooze(s.days)} disabled={d.held} className="h-8 rounded-lg px-2 text-[13px] text-foreground/80 transition hover:bg-surface-hover hover:text-foreground disabled:opacity-40">
                  {s.label}
                </button>
              ))}
            </span>
          )}
          field={{
            label: 'Feedback',
            placeholder: d.canRegenerate
              ? 'What should change? Regenerate uses this as instructions; a decision carries it as a note for the agent.'
              : 'Add feedback with your decision…',
            value: d.note,
            onChange: d.setNote,
            disabled: d.held,
            hint: d.canRegenerate && !d.regenerating && !d.note.trim() ? 'Type feedback to regenerate' : undefined,
            action: d.canRegenerate
              ? { label: d.regenerating ? 'Regenerating…' : 'Regenerate', onClick: () => void d.regenerate(), disabled: d.held || !d.note.trim(), busy: d.busy || d.regenerating, icon: RefreshCw }
              : undefined,
          }}
        />
      )}
    />
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
 * @param props.guided - True when the guided review runs beside the page; rewrites then come from the conversation.
 */
export const LeadView = (props: {
  lead: LeadRow;
  contactHref: string | null;
  runState: LeadRunState;
  onDecided: () => void;
  guided?: boolean;
}) => {
  const run = props.runState.run;
  if (run) {
    return <LeadDecision lead={props.lead} contactHref={props.contactHref} run={run} onDecided={props.onDecided} guided={props.guided ?? false} />;
  }
  return <LeadRecord lead={props.lead} contactHref={props.contactHref} runState={props.runState} />;
};

/**
 * The live page: the server resolved the run; deciding refreshes the route so
 * the lane flip renders.
 * @param props
 * @param props.lead
 * @param props.contactHref - HubSpot deep link, when the portal id resolves.
 * @param props.runState
 * @param props.guided
 */
export const LeadDetail = (props: {
  lead: LeadRow;
  contactHref: string | null;
  runState: LeadRunState;
  /** True when the guided review runs beside the page and owns the rewrite. */
  guided?: boolean;
}) => {
  const router = useRouter();
  return (
    <LeadView
      lead={props.lead}
      contactHref={props.contactHref}
      runState={props.runState}
      guided={props.guided}
      onDecided={() => router.refresh()}
    />
  );
};
