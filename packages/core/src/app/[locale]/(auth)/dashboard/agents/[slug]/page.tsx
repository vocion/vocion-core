import { ArrowLeft, Bot, FileText, Users } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { StatusPill } from '@/components/ui/status-pill';
import { PrimitiveFiles } from '@/features/dashboard/PrimitiveFiles';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { getWorkspaceDirtyState } from '@/libs/workspace/dirty';
import { readPrimitiveFiles } from '@/libs/workspace/reader';
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
  const dirtyState = getWorkspaceDirtyState();
  const skills = agent.skillSlugs ?? [];
  const subagents = agent.subagents ?? [];
  const promptIsLong = agent.systemPrompt.length > 2000;
  const systemPromptBlock = (
    <pre className="max-h-[32rem] overflow-auto rounded-md bg-muted/40 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">{agent.systemPrompt}</pre>
  );

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

      <section className="mb-6 rounded-md border border-border p-5">
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
          <FileText className="size-4 text-primary" />
          System prompt
        </h2>
        {promptIsLong
          ? (
              <details>
                <summary className="cursor-pointer text-sm font-medium text-primary">
                  Show full prompt (
                  {agent.systemPrompt.length.toLocaleString()}
                  {' '}
                  characters)
                </summary>
                <div className="mt-3">{systemPromptBlock}</div>
              </details>
            )
          : systemPromptBlock}
      </section>

      {subagents.length > 0 && (
        <section className="mb-6 rounded-md border border-border p-5">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
            <Users className="size-4 text-primary" />
            Subagents
          </h2>
          <div className="flex flex-col">
            {subagents.map(sa => (
              <div key={sa.name} className="border-b border-border py-2.5 last:border-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-medium">{sa.name}</span>
                  {sa.model && <span className="font-mono text-[11px] text-muted-foreground">{sa.model}</span>}
                  {sa.tools && sa.tools.length > 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      tools:
                      {' '}
                      {sa.tools.join(', ')}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{sa.description}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">The parent agent dispatches these via the task tool; each runs with its own prompt.</p>
        </section>
      )}

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
                    href={`/dashboard/skills/${s}`}
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
