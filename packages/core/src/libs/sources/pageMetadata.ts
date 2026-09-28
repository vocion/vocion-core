/**
 * The structured half of a web page, and the capped blob it becomes on the
 * document row.
 *
 * `extractFromHtml` (`libs/sources/web.ts`) turns a page into text; the same
 * DOM walk also knows the page's JSON-LD, its og:image and every URL it
 * publishes. That used to be thrown away, the JSON-LD survived only as a text
 * section, so a downstream extractor had to re-parse prose to get facts the
 * page had already stated in machine-readable form. `PageStructure` is that
 * half, kept.
 *
 * `pageMetadata` is the only thing that reaches `knowledge_document.metadata`,
 * and that column is compared with `canonicalJson` on every sync to decide
 * whether a document needs refreshing (`services/IngestionService.ts:215`).
 * Two consequences drive everything here: the output must be DETERMINISTIC,
 * no clocks, no counters, no iteration order that depends on anything but the
 * page, and it must be BOUNDED, because a big listing page can carry
 * megabytes of JSON-LD and hundreds of links.
 */

export type PageLink = {
  url: string;
  text: string;
};

export type PageStructure = {
  /** Every JSON-LD block on the page, parsed. Order is document order. */
  jsonLd?: unknown[];
  /** Every JSON-LD block is also in the page text, whole. */
  jsonLdInText?: boolean;
  /** The og:image, made absolute against the page URL. */
  ogImage?: string;
  /**
   * Every URL the page published, in document order, deduplicated.
   *
   * This is the PRE-STRIP list: it is collected before the chrome (nav,
   * header, footer, cookie bars) comes out, so it is a superset of the links
   * that survive into `content`. That is deliberate, it is the gate a later
   * stage uses to decide whether a model-returned URL was actually published
   * by the page, and a gate wants the superset.
   */
  links?: PageLink[];
  /** Set when a cap dropped something, so a reader knows the lists are partial. */
  truncated?: boolean;
};

/** JSON-LD blocks kept per page. Past this a listing page is repeating itself. */
export const JSON_LD_BLOCK_CAP = 25;

/**
 * Total serialised JSON-LD kept on the document row. Blocks are dropped WHOLE
 * from the end: half an object on a row that downstream code will `JSON.parse`
 * is worse than a missing one.
 */
export const JSON_LD_METADATA_CHAR_CAP = 40_000;

/** Links kept per page. A nav-heavy page publishes far more than this. */
export const LINK_CAP = 300;

/** A link's visible text, sliced. Some sites put a paragraph inside an <a>. */
export const LINK_TEXT_CAP = 200;

/**
 * Build the metadata blob for one page.
 *
 * Empty parts are omitted rather than written as `[]`, so a page with no
 * JSON-LD and no links produces exactly what the connector used to write and
 * costs no `metadataRefreshed` on the next sync.
 * @param structure - the page structure, when the body was HTML.
 */
export function pageMetadata(structure: PageStructure | undefined): Record<string, unknown> {
  if (!structure) {
    return {};
  }
  const out: Record<string, unknown> = {};
  let truncated = structure.truncated === true;

  const { kept: jsonLd, truncated: jsonLdCut } = capJsonLd(structure.jsonLd ?? []);
  if (jsonLd.length) {
    out.jsonLd = jsonLd;
    if (structure.jsonLdInText === true) {
      out.jsonLdInText = true;
    }
  }
  truncated ||= jsonLdCut;

  if (structure.ogImage) {
    out.ogImage = structure.ogImage;
  }

  const links = (structure.links ?? []).slice(0, LINK_CAP).map(link => ({
    url: link.url,
    text: link.text.slice(0, LINK_TEXT_CAP),
  }));
  if (links.length) {
    out.links = links;
  }
  truncated ||= (structure.links?.length ?? 0) > LINK_CAP;

  if (truncated) {
    out.truncated = true;
  }
  return out;
}

/**
 * Apply both JSON-LD caps: at most `JSON_LD_BLOCK_CAP` blocks, and at most
 * `JSON_LD_METADATA_CHAR_CAP` characters once serialised, counting a block
 * only if the whole of it fits.
 * @param blocks - the parsed JSON-LD blocks, in document order.
 */
function capJsonLd(blocks: unknown[]): { kept: unknown[]; truncated: boolean } {
  const withinBlockCap = blocks.slice(0, JSON_LD_BLOCK_CAP);
  const kept: unknown[] = [];
  let budget = JSON_LD_METADATA_CHAR_CAP;
  for (const block of withinBlockCap) {
    let size: number;
    try {
      size = JSON.stringify(block)?.length ?? 0;
    } catch {
      // A cycle cannot come out of JSON.parse, but a block that will not
      // serialise cannot be stored either, so it is dropped with the rest.
      break;
    }
    if (size > budget) {
      break;
    }
    kept.push(block);
    budget -= size;
  }
  return { kept, truncated: kept.length < blocks.length };
}
