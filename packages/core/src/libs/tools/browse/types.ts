export type Page = {
  url: string;
  title: string;
  content: string;
};

/** A page's HTML as served (or, through a rendering provider, as rendered). */
export type RawPage = {
  /** The URL finally read, after redirects. */
  url: string;
  html: string;
};

export type BrowseProvider = {
  readonly name: string;
  readonly requiredEnv: string[];
  isReady: () => boolean;
  /**
   * Fetch a single URL and return extracted title + text/markdown.
   *
   * `orgId` is what lets a paid provider spend the org's own vendor key rather
   * than the server's. It is optional because not every caller has an org in
   * hand — a fetch with no org falls back to the server's key.
   */
  fetchPage: (url: string, opts?: { orgId?: string }) => Promise<Page | null>;
  /**
   * Fetch a single URL and return its HTML, for a caller that reads the page's
   * structure (headings, meta, schema.org) rather than its prose: SERP
   * research (`libs/tools/serp/pageFacts.ts`). The address must be public
   * (`libs/net/publicUrl.ts`) on every hop. Null when the URL is not HTML.
   */
  fetchHtml: (url: string, opts?: { orgId?: string }) => Promise<RawPage | null>;
};

export type BrowseProviderName = 'builtin' | 'firecrawl';
