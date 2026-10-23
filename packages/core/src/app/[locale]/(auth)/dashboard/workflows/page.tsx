import { Compass, GitBranch } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { ListPage, ListRow, ListRows, Stat, StatRow, Subline } from '@/components/patterns';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill } from '@/components/ui/status-pill';
import { TriggerBadge } from '@/features/dashboard/TriggerBadge';
import { clerkAuth as auth } from '@/libs/Auth';
import { listAgents } from '@/services/AgentService';
import { listWorkflows } from '@/services/WorkflowService';
import { isEntityStatus } from '@/types/Status';

export default async function WorkflowsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();

  const workflows = orgId ? await listWorkflows(orgId) : [];
  const agents = orgId ? await listAgents(orgId) : [];
  const agentNameBySlug = new Map(agents.map(ag => [ag.slug, ag.name]));
  const active = workflows.filter(w => w.status === 'active');

  return (
    <ListPage
      title="Workflows"
      description="Repeatable work in set steps, with a person's approval where it matters."
    >
      {workflows.length > 0 && (
        <StatRow className="mb-6 grid-cols-3">
          <Stat label="Total" value={workflows.length} />
          <Stat label="Active" value={active.length} />
          <Stat label="Inactive" value={workflows.length - active.length} />
        </StatRow>
      )}

      {workflows.length === 0
        ? (
            <EmptyState
              icon={GitBranch}
              title="No workflows yet"
              description="A workflow runs the same steps every time, and stops for a person's approval where it matters."
              action={{ label: 'Browse apps', href: '/dashboard/apps' }}
              authoring={(
                <>
                  A workflow is a YAML file under
                  {' '}
                  <code>workflows/</code>
                  {' '}
                  in the workspace, applied with the rest of it.
                </>
              )}
              secondaryAction={{ label: 'How workflows work', href: '/dashboard/docs/docs/concepts/workflows' }}
            />
          )
        : (
            <ListRows>
              {workflows.map((w) => {
                const steps = Array.isArray(w.steps) ? w.steps.length : 0;
                const owner = w.ownerAgentSlug
                  ? (
                      <span className="inline-flex items-center gap-1" title="Owning agent">
                        <Compass className="size-3" />
                        {agentNameBySlug.get(w.ownerAgentSlug) ?? w.ownerAgentSlug}
                      </span>
                    )
                  : null;
                return (
                  <ListRow
                    key={w.id}
                    href={`/dashboard/workflows/${w.slug}`}
                    icon={GitBranch}
                    title={w.name}
                    subline={(
                      <Subline
                        separator="·"
                        segments={[
                          <span key="slug" className="font-mono">{w.slug}</span>,
                          w.description,
                          <TriggerBadge key="trigger" trigger={w.trigger} />,
                          `${steps} ${steps === 1 ? 'step' : 'steps'} · v${w.version ?? 1}`,
                          owner,
                        ]}
                      />
                    )}
                    chip={<StatusPill status={w.status && isEntityStatus(w.status) ? w.status : 'inactive'} />}
                  />
                );
              })}
            </ListRows>
          )}
    </ListPage>
  );
}
