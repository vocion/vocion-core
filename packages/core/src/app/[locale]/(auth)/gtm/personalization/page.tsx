import type { BriefRow } from '@/features/personalization/PersonalizationQueue';
import { desc, eq } from 'drizzle-orm';
import { Sparkles } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/ui/empty-state';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { PersonalizationQueue } from '@/features/personalization/PersonalizationQueue';
import { QueueResetControl } from '@/features/personalization/QueueResetControl';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { leadBriefSchema } from '@/models/Schema';
import { ORG_ROLE } from '@/types/Auth';

/**
 * Personalization — the queue of MQLs the sweep has picked up. A lead lands
 * here when it arrives; research, drafting and review arrive in later slices.
 * Nothing here has been sent, and a lead leaves the queue only when a human
 * moves it.
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
  const { orgId, has } = await auth();
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
    arrivedAt: r.arrivedAt?.toISOString() ?? null,
    briefedAt: r.briefedAt?.toISOString() ?? null,
  }));

  // TEMPORARY (phase 2): the reset escape hatch. Absent unless the flag is set.
  const canReset = Boolean(Env.VOCION_ALLOW_QUEUE_RESET) && has({ role: ORG_ROLE.ADMIN });

  return (
    <>
      <TitleBar
        title="Personalization"
        description="The queue of MQLs the sweep has picked up. Nothing sends without you."
      />

      {canReset && (
        <div className="mb-3 flex justify-end">
          <QueueResetControl rowCount={briefs.length} />
        </div>
      )}

      {briefs.length === 0
        ? (
            <EmptyState
              icon={Sparkles}
              title="No leads queued yet"
              description="The MQL sweep records every lead it picks up here. Ask the RevOps Lead to run a pass in chat, or wait for the next scheduled sweep."
            />
          )
        : <PersonalizationQueue briefs={briefs} />}
    </>
  );
}
