import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { SeoPublicationPanel } from './SeoPublicationPanel';
import { SeoReadinessPanel } from './SeoReadinessPanel';
import '@/styles/global.css';

vi.mock('@/libs/I18nNavigation', () => ({ useRouter: () => ({ refresh: () => {} }), Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

afterEach(() => vi.restoreAllMocks());

const url = 'https://northwind.example/page';
const props = { pageId: 20, publishedUrl: url, providerPublished: true, canVerify: true };

it('does not equate provider publication with public verification, and hides owner action from other users', async () => {
  await render(<SeoPublicationPanel {...props} canVerify={false} />);

  await expect.element(page.getByText('Recorded as published', { exact: true })).toBeVisible();
  await expect.element(page.getByText('No current verification')).toBeVisible();
  await expect.element(page.getByRole('button', { name: 'Verify public page' })).not.toBeInTheDocument();
});

it('posts only to the page endpoint and renders an unverified result without pretending success', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'unverified', url, checkedAt: '2026-01-01', evidence: 'Access could not be established.' }), { status: 200 }));
  await render(<SeoPublicationPanel {...props} />);
  await page.getByRole('button', { name: 'Verify public page' }).click();

  await expect.element(page.getByText('Public availability unverified')).toBeVisible();
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/seo/pages/20/verify-publication', { method: 'POST' });
  await expect.element(page.getByText('Access could not be established.')).toBeVisible();
});

it('shows race failures and does not present an old URL check as current verification', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { message: 'The page changed. Reload and retry.' } }), { status: 409 }));
  await render(<SeoPublicationPanel {...props} initial={{ status: 'verified', url: 'https://northwind.example/old', checkedAt: '2026-01-01', evidence: 'Matched old page.' }} />);

  await expect.element(page.getByText('No current verification')).toBeVisible();

  await page.getByRole('button', { name: 'Verify public page' }).click();

  await expect.element(page.getByRole('alert')).toHaveTextContent('The page changed');
});

it('shows the provider count and public-check count as separate readiness measures', async () => {
  await render(<SeoReadinessPanel readiness={{ checks: [], cadence: null, measurement: { outcomes: [], totalCount: 0, measuredCount: 0, reportingNote: '' }, publication: { recordedPublished: 5, verified: 2, failed: 1, unverified: 1, notChecked: 1 } }} />);
  const section = page.getByRole('region', { name: 'Published delivery evidence' });

  await expect.element(section).toHaveTextContent('Provider-recorded published');
  await expect.element(section).toHaveTextContent('Public HTML verified');
  await expect.element(section).toHaveTextContent('1 failed checks');
  await expect.element(section).toHaveTextContent('1 without a current check');
});

it('shows a dated matching public check as verified without claiming search impact', async () => {
  await render(<SeoPublicationPanel {...props} publishedAt="2025-12-01" initial={{ status: 'verified', url, checkedAt: '2026-01-01', evidence: 'Matched expected public HTML.' }} />);

  await expect.element(page.getByText('Public HTML verified', { exact: true })).toBeVisible();
  await expect.element(page.getByText('Checked: 2026-01-01')).toBeVisible();
  await expect.element(page.getByRole('region', { name: 'Publication evidence' })).toHaveTextContent('does not publish, prove indexing');
});
