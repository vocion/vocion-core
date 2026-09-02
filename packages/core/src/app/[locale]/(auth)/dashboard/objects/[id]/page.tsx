import type { Finding } from '@/features/dashboard/InspectionPhoto';
import {
  ArrowLeft,
  Calendar,
  Clock,
  ExternalLink,
  FileText,
  Link2,
  Phone,
  Sparkles,
  Tag,
  User,
} from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { InspectionPhoto } from '@/features/dashboard/InspectionPhoto';
import { ObjectAgentActivity } from '@/features/dashboard/ObjectAgentActivity';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { VisionEngineControl } from '@/features/dashboard/VisionEngineControl';
import { clerkAuth as auth } from '@/libs/Auth';
import { appImageUrl } from '@/libs/aws/s3';
import { Link } from '@/libs/I18nNavigation';
import { getBusinessObject } from '@/services/BusinessObjectService';

const roleLabels: Record<string, string> = {
  transcript: 'Transcript',
  recording: 'Recording',
  related_call: 'Related Call',
  booking: 'Calendar Booking',
  contact: 'Contact Record',
  deal: 'Deal Record',
  email_thread: 'Email Thread',
  follow_up: 'Follow-up',
};

function MetadataField({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
        {icon}
      </div>
      <div>
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className="text-sm">{value}</div>
      </div>
    </div>
  );
}

export default async function ObjectDetailPage(props: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();

  if (!orgId) {
    return notFound();
  }

  const obj = await getBusinessObject(Number(id), orgId);
  if (!obj) {
    return notFound();
  }

  const meta = obj.metadata as Record<string, unknown>;
  const keyTopics = (meta.key_topics ?? meta.topics ?? []) as string[];
  const nextSteps = (meta.next_steps ?? []) as string[];

  return (
    <>
      <div className="mb-4">
        <Link
          href="/dashboard/objects"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          Back to Objects
        </Link>
      </div>

      <TitleBar
        title={(
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
              <Phone className="size-5 stroke-primary" />
            </div>
            <div>
              <div>{obj.title}</div>
              <div className="flex items-center gap-2 text-sm font-normal">
                <Badge variant="secondary">{obj.type.label}</Badge>
                {obj.status && (
                  <Badge variant={obj.status === 'completed' ? 'default' : 'outline'}>
                    {obj.status}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        )}
      />

      <div className="mb-6 space-y-4">
        {typeof meta.image_url === 'string' && <VisionEngineControl compact />}
        {typeof meta.image_url === 'string' && (
          <InspectionPhoto
            objectId={obj.id}
            title={obj.title}
            imageUrl={meta.image_url}
            verdict={typeof meta.verdict === 'string' ? meta.verdict : null}
            confidence={typeof meta.confidence === 'number' ? meta.confidence : null}
            explanation={typeof meta.explanation === 'string' ? meta.explanation : null}
            findings={Array.isArray(meta.findings) ? (meta.findings as Finding[]) : []}
            regions={Array.isArray(meta.regions) ? (meta.regions as Finding[]) : []}
            regionsChecked={typeof meta.regions_checked === 'number' ? meta.regions_checked : null}
            checks={(meta.checks as React.ComponentProps<typeof InspectionPhoto>['checks']) ?? null}
            engines={(meta.engines as React.ComponentProps<typeof InspectionPhoto>['engines']) ?? null}
            referenceUrls={Array.isArray(meta.reference_keys) && typeof meta.bucket === 'string' ? (meta.reference_keys as string[]).map(k => appImageUrl(meta.bucket as string, k)) : []}
            knownLabel={typeof meta.known_label === 'string' ? meta.known_label : null}
          />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content — left 2 cols */}
        <div className="space-y-6 lg:col-span-2">
          {/* Image-backed objects (inspections, scans): the picture first, then what was found. */}
          {/* Summary */}
          <div className="rounded-lg border border-border p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4 stroke-primary" />
              Discovery Summary
            </div>
            {obj.summary
              ? (
                  <div className="text-sm leading-relaxed text-foreground">
                    {obj.summary}
                  </div>
                )
              : (
                  <div className="rounded-md bg-muted/50 p-4 text-center text-sm text-muted-foreground">
                    No summary generated yet. Summary generation will analyze linked documents
                    to create a comprehensive overview of this discovery call.
                  </div>
                )}
          </div>

          {/* Linked Documents */}
          <div className="rounded-lg border border-border p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Link2 className="size-4" />
              Linked Sources
              <Badge variant="outline" className="ml-auto text-xs">
                {obj.documentLinks.length}
                {' '}
                documents
              </Badge>
            </div>
            <div className="space-y-2">
              {obj.documentLinks.map(link => (
                <div
                  key={link.id}
                  className="flex items-center gap-3 rounded-md border border-border bg-background p-3"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <FileText className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {link.semanticIdentifier ?? link.onyxDocumentId}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {link.sourceType}
                      </Badge>
                      <span>{roleLabels[link.role] ?? link.role}</span>
                    </div>
                  </div>
                  {link.link && (
                    <a
                      href={link.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <ExternalLink className="size-4" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Next Steps */}
          {nextSteps.length > 0 && (
            <div className="rounded-lg border border-border p-5">
              <div className="mb-3 text-sm font-semibold">Next Steps</div>
              <div className="space-y-2">
                {nextSteps.map((step, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <div className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" />
                    {step}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar — right col */}
        <div className="space-y-6">
          {/* Metadata */}
          <div className="rounded-lg border border-border p-5">
            <div className="mb-2 text-sm font-semibold">Details</div>
            <div className="divide-y divide-border">
              {meta.prospect_name
                ? (
                    <MetadataField
                      icon={<User className="size-4 stroke-muted-foreground" />}
                      label="Prospect"
                      value={String(meta.prospect_name)}
                    />
                  )
                : null}
              {meta.prospect_company
                ? (
                    <MetadataField
                      icon={<User className="size-4 stroke-muted-foreground" />}
                      label="Company"
                      value={String(meta.prospect_company)}
                    />
                  )
                : null}
              {meta.scheduled_at
                ? (
                    <MetadataField
                      icon={<Calendar className="size-4 stroke-muted-foreground" />}
                      label="Scheduled"
                      value={new Date(String(meta.scheduled_at)).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    />
                  )
                : null}
              {meta.hubspot_deal_stage
                ? (
                    <MetadataField
                      icon={<Tag className="size-4 stroke-muted-foreground" />}
                      label="Deal Stage"
                      value={(
                        <Badge variant="secondary">{String(meta.hubspot_deal_stage)}</Badge>
                      )}
                    />
                  )
                : null}
              {meta.duration_minutes
                ? (
                    <MetadataField
                      icon={<Clock className="size-4 stroke-muted-foreground" />}
                      label="Duration"
                      value={`${meta.duration_minutes} min`}
                    />
                  )
                : null}
            </div>
          </div>

          {/* Topics */}
          {keyTopics.length > 0 && (
            <div className="rounded-lg border border-border p-5">
              <div className="mb-3 text-sm font-semibold">Key Topics</div>
              <div className="flex flex-wrap gap-1.5">
                {keyTopics.map(topic => (
                  <Badge key={topic} variant="secondary" className="text-xs">
                    {topic}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Object ID & metadata */}
          <div className="rounded-lg border border-border p-5">
            <div className="mb-2 text-sm font-semibold">System Info</div>
            <div className="space-y-1 text-xs text-muted-foreground">
              <div>
                Object ID:
                {obj.id}
              </div>
              <div>
                Type:
                {obj.type.slug}
              </div>
              <div>
                Created:
                {' '}
                {new Date(obj.createdAt).toLocaleDateString()}
              </div>
              {obj.summaryGeneratedAt && (
                <div>
                  Summary generated:
                  {' '}
                  {new Date(obj.summaryGeneratedAt).toLocaleDateString()}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <ObjectAgentActivity
        orgId={orgId}
        externalRef={String(
          (obj.metadata as Record<string, unknown> | null)?.external_id
          ?? (obj.metadata as Record<string, unknown> | null)?.externalId
          ?? '',
        ) || null}
      />
    </>
  );
}
