import { eq } from 'drizzle-orm';
import { ArrowRight, ScrollText } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { Link } from '@/libs/I18nNavigation';
import { playbookSchema } from '@/models/Schema';

/**
 * Playbooks list. Backend lands in `routers/Playbooks.ts` (read-only `list` +
 * `get`) but server components can query the DB directly — saves the oRPC
 * roundtrip and matches the pattern other primitive list pages use.
 *
 * A Playbook is markdown + YAML that an agent reads on demand at
 * `/playbooks/<slug>/` in its virtual filesystem. The detail page renders
 * the body via DocViewer; this page is the catalog.
 * @param props
 * @param props.params
 */
export default async function PlaybooksPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    notFound();
  }

  const rows = await db
    .select({
      id: playbookSchema.id,
      slug: playbookSchema.slug,
      name: playbookSchema.name,
      description: playbookSchema.description,
      tags: playbookSchema.tags,
      version: playbookSchema.version,
      updatedAt: playbookSchema.updatedAt,
      sourceFiles: playbookSchema.sourceFiles,
    })
    .from(playbookSchema)
    .where(eq(playbookSchema.orgId, orgId))
    .orderBy(playbookSchema.name);

  return (
    <>
      <TitleBar
        title={(
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ScrollText className="size-5" />
            </div>
            <span>Playbooks</span>
          </div>
        )}
        description="Markdown + YAML procedural guides agents read on demand. Authored under workspace/<org>/playbooks/<slug>/SKILL.md; mounted into each agent's virtual filesystem based on tag intersection."
      />

      {rows.length === 0
        ? (
            <EmptyState
              title="No playbooks yet"
              description="Author one under workspace/<org>/playbooks/<slug>/SKILL.md and run `npm run workspace:apply` to register it."
              icon={ScrollText}
            />
          )
        : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {rows.map(p => (
                <li key={p.id}>
                  <Link
                    href={`/dashboard/playbooks/${p.slug}`}
                    className="block rounded-xl border border-border bg-background p-5 transition hover:border-primary/30"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-base font-semibold">{p.name}</h3>
                        <code className="font-mono text-xs text-muted-foreground">{p.slug}</code>
                      </div>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{p.description}</p>
                    <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">
                        v
                        {p.version}
                      </span>
                      <span aria-hidden>·</span>
                      <span>
                        {(p.sourceFiles?.length ?? 0)}
                        {' '}
                        file
                        {(p.sourceFiles?.length ?? 0) === 1 ? '' : 's'}
                      </span>
                      {p.tags.length > 0 && (
                        <>
                          <span aria-hidden>·</span>
                          <div className="flex flex-wrap gap-1">
                            {p.tags.slice(0, 4).map(tag => (
                              <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>
                            ))}
                            {p.tags.length > 4 && (
                              <span className="text-[10px]">
                                +
                                {p.tags.length - 4}
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
    </>
  );
}
