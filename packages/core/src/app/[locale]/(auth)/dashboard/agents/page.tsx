import { auth } from '@clerk/nextjs/server';
import { Bot } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { CatalogCard } from '@/components/ui/catalog-card';
import { EmptyState } from '@/components/ui/empty-state';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { listAgents } from '@/services/AgentService';

/**
 * Resolve a per-agent accent CSS color from the agent's authored
 * `accent` field. Falls back to amber. Mirrors libs/agentAccent.ts
 * but returns a CSS var for inline `style` use rather than Tailwind
 * class strings.
 */
function accentCssVar(name: string | null | undefined): string {
  if (name === 'teal') {
    return 'var(--brand-teal)';
  }
  return 'var(--brand-amber)';
}

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
        description="LLM orchestrators that wire Skills + Workflows into a named operating identity."
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
              {agents.map((a) => {
                const skillCount = a.skillSlugs?.length ?? 0;
                return (
                  <CatalogCard
                    key={a.id}
                    href={`/dashboard/agents/${a.slug}`}
                    icon={Bot}
                    title={a.name}
                    slug={a.slug}
                    description={a.description ?? undefined}
                    status={a.active === 'true' ? 'active' : 'inactive'}
                    accentColor={accentCssVar(a.accent)}
                    footer={(
                      <>
                        {skillCount}
                        {' '}
                        skill
                        {skillCount === 1 ? '' : 's'}
                        {' '}
                        wired
                      </>
                    )}
                  />
                );
              })}
            </div>
          )}
    </>
  );
}
