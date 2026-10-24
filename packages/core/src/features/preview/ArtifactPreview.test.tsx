import type { RecordRef } from '@/services/chat/pageContext';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render as renderBase } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import '@/styles/global.css';

/**
 * AN ARTIFACT IS AN ENTRY IN THE ONE PANE (Chris, 2026-10-23: "one sidebar and
 * panes UX for all use cases"). It opens as itself, stacks over a record with
 * a way back, and its chip opens it again after the X. Fixtures are fictional.
 */

const previewGet = vi.fn();
const artifactGet = vi.fn();
vi.mock('@/libs/Orpc', () => ({
  client: {
    preview: { get: (...a: unknown[]) => previewGet(...a) },
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
const { ArtifactChips } = await import('@/features/dashboard/chat/ArtifactChips');
const { closePreview, openPreview, useOpenPreviewRef } = await import('./previewState');
const en = (await import('@/locales/en.json')).default;

const render = (ui: React.ReactElement) => renderBase(ui, {
  wrapper: ({ children }) => <NextIntlClientProvider locale="en" messages={en}>{children}</NextIntlClientProvider>,
});

const chart = {
  id: 41,
  kind: 'markdown',
  title: 'Cumulative revenue',
  version: 3,
  authorKind: 'agent',
  authorId: 'agent:analyst',
  updatedAt: new Date().toISOString(),
  folder: null,
  conversationId: 7,
  messageId: null,
  spec: { markdown: '## Three scenarios\n\nFloor, run-rate and pipeline.' },
};
const record = { ref: { type: 'object', id: '16' }, title: 'Larkfield renewal', sourceLabel: 'Deal', body: 'Renewal due in November.' };

function Host() {
  const ref = useOpenPreviewRef();
  return (
    <div className="fixed inset-0 flex">
      <div className="w-1/2">
        <ArtifactChips artifacts={[{ id: 41, title: 'Cumulative revenue', kind: 'markdown', version: 3 }]} />
      </div>
      <div className="flex w-1/2 flex-col">{ref ? <PreviewPane key={`${ref.type}:${ref.id}`} recordRef={ref} /> : <p data-testid="closed">closed</p>}</div>
    </div>
  );
}

const start = window.location.href;

beforeEach(() => {
  window.history.replaceState(null, '', '/dashboard/chat');
  previewGet.mockReset();
  previewGet.mockImplementation(async (ref: Pick<RecordRef, 'type' | 'id'>) => (ref.type === 'object' ? record : null));
  artifactGet.mockReset();
  artifactGet.mockImplementation(async () => chart);
});

afterEach(() => {
  closePreview();
  window.history.replaceState(null, '', start);
});

describe('an artifact in the pane', () => {
  it('opens as itself, the artifact\'s own pane, from its chip', async () => {
    await render(<Host />);
    await page.getByRole('button', { name: /Cumulative revenue/ }).click();

    await expect.element(page.getByLabelText(/^Artifact: /)).toBeInTheDocument();

    expect(artifactGet).toHaveBeenCalledWith({ id: 41 });
  });

  it('closes with its X, and the chip opens it again', async () => {
    await render(<Host />);
    await page.getByRole('button', { name: /Cumulative revenue/ }).click();

    await expect.element(page.getByLabelText(/^Artifact: /)).toBeInTheDocument();

    await page.getByRole('button', { name: 'Close the artifact' }).click();

    await expect.element(page.getByTestId('closed')).toBeInTheDocument();

    await page.getByRole('button', { name: /Cumulative revenue/ }).click();

    await expect.element(page.getByLabelText(/^Artifact: /)).toBeInTheDocument();
  });

  it('stands on top of a record, with the way back to it', async () => {
    await render(<Host />);
    openPreview({ type: 'object', id: '16' }, null);

    await expect.element(page.getByRole('heading', { name: 'Larkfield renewal' })).toBeInTheDocument();

    openPreview({ type: 'artifact', id: '41' }, null);

    await expect.element(page.getByLabelText(/^Artifact: /)).toBeInTheDocument();

    await page.getByTestId('preview-stack-back').click();

    await expect.element(page.getByRole('heading', { name: 'Larkfield renewal' })).toBeInTheDocument();
  });
});
