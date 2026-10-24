import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { ChartSpec } from './spec';
import { ChartView } from './ChartView';

/**
 * Each chart kind the engine draws, at a phone's width and a desktop pane's.
 * The phone column is laid out at 360px (labels thinned, wrapped, or the
 * bars turned horizontal; never overlapping); the desktop one at 960px.
 * Fictional numbers throughout.
 */
const meta: Meta = {
  title: 'Charts/Kinds',
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const stackedByMonth: ChartSpec = {
  title: 'On pace for $4.4M, with December carried by pipeline',
  type: 'bar',
  x: MONTHS,
  series: [
    { name: 'Invoiced', values: [310, 295, 330, 342, 351, 360, 372, 380, 395, 410, 205, 120].map(v => v * 1000) },
    { name: 'Weighted pipeline', values: [null, null, null, null, null, null, null, null, null, null, 140000, 260000], forecast: true },
  ],
  stack: 'stack',
  aggregation: 'period',
  forecastFrom: 'Nov',
  marker: { x: 'Oct', label: 'Today' },
  format: 'currency',
  currency: 'USD',
  source: 'Ledger P&L by month; CRM open deals at stage probability',
  asOf: '2026-10-23',
};

const grouped: ChartSpec = {
  title: 'Expansion outgrew new logos in Q3',
  type: 'bar',
  x: ['Q1', 'Q2', 'Q3', 'Q4'],
  series: [{ name: 'New logos', values: [420, 460, 410, 480] }, { name: 'Expansion', values: [300, 380, 520, 560] }],
  format: 'currency',
  compact: true,
  aggregation: 'period',
};

const percent: ChartSpec = {
  title: 'Retainers are now half of revenue',
  type: 'bar',
  x: ['Jul', 'Aug', 'Sep', 'Oct'],
  series: [{ name: 'Retainers', values: [30, 38, 44, 51] }, { name: 'Projects', values: [55, 49, 45, 40] }, { name: 'Licences', values: [15, 13, 11, 9] }],
  stack: 'percent',
  aggregation: 'period',
};

const lineForecast: ChartSpec = {
  title: 'Cash stays above the floor through March',
  type: 'line',
  x: ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'],
  series: [{ name: 'Cash', values: [1.9, 1.7, 1.8, 1.6, 1.5, 1.55].map(v => v * 1e6) }],
  aggregation: 'snapshot',
  forecastFrom: 'Nov',
  targets: [{ value: 1_200_000, label: 'Floor' }],
  format: 'currency',
  asOf: '2026-10-23',
};

const area: ChartSpec = {
  title: 'Support load doubled after the launch',
  type: 'area',
  x: MONTHS.slice(0, 9),
  series: [{ name: 'Email', values: [40, 42, 38, 45, 60, 88, 95, 92, 90] }, { name: 'Chat', values: [20, 22, 25, 24, 40, 70, 80, 78, 82] }],
  stack: 'stack',
  unit: 'tickets',
};

const waterfall: ChartSpec = {
  title: 'Churn took back a third of new ARR',
  type: 'waterfall',
  x: ['Q3 ARR', 'New', 'Expansion', 'Churn', 'Q4 ARR'],
  series: [{ name: 'ARR', values: [2_000_000, 360_000, 140_000, -170_000, 2_330_000] }],
  waterfallTotals: ['Q3 ARR', 'Q4 ARR'],
  format: 'currency',
};

/** The P&L bridge Chris was shown on 2026-10-24, rebuilt with fictional numbers: the library draws its summary and a rescaled detail. */
const pnlBridge: ChartSpec = {
  title: 'Base case: the year ends about $46K net profit on $5.11M revenue',
  type: 'waterfall',
  x: ['Revenue', 'Delivery cost', 'Gross profit', 'Operating expenses', 'Operating profit', 'Interest', 'Bonus pool', 'Tax', 'Net income'],
  series: [{ name: 'FY2026 base case', values: [5_110_000, -2_520_000, null, -2_478_000, null, -38_000, -4_600, -23_400, null], forecast: true }],
  waterfallTotals: ['Revenue', 'Gross profit', 'Operating profit', 'Net income'],
  format: 'currency',
  currency: 'USD',
  source: 'Ledger P&L, year to date plus base case',
  asOf: '2026-10-24',
};

/** Long names: the library turns the bars horizontal rather than cutting them to codes. */
const longNames: ChartSpec = {
  title: 'Three customers carry half of this year\'s revenue',
  type: 'bar',
  x: ['Northwind Regional Holdings', 'Kestrel Capital Partners', 'Larkfield Construction Group', 'Other customers'],
  series: [{ name: 'Revenue', values: [1_310_000, 820_000, 540_000, 2_440_000] }],
  format: 'currency',
  source: 'Ledger, invoices by customer',
  asOf: '2026-10-24',
};

function Both({ spec }: { spec: ChartSpec }) {
  return (
    <div className="flex flex-wrap items-start gap-8">
      <div style={{ width: 360 }}><ChartView spec={spec} width={360} /></div>
      <div style={{ width: 960, maxWidth: '100%' }}><ChartView spec={spec} width={960} /></div>
    </div>
  );
}

export const StackedByMonth: Story = { render: () => <Both spec={stackedByMonth} /> };
export const Grouped: Story = { render: () => <Both spec={grouped} /> };
export const PercentStacked: Story = { render: () => <Both spec={percent} /> };
export const LineWithForecast: Story = { render: () => <Both spec={lineForecast} /> };
export const StackedArea: Story = { render: () => <Both spec={area} /> };
export const Waterfall: Story = { render: () => <Both spec={waterfall} /> };
export const PnlBridgeSplit: Story = { render: () => <Both spec={pnlBridge} /> };
export const LongNamesHorizontal: Story = { render: () => <Both spec={longNames} /> };
export const InChat: Story = { render: () => <div className="max-w-md"><ChartView spec={stackedByMonth} dense /></div> };
