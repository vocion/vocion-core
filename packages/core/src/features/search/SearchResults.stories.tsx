import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { SearchResult } from './SearchResults';
import { NextIntlClientProvider } from 'next-intl';
import { ListPage } from '@/components/patterns';
import { SearchResults } from './SearchResults';

/**
 * Search on the List archetype: one title, one context line, ONE row of
 * connector chips with "+N more", and results as `ListRow`s in the same
 * density as Artifacts and Review queue.
 */
const meta: Meta<typeof SearchResults> = {
  title: 'Search/Results',
  component: SearchResults,
  parameters: { layout: 'padded' },
  decorators: [
    Story => (
      <NextIntlClientProvider locale="en">
        <div className="@container mx-auto max-w-5xl">
          <ListPage
            title="Search"
            description="Hybrid retrieval across every connected connector — pgvector and Postgres full-text with reciprocal rank fusion, the same pipeline your agents use."
          >
            <Story />
          </ListPage>
        </div>
      </NextIntlClientProvider>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof SearchResults>;

const SOURCES = [
  { slug: 'drive', count: 1284 },
  { slug: 'notion', count: 612 },
  { slug: 'slack', count: 480 },
  { slug: 'github', count: 311 },
  { slug: 'gong', count: 204 },
  { slug: 'hubspot', count: 158 },
  { slug: 'zendesk', count: 96 },
  { slug: 'linear', count: 44 },
];

function result(over: Partial<SearchResult> & Pick<SearchResult, 'id' | 'title'>): SearchResult {
  return {
    sourceSlug: 'drive',
    link: null,
    blurb: 'The quarterly plan, the owners for each workstream, and the dates the team committed to in the kickoff.',
    score: null,
    updatedAt: '2026-08-24T09:00:00.000Z',
    openable: true,
    ...over,
  };
}

const RECENT: SearchResult[] = [
  result({ id: '1', title: 'Q3 platform plan' }),
  result({ id: '2', title: 'Onboarding runbook', sourceSlug: 'notion', updatedAt: '2026-08-22T09:00:00.000Z' }),
  result({ id: '3', title: 'Pricing FAQ', sourceSlug: 'zendesk', updatedAt: '2026-08-19T09:00:00.000Z', blurb: 'Answers the five questions support gets most about plan limits and overages.' }),
];

/** Browsing: no query, the most recent documents, no scores. */
export const Browsing: Story = {
  args: { query: '', source: null, sources: SOURCES, results: RECENT, error: null },
};

/** A query: the same rows, ranked, with the hybrid score in its column. */
export const Ranked: Story = {
  args: {
    query: 'onboarding',
    source: null,
    sources: SOURCES,
    results: RECENT.map((r, i) => ({ ...r, score: 0.92 - i * 0.17 })),
    error: null,
  },
};

/** Filtered to one connector — the chip is on and never falls into the overflow. */
export const FilteredToOneConnector: Story = {
  args: { query: '', source: 'linear', sources: SOURCES, results: [RECENT[0]!], error: null },
};

/** Nothing matched: the toolbar stays put so the filter can be changed. */
export const NoMatch: Story = {
  args: { query: 'quarterly retros', source: 'gong', sources: SOURCES, results: [], error: null },
};
