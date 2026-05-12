import { auth } from '@clerk/nextjs/server';
import { Bot } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill } from '@/components/ui/status-pill';
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
            <EmptyState
              icon={Bot}
              title="No agents yet"
              description="Agents wire Skills and Workflows into a named operating identity. Author one in context/<org>/agents/ and run npm run context:apply."
              action={{ label: 'How to create an agent', href: '/dashboard/docs/docs/concepts/agents' }}
            />
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
                    <span className="ml-auto">
                      <StatusPill status={a.active === 'true' ? 'active' : 'inactive'} />
                    </span>
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
