import type { PageManifest } from './pageFields';
import { workspaceUrl } from '@/libs/links';

/**
 * ONE LINK FOR EVERY RECORD.
 *
 * A record a plugin gives a page of its own opens THERE — a release at
 * `/dashboard/p/releases/<id>`, a request at its feature page, a product at
 * its overview — and every surface that names the record links to that page
 * rather than to the generic object view. Before this, each surface wrote
 * `/dashboard/objects/<id>` by hand, so the release a feature page named, the
 * task a release page listed and the record a chat citation opened all led to
 * a page that said "Back to Objects" over a sha, while the plugin's own page
 * for the same record sat one navigation away (principle 6: one shape; value
 * 3: evidence you can reach).
 *
 * Which page opens a type is the workspace's word, read from the manifests it
 * has on — so a deployment that replaces a plugin page by slug, or a plugin
 * that adds a page for a new type, moves every link at once and no surface
 * enumerates types (principle 7: the next kind costs a descriptor). A type no
 * page claims opens the generic record, which stays the one place a record's
 * raw fields and history live ({@link rawRecordPath}).
 *
 * Pure, and safe on the client. The server half — reading this org's
 * manifests and slug once per request — is `services/objects/recordHref.ts`.
 */

/** A record to link to: its object type's slug, and its id. */
export type RecordLinkRef = { objectType: string | null | undefined; id: string | number };

/** What the resolver needs, built once per request from the workspace's manifests. */
export type RecordLinks = {
  /** Object type slug → `/dashboard/p/<slug>/{id}`, the page that opens one. */
  pages: ReadonlyMap<string, string>;
  /** The workspace the links are for; null leaves them bare (the `Link` wrapper and the proxy canonicalise a bare path). */
  workspaceSlug: string | null;
  /**
   * Object types whose page is a `report` — one record's whole story, and the
   * status it is in (`services/objects/recordStatus.ts`). Absent, none.
   */
  reports?: ReadonlySet<string>;
};

/** The manifest fields the rule reads — enough that a test can hand in a literal. */
type ManifestShape = Pick<PageManifest, 'slug' | 'archetype' | 'source' | 'derive' | 'recordPage' | 'report'>;

/** No page claims any type: every record opens the generic view. */
export const NO_RECORD_PAGES: RecordLinks = { pages: new Map(), workspaceSlug: null };

/**
 * The generic record view. Kept for the surfaces that deliberately offer the
 * raw record — "Edit fields and history" — and as the fallback for a type no
 * page claims.
 * @param id - The record id.
 */
export function rawRecordPath(id: string | number): string {
  return `/dashboard/objects/${encodeURIComponent(String(id))}`;
}

/**
 * The object type a page opens one record of at `/dashboard/p/<slug>/<id>`,
 * or null. This mirrors what that route (`app/…/dashboard/p/[slug]/[id]`)
 * actually draws for a business object, and nothing else: a `report` over its
 * subject, a list with a `recordPage`, and the product board's overview. A
 * `rowLink` alone is not a claim — a list can point its rows anywhere, and a
 * `/dashboard/p/<slug>/{id}` the route does not draw is a 404.
 * @param m - One page manifest.
 */
export function recordPageTypeOf(m: ManifestShape): string | null {
  if (m.archetype === 'report' && m.report) {
    return m.report.subject;
  }
  if (m.archetype === 'list' && m.source?.kind === 'objects' && (m.recordPage !== undefined || m.derive === 'productBoard')) {
    return m.source.objectType;
  }
  return null;
}

/**
 * Object type → the page template that opens one, from a workspace's manifests.
 * The first page to claim a type keeps it, in the order the pages were read
 * (the workspace's own pages first, then its plugins'), so an override wins.
 * @param manifests - The pages the workspace has on.
 */
export function recordPagesOf(manifests: readonly ManifestShape[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of manifests) {
    const type = recordPageTypeOf(m);
    if (type !== null && !out.has(type)) {
      out.set(type, `/dashboard/p/${m.slug}/{id}`);
    }
  }
  return out;
}

/**
 * The object type a page slug opens one record of — the other direction of
 * {@link recordPagesOf}: `feature` → `request`, `releases` → `release`. Null
 * when no page by that slug claims a type; the slug itself is never the type.
 * @param links - From {@link recordLinksOf}.
 * @param pageSlug - The `<slug>` in `/dashboard/p/<slug>/<id>`.
 */
export function recordTypeOfPage(links: RecordLinks, pageSlug: string): string | null {
  const template = `/dashboard/p/${pageSlug}/{id}`;
  for (const [type, t] of links.pages) {
    if (t === template) {
      return type;
    }
  }
  return null;
}

/**
 * Build the resolver's input.
 * @param manifests - The pages the workspace has on.
 * @param workspaceSlug - `project.slug`, to prefix each link; null for bare paths.
 */
export function recordLinksOf(manifests: readonly ManifestShape[], workspaceSlug: string | null = null): RecordLinks {
  return { pages: recordPagesOf(manifests), workspaceSlug, reports: reportTypesOf(manifests) };
}

/**
 * Object types a `report` page tells the story of — the types that have a
 * status to read (`GET /api/v1/objects/:id/status`).
 * @param manifests - The pages the workspace has on.
 */
export function reportTypesOf(manifests: readonly ManifestShape[]): Set<string> {
  return new Set(manifests.flatMap(m => (m.archetype === 'report' && m.report ? [m.report.subject] : [])));
}

/**
 * Whether a record of this type has a report page, and so a status.
 * @param links - From {@link recordLinksOf}.
 * @param objectType - The record's type slug.
 */
export function hasReportPage(links: RecordLinks, objectType: string | null | undefined): boolean {
  return objectType ? links.reports?.has(objectType) === true : false;
}

/**
 * The link to one record: the page its workspace declares for its type, the
 * generic record otherwise, workspace-prefixed when the workspace is known.
 * @param links - From {@link recordLinksOf}; {@link NO_RECORD_PAGES} for the generic view.
 * @param ref - The record.
 */
export function recordHrefFrom(links: RecordLinks, ref: RecordLinkRef): string {
  const template = ref.objectType ? links.pages.get(ref.objectType) : undefined;
  const path = template ? template.replace('{id}', encodeURIComponent(String(ref.id))) : rawRecordPath(ref.id);
  return links.workspaceSlug ? workspaceUrl(links.workspaceSlug, path) : path;
}

/**
 * The generic record, prefixed the same way — for a surface that deliberately
 * offers the raw fields and history beside the page.
 * @param links - From {@link recordLinksOf}.
 * @param id - The record id.
 */
export function rawRecordHrefFrom(links: RecordLinks, id: string | number): string {
  return links.workspaceSlug ? workspaceUrl(links.workspaceSlug, rawRecordPath(id)) : rawRecordPath(id);
}

/**
 * A bound resolver, for pure assemblers that take one function rather than
 * the links: `link({ objectType: 'release', id })`.
 */
export type RecordLinker = (ref: RecordLinkRef) => string;

/**
 * Bind {@link recordHrefFrom} to one workspace's links.
 * @param links - From {@link recordLinksOf}.
 */
export function recordLinker(links: RecordLinks): RecordLinker {
  return ref => recordHrefFrom(links, ref);
}

/** The resolver with no pages declared — what a pure assembler uses when its caller passed none. */
export const genericRecordLinker: RecordLinker = recordLinker(NO_RECORD_PAGES);

/**
 * "Open feature" from `/w/acme/dashboard/p/feature/12` — the name of the page
 * the workspace opens the record on, so the words follow the workspace.
 * @param href - The record's link.
 */
export function openLabelFor(href: string): string {
  const page = /\/p\/([^/]+)\/[^/]+$/.exec(href)?.[1];
  return page ? `Open ${decodeURIComponent(page).replace(/[-_]+/g, ' ')}` : 'Open record';
}
