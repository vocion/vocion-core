import { auth } from '@clerk/nextjs/server';
import { Search, Send, Zap } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { Link } from '@/libs/I18nNavigation';
import { listSkills } from '@/services/SkillService';

const categoryIcons: Record<string, React.ReactNode> = {
  query: <Search className="size-4" />,
  mutation: <Send className="size-4" />,
  composite: <Zap className="size-4" />,
};

const categoryLabels: Record<string, string> = {
  query: 'Query',
  mutation: 'Action',
  composite: 'Composite',
};

export default async function SkillsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();

  const skills = orgId ? await listSkills(orgId) : [];

  const activeSkills = skills.filter(s => s.status === 'active');
  const disabledSkills = skills.filter(s => s.status !== 'active');

  return (
    <>
      <TitleBar
        title="Skills"
        description="Configurable LLM-powered capabilities for your agents"
      />

      {/* Stats */}
      <div className="mb-6 grid grid-cols-3 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-border p-3 text-center">
          <div className="text-xl font-bold">{skills.length}</div>
          <div className="text-[11px] text-muted-foreground">Total Skills</div>
        </div>
        <div className="rounded-lg border border-border p-3 text-center">
          <div className="text-xl font-bold text-green-600">{activeSkills.length}</div>
          <div className="text-[11px] text-muted-foreground">Active</div>
        </div>
        <div className="rounded-lg border border-border p-3 text-center">
          <div className="text-xl font-bold text-muted-foreground">{disabledSkills.length}</div>
          <div className="text-[11px] text-muted-foreground">Planned</div>
        </div>
        <div className="hidden rounded-lg border border-border p-3 text-center sm:block">
          <div className="text-xl font-bold">{skills.filter(s => s.requiresApproval === 'true').length}</div>
          <div className="text-[11px] text-muted-foreground">Require HITL</div>
        </div>
      </div>

      {/* Active Skills */}
      {activeSkills.length > 0 && (
        <div className="mb-6">
          <div className="mb-3 text-sm font-semibold">Active Skills</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {activeSkills.map(skill => (
              <Link
                key={skill.id}
                href={`/dashboard/skills/${skill.slug}`}
                className="rounded-lg border border-green-200 bg-green-50/30 p-4 transition-all hover:border-green-300 hover:shadow-sm dark:border-green-900 dark:bg-green-950/20"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {categoryIcons[skill.category ?? 'query']}
                    <span className="font-semibold">{skill.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {skill.requiresApproval === 'true'
                      ? <Badge variant="outline" className="text-[9px] text-amber-600">HITL</Badge>
                      : <Badge variant="outline" className="text-[9px] text-green-600">Auto</Badge>}
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-[9px] font-medium text-green-800">Active</span>
                  </div>
                </div>
                <div className="mt-2 text-sm text-muted-foreground">{skill.description}</div>
                <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span>
                    Model:
                    {skill.model}
                  </span>
                  <span>
                    Temp:
                    {skill.temperature}
                  </span>
                  <span>
                    v
                    {skill.version}
                  </span>
                  <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{categoryLabels[skill.category ?? 'query']}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Planned Skills */}
      {disabledSkills.length > 0 && (
        <div>
          <div className="mb-3 text-sm font-semibold text-muted-foreground">Planned Skills</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {disabledSkills.map(skill => (
              <div
                key={skill.id}
                className="rounded-lg border border-border p-4 opacity-60"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {categoryIcons[skill.category ?? 'query']}
                    <span className="font-medium">{skill.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {skill.requiresApproval === 'true'
                      ? <Badge variant="outline" className="text-[9px] text-amber-600">HITL</Badge>
                      : <Badge variant="outline" className="text-[9px] text-green-600">Auto</Badge>}
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] font-medium text-muted-foreground">Planned</span>
                  </div>
                </div>
                <div className="mt-2 text-sm text-muted-foreground">{skill.description}</div>
                <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span>{categoryLabels[skill.category ?? 'query']}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
