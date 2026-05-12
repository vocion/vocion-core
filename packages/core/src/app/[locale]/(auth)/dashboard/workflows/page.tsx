import { auth } from '@clerk/nextjs/server';
import { GitBranch } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill } from '@/components/ui/status-pill';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { Link } from '@/libs/I18nNavigation';
import { listWorkflows } from '@/services/WorkflowService';
import { isEntityStatus } from '@/types/Status';

export default async function WorkflowsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();

  const workflows = orgId ? await listWorkflows(orgId) : [];
  const active = workflows.filter(w => w.status === 'active');

  return (
    <>
      <TitleBar
        title="Workflows"
        description="Sequences of skills + HITL approve gates, authored in context/<org>/workflows/."
      />

      <div className="mb-6 grid grid-cols-3 gap-3 sm:grid-cols-4">
        <Stat label="Total" value={workflows.length} />
        <Stat label="Active" value={active.length} />
        <Stat label="Inactive" value={workflows.length - active.length} />
      </div>

      {workflows.length === 0
        ? (
            <EmptyState
              icon={GitBranch}
              title="No workflows yet"
              description="Workflows are sequences of Skills with optional human-approval gates and persistent state. Author one in context/<org>/workflows/ and run npm run context:apply."
              action={{ label: 'How to author a workflow', href: '/dashboard/docs/docs/concepts/workflows' }}
            />
          )
        : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {workflows.map((w) => {
                const steps = Array.isArray(w.steps) ? w.steps.length : 0;
                return (
                  <Link
                    key={w.id}
                    href={`/dashboard/workflows/${w.slug}`}
                    className="rounded-lg border border-border bg-background p-4 transition hover:border-primary/30"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <GitBranch className="size-4 text-primary" />
                      <span className="text-sm font-medium">{w.name}</span>
                      <span className="ml-auto">
                        <StatusPill status={w.status && isEntityStatus(w.status) ? w.status : 'inactive'} />
                      </span>
                    </div>
                    <div className="mb-2 font-mono text-[11px] text-muted-foreground">{w.slug}</div>
                    {w.description && <p className="text-xs leading-relaxed text-muted-foreground">{w.description}</p>}
                    <div className="mt-3 text-[11px] text-muted-foreground">
                      {steps}
                      {' '}
                      {steps === 1 ? 'step' : 'steps'}
                      {' · v'}
                      {w.version ?? 1}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border p-3 text-center">
      <div className="text-xl font-bold">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
