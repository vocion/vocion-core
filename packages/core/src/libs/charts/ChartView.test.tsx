import type { ChartSpec } from './spec';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { ChartView } from './ChartView';
import '@/styles/global.css';

/**
 * The chart card in a real browser: laid out at its own width, so on a phone
 * the x labels thin instead of running into each other, the forecast is
 * hatched and named in the legend, and the data is there for a screen reader.
 * Fictional numbers.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const spec: ChartSpec = {
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
  format: 'currency',
  source: 'Ledger P&L by month',
  asOf: '2026-10-23',
};

/** The x labels as drawn: the text along the bottom edge. */
function xLabels(): DOMRect[] {
  const svg = document.querySelector('[data-testid="chart"] svg')!;
  const bottom = svg.getBoundingClientRect().bottom;
  return [...svg.querySelectorAll('text')].map(t => t.getBoundingClientRect()).filter(r => bottom - r.bottom < 16);
}

describe('the chart card', () => {
  it('draws no two x labels on top of each other at a phone\'s width', async () => {
    await render(<div style={{ width: 340 }}><ChartView spec={spec} /></div>);

    await expect.element(page.getByRole('img', { name: 'On pace for $4.4M, with December carried by pipeline' })).toBeVisible();
    // Laid out again at the width it measured, not the default.
    await expect.poll(() => document.querySelector('[data-testid="chart"] svg')?.getAttribute('viewBox')?.startsWith('0 0 340 ')).toBe(true);

    const labels = xLabels().sort((a, b) => a.left - b.left);

    expect(labels.length).toBeGreaterThan(2);

    for (let i = 1; i < labels.length; i++) {
      expect(labels[i]!.left).toBeGreaterThanOrEqual(labels[i - 1]!.right);
    }
  });

  it('names the forecast in the legend and keeps the data for a screen reader', async () => {
    await render(<ChartView spec={spec} width={960} />);

    await expect.element(page.getByTestId('chart-legend')).toHaveTextContent(/Weighted pipeline \(forecast\)/);
    await expect.element(page.getByTestId('chart-legend')).toHaveTextContent(/Forecast from Nov/);
    expect(document.querySelector('[data-testid="chart"] table')?.textContent).toContain('Nov (forecast)');
    expect(document.querySelector('[data-testid="chart"] pattern')).not.toBeNull();
  });
});
