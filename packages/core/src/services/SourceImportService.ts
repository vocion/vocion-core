/**
 * SourceImportService — turns an uploaded CSV into many sources.
 *
 * Two entrypoints that read the same file the same way:
 *
 *   - `previewSourceImportForOrg()` — says what would happen, per row, and
 *     writes nothing. The Sources dialog calls this before showing a confirm
 *     button.
 *   - `commitSourceImportForOrg()` — re-runs that same preview server-side and
 *     creates the rows it judged importable.
 *
 * The commit deliberately does not trust a preview the client hands back. A
 * caller could otherwise post a row the preview had marked "already exists" and
 * get a duplicate source; re-deriving the verdicts here means the only thing
 * the client controls is the file itself.
 *
 * Row parsing, coercion and validation live in `libs/sources/bulkImport`, which
 * is pure. This module is the thin layer that supplies what the database knows
 * (which sources already exist) and performs the write.
 */

import type { ExistingSource, SourceImportPreview } from '@/libs/sources/bulkImport';
import { previewSourceImport } from '@/libs/sources/bulkImport';
import { getConnector } from '@/libs/sources/registry';
import { addSourcesFromImport, listSources } from './SourceSyncService';

export type SourceImportResult = {
  preview: SourceImportPreview | null;
  /** The sources actually created. Empty on a preview, or when no row was importable. */
  created: Array<{ id: number; slug: string }>;
  /** A file-level problem — an unusable file, an unknown connector. Null when the rows were read. */
  error: string | null;
};

/**
 * What an uploaded CSV would do for this org, without doing any of it.
 * @param input - Org, connector and file text.
 * @param input.orgId - Org whose existing sources the rows are checked against.
 * @param input.kind - Connector slug the rows belong to.
 * @param input.csvText - Raw text of the uploaded file.
 */
export async function previewSourceImportForOrg(input: {
  orgId: string;
  kind: string;
  csvText: string;
}): Promise<SourceImportResult> {
  const connector = getConnector(input.kind);
  if (!connector?.bulkImport) {
    return { preview: null, created: [], error: `${input.kind} sources cannot be imported from a file.` };
  }

  const existingSources = await existingSourcesForConnector(input.orgId, input.kind);
  const { preview, error } = previewSourceImport({
    connector,
    csvText: input.csvText,
    existingSources,
  });
  return { preview, created: [], error };
}

/**
 * Create every importable row in an uploaded CSV.
 *
 * Rows the preview rejected are left alone and still reported, so the caller
 * can tell the operator exactly which lines did not become sources and why.
 * @param input - Org, connector and file text.
 * @param input.orgId - Org that will own the new sources.
 * @param input.kind - Connector slug the rows belong to.
 * @param input.csvText - Raw text of the uploaded file.
 */
export async function commitSourceImportForOrg(input: {
  orgId: string;
  kind: string;
  csvText: string;
}): Promise<SourceImportResult> {
  const previewed = await previewSourceImportForOrg(input);
  if (previewed.error || !previewed.preview) {
    return previewed;
  }

  const importableRows = previewed.preview.rows
    .filter(row => row.verdict === 'ok' && row.slug !== null && row.config !== null)
    .map(row => ({ slug: row.slug!, configJson: row.config! }));

  if (importableRows.length === 0) {
    return { preview: previewed.preview, created: [], error: null };
  }

  const created = await addSourcesFromImport({
    orgId: input.orgId,
    kind: input.kind,
    rows: importableRows,
  });
  return { preview: previewed.preview, created, error: null };
}

/**
 * This org's already-configured sources for one connector.
 *
 * A source records which connector created it in `config._connector`, not in
 * the `kind` column (every connector source is stored as kind `plugin`), so the
 * filter reads that key.
 * @param orgId - Org to read.
 * @param kind - Connector slug to filter on.
 */
async function existingSourcesForConnector(orgId: string, kind: string): Promise<ExistingSource[]> {
  const sources = await listSources(orgId);
  return sources
    .filter(source => (source.config?._connector ?? source.slug) === kind)
    .map(source => ({ slug: source.slug, config: source.config ?? {} }));
}
