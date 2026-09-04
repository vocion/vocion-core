export type Page = {
  url: string;
  title: string;
  content: string;
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
};

export type BrowseProviderName = 'builtin' | 'firecrawl';
