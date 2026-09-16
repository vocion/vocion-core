'use client';

import type { LeadDossier } from './LeadTabs';
import type { ReviewCardRun } from '@/features/review/ReviewActionCard';
import type { ReviewContent } from '@/libs/actions/types';
import type { LeadArtifactRef } from '@/services/personalization/artifacts';
import type { CurrentSequence } from '@/services/personalization/sequenceState';
import { AlarmClock, Check, Loader2, MessageSquareText, TriangleAlert, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  Accordion,
  DetailMeta,
  DetailPage,
  MetaChip,
  Section,
  StatusDot,
  StickyActionBar,
} from '@/components/patterns';
import { ConfidenceBars } from '@/components/ui/confidence-indicator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { requestAgentSurface } from '@/features/dashboard/chat/agentSurface';
import { contentKindRenderer } from '@/features/review/contentKinds';
import { useReviewDecision } from '@/features/review/useReviewDecision';
import { readerFailure } from '@/libs/chat/redact';
import { dimensionState, researchState, SIGNAL_STATE_LABEL } from '@/services/personalization/confidence';
import { resolveSequenceState } from '@/services/personalization/sequenceState';
import { cn } from '@/utils/Helpers';
import { ArtifactRegenerateControl } from './ArtifactRegenerateControl';
import { useDraftRevision } from './draftRevision';
import { savedGuidedEdits } from './GuidedReview';
import { entranceLabel, fullDate, LANE_PILL, shortDate } from './leadFormat';
import { BriefTab, EvidenceTab, HandoffBriefZone } from './LeadTabs';
import { SequenceStateBlock } from './SequenceStateBlock';

/**
 * The lead workspace — one lead on its own URL, rebuilt to the CEO's review
 * (`docs/specs/personalization-v2.md`).
 *
 * The shape the review asked for, and what it replaced:
 *
 * ```
 * Before                                  After
 * nav | document | metadata rail | chat   nav | workspace | optional copilot
 *      ^ sequence inside the document
 * ```
 *
 * - **Three vertical zones, capped.** The permanent metadata column is gone;
 *   confidence, timeline and CRM context live in the brief or under Evidence.
 * - **Header, then ONE recommendation block, then tabs.** The recommendation
 *   is stated once — what, why, and what approving will actually do — and the
 *   sequence-state reconciliation is part of it, because that is the thing a
 *   person has to understand before pressing the button.
 * - **Sequence · Brief · Evidence.** The sequence leads, because this page is
 * an enrollment review and the sends are the work being approved; the brief is five sections; the sequence
 *   is the sends with their rationale and their edit; Evidence holds
 *   everything the brief no longer has to carry.
 * - **The decision never scrolls away**, and its primary is HELD when the
 *   sequence state cannot say what approving would do.
 *
 * Unchanged, deliberately: the page still decides the SAME run the review
 * queue does through the same `useReviewDecision` path; the rail beside it is
 * still the conversation and never a second copy of the page (#378); the
 * record page is still full width (#375); a rewrite asked for in the
 * conversation still lands here (`draftRevision`).
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
  /** What the CRM last observed about the contact's own enrollment (0112). */
  currentSequence: CurrentSequence | null;
  reviewActionRunId: number | null;
  draftError: string | null;
  mqlAt: string | null;
  arrivedAt: string | null;
  briefedAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  briefVersion: string | null;
  workspaceSha: string | null;
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
  /** The exact artifact versions a decision on this run already pinned. */
  pinned: Array<{ artifactId: number; role: string; version: number; title: string }>;
};

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

const TABS = ['sequence', 'brief', 'evidence'] as const;
type TabKey = (typeof TABS)[number];

// Inline fields: text until touched, a soft fill on hover/focus.
const INLINE_FIELD = 'w-full rounded-md bg-transparent px-2 py-1.5 text-sm transition outline-none hover:bg-surface-hover focus:bg-surface-soft disabled:opacity-60';

/**
 * A quiet, hairline notice — regenerating, stale, failed. Not a banner box.
 * @param props - Tone, icon, content.
 * @param props.tone - amber or red.
 * @param props.icon - The glyph.
 * @param props.children - The words.
 * @param props.testid - Test hook.
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
 * "Ask about brief" / "Discuss recommendation" / "Editing Send 2".
 *
 * The chat is a scoped drawer, not a second panel: the same one-column rail
 * (#375) opened with an explicit subject, so "make this less salesy" has an
 * unambiguous referent instead of the person hoping the model knows which
 * thing they meant. It adds scope; it does not add a surface.
 * @param props - The scope's label and the artifacts in view.
 * @param props.label - What the drawer is scoped to.
 * @param props.context - The page context to attach.
 */
const AskScoped = (props: { label: string; context: () => Parameters<typeof requestAgentSurface>[0] }) => (
  <button
    type="button"
    data-testid={`ask-scoped-${props.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
    onClick={() => requestAgentSurface(props.context())}
    className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
  >
    <MessageSquareText className="size-3.5" aria-hidden />
    {props.label}
  </button>
);

/**
 * What happened to this lead, as one line above the read-only sends.
 * @param lead - The row.
 * @param state - The run state.
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

/**
 * The page context every scoped ask carries: the record AND its artifacts.
 * @param lead
 * @param artifacts
 * @param tab
 * @param extra
 */
function contextFor(lead: LeadRow, artifacts: readonly LeadArtifactRef[], tab: TabKey, extra?: Array<{ label: string; value: string }>) {
  return {
    path: `/gtm/lead/${lead.contactRef.split(':')[1] ?? ''}`,
    title: lead.contactName,
    record: { type: 'object' as const, id: lead.contactRef, label: lead.contactName },
    // P0: what the page is SHOWING, so the model cannot answer "there's no
    // brief or proposal to review here" beside a page rendering one. Resolved
    // server-side from these ids (`services/chat/grounding.ts`).
    artifacts: artifacts.map(a => a.ref),
    state: [{ label: 'Tab', value: tab }, ...(extra ?? [])],
    openedFrom: true as const,
  };
}

/**
 * The presentational page, so stories and tests can put it in any state.
 * @param props - The lead, its artifacts, the run state and the callbacks.
 * @param props.lead - The row.
 * @param props.artifacts - The lead's three artifacts.
 * @param props.contactHref - HubSpot deep link, when the portal id resolves.
 * @param props.runState - What the server resolved the back-linked run into.
 * @param props.onDecided - Called after a decision lands.
 * @param props.guided - True when the conversation beside the page owns the rewrite.
 */
export const LeadView = (props: {
  lead: LeadRow;
  artifacts?: LeadArtifactRef[];
  contactHref: string | null;
  runState: LeadRunState;
  onDecided: () => void;
  guided?: boolean;
}) => {
  const { lead, runState } = props;
  const artifacts = props.artifacts ?? [];
  const guided = props.guided ?? false;
  const run = runState.run;

  const search = useSearchParams();
  const urlTab = search?.get('tab');
  // This is an ENROLLMENT REVIEW page, so the sequence is the thing being
  // approved — the brief and the evidence exist to justify it. Chris,
  // 2026-09-16: *"The recommendation block tells me what Vocion wants to do.
  // My next natural question is: okay, what are you going to send? Not: show
  // me the research report."* So the sequence leads whenever there is one to
  // review; a lead with no sends yet has nothing to approve and opens on the
  // brief. An explicit `?tab=` always wins.
  const [tab, setTab] = useState<TabKey>(
    TABS.includes(urlTab as TabKey) ? urlTab as TabKey : lead.draftSequence.length > 0 ? 'sequence' : 'brief',
  );

  // The two states the page has to reconcile BEFORE a button
  // (`docs/specs/personalization-v2.md`, P0).
  const sequenceState = useMemo(
    () => resolveSequenceState(lead.currentSequence, lead.recommendedSequence, lead.draftSequence.length),
    [lead.currentSequence, lead.recommendedSequence, lead.draftSequence.length],
  );

  const pill = LANE_PILL[lead.status] ?? { status: 'pending' as const, label: lead.status };
  const subtitle = [lead.contactTitle, lead.companyName].filter(Boolean).join(' · ');
  const line = decisionLine(lead, runState);

  const d = useReviewDecision(run ?? { id: 0, actionId: '', status: 'pending', input: {}, invokedBy: null, proposal: null, regeneratingSince: null, regenerateNote: null, error: null, card: { system: '', title: '', fields: [], content: [] } } as unknown as ReviewCardRun, {
    onDecided: props.onDecided,
    onRegenerated: props.onDecided,
    extraContentEdits: guided && run ? () => savedGuidedEdits(run) : undefined,
  });
  // A rewrite asked for in the conversation lands HERE, on the record, because
  // the record is what shows the sends (#378).
  useDraftRevision(run?.id ?? -1, (contentId, body) => d.editContent(contentId, { body }));
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  const cardContent = run?.card.content ?? [];
  const emails = cardContent.filter((c): c is Extract<ReviewContent, { kind: 'email' }> => c.kind === 'email');
  const [openSends, setOpenSends] = useState<string[]>(() => (emails.length > 0 ? [emails[0]!.id] : lead.draftSequence.length > 0 ? [String(lead.draftSequence[0]!.step)] : []));
  const allOpen = emails.length > 0 && emails.every(e => openSends.includes(e.id));
  const approveLabel = run?.card.verbs?.approve ?? 'Enroll';

  const timeline = [
    lead.arrivedAt && { label: 'Arrived', value: fullDate(lead.arrivedAt) },
    lead.mqlAt && { label: 'Became MQL', value: fullDate(lead.mqlAt) },
    lead.briefedAt && { label: 'Briefed', value: fullDate(lead.briefedAt) },
    lead.decidedAt && { label: 'Decided', value: `${fullDate(lead.decidedAt)}${lead.decidedBy ? ` · ${lead.decidedBy}` : ''}` },
  ].filter((x): x is { label: string; value: string } => Boolean(x));

  const provenance = [
    lead.briefVersion && { label: 'Brief version', value: lead.briefVersion },
    lead.workspaceSha && { label: 'Workspace', value: lead.workspaceSha },
    run && { label: 'Review run', value: `#${run.id}` },
    ...artifacts.map(a => ({ label: `Artifact · ${a.role}`, value: `#${a.id} · v${a.version}` })),
    // What the human actually approved, if they already have. This is the
    // whole reason a decision pins versions (MANIFESTO §3).
    ...runState.pinned.map(p => ({ label: `Approved · ${p.role}`, value: `#${p.artifactId} · v${p.version}` })),
  ].filter((x): x is { label: string; value: string } => Boolean(x));

  const recommendationHeadline = run?.card.recommendation?.headline
    ?? (lead.recommendedSequence ? `Enroll in ${lead.recommendedSequence.name}` : run?.card.title ?? 'No outreach recommended yet');
  const recommendationDetail = run?.card.recommendation?.detail ?? run?.card.summary ?? run?.proposal?.rationale ?? lead.recommendedSequence?.reason ?? null;

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
        // ONE line: the lane, how they arrived, and the research confidence.
        // Everything that used to live in a column beside the page is in the
        // brief or under Evidence now.
        <DetailMeta
          items={[
            <StatusDot key="lane" tone={LANE_TONE[pill.status] ?? 'neutral'} label={run ? 'Ready for review' : pill.label} />,
            lead.entranceSource ? entranceLabel(lead.entranceSource) : null,
            lead.utmCampaign ? `via ${lead.utmCampaign}` : null,
            lead.mqlAt ? `MQL ${shortDate(lead.mqlAt)}` : lead.arrivedAt ? `Arrived ${shortDate(lead.arrivedAt)}` : null,
            lead.confidence !== null
              ? (
                  <ConfidenceBars
                    key="confidence"
                    value={lead.confidence}
                    subject="Research"
                    // A lead graded before the dimensions existed still has a raw
                    // number, and that number is no more calibrated than the
                    // five are — so it reads the SAME ladder rather than
                    // falling back to a percentage.
                    reading={SIGNAL_STATE_LABEL[lead.confidenceDimensions ? researchState(lead.confidenceDimensions) : dimensionState(lead.confidence)]}
                    note="How much of the evidence we wanted we actually got. Per-signal states are in the brief."
                  />
                )
              : null,
            props.contactHref ? <MetaChip key="crm" href={props.contactHref}>Open in HubSpot ↗</MetaChip> : null,
          ]}
        />
      )}
      bar={run
        ? (
            <StickyActionBar
              className="mx-0 px-0 sm:mx-0 sm:px-0"
              primary={{
                'label': d.execError ? `Retry ${approveLabel}` : approveLabel,
                'onClick': () => void d.decide('approve'),
                // Held when the sequence state cannot say what approving would
                // do: a one-click Enroll that might mean either of two things
                // is worse than no button.
                'disabled': d.held || !sequenceState.canEnroll,
                'busy': d.busy,
                'icon': Check,
                'data-testid': 'decide-approve',
              }}
              secondary={[
                { label: 'Snooze', onClick: () => setSnoozeOpen(o => !o), disabled: d.held, icon: AlarmClock },
                { 'label': run.card.verbs?.reject ?? 'Decline', 'onClick': () => void d.decide('reject'), 'disabled': d.held, 'icon': X, 'tone': 'danger', 'data-testid': 'decide-reject' },
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
                placeholder: 'Add feedback with your decision. To rewrite something, use Regenerate beside the artifact it belongs to.',
                value: d.note,
                onChange: d.setNote,
                disabled: d.held,
              }}
            />
          )
        : undefined}
    >
      {/* Regenerating / stale / execution failure — server truth, stated where
          the decision is. */}
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

      {/* ONE recommendation block. What, why, and — before any button — what
          approving will actually do. */}
      <Section
        eyebrow="Recommendation"
        data-testid="recommended-action"
        action={(
          <AskScoped
            label="Discuss recommendation"
            context={() => ({
              prompt: '',
              context: contextFor(lead, artifacts, tab, [{ label: 'Scope', value: 'the outreach recommendation' }]),
              scope: { label: 'Discuss recommendation' },
            })}
          />
        )}
      >
        <p className="text-[15px] leading-snug font-semibold break-words">{recommendationHeadline}</p>
        {recommendationDetail && <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-foreground/80">{recommendationDetail}</p>}
        <div className="mt-3">
          <SequenceStateBlock state={sequenceState} />
        </div>
        {line && <p className="mt-3 text-sm font-medium" data-testid="decision-line">{line}</p>}
        <div className="mt-1">
          <ArtifactRegenerateControl
            leadId={lead.id}
            target="recommendation"
            artifactTitle={`${lead.contactName} — outreach recommendation`}
            placeholder="e.g. A different sequence — this one is built for a warm referral and this lead is cold."
            consequence="This clears the sequence choice and its sends, and asks for both again. The brief is untouched."
          />
        </div>
      </Section>

      <Tabs
        value={tab}
        onValueChange={v => setTab(v as TabKey)}
        className="pt-4"
      >
        <TabsList variant="line" data-testid="lead-tabs">
          <TabsTrigger value="sequence">{`Sequence${lead.draftSequence.length > 0 ? ` · ${lead.draftSequence.length}` : ''}`}</TabsTrigger>
          <TabsTrigger value="brief">Brief</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
        </TabsList>

        <TabsContent value="brief">
          <div className="flex justify-end">
            <AskScoped
              label="Ask about brief"
              context={() => ({
                prompt: '',
                context: contextFor(lead, artifacts, 'brief', [{ label: 'Scope', value: 'the research brief' }]),
                scope: { label: 'Ask about brief' },
              })}
            />
          </div>
          <BriefTab row={lead} artifact={artifacts.find(a => a.role === 'brief')} />
        </TabsContent>

        <TabsContent value="sequence">
          <Section
            eyebrow={`Draft sequence${lead.recommendedSequence ? ` · ${lead.recommendedSequence.name}` : ''}`}
            data-testid="outreach-sends"
            commentField="Draft sequence"
            action={emails.length > 1 && (
              <button
                type="button"
                onClick={() => setOpenSends(allOpen ? [] : emails.map(e => e.id))}
                className="inline-flex h-8 items-center rounded-lg px-2 text-[13px] text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
              >
                {allOpen ? 'Collapse all' : guided ? 'Open all' : 'Edit all'}
              </button>
            )}
          >
            {lead.recommendedSequence?.reason && <p className="mb-3 max-w-3xl text-sm text-foreground/80">{lead.recommendedSequence.reason}</p>}
            {cardContent.length > 0
              ? (
                  <Accordion
                    open={openSends}
                    onToggle={(id, on) => setOpenSends(o => (on ? [...o, id] : o.filter(x => x !== id)))}
                    items={cardContent.map((item, i) => {
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
                        children: (
                          <div className="flex flex-col gap-1">
                            {guided
                              ? (
                                  <>
                                    {subject && <p className="text-sm font-medium">{subject}</p>}
                                    <p className="text-sm leading-relaxed whitespace-pre-line text-foreground/80">{body}</p>
                                  </>
                                )
                              : (
                                  <>
                                    <label className="block">
                                      <span className="sr-only">Subject</span>
                                      <input className={cn(INLINE_FIELD, 'font-medium')} value={subject} onChange={ev => d.editContent(item.id, { subject: ev.target.value })} disabled={d.held} aria-label={`${item.label} subject`} />
                                    </label>
                                    <label className="block">
                                      <span className="sr-only">Body</span>
                                      <textarea className={cn(INLINE_FIELD, 'min-h-28 resize-y leading-relaxed')} value={body} onChange={ev => d.editContent(item.id, { body: ev.target.value })} disabled={d.held} aria-label={`${item.label} body`} />
                                    </label>
                                  </>
                                )}
                            <div className="flex justify-end">
                              {/* The drawer's scope: "Editing Send 2", so
                                  "make this less salesy" has a referent. */}
                              <AskScoped
                                label={`Editing ${item.label}`}
                                context={() => ({
                                  prompt: '',
                                  context: contextFor(lead, artifacts, 'sequence', [{ label: 'Scope', value: item.label }]),
                                  scope: { label: `Editing ${item.label}` },
                                })}
                              />
                            </div>
                          </div>
                        ),
                      };
                    })}
                  />
                )
              : lead.draftSequence.length > 0
                ? (
                    <Accordion
                      open={openSends}
                      onToggle={(id, on) => setOpenSends(o => (on ? [...o, id] : o.filter(x => x !== id)))}
                      items={lead.draftSequence.map(send => ({
                        id: String(send.step),
                        label: send.day !== undefined ? `Day ${send.day}` : `Send ${send.step}`,
                        title: send.subject,
                        children: <p className="text-sm leading-relaxed whitespace-pre-line text-foreground/80">{send.body}</p>,
                      }))}
                    />
                  )
                : (
                    <p className="text-[13px] text-muted-foreground">
                      {lead.draftError ? `Drafting has not produced sends yet: ${readerFailure(lead.draftError)}` : 'No sends drafted yet.'}
                    </p>
                  )}
            {guided && cardContent.length > 0 && (
              <p className="mt-2 text-[12px] text-muted-foreground">
                To change one send, ask for the rewrite in the conversation beside this page; it rides your decision here.
              </p>
            )}
            <div className="mt-2">
              <ArtifactRegenerateControl
                leadId={lead.id}
                target="sequence"
                artifactTitle={`${lead.contactName} — draft sequence`}
                placeholder="e.g. Shorter. Two sends, not four, and drop the case study."
                consequence="This rewrites every send from the brief and the chosen sequence. The sequence choice itself is untouched."
              />
            </div>
          </Section>
          <HandoffBriefZone sections={lead.handoffSections} trigger={lead.handoffTrigger} at={lead.handoffAt} />
        </TabsContent>

        <TabsContent value="evidence">
          <EvidenceTab row={lead} timeline={timeline} provenance={provenance} />
        </TabsContent>
      </Tabs>
    </DetailPage>
  );
};

/**
 * The live page: the server resolved the run; deciding refreshes the route so
 * the lane flip renders.
 * @param props - The lead, its artifacts, the run state.
 * @param props.lead - The row.
 * @param props.artifacts - The lead's three artifacts.
 * @param props.contactHref - HubSpot deep link, when the portal id resolves.
 * @param props.runState - The back-linked run.
 * @param props.guided - True when the conversation beside the page owns the rewrite.
 */
export const LeadDetail = (props: {
  lead: LeadRow;
  artifacts?: LeadArtifactRef[];
  contactHref: string | null;
  runState: LeadRunState;
  guided?: boolean;
}) => {
  const router = useRouter();
  return (
    <LeadView
      lead={props.lead}
      artifacts={props.artifacts}
      contactHref={props.contactHref}
      runState={props.runState}
      guided={props.guided}
      onDecided={() => router.refresh()}
    />
  );
};
