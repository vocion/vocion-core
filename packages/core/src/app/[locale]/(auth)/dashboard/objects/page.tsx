import { auth } from '@clerk/nextjs/server';
import { CheckCircle, ChevronRight, Database, FileText, Link2, Phone } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { Link } from '@/libs/I18nNavigation';
import { listBusinessObjects, listObjectTypes } from '@/services/BusinessObjectService';

const typeIcons: Record<string, React.ReactNode> = {
  discovery_call: <Phone className="size-4" />,
  deal: <FileText className="size-4" />,
  account: <Database className="size-4" />,
  kickoff_call: <Phone className="size-4" />,
};

const sourceColors: Record<string, string> = {
  zoom: 'bg-blue-100 text-blue-800',
  gmail: 'bg-red-100 text-red-800',
  hubspot: 'bg-orange-100 text-orange-800',
  google_drive: 'bg-green-100 text-green-800',
  slack: 'bg-purple-100 text-purple-800',
  google_calendar: 'bg-cyan-100 text-cyan-800',
};

const statusVariant = (status: string | null) => {
  switch (status) {
    case 'completed': return 'default' as const;
    case 'active': return 'secondary' as const;
    case 'scheduled': return 'outline' as const;
    default: return 'outline' as const;
  }
};

export default async function ObjectsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'Objects' });
  const { orgId } = await auth();

  const objectTypes = orgId ? await listObjectTypes(orgId) : [];
  const objects = orgId ? await listBusinessObjects(orgId) : [];

  // Count objects per type
  const countByType: Record<number, number> = {};
  for (const obj of objects) {
    countByType[obj.typeId] = (countByType[obj.typeId] ?? 0) + 1;
  }

  return (
    <>
      <TitleBar
        title={t('title_bar')}
        description={t('title_bar_description')}
      />

      {/* Object Types */}
      <DashboardSection
        title={t('section_types')}
        description={t('section_types_description')}
      >
        {objectTypes.length === 0
          ? (
              <div className="rounded-md border border-dashed border-border p-8 text-center">
                <Database className="mx-auto mb-2 size-8 stroke-muted-foreground" />
                <div className="text-sm font-medium">{t('no_types')}</div>
                <div className="text-xs text-muted-foreground">{t('no_types_description')}</div>
              </div>
            )
          : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {objectTypes.map((objType) => {
                  // Configured = has classification rules (the key signal that this type is actually set up)
                  const isConfigured = !!(objType.classificationPrompt && objType.classificationPrompt.trim().length > 0);
                  return (
                    <Link
                      key={objType.id}
                      href={`/dashboard/objects/type/${objType.slug}`}
                      className="group rounded-lg border border-border p-4 transition-all hover:border-primary/30 hover:bg-muted/50 hover:shadow-sm"
                    >
                      <div className="flex items-center gap-2">
                        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                          {typeIcons[objType.slug] ?? <Database className="size-4" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold">{objType.label}</div>
                          <div className="text-xs text-muted-foreground">
                            {countByType[objType.id] ?? 0}
                            {' '}
                            {(countByType[objType.id] ?? 0) === 1 ? 'instance' : 'instances'}
                          </div>
                        </div>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {isConfigured
                          ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                <CheckCircle className="size-3" />
                                Configured
                              </span>
                            )
                          : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                Unconfigured
                              </span>
                            )}
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                          Sales
                        </span>
                      </div>
                      {objType.description && (
                        <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                          {objType.description}
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
      </DashboardSection>

      {/* Business Objects */}
      <div className="mt-6">
        <DashboardSection
          title={t('section_objects')}
          description={t('section_objects_description')}
        >
          {objects.length === 0
            ? (
                <div className="rounded-md border border-dashed border-border p-8 text-center">
                  <FileText className="mx-auto mb-2 size-8 stroke-muted-foreground" />
                  <div className="text-sm font-medium">{t('no_objects')}</div>
                  <div className="text-xs text-muted-foreground">{t('no_objects_description')}</div>
                </div>
              )
            : (
                <div className="space-y-2">
                  {objects.map((obj) => {
                    const meta = obj.metadata as Record<string, unknown>;
                    const topics = (meta.key_topics ?? meta.topics ?? []) as string[];
                    return (
                      <Link
                        key={obj.id}
                        href={`/dashboard/objects/${obj.id}`}
                        className="flex items-center gap-4 rounded-lg border border-border p-4 transition-all hover:border-primary/30 hover:bg-muted/50 hover:shadow-sm"
                      >
                        {/* Icon */}
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          {typeIcons[obj.type.slug] ?? <Database className="size-5" />}
                        </div>

                        {/* Content */}
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold">{obj.title}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Badge variant="secondary" className="text-xs">{obj.type.label}</Badge>
                            {obj.status ? <Badge variant={statusVariant(obj.status)} className="text-xs">{obj.status}</Badge> : null}
                            {meta.prospect_company
                              ? (
                                  <span className="text-xs text-muted-foreground">{String(meta.prospect_company)}</span>
                                )
                              : null}
                            {meta.hubspot_deal_stage
                              ? (
                                  <Badge variant="outline" className="text-xs">{String(meta.hubspot_deal_stage)}</Badge>
                                )
                              : null}
                          </div>

                          {/* Topics */}
                          {topics.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {topics.slice(0, 4).map(topic => (
                                <span key={topic} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                                  {topic}
                                </span>
                              ))}
                              {topics.length > 4 && (
                                <span className="text-[10px] text-muted-foreground">
                                  +
                                  {topics.length - 4}
                                  {' '}
                                  more
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Right side: linked doc count + sources */}
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Link2 className="size-3" />
                            {obj.documentLinks.length}
                          </div>
                          <div className="flex gap-1">
                            {[...new Set(obj.documentLinks.map(l => l.sourceType))].map(src => (
                              <span
                                key={src}
                                className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${sourceColors[src] ?? 'bg-gray-100 text-gray-700'}`}
                              >
                                {src}
                              </span>
                            ))}
                          </div>
                        </div>

                        {/* Chevron */}
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      </Link>
                    );
                  })}
                </div>
              )}
        </DashboardSection>
      </div>
    </>
  );
}
