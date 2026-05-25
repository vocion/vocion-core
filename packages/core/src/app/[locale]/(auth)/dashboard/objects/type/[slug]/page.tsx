import { clerkAuth as auth } from '@/libs/Auth';
import { eq } from 'drizzle-orm';
import { ArrowLeft, Database } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { PrimitiveFiles } from '@/features/dashboard/PrimitiveFiles';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { getContextDirtyState } from '@/libs/context/dirty';
import { readPrimitiveFiles } from '@/libs/context/reader';
import { db } from '@/libs/DB';
import { Link } from '@/libs/I18nNavigation';
import { businessObjectSchema, businessObjectTypeSchema } from '@/models/Schema';

export default async function ObjectTypeDetailPage(props: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    return notFound();
  }

  const objType = await db.query.businessObjectTypeSchema.findFirst({
    where: eq(businessObjectTypeSchema.slug, slug),
  });
  if (!objType || objType.orgId !== orgId) {
    return notFound();
  }

  const objects = await db.query.businessObjectSchema.findMany({
    where: eq(businessObjectSchema.typeId, objType.id),
    with: { documentLinks: true },
  });

  const sourceRelevance = (objType.sourceRelevance ?? {}) as Record<string, number>;
  const sourceFiles = readPrimitiveFiles('object', slug);
  const dirtyState = getContextDirtyState();

  return (
    <>
      <div className="mb-4">
        <Link href="/dashboard/objects" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3" />
          Back to Objects
        </Link>
      </div>

      <TitleBar
        title={(
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Database className="size-5" />
            </div>
            <div>
              <div>{objType.label}</div>
              <div className="flex items-center gap-2 text-sm font-normal">
                <span className="font-mono text-xs text-muted-foreground">{objType.slug}</span>
                <Badge variant="outline">
                  {objects.length}
                  {' '}
                  {objects.length === 1 ? 'instance' : 'instances'}
                </Badge>
              </div>
            </div>
          </div>
        )}
        description={objType.description ?? undefined}
      />

      {Object.keys(sourceRelevance).length > 0 && (
        <section className="mb-6 rounded-lg border border-border bg-background p-4">
          <div className="mb-3 text-sm font-semibold">Source relevance</div>
          <div className="space-y-2">
            {Object.entries(sourceRelevance)
              .sort(([, a], [, b]) => b - a)
              .map(([src, weight]) => {
                const pct = Math.min((weight / 2.0) * 100, 100);
                return (
                  <div key={src}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono">{src}</span>
                      <span className="font-mono text-muted-foreground tabular-nums">
                        {weight.toFixed(1)}
                        x
                      </span>
                    </div>
                    <div className="mt-1 h-1 w-full rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
          </div>
        </section>
      )}

      {objects.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
            Instances (
            {objects.length}
            )
          </h2>
          <div className="space-y-1.5">
            {objects.slice(0, 20).map(obj => (
              <Link
                key={obj.id}
                href={`/dashboard/objects/${obj.id}`}
                className="flex items-center justify-between rounded-md border border-border bg-background p-3 transition hover:border-primary/30"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{obj.title}</div>
                  {obj.status && <div className="text-[11px] text-muted-foreground">{obj.status}</div>}
                </div>
                <span className="ml-3 shrink-0 font-mono text-[11px] text-muted-foreground">
                  {obj.documentLinks?.length ?? 0}
                  {' '}
                  links
                </span>
              </Link>
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
