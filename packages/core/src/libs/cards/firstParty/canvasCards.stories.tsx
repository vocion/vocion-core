import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ChartCardView } from './chart';
import { DataTableCardView } from './dataTable';
import { LinkCardView } from './link';
import { MarkdownCardView } from './markdown';
import { RecordCardView } from './record';

/**
 * The five canvas cards on both surfaces. `chat` is dense and truncated;
 * `canvas` is the full tile. Same data, same component, two densities.
 */
const meta: Meta = {
  title: 'Cards/Canvas cards',
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj;

const deals = {
  title: 'Open deals closing this month',
  columns: [
    { key: 'name', label: 'Deal', type: 'text' as const },
    { key: 'amount', label: 'Amount', type: 'currency' as const },
    { key: 'probability', label: 'Likelihood', type: 'percent' as const },
    { key: 'stage', label: 'Stage', type: 'badge' as const },
    { key: 'close', label: 'Close', type: 'date' as const },
  ],
  rows: [
    { name: 'Northbeam — Operational AI', amount: 110000, probability: 80, stage: 'Contract sent', close: '2026-09-19' },
    { name: 'Lakeside Grocers — Vocion', amount: 69000, probability: 25, stage: 'Proposal', close: '2026-09-30' },
    { name: 'Harbor Health — Maintenance', amount: 89500, probability: 60, stage: 'Renewal', close: '2026-09-30' },
    { name: 'Ridgeline — ACE Phase 1.5', amount: 37500, probability: 70, stage: 'Proposal', close: '2026-09-30' },
  ],
  caption: 'HubSpot · as of 5:04 AM',
  sortBy: 'amount',
  sortDir: 'desc' as const,
};

export const DataTableChat: Story = { render: () => <div className="max-w-md"><DataTableCardView data={deals} surface="chat" /></div> };
export const DataTableCanvas: Story = { render: () => <DataTableCardView data={deals} surface="canvas" /> };

const chart = {
  title: 'Weighted pipeline by month',
  type: 'bar' as const,
  x: ['Jun', 'Jul', 'Aug', 'Sep'],
  series: [
    { name: 'Contracts out', values: [420000, 610000, 880000, 1062500] },
    { name: 'Proposals', values: [300000, 280000, 350000, 410000] },
  ],
  unit: '$',
  stacked: true,
};
export const ChartChat: Story = { render: () => <div className="max-w-md"><ChartCardView data={chart} surface="chat" /></div> };
export const ChartCanvasLine: Story = { render: () => <ChartCardView data={{ ...chart, type: 'line', stacked: false }} surface="canvas" /> };
export const ChartCanvasArea: Story = { render: () => <ChartCardView data={{ ...chart, type: 'area' }} surface="canvas" /> };

const md = { title: 'Lerner call — prep', md: '## Goal\nDecide whether this is a services deal or an acquisition conversation.\n\n- [x] Data room sent\n- [ ] Confirm TTM\n- [ ] Ask about the board timeline\n\n| Topic | Owner |\n|---|---|\n| Valuation frame | Chris |\n| Integration | Jamie |' };
export const MarkdownChat: Story = { render: () => <div className="max-w-md"><MarkdownCardView data={md} surface="chat" /></div> };
export const MarkdownCanvas: Story = { render: () => <MarkdownCardView data={md} surface="canvas" /> };

const record = { type: 'Deal', id: '61111439370', label: 'Northbeam — Operational AI', href: '/dashboard/objects/61111439370', status: 'Contract sent', fields: [{ k: 'Amount', v: '$110,000' }, { k: 'Close', v: 'Sep 19' }, { k: 'Owner', v: 'Chris' }, { k: 'Last touch', v: '3 days ago' }] };
export const RecordChat: Story = { render: () => <div className="max-w-md"><RecordCardView data={record} surface="chat" /></div> };
export const RecordCanvas: Story = { render: () => <RecordCardView data={record} surface="canvas" /> };

export const LinkChat: Story = { render: () => <div className="max-w-md"><LinkCardView data={{ href: '/artifacts/x.csv', title: 'open-deals.csv', description: 'text/csv · 2 KB' }} surface="chat" /></div> };
