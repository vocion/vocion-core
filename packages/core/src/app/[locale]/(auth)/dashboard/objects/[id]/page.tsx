import type { Finding } from '@/features/dashboard/InspectionPhoto';
import type { LinkMap } from '@/features/dashboard/pages/FieldValue';
import type { PageRow } from '@/libs/workspace/pages';
import { ArrowLeft, ExternalLink, FileText, Link2, Sparkles } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { RecordContext } from '@/features/dashboard/context/RecordContext';
import { InspectionPhoto } from '@/features/dashboard/InspectionPhoto';
import { ObjectAgentActivity } from '@/features/dashboard/ObjectAgentActivity';
import { RecordBody } from '@/features/dashboard/objects/RecordBody';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { VisionEngineControl } from '@/features/dashboard/VisionEngineControl';
import { clerkAuth as auth } from '@/libs/Auth';
import { appImageUrl } from '@/libs/aws/s3';
import { Link } from '@/libs/I18nNavigation';
import { resolveField } from '@/libs/workspace/pages';
import { declaredRecordFields, hasInspectionImage, isDiscoveryRecord, recordSections } from '@/libs/workspace/records';
import { getBusinessObject } from '@/services/BusinessObjectService';
import { recordRef } from '@/services/chat/recordContext';
import { resolveRecordLinks } from '@/services/objects/recordLinks';

/**
 * A record — `/dashboard/objects/<id>`.
 *
 * Rendered from what the record's own type declares (`type.yaml` →
 * `schema`, read here through {@link declaredRecordFields}), through the
 * same formatting layer the list archetype uses, so a value looks the same
 * in a row and on a record. Before this the page was one customer's
 * discovery call in code: every object of every type got "Discovery
 * Summary … a comprehensive overview of this discovery call" and an empty
 * Details card, and an engineering task showed none of its contract, its
 * checks, its pull request or its cost.
 *
 * The domain-specific blocks that were unconditional are now gated on the
 * record actually carrying their fields: the discovery block on
 * `key_topics`/`next_steps`, the vision block on `image_url`.
 */

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

/**
 * Now, read once per render — `Date.now()` counts as impure inside a
 * render, and one instant keeps every `relative` value on the page
 * agreeing with the others. Same shape as the list renderer's.
 */
async function currentTime(): Promise<number> {
  return Date.now();
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
  // A discovery call, and only one, gets the discovery block.
  const isDiscovery = isDiscoveryRecord(meta);
  const hasImage = hasInspectionImage(meta);

  const row: PageRow = {
    id: obj.id,
    title: obj.title,
    status: obj.status ?? null,
    createdAt: obj.createdAt ?? null,
    meta,
  };
  const fields = declaredRecordFields(obj.type.schema);
  // What this page draws with its own hands, so the Other fields block
  // stays what it says it is: everything nothing else showed.
  const handled = [
    ...(isDiscovery ? ['key_topics', 'topics', 'next_steps'] : []),
    ...(hasImage ? ['image_url', 'verdict', 'confidence', 'explanation', 'findings', 'regions', 'regions_checked', 'checks', 'engines', 'reference_keys', 'bucket', 'known_label'] : []),
  ];
  const sections = recordSections(row, fields, handled);
  const now = await currentTime();

  // The record's neighbours, by their own titles: the request that asked
  // for this, the release it shipped in, the repository and product it
  // belongs to, the tasks it carries.
  const links: LinkMap = await resolveRecordLinks(
    orgId,
    sections.links.filter(f => f.to).flatMap((f) => {
      const v = resolveField(row, f.from ?? f.key);
      return (Array.isArray(v) ? v : [v]).map(one => ({ to: f.to!, value: one }));
    }),
  );

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
          <div className="min-w-0">
            <div className="break-words">{obj.title}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-normal">
              <Badge variant="secondary">{obj.type.label}</Badge>
              {obj.status && (
                <Badge variant={obj.status === 'completed' || obj.status === 'accepted' ? 'default' : 'outline'}>
                  {obj.status}
                </Badge>
              )}
            </div>
          </div>
        )}
      />
      <RecordContext record={recordRef('object', obj.id, obj.title)} />

      {hasImage && (
        <div className="mb-6 space-y-4">
          <VisionEngineControl compact />
          <InspectionPhoto
            objectId={obj.id}
            title={obj.title}
            imageUrl={meta.image_url as string}
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
        </div>
      )}

      <RecordBody
        row={row}
        sections={sections}
        now={now}
        links={links}
        aside={(
          <>
            {isDiscovery && keyTopics.length > 0 && (
              <section className="rounded-lg border border-border p-5">
                <h2 className="mb-3 text-sm font-semibold">Key Topics</h2>
                <div className="flex flex-wrap gap-1.5">
                  {keyTopics.map(topic => (
                    <Badge key={topic} variant="secondary" className="text-xs">{topic}</Badge>
                  ))}
                </div>
              </section>
            )}
            <section className="rounded-lg border border-border p-5">
              <h2 className="mb-2 text-sm font-semibold">System Info</h2>
              <dl className="space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between gap-3">
                  <dt>Object ID</dt>
                  <dd className="font-mono">{obj.id}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Type</dt>
                  <dd className="font-mono">{obj.type.slug}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Created</dt>
                  <dd>{new Date(obj.createdAt).toLocaleDateString()}</dd>
                </div>
                {obj.summaryGeneratedAt && (
                  <div className="flex justify-between gap-3">
                    <dt>Summary generated</dt>
                    <dd>{new Date(obj.summaryGeneratedAt).toLocaleDateString()}</dd>
                  </div>
                )}
              </dl>
            </section>
          </>
        )}
      >
        {/* A discovery call's own summary card, for a discovery call only. */}
        {isDiscovery && (
          <section className="rounded-lg border border-border p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4 stroke-primary" />
              Discovery Summary
            </h2>
            {obj.summary
              ? <div className="text-sm leading-relaxed text-foreground">{obj.summary}</div>
              : (
                  <div className="rounded-md bg-muted/50 p-4 text-center text-sm text-muted-foreground">
                    No summary generated yet. Summary generation will analyze linked documents
                    to create a comprehensive overview of this discovery call.
                  </div>
                )}
          </section>
        )}

        {/* Any record's own summary, when the type did not declare one as a field. */}
        {!isDiscovery && obj.summary && !fields.some(f => f.key === 'summary') && (
          <section className="rounded-lg border border-border p-5">
            <h2 className="mb-3 text-sm font-semibold">Summary</h2>
            <div className="text-sm leading-relaxed text-foreground">{obj.summary}</div>
          </section>
        )}

        {obj.documentLinks.length > 0 && (
          <section className="rounded-lg border border-border p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Link2 className="size-4" />
              Linked Sources
              <Badge variant="outline" className="ml-auto text-xs">
                {obj.documentLinks.length}
                {' '}
                documents
              </Badge>
            </h2>
            <div className="space-y-2">
              {obj.documentLinks.map(link => (
                <div key={link.id} className="flex items-center gap-3 rounded-md border border-border bg-background p-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <FileText className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {link.semanticIdentifier ?? link.onyxDocumentId}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="font-mono text-[10px]">{link.sourceType}</Badge>
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
          </section>
        )}

        {nextSteps.length > 0 && (
          <section className="rounded-lg border border-border p-5">
            <h2 className="mb-3 text-sm font-semibold">Next Steps</h2>
            <div className="space-y-2">
              {nextSteps.map((step, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <div className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" />
                  {step}
                </div>
              ))}
            </div>
          </section>
        )}
      </RecordBody>

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
