import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { ArrowLeft, ScrollText } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { DocViewer } from '@/features/dashboard/DocViewer';
import { PrimitiveFiles } from '@/features/dashboard/PrimitiveFiles';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { Link } from '@/libs/I18nNavigation';
import { fromRepoRoot } from '@/libs/repo-root';
import { getWorkspaceDirtyState } from '@/libs/workspace/dirty';
import { getWorkspacePath } from '@/libs/workspace/reader';
import { playbookSchema } from '@/models/Schema';

type Props = {
  params: Promise<{ locale: string; slug: string }>;
};

export default async function PlaybookDetailPage(props: Props) {
  const { locale, slug } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    notFound();
  }

  const [playbook] = await db
    .select()
    .from(playbookSchema)
    .where(and(eq(playbookSchema.orgId, orgId), eq(playbookSchema.slug, slug)));
  if (!playbook) {
    notFound();
  }

  // Read the markdown body from disk. Playbooks live at
  // <context>/playbooks/<slug>/SKILL.md plus arbitrary sibling files.
  // The DB row stores metadata + content_sha for change detection; the
  // body itself is content-on-disk so the dashboard can re-read fresh.
  const contextPath = getWorkspacePath();
  const playbookDir = fromRepoRoot(join(contextPath, 'playbooks', slug.replace(/_/g, '-')));
  const skillMdPath = join(playbookDir, 'SKILL.md');
  const body = existsSync(skillMdPath) ? readFileSync(skillMdPath, 'utf-8') : '';
  // Strip the frontmatter for the rendered body (the catalog row already
  // surfaces title/description/tags via the DB).
  const { content: markdownBody } = stripFrontmatter(body);

  // Per services/playbooks/mount.ts: an agent sees a playbook when the
  // playbook's tag list intersects the agent's tag filter (or when the
  // playbook has no tags — visible everywhere). Agent tag filters live
  // outside `agent.tags` today (computed from the agent's subagent +
  // skill graph), so showing a precise "Mounted by" list is a v0.5.1
  // follow-up; for v0.5 we surface the tags themselves so authors can
  // reason about scope.

  // Source files panel — reuse the PrimitiveFiles pattern but adapt for
  // playbook layout (sourceFiles array on the DB row is repo-relative).
  const sourceFiles = playbook.sourceFiles.length > 0
    ? {
        files: playbook.sourceFiles
          .filter(p => existsSync(fromRepoRoot(join(contextPath, 'playbooks', slug.replace(/_/g, '-'), p))))
          .map((p) => {
            const abs = fromRepoRoot(join(contextPath, 'playbooks', slug.replace(/_/g, '-'), p));
            const ext = p.split('.').pop();
            const language: 'yaml' | 'markdown' | 'javascript' = ext === 'md'
              ? 'markdown'
              : ext === 'js' || ext === 'mjs'
                ? 'javascript'
                : 'yaml';
            return {
              path: `playbooks/${slug.replace(/_/g, '-')}/${p}`,
              fullPath: `${contextPath}/playbooks/${slug.replace(/_/g, '-')}/${p}`,
              content: readFileSync(abs, 'utf-8'),
              language,
            };
          }),
        contextPath,
        editInGitPath: `${contextPath}/playbooks/${slug.replace(/_/g, '-')}`,
      }
    : null;
  const dirtyState = getWorkspaceDirtyState();

  return (
    <>
      <div className="mb-4">
        <Link
          href="/dashboard/playbooks"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          Back to Playbooks
        </Link>
      </div>

      <TitleBar
        title={(
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ScrollText className="size-5" />
            </div>
            <div>
              <div>{playbook.name}</div>
              <div className="flex items-center gap-2 text-sm font-normal">
                <Badge variant="outline">
                  v
                  {playbook.version}
                </Badge>
                <span className="font-mono text-xs text-muted-foreground">{playbook.slug}</span>
                {playbook.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {playbook.tags.map(tag => (
                      <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        description={playbook.description}
      />

      <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
        <article>
          {markdownBody.trim().length === 0
            ? (
                <p className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
                  Playbook body not found on disk at
                  {' '}
                  <code className="font-mono text-xs">
                    {contextPath}
                    /playbooks/
                    {slug.replace(/_/g, '-')}
                    /SKILL.md
                  </code>
                  . The catalog row exists; the file may have been removed since the last `workspace:apply`.
                </p>
              )
            : (
                <DocViewer
                  currentPath={`playbooks/${slug}/SKILL.md`}
                  content={markdownBody}
                  linkBase="/dashboard/docs"
                />
              )}
        </article>

        <aside className="space-y-6 text-sm">
          <section>
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Mount scope
            </h2>
            {playbook.tags.length === 0
              ? (
                  <p className="text-muted-foreground italic">
                    No tags — this playbook mounts into every agent's virtual filesystem at
                    {' '}
                    <code className="font-mono text-xs">
                      /playbooks/
                      {playbook.slug}
                      /
                    </code>
                    .
                  </p>
                )
              : (
                  <>
                    <p className="text-muted-foreground">
                      Mounts only for agents whose subagent / skill graph references one of these tags:
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {playbook.tags.map(tag => (
                        <Badge key={tag} variant="secondary">{tag}</Badge>
                      ))}
                    </div>
                  </>
                )}
          </section>

          {playbook.license && (
            <section>
              <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">License</h2>
              <p className="font-mono text-xs">{playbook.license}</p>
            </section>
          )}

          <section>
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Catalog</h2>
            <dl className="space-y-1">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Version</dt>
                <dd className="font-mono">
                  v
                  {playbook.version}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Files</dt>
                <dd className="font-mono">{playbook.sourceFiles.length}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Updated</dt>
                <dd>{new Date(playbook.updatedAt).toLocaleDateString()}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>

      {sourceFiles && sourceFiles.files.length > 0 && (
        <section className="mt-10">
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

function stripFrontmatter(raw: string): { content: string; data: Record<string, unknown> } {
  if (!raw.startsWith('---')) {
    return { content: raw, data: {} };
  }
  const end = raw.indexOf('\n---', 3);
  if (end === -1) {
    return { content: raw, data: {} };
  }
  return { content: raw.slice(end + 4).replace(/^\n+/, ''), data: {} };
}
