import { auth } from '@clerk/nextjs/server';
import { Search, Send, Zap } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill } from '@/components/ui/status-pill';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { Link } from '@/libs/I18nNavigation';
import { listSkills } from '@/services/SkillService';
import { isEntityStatus } from '@/types/Status';

const categoryIcons: Record<string, React.ReactNode> = {
  query: <Search className="size-4 text-primary" />,
  mutation: <Send className="size-4 text-primary" />,
  composite: <Zap className="size-4 text-primary" />,
};

export default async function SkillsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();

  const skills = orgId ? await listSkills(orgId) : [];
  const active = skills.filter(s => s.status === 'active');
  const hitl = skills.filter(s => s.requiresApproval === 'true');

  return (
    <>
      <TitleBar
        title="Skills"
        description="LLM-powered units of work with typed I/O, authored in context/<org>/skills/. Prompt or plugin form — same contract."
      />

      <div className="mb-6 grid grid-cols-3 gap-3 sm:grid-cols-4">
        <Stat label="Total" value={skills.length} />
        <Stat label="Active" value={active.length} />
        <Stat label="Inactive" value={skills.length - active.length} />
        <Stat label="Require HITL" value={hitl.length} />
      </div>

      {skills.length === 0
        ? (
            <EmptyState
              icon={Zap}
              title="No operations yet"
              description="Operations are single LLM-powered units of work with typed inputs and outputs. Author one in context/<org>/operations/ and run npm run context:apply."
              action={{ label: 'How to author an operation', href: '/dashboard/docs/docs/concepts/skills' }}
            />
          )
        : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {skills.map(skill => (
                <Link
                  key={skill.id}
                  href={`/dashboard/skills/${skill.slug}`}
                  className={`rounded-lg border border-border bg-background p-4 transition hover:border-primary/30 ${skill.status !== 'active' ? 'opacity-60' : ''}`}
                >
                  <div className="mb-2 flex items-center gap-2">
                    {categoryIcons[skill.category ?? 'query']}
                    <span className="text-sm font-medium">{skill.name}</span>
                    <span className="ml-auto">
                      <StatusPill status={skill.status && isEntityStatus(skill.status) ? skill.status : 'inactive'} />
                    </span>
                  </div>
                  <div className="mb-2 font-mono text-[11px] text-muted-foreground">{skill.slug}</div>
                  {skill.description && <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{skill.description}</p>}
                  <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="font-mono">{skill.model}</span>
                    <span>·</span>
                    <span>
                      v
                      {skill.version}
                    </span>
                    {skill.requiresApproval === 'true' && (
                      <>
                        <span>·</span>
                        <Badge variant="outline" className="text-[10px]">HITL</Badge>
                      </>
                    )}
                  </div>
                </Link>
              ))}
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
