import { ArrowRight, Sparkles } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { listCandidates } from '@/services/LearningCandidateService';
import { listSteps } from '@/services/LearningsService';
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
    listSteps(orgId),
    listCandidates(orgId, { status: 'pending', limit: CANDIDATE_PAGE_SIZE }),
  ]);

  return (
    <>
      <TitleBar
        title={(
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="size-5" />
            </div>
            <span>Learnings</span>
          </div>
        )}
        description="Whitelisted rule buckets the self-improver agent feeds, gated by human approval. Each step is mounted into the agent's virtual FS at /learnings/<step>.md."
      />

      <PendingCandidates
        candidates={pending.items.map(candidate => ({
          id: candidate.id,
          stepName: candidate.stepName,
          ruleText: candidate.ruleText,
          editedRuleText: candidate.editedRuleText,
          sourceFeedbackJobId: candidate.sourceFeedbackJobId,
          createdAt: candidate.createdAt.toISOString(),
        }))}
        total={pending.total}
        pageSize={CANDIDATE_PAGE_SIZE}
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
            <ul className="grid gap-3 sm:grid-cols-2">
              {steps.map(s => (
                <li key={s.name}>
                  <Link
                    href={`/dashboard/learnings/${s.name}`}
                    className="block rounded-xl border border-border bg-background p-5 transition hover:border-primary/30"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-base font-semibold">{s.title}</h3>
                        <code className="font-mono text-xs text-muted-foreground">{s.name}</code>
                      </div>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{s.description}</p>
                    <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">
                        {s.ruleCount}
                        {' '}
                        rule
                        {s.ruleCount === 1 ? '' : 's'}
                      </span>
                      {s.agentSlugs.length > 0 && (
                        <>
                          <span aria-hidden>·</span>
                          <div className="flex flex-wrap gap-1">
                            {s.agentSlugs.slice(0, 3).map(slug => (
                              <Badge key={slug} variant="outline" className="text-[10px]">
                                {slug}
                              </Badge>
                            ))}
                            {s.agentSlugs.length > 3 && (
                              <span className="text-[10px]">
                                +
                                {s.agentSlugs.length - 3}
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
    </>
  );
}
