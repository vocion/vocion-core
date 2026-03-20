import { auth } from '@clerk/nextjs/server';
import { ArrowLeft, CheckCircle2, Clock, Search, Send, Zap } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { Link } from '@/libs/I18nNavigation';
import { getSkill } from '@/services/SkillService';

const categoryIcons: Record<string, React.ReactNode> = {
  query: <Search className="size-5" />,
  mutation: <Send className="size-5" />,
  composite: <Zap className="size-5" />,
};

export default async function SkillDetailPage(props: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();

  if (!orgId) {
    return notFound();
  }
  const skill = await getSkill(orgId, slug);
  if (!skill) {
    return notFound();
  }

  const inputSchema = skill.inputSchema as Record<string, unknown> | null;
  const properties = (inputSchema?.properties ?? {}) as Record<string, { type?: string; description?: string }>;
  const required = (inputSchema?.required ?? []) as string[];

  return (
    <>
      <div className="mb-4">
        <Link
          href="/dashboard/skills"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          Back to Skills
        </Link>
      </div>

      <TitleBar
        title={(
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              {categoryIcons[skill.category ?? 'query']}
            </div>
            <div>
              <div>{skill.name}</div>
              <div className="flex items-center gap-2 text-sm font-normal">
                <Badge variant={skill.status === 'active' ? 'default' : 'outline'}>
                  {skill.status === 'active' ? <CheckCircle2 className="mr-1 size-3" /> : <Clock className="mr-1 size-3" />}
                  {skill.status}
                </Badge>
                {skill.requiresApproval === 'true'
                  ? <Badge variant="outline" className="text-amber-600">Requires Approval</Badge>
                  : <Badge variant="outline" className="text-green-600">Auto-Run</Badge>}
                <Badge variant="secondary">{skill.category}</Badge>
              </div>
            </div>
          </div>
        )}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content */}
        <div className="space-y-6 lg:col-span-2">
          {/* Description */}
          <div className="rounded-lg border border-border p-5">
            <div className="mb-2 text-sm font-semibold">Description</div>
            <div className="text-sm text-muted-foreground">{skill.description}</div>
          </div>

          {/* Prompt Template */}
          <div className="rounded-lg border border-border p-5">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold">Prompt Template</div>
              <div className="text-xs text-muted-foreground">
                {skill.promptTemplate.length}
                {' '}
                chars · v
                {skill.version}
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto rounded-md bg-muted/50 p-4 font-mono text-xs leading-relaxed text-muted-foreground">
              {skill.promptTemplate.split('\n').map((line, i) => {
                // Highlight {{variables}}
                const parts = line.split(/(\{\{.*?\}\})/);
                return (
                  <div key={i} className="min-h-4">
                    {parts.map((part, j) =>
                      part.startsWith('{{') && part.endsWith('}}')
                        ? <span key={j} className="rounded bg-primary/15 px-1 font-semibold text-primary">{part}</span>
                        : <span key={j}>{part}</span>,
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Input Schema */}
          {Object.keys(properties).length > 0 && (
            <div className="rounded-lg border border-border p-5">
              <div className="mb-3 text-sm font-semibold">Input Variables</div>
              <div className="space-y-2">
                {Object.entries(properties).map(([key, val]) => (
                  <div key={key} className="flex items-start gap-3 rounded-md bg-muted/30 p-3">
                    <code className="rounded bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                      {'{{'}
                      {key}
                      {'}}'}
                    </code>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm">{val.description ?? key}</div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{val.type ?? 'string'}</span>
                        {required.includes(key) && <Badge variant="outline" className="text-[9px]">required</Badge>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Config */}
          <div className="rounded-lg border border-border p-5">
            <div className="mb-3 text-sm font-semibold">Configuration</div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Model</span>
                <code className="rounded bg-muted px-2 py-0.5 text-xs">{skill.model}</code>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Temperature</span>
                <span>{skill.temperature}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Category</span>
                <span>{skill.category}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Version</span>
                <span>
                  v
                  {skill.version}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Approval</span>
                <span>{skill.requiresApproval === 'true' ? 'Required' : 'Auto-run'}</span>
              </div>
            </div>
          </div>

          {/* Metadata */}
          <div className="rounded-lg border border-border p-5">
            <div className="mb-3 text-sm font-semibold">Metadata</div>
            <div className="space-y-1 text-xs text-muted-foreground">
              <div>
                Slug:
                {skill.slug}
              </div>
              <div>
                ID:
                {skill.id}
              </div>
              <div>
                Created:
                {new Date(skill.createdAt).toLocaleDateString()}
              </div>
              <div>
                Updated:
                {new Date(skill.updatedAt).toLocaleDateString()}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
