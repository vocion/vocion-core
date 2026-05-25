import { ArrowLeft, Bot } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { StatusPill } from '@/components/ui/status-pill';
import { PrimitiveFiles } from '@/features/dashboard/PrimitiveFiles';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { getContextDirtyState } from '@/libs/context/dirty';
import { readPrimitiveFiles } from '@/libs/context/reader';
import { Link } from '@/libs/I18nNavigation';
import { getAgent } from '@/services/AgentService';

export default async function AgentDetailPage(props: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();

  if (!orgId) {
    return notFound();
  }
  const agent = await getAgent(orgId, slug);
  if (!agent) {
    return notFound();
  }

  const sourceFiles = readPrimitiveFiles('agent', slug);
  const dirtyState = getContextDirtyState();
  const skills = agent.skillSlugs ?? [];

  return (
    <>
      <div className="mb-4">
        <Link
          href="/dashboard/agents"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          Back to Agents
        </Link>
      </div>

      <TitleBar
        title={(
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-[var(--brand-amber-tint)] text-[var(--brand-amber-deep)]">
              <Bot className="size-5" aria-hidden />
            </div>
            <div>
              <div className="font-display">{agent.name}</div>
              <div className="mt-0.5 flex items-center gap-2 text-sm font-normal">
                <StatusPill status={agent.active === 'true' ? 'active' : 'inactive'} size="sm" />
                <span className="font-mono text-xs text-muted-foreground">{agent.slug}</span>
              </div>
            </div>
          </div>
        )}
        description={agent.description ?? undefined}
      />

      <section className="mb-8">
        <h2 className="mb-3 font-display text-sm font-semibold">Wired skills</h2>
        {skills.length === 0
          ? (
              <p className="text-sm text-muted-foreground">No skills wired yet.</p>
            )
          : (
              <div className="flex flex-wrap gap-1.5">
                {skills.map(s => (
                  <Link
                    key={s}
                    href={`/dashboard/operations/${s}`}
                    className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground/80 transition hover:border-primary/30 hover:text-foreground"
                  >
                    {s}
                  </Link>
                ))}
              </div>
            )}
      </section>

      {sourceFiles && (
        <section className="mt-2">
          <h2 className="mb-3 font-display text-sm font-semibold">Source files</h2>
          <PrimitiveFiles
            files={sourceFiles.files}
            editInGitPath={sourceFiles.editInGitPath}
            dirty={dirtyState.dirty}
            dirtyFiles={dirtyState.changedFiles}
          />
        </section>
      )}
    </>
  );
}
