export type Page = {
  url: string;
  title: string;
  content: string;
};

export type BrowseProvider = {
  readonly name: string;
  readonly requiredEnv: string[];
  isReady: () => boolean;
  /** Fetch a single URL and return extracted title + text/markdown. */
  fetchPage: (url: string) => Promise<Page | null>;
};

export type BrowseProviderName = 'builtin' | 'firecrawl';
