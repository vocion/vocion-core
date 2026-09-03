import { Database, Link2 } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { listBusinessObjects, listObjectTypes } from '@/services/BusinessObjectService';

export default async function ObjectsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();

  const objectTypes = orgId ? await listObjectTypes(orgId) : [];
  const objects = orgId ? await listBusinessObjects(orgId) : [];

  const countByType: Record<number, number> = {};
  for (const obj of objects) {
    countByType[obj.typeId] = (countByType[obj.typeId] ?? 0) + 1;
  }

  return (
    <>
      <TitleBar
        title="Objects"
        description="Business entities your tenant cares about, authored in workspace/<org>/objects/. Documents and skill runs link back to an instance."
      />

      <div className="mb-6 grid grid-cols-3 gap-3 sm:grid-cols-5">
        <Stat label="Types" value={objectTypes.length} />
        <Stat label="Instances" value={objects.length} />
        <Stat
          label="Configured"
          value={objectTypes.filter(t => !!t.classificationPrompt?.trim()).length}
        />
        <Stat label="Awaiting review" value={objects.filter(obj => obj.status === 'candidate').length} />
        <Stat label="Rejected" value={objects.filter(obj => obj.status === 'rejected').length} />
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Types</h2>
        {objectTypes.length === 0
          ? (
              <EmptyState
                icon={Database}
                title="No Object types yet"
                description="Object types are typed business entities (Account, Opportunity, Transcript) your tenant cares about. Define one in workspace/<org>/objects/."
                action={{ label: 'How to define an Object type', href: '/dashboard/docs/docs/concepts/objects' }}
              />
            )
          : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {objectTypes.map((t) => {
                  const configured = !!t.classificationPrompt?.trim();
                  return (
                    <Link
                      key={t.id}
                      href={`/dashboard/objects/type/${t.slug}`}
                      className="rounded-lg border border-border bg-background p-4 transition hover:border-primary/30"
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <Database className="size-4 text-primary" />
                        <span className="text-sm font-medium">{t.label}</span>
                        <Badge variant={configured ? 'default' : 'outline'} className="ml-auto">
                          {configured ? 'configured' : 'unconfigured'}
                        </Badge>
                      </div>
                      <div className="mb-2 font-mono text-[11px] text-muted-foreground">{t.slug}</div>
                      {t.description && <p className="text-xs leading-relaxed text-muted-foreground">{t.description}</p>}
                      <div className="mt-3 text-[11px] text-muted-foreground">
                        {countByType[t.id] ?? 0}
                        {' '}
                        {(countByType[t.id] ?? 0) === 1 ? 'instance' : 'instances'}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Instances</h2>
        {objects.length === 0
          ? (
              <EmptyState
                icon={Link2}
                title="No instances yet"
                description="Instances are created automatically when the classifier matches a document to one of your Object types."
              />
            )
          : (
              <div className="space-y-2">
                {objects.map((obj) => {
                  const sources = [...new Set(obj.documentLinks.map(l => l.sourceType))];
                  return (
                    <Link
                      key={obj.id}
                      href={`/dashboard/objects/${obj.id}`}
                      className="flex items-center gap-3 rounded-lg border border-border bg-background p-3 transition hover:border-primary/30"
                    >
                      <Database className="size-4 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{obj.title}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className="font-mono">{obj.type.slug}</span>
                          {obj.status && (
                            <Badge variant={badgeVariantForStatus(obj.status)} className="text-[10px]">
                              {labelForStatus(obj.status)}
                            </Badge>
                          )}
                          {obj.status === 'approved' && !obj.externalId && (
                            <span>not published yet</span>
                          )}
                          {obj.externalSystem && obj.externalId && (
                            <span className="font-mono">
                              {obj.externalSystem}
                              /
                              {obj.externalId}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 text-[11px] text-muted-foreground">
                        {sources.length > 0 && (
                          <span className="mr-2 font-mono">{sources.join(', ')}</span>
                        )}
                        <span className="inline-flex items-center gap-1">
                          <Link2 className="size-3" />
                          {obj.documentLinks.length}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
      </section>
    </>
  );
}

/**
 * A proposed candidate and a curated record are very different things to a
 * reviewer, so lifecycle state gets colour rather than small grey text: an
 * unreviewed extraction should not read as a finished record.
 * @param status - The value stored on the business object.
 */
function badgeVariantForStatus(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'rejected') {
    return 'destructive';
  }
  if (status === 'candidate') {
    return 'secondary';
  }
  if (status === 'approved') {
    return 'default';
  }
  return 'outline';
}

/**
 * Plain wording for the states this page cares about. Any other status an
 * object type defines for itself is shown as it was stored.
 * @param status - The value stored on the business object.
 */
function labelForStatus(status: string): string {
  if (status === 'candidate') {
    return 'awaiting review';
  }
  return status;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border p-3 text-center">
      <div className="text-xl font-bold">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
