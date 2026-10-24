import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render as renderBase } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { expandChartBlocks } from '@/libs/charts/documentBlocks';
import '@/styles/global.css';

/**
 * Charts in the one pane, on a phone: a chart artifact draws at the drawer's
 * width, and a document's chart blocks arrive drawn inside the document the
 * drawer shows. Fictional numbers.
 */

const artifactGet = vi.fn();
vi.mock('@/libs/Orpc', () => ({
  client: {
    preview: { get: vi.fn(async () => null) },
    artifacts: new Proxy({ get: (...a: unknown[]) => artifactGet(...a) } as Record<string, unknown>, {
      get: (target, name: string) => target[name] ?? vi.fn(async () => []),
    }),
  },
}));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/dashboard/chat',
}));

const { PreviewPane } = await import('./PreviewPane');
const { PaneDrawer } = await import('./PaneDrawer');
const { closePreview, openPreview, useOpenPreviewRef } = await import('./previewState');
const en = (await import('@/locales/en.json')).default;

const render = (ui: React.ReactElement) => renderBase(ui, {
  wrapper: ({ children }) => <NextIntlClientProvider locale="en" messages={en}>{children}</NextIntlClientProvider>,
});

const SPEC = {
  title: 'On pace for $4.4M, with December carried by pipeline',
  type: 'bar',
  x: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
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

const base = { version: 1, authorKind: 'agent', authorId: 'agent:analyst', updatedAt: new Date().toISOString(), folder: null, conversationId: 7, messageId: null };
const chartArtifact = { ...base, id: 51, kind: 'chart', title: SPEC.title, spec: SPEC };
const docHtml = expandChartBlocks('<!doctype html><html><head><title>Revenue review</title></head><body>'
  + '<article class="sheet"><div class="body"><h1>Revenue review</h1>'
  + `<figure class="vocion-chart"><script type="application/json">${JSON.stringify(SPEC)}</script></figure>`
  + '</div></article></body></html>').html;
const documentArtifact = { ...base, id: 52, kind: 'document', title: 'Revenue review', spec: { title: 'Revenue review', html: docHtml, sheets: 1 } };

function Phone() {
  const ref = useOpenPreviewRef();
  return (
    <div className="fixed inset-0 flex flex-col justify-end">
      <form><textarea data-agent-composer aria-label="Message" /></form>
      <PaneDrawer>{ref ? <PreviewPane key={`${ref.type}:${ref.id}`} recordRef={ref} /> : null}</PaneDrawer>
    </div>
  );
}

const start = window.location.href;

beforeEach(async () => {
  window.history.replaceState(null, '', '/dashboard/chat');
  await page.viewport(390, 844);
  artifactGet.mockReset();
  artifactGet.mockImplementation(async ({ id }: { id: number }) => (id === 51 ? chartArtifact : documentArtifact));
});

afterEach(() => {
  closePreview();
  window.history.replaceState(null, '', start);
});

describe('charts in the pane on a phone', () => {
  it('draws a chart artifact at the drawer\'s width, its forecast named', async () => {
    await render(<Phone />);
    openPreview({ type: 'artifact', id: '51' }, null);

    await expect.element(page.getByTestId('preview-drawer')).toBeVisible();
    await expect.element(page.getByRole('img', { name: SPEC.title })).toBeVisible();
    await expect.element(page.getByTestId('chart-legend')).toHaveTextContent(/Forecast from Nov/);

    const svg = document.querySelector('[data-testid="chart"] svg')!;

    expect(svg.getBoundingClientRect().width).toBeLessThanOrEqual(390);
  });

  it('shows a document with its chart block drawn, inside the drawer, never wider than the screen', async () => {
    await render(<Phone />);
    openPreview({ type: 'artifact', id: '52' }, null);

    await expect.element(page.getByTestId('preview-drawer')).toBeVisible();
    await expect.poll(() => document.querySelector('[data-testid="preview-drawer"] iframe')).not.toBeNull();

    const frame = document.querySelector<HTMLIFrameElement>('[data-testid="preview-drawer"] iframe')!;
    const srcdoc = frame.getAttribute('srcdoc') ?? '';

    expect(srcdoc).toContain('data-vocion-chart="1"');
    expect(srcdoc).toContain('<svg');
    expect(frame.getBoundingClientRect().right).toBeLessThanOrEqual(391);
  });
});
