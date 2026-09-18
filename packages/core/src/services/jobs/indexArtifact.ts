/**
 * `index-artifact` — the built-in automation job that puts one artifact into
 * the knowledge index, so `search_knowledge` finds what an agent or a person
 * wrote, not only what a connector ingested.
 *
 *   automations/wiki-index.yaml
 *     when: { event: artifact.saved, filter: { folder: wiki } }
 *     do:   { job: index-artifact, input: { source: wiki } }
 *
 * The event carries `artifactId`; `input.source` names the knowledge source
 * the document lands under (default: the artifact's folder, else `artifacts`).
 * Markdown artifacts index their body; documents index title + sheet outline
 * (the HTML is for printing, not for searching); other kinds index their
 * title and a JSON rendering of the spec. Re-indexing the same version is a
 * no-op through the content hash.
 */

import { ensureSource, ingestDocument } from '@/services/IngestionService';

export const INDEX_ARTIFACT_JOB = 'index-artifact';

export type IndexArtifactInput = {
  artifactId?: number | string;
  /** Knowledge source slug to file under. Default: the artifact's folder, else `artifacts`. */
  source?: string;
};

export type IndexArtifactResult = {
  artifactId: number;
  source: string;
  indexed: boolean;
  reason?: string;
};

/**
 * Searchable text for an artifact, per kind.
 * @param kind - The artifact kind.
 * @param spec - Its spec.
 */
export function artifactSearchText(kind: string, spec: Record<string, unknown>): string {
  if (kind === 'markdown' && typeof spec.md === 'string') {
    return spec.md;
  }
  if (kind === 'document' && typeof spec.html === 'string') {
    // Sheets are `<section class="sheet">`; headings are what a search should hit.
    const text = spec.html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.slice(0, 200_000);
  }
  return JSON.stringify(spec).slice(0, 100_000);
}

export async function runIndexArtifactJob(orgId: string, input: Record<string, unknown>): Promise<IndexArtifactResult> {
  const artifactId = Number((input as IndexArtifactInput).artifactId);
  if (!Number.isInteger(artifactId) || artifactId <= 0) {
    throw new Error('index-artifact needs input.artifactId (the event payload carries it)');
  }
  const { getArtifact } = await import('@/services/ArtifactService');
  const artifact = await getArtifact({ orgId, id: artifactId });
  if (!artifact) {
    return { artifactId, source: '', indexed: false, reason: 'artifact not found (deleted before the job ran)' };
  }
  const sourceSlug = String((input as IndexArtifactInput).source ?? artifact.folder?.split('/')[0] ?? 'artifacts');
  const src = await ensureSource({ orgId, slug: sourceSlug, kind: 'plugin', configJson: { indexes: 'artifacts' } });
  const content = artifactSearchText(artifact.kind, artifact.spec as Record<string, unknown>);
  if (!content.trim()) {
    return { artifactId, source: sourceSlug, indexed: false, reason: 'nothing searchable in the spec' };
  }
  await ingestDocument(src, {
    externalId: `artifact:${artifact.id}`,
    title: artifact.title,
    content: `# ${artifact.title}\n\n${content}`,
    uri: `/dashboard/artifacts/${artifact.id}`,
    lastModifiedAt: artifact.updatedAt ?? artifact.createdAt,
    metadata: {
      kind: artifact.kind,
      folder: artifact.folder,
      version: artifact.currentVersion,
      recordType: artifact.recordType,
      recordId: artifact.recordId,
      artifactId: artifact.id,
    },
  });
  return { artifactId, source: sourceSlug, indexed: true };
}
