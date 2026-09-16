import { and, eq, inArray, sql } from 'drizzle-orm';
import { Sparkles } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow, ListRows } from '@/components/ui/list-row';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { learningFeedbackOccurrenceSchema } from '@/models/Schema';
import { listCandidates } from '@/services/LearningCandidateService';
import { listNamespaces } from '@/services/MemoryService';
import { PendingCandidates } from './PendingCandidates';

/**
 * Learnings list — one row per step (e.g. `meeting_triage`,
 * `support_reply_review`). Each step holds a bucket of approved rules
 * the agent reads at `/learnings/<step>.md` in its virtual filesystem.
 *
 * The feedback worker proposes new rules at runtime; humans approve them here
 * before they land in the bucket. Pending suggestions show at the top of this
 * page, and the same decisions are available over
 * `/api/v1/learning-candidates` so an external admin panel can drive them too.
 * @param props
 * @param props.params
 */
export default async function LearningsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    notFound();
  }

  const CANDIDATE_PAGE_SIZE = 20;
  const [steps, pending] = await Promise.all([
    listNamespaces(orgId),
    listCandidates(orgId, { status: 'pending', limit: CANDIDATE_PAGE_SIZE }),
  ]);

  // Scope options per candidate: the agent whose output drew the feedback and
  // the person who gave it, read off the occurrence evidence. These are what
  // the card's scope select can re-target to.
  const candidateIds = pending.items.map(c => c.id);
  const occurrenceRefs = candidateIds.length > 0
    ? await db
        .select({
          candidateId: learningFeedbackOccurrenceSchema.candidateId,
          agentSlug: sql<string | null>`max(${learningFeedbackOccurrenceSchema.agentSlug})`,
          submittedBy: sql<string | null>`max(${learningFeedbackOccurrenceSchema.submittedBy})`,
        })
        .from(learningFeedbackOccurrenceSchema)
        .where(and(
          eq(learningFeedbackOccurrenceSchema.orgId, orgId),
          inArray(learningFeedbackOccurrenceSchema.candidateId, candidateIds),
        ))
        .groupBy(learningFeedbackOccurrenceSchema.candidateId)
    : [];
  const refsByCandidate = new Map(occurrenceRefs.map(r => [r.candidateId, r]));

  return (
    <>
      <TitleBar
        title="Learnings"
        description="Whitelisted memory namespaces the feedback loop feeds, gated by human approval. Each one mounts into the agent's virtual FS under /memories/<path>/."
      />

      <PendingCandidates
        candidates={pending.items.map(candidate => ({
          id: candidate.id,
          stepName: candidate.stepName,
          ruleText: candidate.ruleText,
          editedRuleText: candidate.editedRuleText,
          sourceFeedbackJobId: candidate.sourceFeedbackJobId,
          polarity: candidate.polarity,
          occurrenceCount: candidate.occurrenceCount,
          createdAt: candidate.createdAt.toISOString(),
          memoryType: candidate.memoryType,
          scopeKind: candidate.scopeKind,
          scopeRef: candidate.scopeRef,
          agentRef: refsByCandidate.get(candidate.id)?.agentSlug ?? null,
          userRef: refsByCandidate.get(candidate.id)?.submittedBy ?? null,
        }))}
        total={pending.total}
        pageSize={CANDIDATE_PAGE_SIZE}
        steps={steps.map(s => ({ name: s.name, title: s.title }))}
      />

      {steps.length === 0
        ? (
            <EmptyState
              title="No learning steps yet"
              description="Author one at workspace/<org>/learnings/<step>.yaml and run `npm run workspace:apply` to register the bucket. Then add rules here or let the self-improver propose them."
              icon={Sparkles}
            />
          )
        : (
            <ListRows className="border-y border-border/70">
              {steps.map(s => (
                <ListRow
                  key={s.name}
                  href={`/dashboard/learnings/${s.name}`}
                  icon={Sparkles}
                  title={s.title}
                  meta={(
                    <>
                      <code className="font-mono">{s.name}</code>
                      {s.description && (
                        <>
                          {' '}
                          ·
                          {' '}
                          {s.description}
                        </>
                      )}
                    </>
                  )}
                  trailing={(
                    <span className="flex items-center gap-2">
                      {s.agentSlugs.slice(0, 2).map(slug => (
                        <Badge key={slug} variant="outline">{slug}</Badge>
                      ))}
                      {s.agentSlugs.length > 2 && (
                        <span>
                          +
                          {s.agentSlugs.length - 2}
                        </span>
                      )}
                      <span className="tabular-nums">
                        {s.ruleCount}
                        {' '}
                        rule
                        {s.ruleCount === 1 ? '' : 's'}
                      </span>
                    </span>
                  )}
                />
              ))}
            </ListRows>
          )}
    </>
  );
}
