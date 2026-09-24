/**
 * RESOLVING A PICTURE A ROW NAMES BY ID.
 *
 * A record stores the artifact, not the URL — `visuals.beforeArtifactIds` is
 * a list of artifact ids, and that is right: an artifact is the thing that
 * versions and can be cited, and a URL copied onto the record is a second
 * copy of a fact that can quietly disagree with the first.
 *
 * But a page cannot draw an id. So the page layer does the join, once, for
 * every `format: image` field whose value is an artifact id rather than a
 * URL — one query per page rather than one per row — and substitutes the
 * served URL on the way to the renderer. The record stays canonical and the
 * card gets something it can put in an `<img>`.
 *
 * An id that resolves to nothing is CLEARED rather than left in place: a row
 * whose artifact was deleted has no picture, and the block draws the empty
 * slot it draws for a row that never had one. A broken image would report
 * the same fact worse.
 */

import type { PageField, PageRow } from '@/libs/workspace/pageFields';
import { artifactHref } from '@/libs/tools/artifacts/url';
import { resolveField } from '@/libs/workspace/pageFields';
import { listArtifactsByIds } from '@/services/ArtifactService';

/**
 * Where an artifact row keeps something an `<img>` can load.
 * @param row
 * @param row.url
 * @param row.spec
 */
function imageUrlOf(row: { url: string | null; spec: unknown }): string | null {
  const url = row.url ?? (typeof row.spec === 'object' && row.spec !== null ? (row.spec as Record<string, unknown>).url : null);
  return typeof url === 'string' && url !== '' ? artifactHref(url) : null;
}

function idOf(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The metadata key a `from` writes back to, or null when it names something
 * that is not a single metadata field.
 * @param from - The field's `from`, or its key.
 */
function writableKey(from: string): string | null {
  const path = from.startsWith('meta.') ? from.slice(5) : from;
  if (path === '' || path.includes('.') || ['title', 'status', 'createdAt', 'id'].includes(from)) {
    return null;
  }
  return path;
}

/**
 * Replace artifact ids with served URLs on every `format: image` field.
 *
 * Rows are returned with the substitution applied to `meta`; a row whose
 * image field already holds a URL, or holds nothing, comes back untouched.
 * @param orgId - The workspace, because an artifact is org-scoped and an id
 * from another org must resolve to nothing rather than to a picture.
 * @param rows - The rows about to be drawn.
 * @param fields - The page's declared fields.
 * @returns The rows, with image ids resolved.
 */
export async function resolveRowImages(orgId: string, rows: PageRow[], fields: PageField[]): Promise<PageRow[]> {
  const images = fields.filter(f => f.format === 'image');
  if (images.length === 0 || rows.length === 0) {
    return rows;
  }
  // The key the substitution writes back to. `resolveField` reads a bare
  // `foo` as `meta.foo`, so only a single-segment metadata path can be
  // rewritten; a field reading a row COLUMN, or a nested path, is read but
  // never written — this has no business editing a record's identity.
  const paths = images
    .map(f => ({ from: f.from ?? f.key }))
    .map(({ from }) => ({ from, key: writableKey(from) }))
    .filter((p): p is { from: string; key: string } => p.key !== null);
  const wanted = new Set<number>();
  for (const row of rows) {
    for (const { from } of paths) {
      const raw = resolveField(row, from);
      const id = idOf(Array.isArray(raw) ? raw[0] : raw);
      if (id !== null) {
        wanted.add(id);
      }
    }
  }
  if (wanted.size === 0) {
    return rows;
  }
  const found = await listArtifactsByIds({ orgId, ids: [...wanted] });
  const urls = new Map(found.map(a => [a.id, imageUrlOf(a)]));
  return rows.map((row) => {
    let meta = row.meta;
    for (const { from, key } of paths) {
      const raw = resolveField(row, from);
      const id = idOf(Array.isArray(raw) ? raw[0] : raw);
      if (id !== null) {
        meta = { ...meta, [key]: urls.get(id) ?? null };
      }
    }
    return meta === row.meta ? row : { ...row, meta };
  });
}
