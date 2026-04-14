import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { ArrowLeft, BookOpen, Database, Shield } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { db } from '@/libs/DB';
import { Link } from '@/libs/I18nNavigation';
import { businessObjectSchema, businessObjectTypeSchema } from '@/models/Schema';

const sourceColors: Record<string, string> = {
  zoom: '#2D8CFF',
  hubspot: '#FF7A59',
  gmail: '#EA4335',
  google_drive: '#4285F4',
  google_calendar: '#0F9D58',
  slack: '#4A154B',
};

const sourceLabels: Record<string, string> = {
  zoom: 'Zoom',
  hubspot: 'HubSpot',
  gmail: 'Gmail',
  google_drive: 'Drive',
  google_calendar: 'Calendar',
  slack: 'Slack',
};

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
  const fewShots = (objType.fewShotExamples ?? []) as Array<{ input: string; output: string; label?: string }>;
  const classPrompt = objType.classificationPrompt;

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
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
              <Database className="size-5 stroke-primary" />
            </div>
            <div>
              <div>{objType.label}</div>
              <div className="flex items-center gap-2 text-sm font-normal">
                <Badge variant="secondary">{objType.slug}</Badge>
                <Badge variant="outline">
                  {objects.length}
                  {' '}
                  instances
                </Badge>
              </div>
            </div>
          </div>
        )}
      />

      {objType.description && (
        <div className="mb-6 text-sm text-muted-foreground">{objType.description}</div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content */}
        <div className="space-y-6 lg:col-span-2">
          {/* Classification Prompt */}
          {classPrompt && (
            <div className="rounded-lg border border-border p-5">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Shield className="size-4" />
                Classification Rules
              </div>
              <div className="text-xs text-muted-foreground">How the system identifies this object type from raw documents</div>
              <div className="mt-3 rounded-md bg-muted/50 p-4 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
                {classPrompt}
              </div>
            </div>
          )}

          {/* Business Rules */}
          {classPrompt && (
            <div className="rounded-lg border border-border p-5">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <BookOpen className="size-4" />
                Business Rules
              </div>
              <div className="mb-3 text-xs text-muted-foreground">
                Classification logic applied to this object type
              </div>
              <div className="rounded-md bg-muted/50 p-4 text-sm leading-relaxed whitespace-pre-wrap">
                {classPrompt}
              </div>
            </div>
          )}

          {/* Few-Shot Examples */}
          {fewShots.length > 0 && (
            <div className="rounded-lg border border-border p-5">
              <div className="mb-2 text-sm font-semibold">
                Few-Shot Classification Examples
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {fewShots.length}
                  {' '}
                  examples
                </span>
              </div>
              <div className="space-y-3">
                {fewShots.map((ex, i) => (
                  <div key={i} className="rounded-md bg-muted/30 p-3">
                    <div className="text-xs font-medium text-muted-foreground">Input:</div>
                    <div className="text-sm">{ex.input}</div>
                    <div className="mt-2 text-xs font-medium text-muted-foreground">Classification:</div>
                    <code className="mt-0.5 block rounded bg-muted p-2 text-xs">{ex.output}</code>
                    {ex.label && <div className="mt-1 text-[10px] text-green-600">{ex.label}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Instances */}
          <div className="rounded-lg border border-border p-5">
            <div className="mb-3 text-sm font-semibold">
              Instances (
              {objects.length}
              )
            </div>
            {objects.length === 0
              ? <div className="text-sm text-muted-foreground">No instances yet</div>
              : (
                  <div className="space-y-2">
                    {objects.map(obj => (
                      <Link
                        key={obj.id}
                        href={`/dashboard/objects/${obj.id}`}
                        className="flex items-center justify-between rounded-md border border-border p-3 transition-colors hover:bg-muted/50"
                      >
                        <div>
                          <div className="text-sm font-medium">{obj.title}</div>
                          <div className="text-xs text-muted-foreground">{obj.status}</div>
                        </div>
                        <Badge variant="outline" className="text-[9px]">
                          {obj.documentLinks?.length ?? 0}
                          {' '}
                          links
                        </Badge>
                      </Link>
                    ))}
                  </div>
                )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Source Relevance */}
          <div className="rounded-lg border border-border p-5">
            <div className="mb-3 text-sm font-semibold">Source Relevance</div>
            <div className="text-xs text-muted-foreground">Which connectors matter most for this object type</div>
            {Object.keys(sourceRelevance).length > 0
              ? (
                  <div className="mt-3 space-y-2">
                    {Object.entries(sourceRelevance)
                      .sort(([, a], [, b]) => b - a)
                      .map(([src, weight]) => {
                        const color = sourceColors[src] ?? '#888';
                        const label = sourceLabels[src] ?? src;
                        const pct = Math.min((weight / 2.0) * 100, 100);
                        return (
                          <div key={src}>
                            <div className="flex items-center justify-between text-sm">
                              <div className="flex items-center gap-2">
                                <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
                                <span className="font-medium">{label}</span>
                              </div>
                              <span className="font-mono text-xs text-muted-foreground">
                                {weight}
                                x
                              </span>
                            </div>
                            <div className="mt-0.5 h-1.5 w-full rounded-full bg-muted">
                              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )
              : <div className="mt-2 text-xs text-muted-foreground">No source relevance configured</div>}
          </div>

          {/* Schema */}
          {objType.schema && (
            <div className="rounded-lg border border-border p-5">
              <div className="mb-3 text-sm font-semibold">Metadata Schema</div>
              <pre className="max-h-48 overflow-y-auto rounded-md bg-muted/50 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
                {(() => {
                  const schema = objType.schema as Record<string, unknown>;
                  const props = (schema.properties ?? schema) as Record<string, unknown>;
                  return Object.entries(props).map(([key, val]) => {
                    if (val && typeof val === 'object' && 'type' in (val as Record<string, unknown>)) {
                      const typeDef = val as Record<string, unknown>;
                      if (typeDef.type === 'array' && typeDef.items && typeof typeDef.items === 'object' && 'type' in (typeDef.items as Record<string, unknown>)) {
                        return `${key}: ${String((typeDef.items as Record<string, unknown>).type)}[]`;
                      }
                      if (typeDef.format) {
                        return `${key}: ${String(typeDef.format)}`;
                      }
                      return `${key}: ${String(typeDef.type)}`;
                    }
                    return `${key}: ${String(val)}`;
                  }).join('\n');
                })()}
              </pre>
            </div>
          )}

          {/* Meta */}
          <div className="rounded-lg border border-border p-5">
            <div className="mb-2 text-sm font-semibold">System Info</div>
            <div className="space-y-1 text-xs text-muted-foreground">
              <div>
                Slug:
                {objType.slug}
              </div>
              <div>
                ID:
                {objType.id}
              </div>
              <div>
                Created:
                {new Date(objType.createdAt).toLocaleDateString()}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
