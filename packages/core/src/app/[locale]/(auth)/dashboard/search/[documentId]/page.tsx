import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { DocumentDetail } from '@/features/search/DocumentDetail';
import { clerkAuth as auth } from '@/libs/Auth';
import { getDocument } from '@/services/SourceSyncService';

/**
 * One Search result on its own page — the Detail archetype. Reads only; the
 * page itself is `features/search/DocumentDetail`.
 * @param props
 * @param props.params
 */
export default async function DocumentPage(props: {
  params: Promise<{ locale: string; documentId: string }>;
}) {
  const { locale, documentId } = await props.params;
  setRequestLocale(locale);
  const { orgId, userId } = await auth();
  const id = Number.parseInt(documentId, 10);
  if (!orgId || !Number.isSafeInteger(id) || id <= 0) {
    notFound();
  }

  const { allowedSourceSlugsForUser } = await import('@/services/SourceAccessService');
  const allowedSourceSlugs = userId ? await allowedSourceSlugsForUser(orgId, userId) : undefined;
  const doc = await getDocument(orgId, id, { allowedSourceSlugs });
  if (!doc) {
    notFound();
  }

  return (
    <DocumentDetail
      backHref="/dashboard/search"
      doc={{
        id: String(doc.id),
        title: doc.title ?? `document ${doc.id}`,
        sourceSlug: doc.sourceSlug,
        sourceKind: doc.sourceKind,
        externalId: doc.externalId,
        uri: doc.uri,
        content: doc.content,
        chunkCount: doc.chunkCount,
        lastModifiedAt: doc.lastModifiedAt ? doc.lastModifiedAt.toISOString() : null,
        ingestedAt: doc.ingestedAt.toISOString(),
        metadata: doc.metadata,
      }}
    />
  );
}
