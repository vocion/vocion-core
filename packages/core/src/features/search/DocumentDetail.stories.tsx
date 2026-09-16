import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { NextIntlClientProvider } from 'next-intl';
import { DocumentDetail } from './DocumentDetail';

/**
 * One ingested document on the Detail archetype, with the standard
 * "Ask about this" affordance beside the title.
 */
const meta: Meta<typeof DocumentDetail> = {
  title: 'Search/Document',
  component: DocumentDetail,
  parameters: { layout: 'padded' },
  decorators: [
    Story => (
      <NextIntlClientProvider locale="en">
        <div className="@container mx-auto max-w-5xl">
          <Story />
        </div>
      </NextIntlClientProvider>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof DocumentDetail>;

const BODY = `Q3 platform plan

Three workstreams, each with one owner and one date.

1. Retrieval quality. Owner: platform. Ship reciprocal rank fusion behind a
flag, measure against the labelled set, then make it the default.

2. Connector coverage. Owner: integrations. Three connectors, each with a
sync budget and a tombstoning pass.

3. The shell. Owner: product. One list component, one detail component; every
page composes them.`;

export const Default: Story = {
  args: {
    backHref: '/dashboard/search',
    doc: {
      id: '1',
      title: 'Q3 platform plan',
      sourceSlug: 'drive',
      sourceKind: 'google_drive',
      externalId: '1aBcD-EfGhIjKlMnOpQrStUvWxYz',
      uri: 'https://example.com/d/q3-platform-plan',
      content: BODY,
      chunkCount: 3,
      lastModifiedAt: '2026-08-24T09:00:00.000Z',
      ingestedAt: '2026-08-25T04:12:00.000Z',
      metadata: { author: 'platform', folder: 'Planning', mimeType: 'text/markdown' },
    },
  },
};

/** A document with no indexed text — the truth, not an empty page. */
export const NoText: Story = {
  args: {
    ...Default.args!,
    doc: { ...Default.args!.doc!, content: '', chunkCount: 0, uri: null, metadata: {} },
  },
};
