/**
 * Serve one stored artifact to a caller who belongs to its org.
 *
 * Resolution, in order:
 *   1. numeric `id` → `artifact` row (0095) → its org must match; filename
 *      comes from the row's url/spec (or the path segment when given).
 *   2. otherwise `id` is the content-addressed file id `<orgId>-<hash>` that
 *      `saveArtifact` mints (pre-0095 files have no row) → the id must start
 *      with the caller's `<orgId>-`; the filename segment, when present, must
 *      begin with the id, else the directory is scanned for `<id>.*`.
 *
 * Anything that doesn't resolve is a 404 — including an org mismatch, so a
 * caller learns nothing about another tenant's files. Responses are
 * `Cache-Control: private`.
 */

import { Buffer } from 'node:buffer';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { artifactsDir } from './store';
import { contentTypeForExt, isInlineType, isSafeArtifactFilename, parseArtifactFilename } from './url';

export type ArtifactRowLookup = (id: number) => Promise<{ orgId: string; kind: string; url: string | null; spec: Record<string, unknown>; title: string; payload?: unknown } | null>;

export type ServeResult
  = | { status: 200; body: Buffer; headers: Record<string, string> }
    /** A card artifact (table, markdown, chart, record, link) has no file — its spec is the content. */
    | { status: 200; json: unknown }
    | { status: 404 | 400 };

async function fileIn(dir: string, filename: string): Promise<{ abs: string; size: number } | null> {
  if (!isSafeArtifactFilename(filename)) {
    return null;
  }
  const abs = path.resolve(dir, filename);
  if (!abs.startsWith(path.resolve(dir) + path.sep)) {
    return null;
  }
  try {
    const s = await stat(abs);
    return s.isFile() ? { abs, size: s.size } : null;
  } catch {
    return null;
  }
}

export async function resolveArtifactFile(opts: {
  callerOrgId: string;
  id: string;
  filename?: string;
  lookupRow: ArtifactRowLookup;
  dir?: string;
}): Promise<ServeResult> {
  const dir = opts.dir ?? artifactsDir();
  let filename: string | null = null;
  let displayName: string | null = null;

  if (/^\d+$/.test(opts.id)) {
    const row = await opts.lookupRow(Number(opts.id));
    if (!row || row.orgId !== opts.callerOrgId) {
      return { status: 404 };
    }
    if (row.kind === 'document' && opts.filename && /\.html?$/i.test(opts.filename) && typeof row.spec.html === 'string') {
      // The document itself, for "Open" and for printing from the browser.
      // Sandboxed by CSP: agent-authored HTML runs with an opaque origin, so a
      // script in it can neither read the app's cookies nor its DOM.
      const body = Buffer.from(row.spec.html, 'utf8');
      return {
        status: 200,
        body,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': String(body.byteLength),
          'Content-Security-Policy': 'sandbox allow-scripts allow-modals allow-popups; frame-ancestors \'self\'',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, max-age=0, must-revalidate',
          'Content-Disposition': `inline; filename="${row.title.replace(/[^\w .()-]+/g, ' ').trim().slice(0, 120) || 'document'}.html"`,
        },
      };
    }
    if (row.kind !== 'file') {
      return { status: 200, json: row.payload ?? { kind: row.kind, title: row.title, spec: row.spec } };
    }
    const fromSpec = typeof row.spec.filename === 'string' ? row.spec.filename : null;
    const fromUrl = row.url ? row.url.split('/').pop() ?? null : null;
    filename = opts.filename && isSafeArtifactFilename(opts.filename) ? opts.filename : (fromSpec ?? fromUrl);
    if (filename && fromSpec && fromUrl && filename !== fromSpec && filename !== fromUrl) {
      return { status: 404 };
    }
    displayName = row.title;
  } else {
    // Legacy / content-addressed id: `<orgId>-<hash>`.
    if (!isSafeArtifactFilename(opts.id) || !opts.id.startsWith(`${opts.callerOrgId}-`)) {
      return { status: 404 };
    }
    if (opts.filename) {
      const parsed = parseArtifactFilename(opts.filename);
      if (!parsed || parsed.id !== opts.id) {
        return { status: 404 };
      }
      filename = opts.filename;
    } else {
      let entries: string[] = [];
      try {
        entries = await readdir(dir);
      } catch {
        return { status: 404 };
      }
      filename = entries.find(e => parseArtifactFilename(e)?.id === opts.id) ?? null;
    }
  }

  if (!filename) {
    return { status: 404 };
  }
  const found = await fileIn(dir, filename);
  if (!found) {
    return { status: 404 };
  }
  const ext = parseArtifactFilename(filename)?.ext ?? '';
  const contentType = contentTypeForExt(ext);
  const body = await readFile(found.abs);
  const disposition = `${isInlineType(contentType) ? 'inline' : 'attachment'}; filename="${(displayName && ext ? `${displayName.replace(/[^\w.-]+/g, '_')}.${ext}` : filename).replace(/"/g, '')}"`;
  return {
    status: 200,
    body,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(found.size),
      'Content-Disposition': disposition,
      'Cache-Control': 'private, max-age=0, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  };
}
