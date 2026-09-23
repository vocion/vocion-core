import { and, count, eq } from 'drizzle-orm';
import { Sparkles } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { ListEmpty, ListPage } from '@/components/patterns';
import { BulkActionsButton } from '@/features/personalization/BulkActionsButton';
import { PersonalizationQueue } from '@/features/personalization/PersonalizationQueue';
import { QueueResetControl } from '@/features/personalization/QueueResetControl';
import { loadQueueBriefRows } from '@/features/personalization/queueRows';
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
 * Nothing here has been sent. The queue is a pure list: each row links to the
 * lead's own page (`/gtm/lead/{hubspot_id}`), where the brief, the evidence
 * and the decision live. Deciding there is the SAME operation on the SAME run
 * as deciding on the review queue.
 *
 * Optional surface at `/gtm/personalization`. Linked only where
 * `workspace.yaml` lists `surfaces: [personalization]` (see
 * `features/navigation/surfaces.ts`).
 *
 * The reference implementation of the List archetype
 * (`components/patterns`, `docs/design/patterns.md`).
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

  const briefs = await loadQueueBriefRows(orgId);

  // The count behind the empty state: leads recorded but not yet briefed.
  const [waiting] = await db
    .select({ n: count() })
    .from(leadBriefSchema)
    .where(and(
      eq(leadBriefSchema.orgId, orgId),
      eq(leadBriefSchema.status, QUEUED_STATUS),
    ));
  const waitingCount = waiting?.n ?? 0;

  // TEMPORARY (phase 2): the reset escape hatch. Absent unless the flag is set.
  const canReset = Boolean(Env.VOCION_ALLOW_QUEUE_RESET) && has({ role: ORG_ROLE.ADMIN });

  return (
    <ListPage
      title="Personalization"
      description="Researched leads waiting on your decision. Each row opens the lead's page: the brief, the evidence, and the decision. Nothing here has been sent."
      actions={(
        <div className="flex items-center gap-2">
          <BulkActionsButton />
          {canReset && <QueueResetControl rowCount={briefs.length} />}
        </div>
      )}
    >
      {briefs.length === 0
        ? (
            <ListEmpty
              icon={Sparkles}
              title="No briefs yet"
              description={waitingCount > 0
                ? `${waitingCount} ${waitingCount === 1 ? 'lead is' : 'leads are'} recorded and waiting to be researched. A lead appears here once its brief is written, so this fills in as the hourly sweep works through them.`
                : 'The hourly sweep queues each new MQL, researches it, and posts the brief here. Ask the RevOps Lead to run a pass in chat, or wait for the next sweep.'}
            />
          )
        : <PersonalizationQueue briefs={briefs} />}
    </ListPage>
  );
}
