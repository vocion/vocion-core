import type { BriefRow } from '@/features/personalization/PersonalizationQueue';
import { desc, eq } from 'drizzle-orm';
import { Sparkles } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/ui/empty-state';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { PersonalizationQueue } from '@/features/personalization/PersonalizationQueue';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { leadBriefSchema } from '@/models/Schema';

/**
 * Personalization — the review queue for MQLs the agent has researched and
 * drafted a sequence for. Nothing here has been sent: a lead leaves the
 * queue only when a human moves it.
 *
 * Optional surface at `/gtm/personalization`. Linked only where
 * `workspace.yaml` lists `surfaces: [personalization]` (see
 * `features/navigation/surfaces.ts`).
 * @param props
 * @param props.params
 */
export default async function PersonalizationPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    return null;
  }

  const rows = await db
    .select()
    .from(leadBriefSchema)
    .where(eq(leadBriefSchema.orgId, orgId))
    .orderBy(desc(leadBriefSchema.briefedAt))
    .limit(500);

  // Dates cross the server/client boundary as ISO strings.
  const briefs: BriefRow[] = rows.map(r => ({
    id: r.id,
    contactRef: r.contactRef,
    contactName: r.contactName,
    contactTitle: r.contactTitle,
    companyName: r.companyName,
    triggerType: r.triggerType,
    entranceSource: r.entranceSource,
    utmCampaign: r.utmCampaign,
    engagementSent: r.engagementSent,
    engagementOpened: r.engagementOpened,
    status: r.status,
    confidence: r.confidence,
    claims: r.claims,
    missing: r.missing,
    draftSequence: r.draftSequence,
    briefedAt: r.briefedAt?.toISOString() ?? null,
  }));

  return (
    <>
      <TitleBar
        title="Personalization"
        description="MQLs the agent has researched and drafted for. Nothing sends without you."
      />

      {briefs.length === 0
        ? (
            <EmptyState
              icon={Sparkles}
              title="No briefed leads yet"
              description="The MQL sweep records every lead it researches here. Ask the RevOps Lead to run a pass in chat, or wait for the next scheduled sweep."
            />
          )
        : <PersonalizationQueue briefs={briefs} />}
    </>
  );
}
