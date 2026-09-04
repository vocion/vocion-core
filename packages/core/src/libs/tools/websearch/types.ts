export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
};

export type WebSearchOptions = {
  /** Max results to return (provider-clamped). */
  count?: number;
  /**
   * The org this search is for. It is what lets a provider spend the org's own
   * vendor key rather than the server's, and it is optional because not every
   * caller has an org in hand — a search with no org falls back to the
   * server's key.
   */
  orgId?: string;
};

export type WebSearchProvider = {
  readonly name: string;
  /** env vars this provider needs; empty when none / always ready. */
  readonly requiredEnv: string[];
  /** true when requiredEnv are all present. */
  isReady: () => boolean;
  search: (query: string, opts?: WebSearchOptions) => Promise<WebSearchResult[]>;
};

export type WebSearchProviderName = 'tavily' | 'brave' | 'anthropic';
