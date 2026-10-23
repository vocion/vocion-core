import { Database, Link2 } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { ListPage, ListRow, ListRows, Subline } from '@/components/patterns';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { clerkAuth as auth } from '@/libs/Auth';
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
    <ListPage
      title="Objects"
      description="The things your business tracks, like accounts and transcripts, with every document and run that mentions them."
    >
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
                title="No object types yet"
                description="An object type is a kind of thing your business tracks, like an account or a transcript."
                action={{ label: 'Browse apps', href: '/dashboard/apps' }}
                secondaryAction={{ label: 'How objects work', href: '/dashboard/docs/docs/concepts/objects' }}
                authoring={(
                  <>
                    An object type is a YAML file under
                    {' '}
                    <code>objects/</code>
                    {' '}
                    in the workspace, applied with the rest of it.
                  </>
                )}
              />
            )
          : (
              <ListRows>
                {objectTypes.map((t) => {
                  const configured = !!t.classificationPrompt?.trim();
                  const instances = countByType[t.id] ?? 0;
                  return (
                    <ListRow
                      key={t.id}
                      href={`/dashboard/objects/type/${t.slug}`}
                      icon={Database}
                      title={t.label}
                      subline={(
                        <Subline
                          separator="·"
                          segments={[
                            <span key="slug" className="font-mono">{t.slug}</span>,
                            t.description,
                            `${instances} ${instances === 1 ? 'instance' : 'instances'}`,
                          ]}
                        />
                      )}
                      chip={(
                        <Badge variant={configured ? 'default' : 'outline'}>
                          {configured ? 'configured' : 'unconfigured'}
                        </Badge>
                      )}
                    />
                  );
                })}
              </ListRows>
            )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Instances</h2>
        {objects.length === 0
          ? (
              <EmptyState
                icon={Link2}
                title="Nothing tracked yet"
                description="Records appear here on their own as documents arrive that match one of your object types."
                action={{ label: 'Connect a tool', href: '/dashboard/connectors' }}
              />
            )
          : (
              <ListRows>
                {objects.map((obj) => {
                  const sources = [...new Set(obj.documentLinks.map(l => l.sourceType))];
                  const external = obj.externalSystem && obj.externalId
                    ? <span className="font-mono">{`${obj.externalSystem}/${obj.externalId}`}</span>
                    : null;
                  const sourceList = sources.length > 0 ? <span className="font-mono">{sources.join(', ')}</span> : null;
                  return (
                    <ListRow
                      key={obj.id}
                      href={`/dashboard/objects/${obj.id}`}
                      icon={Database}
                      title={obj.title}
                      subline={(
                        <Subline
                          separator="·"
                          segments={[
                            <span key="type" className="font-mono">{obj.type.slug}</span>,
                            obj.status === 'approved' && !obj.externalId && 'not published yet',
                            external,
                            sourceList,
                            <span key="links" className="inline-flex items-center gap-1">
                              <Link2 className="size-3" />
                              {obj.documentLinks.length}
                            </span>,
                          ]}
                        />
                      )}
                      chip={obj.status
                        ? (
                            <Badge variant={badgeVariantForStatus(obj.status)} className="text-[10px]">
                              {labelForStatus(obj.status)}
                            </Badge>
                          )
                        : undefined}
                    />
                  );
                })}
              </ListRows>
            )}
      </section>
    </ListPage>
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
