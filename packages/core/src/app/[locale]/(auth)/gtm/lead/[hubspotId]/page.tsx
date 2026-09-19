import type { LeadRow, LeadRunState } from '@/features/personalization/LeadDetail';
import type { ReviewCardRun } from '@/features/review/ReviewSurface';
import { and, eq } from 'drizzle-orm';
import { UserSearch } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/ui/empty-state';
import { CommentLayerProvider } from '@/features/comments/CommentLayer';
import { loadChatAgentContext } from '@/features/dashboard/chat/agentOptions';
import { ChatDock } from '@/features/dashboard/chat/ChatDock';
import { RecordContext } from '@/features/dashboard/context/RecordContext';
import { LeadDetail } from '@/features/personalization/LeadDetail';
import { getAction } from '@/libs/actions/registry';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { actionRunSchema, knowledgeSourceSchema, leadBriefSchema, reviewAssignmentSchema } from '@/models/Schema';

/**
 * The lead page — one URL per lead, `/gtm/lead/{hubspot_id}`. The review
 * card's View Research link and the personalization queue's rows both land
 * here. When the lead has a decision waiting the page leads with the same
 * decidable card as the review queue; when it does not, the page is the
 * lead's research record: the brief, the reference articles, what is missing,
 * and what was decided.
 *
 * The id maps to the lead_brief row through the `contacts:{id}` ref prefix —
 * nothing new is stored. An id the sweep has never queued renders an empty
 * state, never a crash.
 * @param props
 * @param props.params
 */
export default async function LeadPage(props: {
  params: Promise<{ locale: string; hubspotId: string }>;
}) {
  const { locale, hubspotId } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    return null;
  }

  const [row] = await db
    .select()
    .from(leadBriefSchema)
    .where(and(
      eq(leadBriefSchema.orgId, orgId),
      eq(leadBriefSchema.contactRef, `contacts:${hubspotId}`),
    ))
    .limit(1);

  // Contact deep link needs the portal id, read from the contacts source —
  // the same lookup the review card's template does.
  const [source] = await db
    .select({ configJson: knowledgeSourceSchema.configJson })
    .from(knowledgeSourceSchema)
    .where(and(
      eq(knowledgeSourceSchema.orgId, orgId),
      eq(knowledgeSourceSchema.slug, 'hubspot-contacts'),
    ))
    .limit(1);
  const portalId = (source?.configJson as { portalId?: string | number } | null)?.portalId;
  const contactHref = portalId ? `https://app.hubspot.com/contacts/${portalId}/record/0-1/${hubspotId}` : null;

  if (!row) {
    return (
      <EmptyState
        icon={UserSearch}
        title="Not on the personalization ledger"
        description="This lead has not been through the personalization sweep, so there is no brief, no research, and no draft to show. The hourly sweep queues each new MQL; a lead gets a page here once it has been picked up."
        action={{ label: 'Back to the queue', href: '/gtm/personalization' }}
        {...(contactHref ? { secondaryAction: { label: 'Open in HubSpot', href: contactHref } } : {})}
      />
    );
  }

  // The back-linked run, resolved under the SAME predicate the review queue's
  // feed applies: pending or failed and not snoozed shows the card (deciding
  // it here decides it everywhere, and a failed card carries its error with
  // Approve-as-retry); snoozed shows when it returns.
  const runState: LeadRunState = { run: null, snoozedUntil: null, runFailed: false, pinned: [] };
  if (row.reviewActionRunId != null) {
    const now = new Date();
    const [found] = await db
      .select({ run: actionRunSchema, snoozedUntil: reviewAssignmentSchema.snoozedUntil })
      .from(actionRunSchema)
      .leftJoin(reviewAssignmentSchema, and(
        eq(reviewAssignmentSchema.orgId, orgId),
        eq(reviewAssignmentSchema.kind, 'action'),
        eq(reviewAssignmentSchema.runId, actionRunSchema.id),
      ))
      .where(and(
        eq(actionRunSchema.orgId, orgId),
        eq(actionRunSchema.id, row.reviewActionRunId),
      ))
      .limit(1);
    // What the human already approved, if they have — the pin is what makes
    // the audit answer "what did they approve" rather than "what does this
    // look like now" (0112).
    runState.pinned = found?.run.pinnedArtifacts ?? [];
    if (found?.run.status === 'pending' || found?.run.status === 'failed') {
      const snoozed = found.snoozedUntil != null && found.snoozedUntil > now;
      const expired = found.run.expiresAt != null && found.run.expiresAt <= now;
      if (snoozed) {
        runState.snoozedUntil = found.snoozedUntil!.toISOString();
      } else if (!expired) {
        // Best-effort, like the feed: a presenter error means no card, never
        // a broken page. `canRegenerate` is stamped from the action's declared
        // capability, the same as the queue's feed.
        const action = getAction(found.run.actionId);
        const presenter = action?.reviewCard;
        const card = presenter
          ? await presenter({ orgId }, found.run.input as never).catch(() => undefined)
          : undefined;
        if (card) {
          runState.run = {
            id: found.run.id,
            actionId: found.run.actionId,
            status: found.run.status,
            input: found.run.input as Record<string, unknown>,
            invokedBy: found.run.invokedBy,
            proposal: found.run.proposal,
            // ISO across the server/client boundary, like the dates above.
            regeneratingSince: found.run.regeneratingSince?.toISOString() ?? null,
            regenerateNote: found.run.regenerateNote,
            error: found.run.error,
            card: { ...card, canRegenerate: action?.regenerate !== undefined },
          } satisfies ReviewCardRun;
        } else if (found.run.status === 'failed') {
          // No presenter card to retry through — at least name the failure.
          runState.runFailed = true;
        }
      }
    }
  }

  // The lead's three artifacts (0112). Materialised from the ledger row here
  // as a backfill, so a lead briefed before the split has them the first time
  // somebody opens it rather than only after the next sweep; the pipeline
  // writes keep them in step from then on. Idempotent — identical content
  // writes nothing.
  const { ensureLeadArtifacts } = await import('@/services/personalization/artifacts');
  const artifacts = await ensureLeadArtifacts(orgId, row.id).catch(() => []);

  // Confidence, per dimension. Stored when the brief was written; computed
  // here for a row that predates the column, so the page never shows one
  // collapsed number where five different questions live.
  const { computeConfidenceDimensions } = await import('@/services/personalization/confidence');
  const dimensions = row.confidenceDimensions ?? computeConfidenceDimensions({
    contactName: row.contactName,
    contactTitle: row.contactTitle,
    companyName: row.companyName,
    entranceSource: row.entranceSource,
    utmCampaign: row.utmCampaign,
    mqlAt: row.mqlAt,
    arrivedAt: row.arrivedAt,
    engagementSent: row.engagementSent,
    engagementOpened: row.engagementOpened,
    claims: row.claims,
    missing: row.missing,
  });

  // Dates cross the server/client boundary as ISO strings.
  const lead: LeadRow = {
    id: row.id,
    contactRef: row.contactRef,
    contactName: row.contactName,
    contactTitle: row.contactTitle,
    companyName: row.companyName,
    entranceSource: row.entranceSource,
    utmCampaign: row.utmCampaign,
    engagementSent: row.engagementSent,
    engagementOpened: row.engagementOpened,
    status: row.status,
    confidence: row.confidence,
    confidenceDimensions: dimensions as LeadRow['confidenceDimensions'],
    sections: row.sections,
    claims: row.claims,
    missing: row.missing,
    briefError: row.briefError,
    briefAttempts: row.briefAttempts,
    regenerateNote: row.regenerateNote,
    regenerateHistory: row.regenerateHistory,
    draftSequence: row.draftSequence.map((send, i) => ({ ...send, step: send.step ?? i + 1 })),
    recommendedSequence: row.recommendedSequence,
    currentSequence: row.currentSequence ?? null,
    reviewActionRunId: row.reviewActionRunId,
    draftError: row.draftError,
    mqlAt: row.mqlAt?.toISOString() ?? null,
    arrivedAt: row.arrivedAt?.toISOString() ?? null,
    briefedAt: row.briefedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decidedBy: row.decidedBy,
    briefVersion: row.briefVersion,
    workspaceSha: row.workspaceSha,
    handoffSections: row.handoffSections,
    handoffTrigger: row.handoffTrigger,
    handoffAt: row.handoffAt?.toISOString() ?? null,
  };

  // The dock: the agent conversation as an overlay on the page's right edge,
  // scoped to this lead (agent-chat-surface.md §3, decided 2026-09-02; made an
  // overlay 2026-09-16). The shell's dock bails on this route, so this is the
  // page's one surface.
  const { agents } = await loadChatAgentContext(orgId);

  // The comment layer spans both: a note taken on the brief becomes a chip in
  // the dock's composer, and clears from both when the agent applies it (043).
  // It reads the commentable regions from the rendered page, so an anchor
  // always points at the words the reviewer actually selected.
  return (
    <CommentLayerProvider
      targetRef={`lead_brief:${row.id}`}
      record={{ type: 'object', id: row.contactRef, label: row.contactName }}
      // The sequence draft is in view exactly when a decision is waiting, so
      // that is exactly when the selection offers *Add change* and `(+)`
      // offers `@change`.
      changeIntent={runState.run !== null}
    >
      {/* What this page IS about, declared once (R4 / #329). The rail beside
          it reads this to know the record is already on screen and therefore
          not to render it a second time (`pageShowsRecord`); it is the same
          `RecordRef` the scoped dock resolves from `contacts:{id}`. */}
      <RecordContext record={{ type: 'object', id: row.contactRef, label: row.contactName, href: `/gtm/lead/${hubspotId}` }} />
      <div className="min-w-0 flex-1">
        {/* `guided`: the rewrite is asked for in the conversation and rides
            the decision taken HERE — the page keeps the record and the verbs. */}
        <LeadDetail lead={lead} artifacts={artifacts} contactHref={contactHref} runState={runState} guided={agents.length > 0} />
      </div>
      <ChatDock
        agents={agents}
        scopeRef={row.contactRef}
        scopeLabel={row.contactName}
        // Full width by default (2026-09-16), with no exception: the record —
        // the sends included — and its decision bar are on this page, so the
        // rail is the conversation about them and waits on its edge tab.
        run={runState.run}
      />
    </CommentLayerProvider>
  );
}
