export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
};

export type WebSearchOptions = {
  /** Max results to return (provider-clamped). */
  count?: number;
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
