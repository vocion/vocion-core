import type { DiscoveryEntry } from '@/features/discovery/DiscoveryLedger';
import { desc, eq } from 'drizzle-orm';
import { Radar } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { ListEmpty, ListPage } from '@/components/patterns';
import { DiscoveryLedger } from '@/features/discovery/DiscoveryLedger';
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
 *
 * The reference implementation of the Ledger archetype
 * (`components/patterns`, `docs/design/patterns.md`). This file reads; the
 * ledger itself is `features/discovery/DiscoveryLedger`.
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
    })
    .from(discoveryCandidateSchema)
    .leftJoin(actionRunSchema, eq(actionRunSchema.id, discoveryCandidateSchema.reviewActionRunId))
    .where(eq(discoveryCandidateSchema.orgId, orgId))
    .orderBy(desc(discoveryCandidateSchema.matchedAt))
    .limit(200);

  // Dates cross the server/client boundary as ISO strings.
  const entries: DiscoveryEntry[] = rows.map(({ candidate: c, reviewStatus }) => ({
    id: c.id,
    title: c.meetingTitle ?? c.meetingExternalId,
    when: c.meetingStart?.toISOString() ?? null,
    matchedAt: c.matchedAt.toISOString(),
    matchReason: c.matchReason,
    status: c.status,
    route: c.route,
    classification: c.classification
      ? {
          isDiscovery: c.classification.isDiscovery,
          isDiscoveryConfidence: c.classification.isDiscoveryConfidence,
          proposalReady: c.classification.proposalReady,
          proposalReadyConfidence: c.classification.proposalReadyConfidence,
          reasoning: c.classification.reasoning,
        }
      : null,
    thresholds: c.thresholds,
    skippedReason: c.skippedReason,
    classifierVersion: c.classifierVersion,
    assessedBy: c.assessedBy,
    transcriptHash: c.transcriptHash,
    workspaceSha: c.workspaceSha,
    reviewActionRunId: c.reviewActionRunId,
    reviewStatus: reviewStatus ?? null,
  }));

  return (
    <ListPage
      title="Discovery ledger"
      description="Every call the detection agent assessed — what it read, how it scored, the thresholds it decided under, and what a human did with it."
    >
      {entries.length === 0
        ? (
            <ListEmpty
              icon={Radar}
              title="No assessed calls yet"
              description="The hourly discovery check records every matched meeting here — or ask the RevOps Lead to run a detection pass in chat."
            />
          )
        : <DiscoveryLedger entries={entries} />}
    </ListPage>
  );
}
