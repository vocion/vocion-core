import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/locales/en.json';
import { DeliverablePane } from './DeliverablePane';

/**
 * The deliverable pane on a fictional deck and document: pages down the
 * side, the selected page live, notes and the receipt's findings beneath.
 * Edits call the real client, so in Storybook they fail with a toast — the
 * layout and the in-place editing affordance are what this shows.
 */
const meta: Meta<typeof DeliverablePane> = {
  title: 'Artifacts/Deliverable pane',
  component: DeliverablePane,
  parameters: { layout: 'fullscreen' },
  decorators: [
    Story => (
      <NextIntlClientProvider locale="en" messages={messages}>
        <div className="flex h-[720px] p-4">
          <Story />
        </div>
      </NextIntlClientProvider>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof DeliverablePane>;

const s = (id: string, body: string, notes: string) =>
  `<section id="${id}" style="padding:120px;display:flex;flex-direction:column;gap:32px;background:#f7f5f0;font-family:Georgia,serif;color:#1d1d1b">${body}<aside>${notes}</aside></section>`;

export const Deck: Story = {
  args: {
    artifactId: 1,
    kind: 'deck',
    title: 'Bellwater Hall — concept',
    version: 3,
    spec: {
      format: 'vocion-deck/1',
      title: 'Bellwater Hall — concept',
      order: ['cover', 'plan', 'price'],
      slides: {
        cover: s('cover', '<h1 style="font-size:120px;margin:0">One calendar for every hall</h1><p style="font-size:40px;margin:0">A concept for Bellwater Hall</p>', 'Open with the booking clash from the Bellwater call; synthetic numbers.'),
        plan: s('plan', '<h2 style="font-size:72px;margin:0">The plan</h2><ul style="font-size:40px"><li>Weeks 1–4: one calendar</li><li>Weeks 5–8: the booking desk</li></ul>', 'Three phases is a draft; confirm with Bellwater ops.'),
        price: s('price', '<h2 style="font-size:72px;margin:0">The price</h2><p style="font-size:48px;margin:0">[$__] per month</p>', ''),
      },
      verification: {
        at: '2026-10-20T10:00:00.000Z',
        ok: true,
        pdfPages: 3,
        issues: [],
        reports: ['slide 3: placeholder [$__]'],
        slides: [
          { id: 'cover', n: 1, label: 'One calendar for every hall', overflowPx: 0, clipped: [], smallText: [], belowFooter: [], elementCount: 2, unknownElements: [], unresolvedAssets: [], placeholders: [], hasNotes: true },
          { id: 'plan', n: 2, label: 'The plan', overflowPx: 0, clipped: [], smallText: [], belowFooter: [], elementCount: 4, unknownElements: [], unresolvedAssets: [], placeholders: [], hasNotes: true },
          { id: 'price', n: 3, label: 'The price', overflowPx: 0, clipped: [], smallText: [], belowFooter: [], elementCount: 2, unknownElements: [], unresolvedAssets: [], placeholders: ['[$__]'], hasNotes: false },
        ],
      },
    },
  },
};

const sheet = (body: string) => `<article class="sheet" style="width:816px;min-height:1056px;margin:16px auto;background:#fff;padding:64px;font-family:Georgia,serif">${body}</article>`;

export const Document: Story = {
  args: {
    artifactId: 2,
    kind: 'document',
    title: 'Contoso Supply — scope',
    version: 2,
    spec: {
      title: 'Contoso Supply — scope',
      html: `<!doctype html><html><head><title>Contoso Supply — scope</title></head><body style="background:#e9e9e4;margin:0">${sheet('<h1>Contoso Supply, one record</h1><p>What we will do, and what we will not.</p>')}${sheet('<h2>Plan</h2><p>Three phases over twelve weeks.</p>')}</body></html>`,
      sheets: 2,
    },
  },
};

export const OlderVersion: Story = { args: { ...Deck.args, readOnly: true } };
