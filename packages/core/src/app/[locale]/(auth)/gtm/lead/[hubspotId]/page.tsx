import type { LeadRow, LeadRunState } from '@/features/personalization/LeadDetail';
import type { ReviewCardRun } from '@/features/review/ReviewActionCard';
import { and, eq } from 'drizzle-orm';
import { UserSearch } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/ui/empty-state';
import { CommentLayerProvider } from '@/features/comments/CommentLayer';
import { loadChatAgentContext } from '@/features/dashboard/chat/agentOptions';
import { ChatDock } from '@/features/dashboard/chat/ChatDock';
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
  // pending feed applies: pending and not snoozed shows the card (deciding it
  // here decides it everywhere); pending but snoozed shows when it returns; a
  // failed execution is named rather than read as still waiting.
  const runState: LeadRunState = { run: null, snoozedUntil: null, runFailed: false };
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
    if (found?.run.status === 'pending') {
      const snoozed = found.snoozedUntil != null && found.snoozedUntil > now;
      const expired = found.run.expiresAt != null && found.run.expiresAt <= now;
      if (snoozed) {
        runState.snoozedUntil = found.snoozedUntil!.toISOString();
      } else if (!expired) {
        // Best-effort, like the feed: a presenter error means no card, never
        // a broken page.
        const presenter = getAction(found.run.actionId)?.reviewCard;
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
            card,
          } satisfies ReviewCardRun;
        }
      }
    } else if (found?.run.status === 'failed') {
      runState.runFailed = true;
    }
  }

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
    sections: row.sections,
    claims: row.claims,
    missing: row.missing,
    briefError: row.briefError,
    briefAttempts: row.briefAttempts,
    regenerateNote: row.regenerateNote,
    draftSequence: row.draftSequence,
    recommendedSequence: row.recommendedSequence,
    reviewActionRunId: row.reviewActionRunId,
    draftError: row.draftError,
    mqlAt: row.mqlAt?.toISOString() ?? null,
    arrivedAt: row.arrivedAt?.toISOString() ?? null,
    briefedAt: row.briefedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decidedBy: row.decidedBy,
  };

  // The dock: the agent conversation as a third column, scoped to this lead
  // and open by default (agent-chat-surface.md §3, decided 2026-09-02). The
  // floating bubble bails on this route, so this is the page's one surface.
  const { agents } = await loadChatAgentContext(orgId);

  // The comment layer spans both: a note taken on the brief becomes a chip in
  // the dock's composer, and clears from both when the agent applies it (043).
  // It reads the commentable regions from the rendered page, so an anchor
  // always points at the words the reviewer actually selected.
  return (
    <CommentLayerProvider targetRef={`lead_brief:${row.id}`}>
      <div className="min-w-0 flex-1">
        <LeadDetail lead={lead} contactHref={contactHref} runState={runState} />
      </div>
      <ChatDock
        agents={agents}
        scopeRef={row.contactRef}
        scopeLabel={row.contactName}
      />
    </CommentLayerProvider>
  );
}
