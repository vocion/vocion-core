import type { PreviewDoc } from '@/libs/preview/types';
import type { RecordRef, RecordType } from '@/services/chat/pageContext';
import { evidenceRef } from '@/libs/preview/evidenceRef';

/**
 * THE list of record types that can be previewed, and the only one.
 *
 * A type opts in by adding a descriptor here — the way a vendor opts in by
 * adding one to `libs/platforms/registry.ts`. Nothing in the panel, the router
 * or any calling surface enumerates types, so adding a descriptor is the whole
 * change, and every surface that already renders a `RecordRef` gets preview
 * for that type with no edit of its own.
 *
 * A type with no descriptor is not an error. `resolvePreview` answers with an
 * `unresolved` doc carrying the raw reference and its link — a reference we
 * cannot read still tells a person which thing it names.
 */

export type PreviewContext = { orgId: string; userId: string | null };

export type PreviewDescriptor = {
  /** The chip. */
  sourceLabel: string;
  /** The full detail page for this ref, when the ref alone determines it. */
  href?: (ref: RecordRef) => string | null;
  /**
   * What we hold for this ref. Return null when the ref names nothing we can
   * find — the caller turns that into the unresolved state; a resolver never
   * invents one.
   *
   * Resolvers read MIRRORS. Every source in this app is already copied into
   * `knowledge_document` or a first-party table by the connectors, so a peek
   * costs a query, not an outbound call to someone else's API. A kind whose
   * data only exists behind a live call has no descriptor on purpose.
   */
  resolve: (ref: RecordRef, ctx: PreviewContext) => Promise<PreviewDoc | null>;
};

const REGISTRY = new Map<RecordType, PreviewDescriptor>();

/**
 * @param type
 * @param descriptor
 */
export function registerPreview(type: RecordType, descriptor: PreviewDescriptor): void {
  REGISTRY.set(type, descriptor);
}

/**
 * @param type
 */
export function previewDescriptor(type: RecordType): PreviewDescriptor | null {
  return REGISTRY.get(type) ?? null;
}

/** Which types can be previewed — for tests and for the docs. */
export function previewTypes(): RecordType[] {
  return [...REGISTRY.keys()].sort();
}

/**
 * What the panel should show for one reference. Never throws and never returns
 * null: a reference we cannot resolve still renders, as itself, with the
 * reason.
 * @param ref
 * @param ctx
 */
export async function resolvePreview(ref: RecordRef, ctx: PreviewContext): Promise<PreviewDoc> {
  const descriptor = REGISTRY.get(ref.type);
  // Even unresolved, the reference names a system and a kind of thing — the
  // same reading the list already put on the row. Say that rather than
  // "Document", and never fall back to the id as the title.
  const read = evidenceRef(ref.id);
  const fallback = (reason: string): PreviewDoc => ({
    ref,
    title: ref.label ?? read.label,
    sourceLabel: read.sourceLabel === 'Note' ? descriptor?.sourceLabel ?? 'Reference' : read.sourceLabel,
    href: ref.href ?? descriptor?.href?.(ref) ?? undefined,
    unresolved: { reason, reference: ref.id },
  });
  if (!descriptor) {
    return fallback('Nothing in Vocion reads this kind of reference yet.');
  }
  try {
    const doc = await descriptor.resolve(ref, ctx);
    if (!doc) {
      return fallback('No synced copy of this reference was found in this workspace.');
    }
    return { ...doc, href: doc.href ?? descriptor.href?.(ref) ?? undefined };
  } catch (error) {
    console.error(`preview: resolving ${ref.type}:${ref.id} failed`, error);
    return fallback('This reference could not be read just now.');
  }
}
