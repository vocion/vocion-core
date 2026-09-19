'use client';

import type { LeadDossier } from './LeadTabs';
import type { ReviewCardRun } from '@/features/review/ReviewSurface';
import type { LeadArtifactRef } from '@/services/personalization/artifacts';
import type { CurrentSequence } from '@/services/personalization/sequenceState';
import { MessageSquareText } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  Accordion,
  MetaChip,
  Section,
  StatusDot,
} from '@/components/patterns';
import { ConfidenceBars } from '@/components/ui/confidence-indicator';
import { requestAgentSurface } from '@/features/dashboard/chat/agentSurface';
import { ReviewSurface } from '@/features/review/ReviewSurface';
import { readerFailure } from '@/libs/chat/redact';
import { dimensionState, researchState, SIGNAL_STATE_LABEL } from '@/services/personalization/confidence';
import { resolveSequenceState } from '@/services/personalization/sequenceState';
import { ArtifactRegenerateControl } from './ArtifactRegenerateControl';
import { savedGuidedEdits } from './GuidedReview';
import { entranceLabel, fullDate, LANE_PILL, shortDate } from './leadFormat';
import { BriefTab, EvidenceTab, HandoffBriefZone } from './LeadTabs';
import { ReferenceRow } from './ReferenceRow';

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

/** Which tab a scoped ask was opened from, so the model knows what you were reading. */
type TabKey = 'sequence' | 'brief' | 'evidence';

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

  // The two states the page has to reconcile BEFORE a button
  // (`docs/specs/personalization-v2.md`, P0).
  const sequenceState = useMemo(
    () => resolveSequenceState(lead.currentSequence, lead.recommendedSequence, lead.draftSequence.length),
    [lead.currentSequence, lead.recommendedSequence, lead.draftSequence.length],
  );

  // The read-only draft's first send opens; there is nothing to decide on it.
  const [openSends, setOpenSends] = useState<string[]>(() => (lead.draftSequence.length > 0 ? [String(lead.draftSequence[0]!.step)] : []));

  const pill = LANE_PILL[lead.status] ?? { status: 'pending' as const, label: lead.status };
  const subtitle = [lead.contactTitle, lead.companyName].filter(Boolean).join(' · ');
  const line = decisionLine(lead, runState);

  // A lead with nothing pending still has a page: the same shell, reading
  // rather than deciding. The synthetic run carries only what the lead row
  // already knows, so no zone claims a fact the record does not have.
  const surfaceRun: ReviewCardRun = run ?? {
    id: 0,
    actionId: 'personalization.enroll',
    status: lead.status === 'handed_off' || lead.status === 'sent' ? 'done' : 'pending',
    input: {},
    invokedBy: null,
    proposal: null,
    card: {
      title: lead.contactName,
      system: 'Personalization',
      subject: { name: lead.contactName, role: lead.contactTitle ?? undefined, company: lead.companyName ?? undefined },
      fields: [],
      content: [],
    },
  };

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
    // whole reason a decision pins versions (design principle 1).
    ...runState.pinned.map(p => ({ label: `Approved · ${p.role}`, value: `#${p.artifactId} · v${p.version}` })),
  ].filter((x): x is { label: string; value: string } => Boolean(x));

  // The acquisition facts are the enroll card's own provenance whenever there
  // is a card; without one they have to come from the row, or a decided lead
  // loses how it arrived.
  const meta = [
    { label: 'Lane', value: <StatusDot tone={LANE_TONE[pill.status] ?? 'neutral'} label={run ? 'Ready for review' : pill.label} /> },
    ...(run
      ? []
      : [
          lead.entranceSource ? { label: 'Source', value: entranceLabel(lead.entranceSource) } : null,
          lead.utmCampaign ? { label: 'Campaign', value: `via ${lead.utmCampaign}` } : null,
          lead.mqlAt ? { label: 'Became MQL', value: shortDate(lead.mqlAt) } : lead.arrivedAt ? { label: 'Arrived', value: shortDate(lead.arrivedAt) } : null,
        ]),
    // What the CRM last observed, which is the thing a person has to
    // understand before pressing Enroll. Its unresolvable case holds the
    // primary and says so on the button.
    { label: 'Current sequence', value: <span data-testid="sequence-state-current">{sequenceState.currentLine}</span> },
    lead.confidence !== null
      ? {
          label: 'Research',
          value: (
            <ConfidenceBars
              value={lead.confidence}
              subject="Research"
              // A lead graded before the dimensions existed still has a raw
              // number, and that number is no more calibrated than the five
              // are — so it reads the SAME ladder rather than falling back to
              // a percentage.
              reading={SIGNAL_STATE_LABEL[lead.confidenceDimensions ? researchState(lead.confidenceDimensions) : dimensionState(lead.confidence)]}
              note="How much of the evidence we wanted we actually got. Per-signal states are in the brief."
            />
          ),
        }
      : null,
    props.contactHref ? { label: 'CRM', value: <MetaChip href={props.contactHref}>Open in HubSpot ↗</MetaChip> } : null,
  ].filter(x => x !== null) as Array<{ label: string; value: React.ReactNode }>;

  const sequenceTab = (
    <div data-testid="sequence-tab">
      {/* Reading the brief while editing a send is this page's normal motion,
          and tabs make it impossible. These stand an artifact in the side
          panel without moving you off the send you are writing. */}
      <ReferenceRow artifacts={artifacts} exclude="sequence" />
      <Section
        eyebrow={`The sequence${lead.recommendedSequence ? ` · ${lead.recommendedSequence.name}` : ''}`}
        data-testid="recommended-action"
        commentField="The sequence"
        action={(
          <AskScoped
            label="Discuss recommendation"
            context={() => ({
              prompt: '',
              context: contextFor(lead, artifacts, 'sequence', [{ label: 'Scope', value: 'the outreach recommendation' }]),
              scope: { label: 'Discuss recommendation' },
            })}
          />
        )}
      >
        {/* Why this sequence is the run's rationale, and the shell already
            carries it under Why. It only reads here when there is no run to
            carry it — a lead already decided, or one whose sends were never
            proposed. */}
        {lead.recommendedSequence?.reason && !run?.proposal?.rationale && (
          <p className="mb-3 max-w-3xl text-sm leading-relaxed text-foreground/80">{lead.recommendedSequence.reason}</p>
        )}

        {/* The sends themselves are one tab each, from the run. This is what
            is left: the whole-sequence rewrite, and the read-only draft for a
            lead whose sends were never proposed. */}
        {(run?.card.content?.length ?? 0) === 0 && (
          lead.draftSequence.length > 0
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
                <p className="text-[13px] text-muted-foreground" data-testid="outreach-sends">
                  {lead.draftError ? `Drafting has not produced sends yet: ${readerFailure(lead.draftError)}` : 'No sends drafted yet.'}
                </p>
              )
        )}
        {guided && (run?.card.content?.length ?? 0) > 0 && (
          <p className="text-[12px] text-muted-foreground">
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
    </div>
  );

  const briefTab = (
    <>
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
    </>
  );

  return (
    <ReviewSurface
      data-testid="lead-page"
      run={surfaceRun}
      decidable={Boolean(run)}
      guided={guided}
      crumbs={[
        { label: 'Workspace', href: '/dashboard' },
        { label: 'Personalization', href: '/gtm/personalization' },
        { label: lead.contactName },
      ]}
      title={lead.contactName}
      subtitle={subtitle || undefined}
      meta={meta}
      // A one-click Enroll that might mean either of two things is worse than
      // no button, so the primary is held until the sequence state can say
      // what approving would do — and the button carries the reason.
      hold={run && !sequenceState.canEnroll ? { reason: sequenceState.blockedReason ?? 'The sequence state cannot say what approving would do.' } : null}
      extraTabs={[
        { id: 'sequence', label: 'Sequence', children: sequenceTab },
        { id: 'brief', label: 'Brief', children: briefTab },
      ]}
      // The sends ARE the sequence, so a lead with sends waiting opens on the
      // first one. Chris, 2026-09-16: *"okay, what are you going to send? Not:
      // show me the research report."* A lead with nothing to send yet has
      // nothing to approve, so it opens on the brief. An explicit `?tab=`
      // always wins.
      defaultTab={urlTab
        ? `extra-${urlTab}`
        : lead.draftSequence.length === 0 && (run?.card.content?.length ?? 0) === 0 ? 'extra-brief' : undefined}
      // The lead's own evidence, under the run's: the claims with their
      // sources, the timeline, the artifact versions a decision pinned.
      evidenceExtra={<EvidenceTab row={lead} timeline={timeline} provenance={provenance} />}
      // What happened to this lead, said once and always visible rather than
      // buried in whichever tab is open.
      beforeTabs={line ? <p className="pt-4 text-sm font-medium" data-testid="decision-line">{line}</p> : undefined}
      // "Editing Send 2" — the drawer opened with an explicit subject, so
      // "make this less salesy" has an unambiguous referent.
      itemActions={(item, label) => (
        <AskScoped
          label={`Editing ${label}`}
          context={() => ({
            prompt: '',
            context: contextFor(lead, artifacts, 'sequence', [{ label: 'Scope', value: item.label }]),
            scope: { label: `Editing ${label}` },
          })}
        />
      )}
      extraContentEdits={guided && run ? () => savedGuidedEdits(run) : undefined}
      onDecided={props.onDecided}
      onRegenerated={props.onDecided}
    />
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
