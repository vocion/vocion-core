import { and, eq } from 'drizzle-orm';
import { ArrowLeft, ScrollText, Zap } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { StandaloneArtifactView } from '@/features/dashboard/artifacts/StandaloneArtifactView';
import { RecordContext } from '@/features/dashboard/context/RecordContext';
import { DocViewer } from '@/features/dashboard/DocViewer';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { Link } from '@/libs/I18nNavigation';
import { WorkspaceTemplateError } from '@/libs/workspace';
import { agentSchema, playbookSchema } from '@/models/Schema';
import { skillUsageCounts } from '@/services/ActivityService';
import { toPayload } from '@/services/ArtifactService';
import { recordRef } from '@/services/chat/recordContext';
import { readByOrigin } from '@/services/playbooks/mount';
import { ensureSourceArtifact } from '@/services/workspace/WorkspaceSourceService';

type Props = {
  params: Promise<{ locale: string; slug: string }>;
};

type CatalogRow = typeof playbookSchema.$inferSelect;

/**
 * Read the SKILL.md body the same way an agent would. A file whose
 * `{{env.NAME}}` token this deployment cannot resolve is shown as a
 * problem on the page rather than crashing it — the reader still needs
 * to see which skill is broken and why.
 * @param row - the catalog row whose body to read.
 */
function readBodyOrTemplateProblem(row: CatalogRow): { raw: string; templateProblem: string | null } {
  try {
    return { raw: readByOrigin(row, 'SKILL.md') ?? '', templateProblem: null };
  } catch (error) {
    if (error instanceof WorkspaceTemplateError) {
      return { raw: '', templateProblem: error.message };
    }
    throw error;
  }
}

/**
 * The main panel: the rendered body, or an explanation of why there
 * isn't one.
 * @param props - what to render.
 * @param props.slug - the skill or playbook slug, for doc links.
 * @param props.markdownBody - the body with frontmatter stripped.
 * @param props.templateProblem - why the body could not be resolved, if it could not.
 */
function SkillBody(props: { slug: string; markdownBody: string; templateProblem: string | null }) {
  if (props.templateProblem !== null) {
    return (
      <p className="rounded-xl border border-dashed border-destructive/50 bg-destructive/5 p-6 text-sm text-muted-foreground">
        This file uses a
        {' '}
        <code>{'{{env.NAME}}'}</code>
        {' '}
        value this deployment cannot resolve, so an agent cannot read it either.
        {' '}
        {props.templateProblem}
      </p>
    );
  }
  if (props.markdownBody.trim().length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
        Body not found on disk. The catalog row exists; the file may have been removed since the last workspace:apply.
      </p>
    );
  }
  return (
    <DocViewer
      currentPath={`skills/${props.slug}/SKILL.md`}
      content={props.markdownBody}
      linkBase="/dashboard/docs"
    />
  );
}

/**
 * Skill / playbook detail — the SKILL.md plus provenance: whether the
 * workspace runs the base version or its own override, which agents mount
 * it, and how often it has been read.
 *
 * The SKILL.md edits like an artifact (`libs/workspace/source.ts`): the body
 * renders through the same `ArtifactPane` a document gets — Edit, ⌘S, a
 * version for every save, Restore, Share — and a save writes the file, then
 * applies the workspace. Highlight a passage and the toolbar offers Ask and
 * Change; Change pre-types the instruction and the agent edits the file
 * through `write_playbook`, which a person approves on a Review card with the
 * diff. Without a workspace on this host the body renders read-only as before.
 * @param props
 */
export default async function SkillDetailPage(props: Props) {
  const { locale, slug } = await props.params;
  setRequestLocale(locale);
  const { orgId, userId } = await auth();
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

  const source = await ensureSourceArtifact(orgId, row.kind === 'skill' ? 'skill' : 'playbook', slug).catch(() => null);
  const { raw, templateProblem } = source ? { raw: '', templateProblem: null } : readBodyOrTemplateProblem(row);
  const { content: markdownBody } = stripFrontmatter(raw);
  const record = recordRef('playbook', slug, row.name);
  const originLabel = row.origin === 'core'
    ? 'Base — the core pack\'s version, no workspace copy.'
    : row.origin === 'override'
      ? 'Override — the workspace replaced the base version by slug.'
      : 'Workspace — authored in this workspace only.';

  return (
    <>
      <RecordContext record={record} />
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
        {source
          ? (
              <div className="h-[75vh] min-h-[520px]" data-playbook-source>
                <StandaloneArtifactView artifact={toPayload(source)} selfId={userId ?? null} conversationId={null} />
              </div>
            )
          : (
              <article>
                <SkillBody slug={slug} markdownBody={markdownBody} templateProblem={templateProblem} />
              </article>
            )}

        <aside className="space-y-6 text-sm">
          <section>
            <h2 className="mb-2 text-xs font-medium text-muted-foreground">Provenance</h2>
            <p className="text-muted-foreground">{originLabel}</p>
          </section>

          <section>
            <h2 className="mb-2 text-xs font-medium text-muted-foreground">Mounted by</h2>
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
              <h2 className="mb-2 text-xs font-medium text-muted-foreground">Attached playbooks</h2>
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
            <h2 className="mb-2 text-xs font-medium text-muted-foreground">Usage</h2>
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
            <h2 className="mb-2 text-xs font-medium text-muted-foreground">Catalog</h2>
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
