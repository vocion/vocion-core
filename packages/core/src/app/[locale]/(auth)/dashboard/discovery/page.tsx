import { desc, eq } from 'drizzle-orm';
import { Radar } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/ui/empty-state';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { actionRunSchema, discoveryCandidateSchema } from '@/models/Schema';

/**
 * Discovery ledger — somewhere to look. Every call the system assessed, with
 * what it read and how it decided: meeting, match reason, both scores, the
 * route, the thresholds in force, the classifier version, who ordered it, and
 * the eventual human decision. Dropped calls are rows here too — a call
 * classified as not-discovery has its scores and reasoning, not an absence —
 * and matched-but-not-assessed calls show their `skipped_reason`.
 * @param props
 * @param props.params
 */
export default async function DiscoveryLedgerPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    return null;
  }

  const rows = await db
    .select({
      candidate: discoveryCandidateSchema,
      reviewStatus: actionRunSchema.status,
      reviewInvokedBy: actionRunSchema.invokedBy,
      reviewExecutedAt: actionRunSchema.executedAt,
    })
    .from(discoveryCandidateSchema)
    .leftJoin(actionRunSchema, eq(actionRunSchema.id, discoveryCandidateSchema.reviewActionRunId))
    .where(eq(discoveryCandidateSchema.orgId, orgId))
    .orderBy(desc(discoveryCandidateSchema.matchedAt))
    .limit(200);

  return (
    <>
      <TitleBar
        title="Discovery ledger"
        description="Every call the detection agent assessed — what it read, how it scored, the thresholds it decided under, and what a human did with it."
      />

      {rows.length === 0
        ? (
            <EmptyState
              icon={Radar}
              title="No assessed calls yet"
              description="The hourly discovery check records every matched meeting here — or ask the RevOps Lead to run a detection pass in chat."
            />
          )
        : (
            <div className="flex flex-col gap-2">
              {rows.map(({ candidate: c, reviewStatus }) => {
                const cls = c.classification;
                return (
                  <div key={c.id} className="rounded-lg border border-border bg-background p-4 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="font-medium">
                        {c.meetingTitle ?? c.meetingExternalId}
                        {c.meetingStart && (
                          <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                            {c.meetingStart.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[11px]">
                        {c.route && (
                          <span className={`rounded px-1.5 py-0.5 font-medium ${c.route === 'drop' ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}`}>
                            {c.route}
                          </span>
                        )}
                        <span className="text-muted-foreground">{c.status}</span>
                        {reviewStatus && (
                          <span className="text-muted-foreground" title="Review-queue decision">
                            review:
                            {' '}
                            {reviewStatus}
                          </span>
                        )}
                        {c.skippedReason && (
                          <span className="text-amber-600" title="Matched but not assessed">
                            skipped:
                            {' '}
                            {c.skippedReason}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-1 text-[12px] text-muted-foreground">{c.matchReason}</div>

                    {cls && (
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                        <span>
                          discovery
                          {' '}
                          {cls.isDiscovery ? 'yes' : 'no'}
                          {' '}
                          (
                          {cls.isDiscoveryConfidence.toFixed(2)}
                          )
                        </span>
                        <span>
                          proposal-ready
                          {' '}
                          {cls.proposalReady ? 'yes' : 'no'}
                          {' '}
                          (
                          {cls.proposalReadyConfidence.toFixed(2)}
                          )
                        </span>
                        {c.thresholds && (
                          <span className="text-muted-foreground">
                            thresholds
                            {' '}
                            {c.thresholds.discovery}
                            {' / '}
                            {c.thresholds.ready}
                          </span>
                        )}
                      </div>
                    )}
                    {cls?.reasoning && (
                      <div className="mt-1 text-[12px] text-muted-foreground">{cls.reasoning}</div>
                    )}

                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground/80">
                      {c.classifierVersion && (
                        <span title="Model + prompt version">{c.classifierVersion}</span>
                      )}
                      {c.assessedBy?.agentSlug && (
                        <span title={c.assessedBy.missionRunId ? `mission_run #${c.assessedBy.missionRunId}` : 'chat turn'}>
                          by
                          {' '}
                          {c.assessedBy.agentSlug}
                          {c.assessedBy.missionRunId ? ` (mission run #${c.assessedBy.missionRunId})` : ''}
                        </span>
                      )}
                      {c.transcriptHash && (
                        <span title="knowledge_document.contentHash at read time">
                          transcript
                          {' '}
                          {c.transcriptHash.slice(0, 12)}
                        </span>
                      )}
                      {c.workspaceSha && (
                        <span title="Workspace sha at assessment">
                          ws
                          {' '}
                          {c.workspaceSha.slice(0, 12)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
    </>
  );
}
