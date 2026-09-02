import { and, eq } from 'drizzle-orm';
import { ArrowLeft, ScrollText, Zap } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { DocViewer } from '@/features/dashboard/DocViewer';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { Link } from '@/libs/I18nNavigation';
import { agentSchema, playbookSchema } from '@/models/Schema';
import { skillUsageCounts } from '@/services/ActivityService';
import { readByOrigin } from '@/services/playbooks/mount';

type Props = {
  params: Promise<{ locale: string; slug: string }>;
};

/**
 * Skill / playbook detail — the SKILL.md body plus provenance: whether
 * the workspace runs the base version or its own override, which agents
 * mount it, and how often it has been read.
 * @param props
 */
export default async function SkillDetailPage(props: Props) {
  const { locale, slug } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    notFound();
  }

  const [row] = await db
    .select()
    .from(playbookSchema)
    .where(and(eq(playbookSchema.orgId, orgId), eq(playbookSchema.slug, slug)));
  if (!row) {
    notFound();
  }

  const [agents, usage, attachingSkills] = await Promise.all([
    db
      .select({ slug: agentSchema.slug, skillSlugs: agentSchema.skillSlugs, playbookSlugs: agentSchema.playbookSlugs })
      .from(agentSchema)
      .where(eq(agentSchema.orgId, orgId)),
    skillUsageCounts(orgId),
    row.kind === 'playbook'
      ? db
          .select({ slug: playbookSchema.slug, attachedPlaybooks: playbookSchema.attachedPlaybooks })
          .from(playbookSchema)
          .where(and(eq(playbookSchema.orgId, orgId), eq(playbookSchema.kind, 'skill')))
      : Promise.resolve([]),
  ]);
  // Direct naming plus, for a playbook, every agent whose mounted skill attaches it.
  const attachers = new Set(attachingSkills.filter(sk => (sk.attachedPlaybooks ?? []).includes(slug)).map(sk => sk.slug));
  const mountedBy = [...new Set(agents
    .filter(a => row.kind === 'skill'
      ? (a.skillSlugs ?? []).includes(slug)
      : (a.playbookSlugs ?? []).includes(slug) || (a.skillSlugs ?? []).some(sk => attachers.has(sk)))
    .map(a => a.slug))].sort();

  const raw = readByOrigin(row, 'SKILL.md') ?? '';
  const { content: markdownBody } = stripFrontmatter(raw);
  const originLabel = row.origin === 'core'
    ? 'Base — the core pack\'s version, no workspace copy.'
    : row.origin === 'override'
      ? 'Override — the workspace replaced the base version by slug.'
      : 'Workspace — authored in this workspace only.';

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
              {row.kind === 'skill' ? <Zap className="size-5" /> : <ScrollText className="size-5" />}
            </div>
            <div>
              <div>{row.name}</div>
              <div className="flex items-center gap-2 text-sm font-normal">
                <Badge variant="outline">{row.kind}</Badge>
                <Badge variant={row.origin === 'override' ? 'default' : 'secondary'}>
                  {row.origin === 'core' ? 'base' : row.origin}
                </Badge>
                <span className="font-mono text-xs text-muted-foreground">{row.slug}</span>
              </div>
            </div>
          </div>
        )}
        description={row.description}
      />

      <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
        <article>
          {markdownBody.trim().length === 0
            ? (
                <p className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
                  Body not found on disk. The catalog row exists; the file may have been removed since the last workspace:apply.
                </p>
              )
            : (
                <DocViewer
                  currentPath={`skills/${slug}/SKILL.md`}
                  content={markdownBody}
                  linkBase="/dashboard/docs"
                />
              )}
        </article>

        <aside className="space-y-6 text-sm">
          <section>
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Provenance</h2>
            <p className="text-muted-foreground">{originLabel}</p>
          </section>

          <section>
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Mounted by</h2>
            {mountedBy.length === 0
              ? <p className="text-muted-foreground italic">No agent names it yet.</p>
              : (
                  <div className="flex flex-wrap gap-1">
                    {mountedBy.map(a => (
                      <Link key={a} href={`/dashboard/agents/${a}`}>
                        <Badge variant="secondary">{a}</Badge>
                      </Link>
                    ))}
                  </div>
                )}
          </section>

          {row.kind === 'skill' && (row.attachedPlaybooks ?? []).length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Attached playbooks</h2>
              <div className="flex flex-wrap gap-1">
                {(row.attachedPlaybooks ?? []).map(p => (
                  <Link key={p} href={`/dashboard/skills/${p}`}>
                    <Badge variant="outline">{p}</Badge>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Usage</h2>
            <p className="text-muted-foreground">
              {usage[slug] ?? 0}
              {' '}
              read
              {(usage[slug] ?? 0) === 1 ? '' : 's'}
              {' — '}
              <Link href="/dashboard/activity?kind=tool&tool=skill_read" className="underline">
                see Activity
              </Link>
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Catalog</h2>
            <dl className="space-y-1">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Version</dt>
                <dd className="font-mono">
                  v
                  {row.version}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Files</dt>
                <dd className="font-mono">{row.sourceFiles.length}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Updated</dt>
                <dd>{new Date(row.updatedAt).toLocaleDateString()}</dd>
              </div>
              {row.license && (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">License</dt>
                  <dd className="font-mono text-xs">{row.license}</dd>
                </div>
              )}
            </dl>
          </section>
        </aside>
      </div>
    </>
  );
}

function stripFrontmatter(raw: string): { content: string } {
  if (!raw.startsWith('---')) {
    return { content: raw };
  }
  const end = raw.indexOf('\n---', 3);
  if (end === -1) {
    return { content: raw };
  }
  return { content: raw.slice(end + 4).replace(/^\n+/, '') };
}
