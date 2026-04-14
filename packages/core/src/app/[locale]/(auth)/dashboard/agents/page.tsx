import { auth } from '@clerk/nextjs/server';
import { Bot } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { Link } from '@/libs/I18nNavigation';
import { listAgents } from '@/services/AgentService';

export default async function AgentsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();

  const agents = orgId ? await listAgents(orgId) : [];

  return (
    <>
      <TitleBar
        title="Agents"
        description="LLM orchestrators that wire Skills + Workflows into a named operating identity. Authored in context/<org>/agents/."
      />

      {agents.length === 0
        ? (
            <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">
              No agents defined yet. Add one to
              {' '}
              <code className="rounded bg-muted px-1">context/&lt;org&gt;/agents/</code>
              {' '}
              and run
              {' '}
              <code className="rounded bg-muted px-1">npm run context:apply</code>
              .
            </div>
          )
        : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {agents.map(a => (
                <Link
                  key={a.id}
                  href={`/dashboard/agents/${a.slug}`}
                  className="rounded-lg border border-border bg-background p-4 transition hover:border-primary/30"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <Bot className="size-4 text-primary" />
                    <span className="text-sm font-medium">{a.name}</span>
                    <Badge variant={a.active === 'true' ? 'default' : 'secondary'} className="ml-auto">{a.active === 'true' ? 'active' : 'inactive'}</Badge>
                  </div>
                  <div className="mb-2 font-mono text-[11px] text-muted-foreground">{a.slug}</div>
                  {a.description && <p className="text-xs leading-relaxed text-muted-foreground">{a.description}</p>}
                  <div className="mt-3 text-[11px] text-muted-foreground">
                    {a.skillSlugs?.length ?? 0}
                    {' '}
                    skills wired
                  </div>
                </Link>
              ))}
            </div>
          )}
    </>
  );
}
