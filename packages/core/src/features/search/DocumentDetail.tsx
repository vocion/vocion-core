'use client';

import { DetailPage, FactList, MetaChip, RightColumn, Section } from '@/components/patterns';
import { RecordContext } from '@/features/dashboard/context/RecordContext';
import { recordRef } from '@/services/chat/recordContext';

/**
 * One ingested document on its own URL — the Detail archetype applied to a
 * Search result. What retrieval actually read (the chunks, joined), where it
 * came from, when it was ingested, and the one affordance every record page
 * has: "Ask about this", which hands the rail a `document` `RecordRef` so the
 * document arrives in the conversation as `@<title>` exactly like a lead or a
 * deal does.
 *
 * Chris, 2026-09-15: "I also want to be able to click on one of these records
 * to view full content … and then chat about it? how do I pull it into chat?"
 * The answer is the mechanism the app already has, not a new one.
 */

export type DocumentView = {
  id: string;
  title: string;
  sourceSlug: string;
  sourceKind: string | null;
  externalId: string;
  uri: string | null;
  content: string;
  chunkCount: number;
  lastModifiedAt: string | null;
  ingestedAt: string;
  metadata: Record<string, unknown>;
};

/** Fixed locale + UTC so the server render and the client render agree. */
const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function dateLabel(iso: string | null): string | null {
  if (!iso) {
    return null;
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : DATE.format(d);
}

export function DocumentDetail({ doc, backHref }: { doc: DocumentView; backHref: string }) {
  const record = recordRef('document', doc.id, doc.title);
  const modified = dateLabel(doc.lastModifiedAt);
  const ingested = dateLabel(doc.ingestedAt);
  // Only the metadata a person can read; the ingestion internals stay out.
  const extra = Object.entries(doc.metadata)
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
    .slice(0, 8);

  return (
    <>
      <RecordContext record={record} />
      <DetailPage
        data-testid="document-detail"
        crumbs={[{ label: 'Search', href: backHref }, { label: doc.title }]}
        title={doc.title}
        subtitle={doc.sourceSlug}
        meta={(
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px] text-muted-foreground">
            <MetaChip>Document</MetaChip>
            <span aria-hidden className="text-muted-foreground/50">·</span>
            <span>{doc.sourceSlug}</span>
            {modified && (
              <>
                <span aria-hidden className="text-muted-foreground/50">·</span>
                <span>{`modified ${modified}`}</span>
              </>
            )}
            <span aria-hidden className="text-muted-foreground/50">·</span>
            <span>{`${doc.chunkCount} chunk${doc.chunkCount === 1 ? '' : 's'} indexed`}</span>
            {doc.uri && (
              <>
                <span aria-hidden className="text-muted-foreground/50">·</span>
                <MetaChip href={doc.uri}>Open at the source ↗</MetaChip>
              </>
            )}
          </div>
        )}
        aside={(
          <RightColumn label="Document">
            <Section eyebrow="Source" tone="quiet">
              <FactList
                layout="column"
                facts={[
                  { label: 'Connector', value: doc.sourceSlug },
                  doc.sourceKind && { label: 'Kind', value: doc.sourceKind },
                  { label: 'Id at the source', value: <span className="font-mono text-[12px] break-all">{doc.externalId}</span> },
                  doc.uri && { label: 'Link', value: 'Open at the source ↗', href: doc.uri },
                ]}
              />
            </Section>
            <Section eyebrow="Ingestion" tone="quiet">
              <FactList
                layout="column"
                facts={[
                  modified && { label: 'Last modified', value: modified },
                  { label: 'Ingested', value: ingested ?? '—' },
                  { label: 'Chunks indexed', value: String(doc.chunkCount) },
                ]}
              />
            </Section>
            {extra.length > 0 && (
              <Section eyebrow="Metadata" tone="quiet">
                <FactList layout="column" facts={extra.map(([k, v]) => ({ key: k, label: k, value: String(v) }))} />
              </Section>
            )}
          </RightColumn>
        )}
      >
        <Section eyebrow="Content" aria-label="Document content">
          {doc.content
            ? (
              // The chunks joined, in order — what retrieval reads, verbatim.
              // Highlight any of it and the "Ask Vocion" pill quotes it.
                <pre data-document-body className="overflow-x-auto font-sans text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
                  {doc.content}
                </pre>
              )
            : <p className="text-sm text-muted-foreground">This document has no indexed text.</p>}
        </Section>
      </DetailPage>
    </>
  );
}
