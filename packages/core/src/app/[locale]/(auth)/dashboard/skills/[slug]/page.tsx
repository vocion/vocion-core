import { auth } from '@clerk/nextjs/server';
import { ArrowLeft, Search, Send, Zap } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { PrimitiveFiles } from '@/features/dashboard/PrimitiveFiles';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { getContextDirtyState } from '@/libs/context/dirty';
import { readPrimitiveFiles } from '@/libs/context/reader';
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

  const sourceFiles = readPrimitiveFiles('skill', slug);
  const dirtyState = getContextDirtyState();

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
                <Badge variant={skill.status === 'active' ? 'default' : 'outline'}>{skill.status}</Badge>
                {skill.requiresApproval === 'true' && <Badge variant="outline">HITL</Badge>}
                <span className="font-mono text-xs text-muted-foreground">{skill.slug}</span>
              </div>
            </div>
          </div>
        )}
        description={skill.description}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Config label="Model" value={skill.model ?? '—'} mono />
        <Config label="Temp" value={skill.temperature ?? '—'} />
        <Config label="Category" value={skill.category ?? 'query'} />
        <Config label="Version" value={`v${skill.version}`} />
      </div>

      {Object.keys(properties).length > 0 && (
        <section className="mb-6 rounded-lg border border-border bg-background p-4">
          <div className="mb-3 text-sm font-semibold">Input variables</div>
          <div className="space-y-2">
            {Object.entries(properties).map(([key, val]) => (
              <div key={key} className="flex items-start gap-3">
                <code className="shrink-0 rounded bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary">
                  {'{{'}
                  {key}
                  {'}}'}
                </code>
                <div className="min-w-0 flex-1 text-xs">
                  <div>{val.description ?? key}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {val.type ?? 'string'}
                    {required.includes(key) && <span className="ml-1">· required</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {sourceFiles && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Source files</h2>
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

function Config({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-sm ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}
