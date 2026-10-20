/**
 * Whether an artifact has anything a spreadsheet export would carry — cheap
 * enough for the artifact header to ask on every render, and free of the HTML
 * parser the export itself uses (`tableExport.ts`), so the browser bundle does
 * not carry it.
 * @param artifact - Its kind and spec.
 * @param artifact.kind
 * @param artifact.spec
 */
export function hasExportableTables(artifact: { kind: string; spec?: unknown }): boolean {
  const spec = (artifact.spec ?? {}) as Record<string, unknown>;
  if (artifact.kind === 'document') {
    return typeof spec.html === 'string' && /<table[\s>]/i.test(spec.html);
  }
  return artifact.kind === 'table' && Array.isArray(spec.rows) && spec.rows.length > 0;
}

/**
 * Where the download lives (`app/api/artifacts/[id]/tables/route.ts`).
 * @param artifactId - The artifact.
 * @param format - `xlsx` (every table, one sheet each) or `csv` (one table).
 */
export function tableExportHref(artifactId: number, format: 'xlsx' | 'csv'): string {
  return `/api/artifacts/${artifactId}/tables?format=${format}`;
}
