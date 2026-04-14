import { auth } from '@clerk/nextjs/server';
import { ArrowLeft, Bot, CheckCircle2, Clock } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { PrimitiveFiles } from '@/features/dashboard/PrimitiveFiles';
import { TitleBar } from '@/features/dashboard/TitleBar';
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
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Bot className="size-5" />
            </div>
            <div>
              <div>{agent.name}</div>
              <div className="flex items-center gap-2 text-sm font-normal">
                <Badge variant={agent.active === 'true' ? 'default' : 'outline'}>
                  {agent.active === 'true' ? <CheckCircle2 className="mr-1 size-3" /> : <Clock className="mr-1 size-3" />}
                  {agent.active === 'true' ? 'active' : 'inactive'}
                </Badge>
                <span className="font-mono text-xs text-muted-foreground">{agent.slug}</span>
              </div>
            </div>
          </div>
        )}
        description={agent.description ?? undefined}
      />

      <div className="mb-8 grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-border p-4">
          <div className="mb-1 text-xs text-muted-foreground">Wired skills</div>
          <div className="text-2xl font-semibold">{agent.skillSlugs?.length ?? 0}</div>
          <div className="mt-2 flex flex-wrap gap-1">
            {agent.skillSlugs?.slice(0, 6).map(s => (
              <span key={s} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{s}</span>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-border p-4">
          <div className="mb-1 text-xs text-muted-foreground">Created</div>
          <div className="text-sm">{new Date(agent.createdAt).toLocaleDateString()}</div>
        </div>
        <div className="rounded-lg border border-border p-4">
          <div className="mb-1 text-xs text-muted-foreground">Updated</div>
          <div className="text-sm">{new Date(agent.updatedAt).toLocaleDateString()}</div>
        </div>
      </div>

      {sourceFiles && (
        <section className="mt-2">
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Source files</h2>
          <PrimitiveFiles files={sourceFiles.files} editInGitPath={sourceFiles.editInGitPath} />
        </section>
      )}
    </>
  );
}
