import type { RecordRef, RecordType } from '@/services/chat/pageContext';

/**
 * Preview — the platform capability for "do not make me leave this page".
 *
 * Three mechanisms in this app exist to keep a person where they are, and they
 * are one family, not three products (`docs/design/patterns.md` § Staying put):
 *
 *   1. Select → talk   the thing is ON this page; I select it and ask.
 *   2. Preview         the thing is on ANOTHER page; I peek at it here.
 *   3. The rail        the conversation itself, one keystroke away.
 *
 * The seam is `RecordRef`. Everything in the app that points at a thing is one
 * — evidence items, `@` mentions, inbox rows, search results, artifact links,
 * briefing claims, CRM subjects. A record type opts into preview by adding one
 * descriptor to `services/preview/registry.ts`, the way a platform opts in by
 * adding one to `libs/platforms/registry.ts`. Nothing else enumerates types,
 * so every surface that renders a ref gets preview the moment the descriptor
 * lands.
 *
 * A `PreviewDoc` is what the panel shows. It is deliberately flat and
 * presentational: the resolver has already decided what we hold, so the panel
 * renders and never queries.
 */

/** One `label: value` line in the panel header block. */
export type PreviewFact = { label: string; value: string };

export type PreviewDoc = {
  /** What this is about. Echoed so a stale panel can be told apart. */
  ref: RecordRef;
  /**
   * The heading. NEVER a raw id — an id is a handle, not a name. A resolver
   * with nothing better says what kind of thing it is and puts the id in
   * `reference` below.
   */
  title: string;
  /** The chip: `Granola`, `Zoom`, `Gmail`, `HubSpot`, `Document`, … */
  sourceLabel: string;
  subtitle?: string;
  facts?: PreviewFact[];
  /** The readable content, plain text or markdown. */
  body?: string;
  /** In-app full detail page. Relative only. */
  href?: string;
  /** The external system, when there is no in-app page. Labelled as leaving. */
  externalHref?: string;
  /** When the body was cut, so the panel can say "read the rest there". */
  truncated?: boolean;
  /**
   * Set when nothing could be resolved. The panel still renders: the raw
   * reference, plainly, and why. A blank panel is never an answer.
   */
  unresolved?: { reason: string; reference: string };
};

/** What a descriptor must answer about a ref before anything is loaded. */
export type PreviewIdentity = {
  /** The chip, e.g. `Granola`. */
  sourceLabel: string;
  /** The best name available without I/O — used until the resolver answers. */
  label: string;
  /** The full detail page, when the ref alone determines it. */
  href?: string;
};

/**
 * The URL param that carries an open preview, so a preview is linkable and
 * Back closes it.
 */
export const PREVIEW_PARAM = 'preview';

/**
 * @param ref
 */
export function previewKey(ref: Pick<RecordRef, 'type' | 'id'>): string {
  return `${ref.type}:${ref.id}`;
}

/**
 * Read a `?preview=` value back into a ref. Returns null for anything that is
 * not `<type>:<id>` — a hand-edited URL closes the panel, it does not throw.
 * @param value
 * @param isType - Whether a string names a known record type.
 */
export function parsePreviewKey(value: string | null | undefined, isType: (s: string) => s is RecordType): Pick<RecordRef, 'type' | 'id'> | null {
  if (!value) {
    return null;
  }
  const at = value.indexOf(':');
  if (at <= 0) {
    return null;
  }
  const type = value.slice(0, at);
  const id = value.slice(at + 1);
  return id && isType(type) ? { type, id } : null;
}
