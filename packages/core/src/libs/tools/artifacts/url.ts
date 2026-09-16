/**
 * Artifact URL conventions — pure, importable from client cards and server
 * routes alike.
 *
 * Files are served through `/api/artifacts/<id>/<filename>` (authenticated,
 * org-checked) — never straight from `public/`. `<id>` is the content-
 * addressed file id `<orgId>-<hash>` that `saveArtifact` mints, or a numeric
 * `artifact` row id. Rows and prose written before this route carry
 * `/artifacts/<filename>` URLs; `artifactHref()` rewrites them on the way out.
 */

export const API_ARTIFACTS_BASE = '/api/artifacts';

const SAFE_FILENAME = /^[\w.-]{1,200}$/;

export function isSafeArtifactFilename(name: string): boolean {
  return SAFE_FILENAME.test(name) && !name.includes('..');
}

/**
 * `<orgId>-<hash>.<ext>` → `{ id: '<orgId>-<hash>', ext: 'ext' }`.
 * @param filename
 */
export function parseArtifactFilename(filename: string): { id: string; ext: string } | null {
  if (!isSafeArtifactFilename(filename)) {
    return null;
  }
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) {
    return { id: filename, ext: '' };
  }
  return { id: filename.slice(0, dot), ext: filename.slice(dot + 1).toLowerCase() };
}

/**
 * The served URL for a stored file.
 * @param filename
 * @param base
 */
export function servedArtifactUrl(filename: string, base: string = API_ARTIFACTS_BASE): string {
  const parsed = parseArtifactFilename(filename);
  if (base === API_ARTIFACTS_BASE && parsed) {
    return `${base}/${parsed.id}/${filename}`;
  }
  return `${base.replace(/\/$/, '')}/${filename}`;
}

/**
 * Rewrite a legacy `/artifacts/<filename>` URL to the authenticated route.
 * Anything else (already `/api/artifacts/…`, an external URL) passes through.
 * @param url
 */
export function artifactHref(url: string | null | undefined): string {
  if (!url) {
    return '#';
  }
  const m = url.match(/^\/artifacts\/([\w.-]+)$/);
  if (!m) {
    return url;
  }
  return servedArtifactUrl(m[1]!);
}

const CONTENT_TYPES: Record<string, string> = {
  csv: 'text/csv; charset=utf-8',
  svg: 'image/svg+xml',
  md: 'text/markdown; charset=utf-8',
  html: 'text/html; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  json: 'application/json; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
};

export function contentTypeForExt(ext: string): string {
  return CONTENT_TYPES[ext.toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Types a browser may render inline; everything else is offered as a download.
 * @param contentType
 */
export function isInlineType(contentType: string): boolean {
  return /^(?:image\/|text\/plain|text\/markdown|text\/csv|application\/pdf|application\/json)/.test(contentType);
}
