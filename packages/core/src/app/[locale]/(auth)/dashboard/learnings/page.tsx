import { ArrowRight, Sparkles } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { listSteps } from '@/services/LearningsService';

/**
 * Learnings list — one row per step (e.g. `meeting_triage`,
 * `support_reply_review`). Each step holds a bucket of approved rules
 * the agent reads at `/learnings/<step>.md` in its virtual filesystem.
 *
 * The self-improver subagent proposes new rules at runtime; humans
 * approve them via this UI before they land in the bucket. v0.5 ships
 * with manual add/edit/remove (the approve-flow for self-improver
 * candidates is a v0.5.1 follow-up).
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

  const steps = await listSteps(orgId);

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
        description="Whitelisted rule buckets the self-improver subagent feeds, gated by human approval. Each step is mounted into the agent's virtual FS at /learnings/<step>.md."
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
