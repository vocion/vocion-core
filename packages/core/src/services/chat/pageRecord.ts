/**
 * THE PAGE'S RECORD, TYPED. A page hands chat `{type: 'object', id}` and its
 * path; what the record IS lives in two places the client does not read: the
 * workspace's page manifest (the page `feature` opens a `request`) and the row
 * itself. On `/dashboard/p/feature/124` the product manager was given
 * `object 124` and the path, read "feature" as the type, and told Chris
 * "`feature` isn't one of the object types I can read or write" — about
 * request 124 (conversation 355, 2026-09-28).
 *
 * So before the turn runs, an `object` ref is resolved here: the manifest says
 * which type the page opens (`recordTypeOfPage`), the row confirms it and
 * gives the record's own title. A type is never made up from a page slug.
 */

import type { PageContext, RecordRef } from './pageContext';
import type { RecordLinks } from '@/libs/workspace/recordHref';
import { recordTypeOfPage } from '@/libs/workspace/recordHref';

/** What the resolver reads outside itself — real in production, literal in tests. */
export type PageRecordDeps = {
  /** This workspace's record pages (`recordLinksForOrg`). */
  links: () => Promise<RecordLinks>;
  /** The row's type slug and title, or null when no such record is in this workspace. */
  row: (id: number) => Promise<{ typeSlug: string; title: string } | null>;
};

/**
 * The page slug a record ref's href or the page path names, if it is a
 * `/dashboard/p/<slug>/<id>` page.
 * @param href - The ref's href, or the page path.
 */
function pageSlugOf(href: string | undefined): string | null {
  if (!href) {
    return null;
  }
  const p = href.split(/[?#]/)[0]!.replace(/^\/[a-z]{2}(?=\/)/, '').replace(/^\/w\/[\w-]+/, '');
  return /^\/dashboard\/p\/([\w-]+)\/\d+\/?$/.exec(p)?.[1] ?? null;
}

/**
 * Type one `object` ref. Anything else, or a ref already typed, is returned as it was.
 * @param ref - The ref.
 * @param path - The page path, for a ref with no href.
 * @param deps - The manifest and the row.
 */
export async function typeRecordRef(ref: RecordRef, path: string, deps: PageRecordDeps): Promise<RecordRef> {
  if (ref.type !== 'object' || ref.objectType || !/^\d+$/.test(ref.id)) {
    return ref;
  }
  const slug = pageSlugOf(ref.href) ?? pageSlugOf(path);
  const fromPage = slug ? recordTypeOfPage(await deps.links().catch(() => ({ pages: new Map(), workspaceSlug: null })), slug) : null;
  const row = await deps.row(Number(ref.id)).catch(() => null);
  // The row is the fact; the manifest is what the page says it opens. They
  // agree on every record page; when they do not, the row wins.
  const objectType = row?.typeSlug ?? fromPage;
  if (!objectType) {
    return ref;
  }
  // A page title is often the app's ("Vocion Dashboard"); the row has the record's.
  return { ...ref, objectType, ...(row?.title ? { label: row.title } : {}) };
}

/**
 * Type the page's record (and the records it names) before the turn runs.
 * Never throws: an untyped ref is still the page's record.
 * @param ctx - The page context, as `readPageContext` read it.
 * @param deps - The manifest and the row.
 */
export async function typePageRecord(ctx: PageContext | null, deps: PageRecordDeps): Promise<PageContext | null> {
  if (!ctx?.record) {
    return ctx;
  }
  try {
    return { ...ctx, record: await typeRecordRef(ctx.record, ctx.path, deps) };
  } catch {
    return ctx;
  }
}

/**
 * The resolver wired to this org: its manifests and its rows.
 * @param orgId - The workspace.
 */
export function pageRecordDepsFor(orgId: string): PageRecordDeps {
  return {
    links: async () => {
      const { recordLinksForOrg } = await import('@/services/objects/recordHref');
      return recordLinksForOrg(orgId);
    },
    row: async (id) => {
      const { readRecord } = await import('@/libs/actions/factory-dispatch');
      const r = await readRecord(orgId, id);
      return r ? { typeSlug: r.typeSlug, title: r.title } : null;
    },
  };
}
