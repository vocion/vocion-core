import type { LeadRow } from '@/features/personalization/LeadDetail';
import { and, eq } from 'drizzle-orm';
import { UserSearch } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/ui/empty-state';
import { LeadDetail } from '@/features/personalization/LeadDetail';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { knowledgeSourceSchema, leadBriefSchema } from '@/models/Schema';

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

  return <LeadDetail lead={lead} contactHref={contactHref} />;
}
