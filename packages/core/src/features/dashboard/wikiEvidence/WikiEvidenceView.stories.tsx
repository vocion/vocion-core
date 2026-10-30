import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { EvidenceOverview } from '@/libs/memory/evidence';
import { NextIntlClientProvider } from 'next-intl';
import { WikiEvidenceView } from './WikiEvidenceView';

/**
 * The Wiki evidence page (ADR 0012), with made-up data: a workspace whose
 * travel and retention pages rest on replaced documents and whose refund
 * page cites a passage that changed.
 */
const meta: Meta<typeof WikiEvidenceView> = {
  title: 'Dashboard/Wiki evidence',
  component: WikiEvidenceView,
  parameters: { layout: 'padded' },
  decorators: [
    Story => (
      <NextIntlClientProvider locale="en">
        <div className="mx-auto max-w-5xl">
          <Story />
        </div>
      </NextIntlClientProvider>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof WikiEvidenceView>;

const doc = (id: number, title: string) => ({ id, title, uri: `https://docs.example.com/d/${id}` });

const BOARD: EvidenceOverview = {
  totals: { pages: 6, claims: 19, holding: 12, needCheck: 7, sourcesCited: 11, sourceLinks: 17 },
  checks: [
    { ref: 'claim:refunds#1', slug: 'refunds', pageTitle: 'Refunds', text: 'Customers can get a refund within 30 days of delivery.', freshness: 'changed', was: 'Window. Customers can request a refund within 30 days of delivery.', now: 'Window. Customers can request a refund within 14 days of delivery.', source: doc(104, 'Refund Policy'), newer: null },
    { ref: 'claim:travel#1', slug: 'travel', pageTitle: 'Travel and expenses', text: 'The domestic per diem is $60 per day.', freshness: 'superseded', was: null, now: null, source: doc(101, 'Travel Policy 2025'), newer: doc(102, 'Travel Policy 2026') },
    { ref: 'claim:travel#2', slug: 'travel', pageTitle: 'Travel and expenses', text: 'Hotels are capped at $180 per night.', freshness: 'superseded', was: null, now: null, source: doc(101, 'Travel Policy 2025'), newer: doc(102, 'Travel Policy 2026') },
    { ref: 'claim:data-retention#1', slug: 'data-retention', pageTitle: 'Data retention', text: 'Call recordings are kept for 36 months.', freshness: 'superseded', was: null, now: null, source: doc(119, 'Records Retention Schedule v1'), newer: doc(118, 'Records Retention Schedule v2') },
    { ref: 'claim:security#3', slug: 'security', pageTitle: 'Security', text: 'Laptops are re-imaged every two years.', freshness: 'gone', was: null, now: null, source: null, newer: null },
  ],
  pages: [
    { slug: 'travel', title: 'Travel and expenses', claims: 4, holding: 0, needCheck: 4 },
    { slug: 'data-retention', title: 'Data retention', claims: 2, holding: 0, needCheck: 2 },
    { slug: 'refunds', title: 'Refunds', claims: 2, holding: 1, needCheck: 1 },
    { slug: 'pricing', title: 'Pricing and discounts', claims: 3, holding: 3, needCheck: 0 },
    { slug: 'security', title: 'Security', claims: 5, holding: 5, needCheck: 0 },
    { slug: 'onboarding', title: 'Onboarding', claims: 3, holding: 3, needCheck: 0 },
  ],
  replaced: [
    { edge: 'supersedes', newer: doc(102, 'Travel Policy 2026'), older: doc(101, 'Travel Policy 2025') },
    { edge: 'supersedes', newer: doc(118, 'Records Retention Schedule v2'), older: doc(119, 'Records Retention Schedule v1') },
    { edge: 'amends', newer: doc(105, 'Refund Memo for Enterprise Accounts'), older: doc(104, 'Refund Policy') },
  ],
};

const EMPTY: EvidenceOverview = { totals: { pages: 0, claims: 0, holding: 0, needCheck: 0, sourcesCited: 0, sourceLinks: 0 }, pages: [], checks: [], replaced: [] };

export const Board: Story = { args: { overview: BOARD, wikiBase: '/dashboard/p/wiki', enabled: true } };

export const AllHold: Story = {
  args: { overview: { ...BOARD, totals: { ...BOARD.totals, holding: 19, needCheck: 0 }, checks: [], pages: BOARD.pages.map(p => ({ ...p, holding: p.claims, needCheck: 0 })) }, wikiBase: '/dashboard/p/wiki', enabled: true },
};

export const Empty: Story = { args: { overview: EMPTY, wikiBase: '/dashboard/p/wiki', enabled: true } };

export const Off: Story = { args: { overview: EMPTY, wikiBase: '/dashboard/p/wiki', enabled: false } };
