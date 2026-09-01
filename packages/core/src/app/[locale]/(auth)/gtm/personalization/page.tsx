import type { BriefRow } from '@/features/personalization/PersonalizationQueue';
import { and, count, desc, eq, ne } from 'drizzle-orm';
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
import { QUEUED_STATUS } from '@/services/PersonalizationQueueService';
import { ORG_ROLE } from '@/types/Auth';

/**
 * Personalization — researched leads waiting on a decision. The hourly sweep
 * queues each new MQL, researches it, writes a brief, then drafts the
 * outreach and surfaces the lead as a personalization.enroll review item; a
 * lead reaches this page only once it carries a brief, or once briefing has
 * failed three times and the error is what there is to read.
 *
 * Unbriefed rows are filtered out HERE rather than hidden by the lane picker,
 * so no filter, search or "All" tab can surface a lead with nothing behind it.
 *
 * Nothing here has been sent. Deciding a lead here is the SAME operation on
 * the SAME run as deciding it on the review queue (the card fetches the
 * pending run by the row's back-link and rides the shared decide path).
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

  // A lead with no brief is not on this screen, and a lead part-way through
  // its retries is not either: both sit in `queued` until a brief exists or
  // the tries run out, and the failure path moves the row out of that lane.
  const rows = await db
    .select()
    .from(leadBriefSchema)
    .where(and(
      eq(leadBriefSchema.orgId, orgId),
      ne(leadBriefSchema.status, QUEUED_STATUS),
    ))
    .orderBy(desc(leadBriefSchema.briefedAt))
    .limit(500);

  // The count behind the empty state: leads recorded but not yet briefed.
  const [waiting] = await db
    .select({ n: count() })
    .from(leadBriefSchema)
    .where(and(
      eq(leadBriefSchema.orgId, orgId),
      eq(leadBriefSchema.status, QUEUED_STATUS),
    ));
  const waitingCount = waiting?.n ?? 0;

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
    sections: r.sections,
    claims: r.claims,
    missing: r.missing,
    briefError: r.briefError,
    briefAttempts: r.briefAttempts,
    regenerateNote: r.regenerateNote,
    draftSequence: r.draftSequence,
    recommendedSequence: r.recommendedSequence,
    reviewActionRunId: r.reviewActionRunId,
    draftError: r.draftError,
    mqlAt: r.mqlAt?.toISOString() ?? null,
    arrivedAt: r.arrivedAt?.toISOString() ?? null,
    briefedAt: r.briefedAt?.toISOString() ?? null,
  }));

  // TEMPORARY (phase 2): the reset escape hatch. Absent unless the flag is set.
  const canReset = Boolean(Env.VOCION_ALLOW_QUEUE_RESET) && has({ role: ORG_ROLE.ADMIN });

  return (
    <>
      <TitleBar
        title="Personalization"
        description="Researched leads waiting on your decision. Each one arrives with a brief: what is known, what is inferred, what could not be reached, and the one question worth asking. Nothing here has been sent."
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
              title="No briefs yet"
              description={waitingCount > 0
                ? `${waitingCount} ${waitingCount === 1 ? 'lead is' : 'leads are'} recorded and waiting to be researched. A lead appears here once its brief is written, so this fills in as the hourly sweep works through them.`
                : 'The hourly sweep queues each new MQL, researches it, and posts the brief here. Ask the RevOps Lead to run a pass in chat, or wait for the next sweep.'}
            />
          )
        : <PersonalizationQueue briefs={briefs} />}
    </>
  );
}
