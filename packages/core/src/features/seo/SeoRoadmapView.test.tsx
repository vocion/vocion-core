import type { SeoRoadmap } from '@/services/seo/roadmap';
import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { SeoRoadmapView } from './SeoRoadmapView';
import '@/styles/global.css';

vi.mock('@/libs/I18nNavigation', () => ({ Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>, useRouter: () => ({ refresh: () => {} }) }));

const roadmap: SeoRoadmap = {
  revision: 3,
  initiatives: [{ id: 'fix-indexing', label: 'Restore service page visibility', lane: 'now', status: 'blocked', dependsOn: [], blockedReason: 'Waiting for site access', acceptanceCriteria: 'Affected service URLs pass a fresh indexability check.', recordIds: [71], taskIds: [], evidence: [], ownerUserId: 'owner', due: '2026-11-10' }],
  outcomes: [{ id: 'leads', label: 'Qualified organic leads', unit: 'leads', target: 20 }],
};
const props = { projectId: 9, initial: roadmap, canEdit: true, records: [{ id: 71, title: 'Service page fixes', status: 'in_progress', href: '/dashboard/objects/71' }], owners: [{ id: 'owner', name: 'Jordan' }] };

afterEach(() => vi.restoreAllMocks());

it('shows the owner, blocker and linked work without converting a target into measured results', async () => {
  await render(<SeoRoadmapView {...props} />);

  await expect.element(page.getByTestId('seo-roadmap')).toHaveTextContent('Jordan');
  await expect.element(page.getByText('Waiting for site access')).toBeVisible();
  await expect.element(page.getByRole('link', { name: /Service page fixes/ })).toHaveAttribute('href', '/dashboard/objects/71');
  await expect.element(page.getByRole('region', { name: 'Client outcomes' })).toHaveTextContent('Not measured');
  await expect.element(page.getByRole('link', { name: 'Continue with strategist' })).toHaveAttribute('href', expect.stringContaining('fix-indexing'));
});

it('saves an initiative with the expected revision and preserves other plan data', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ roadmap: { ...roadmap, revision: 4 } }), { status: 200 }));
  await render(<SeoRoadmapView {...props} />);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('textbox', { name: 'Next action', exact: true }).fill('Confirm access with the client');
  await page.getByRole('button', { name: 'Save initiative' }).click();

  await expect.poll(() => fetchMock.mock.calls.length).toBe(1);

  const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));

  expect(body.expectedRevision).toBe(3);
  expect(body.roadmap.initiatives[0].nextAction).toBe('Confirm access with the client');
  expect(body.roadmap.outcomes).toEqual(roadmap.outcomes);
});

it('keeps edits visible when a concurrent update rejects the save', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { message: 'The roadmap changed. Reload before saving.' } }), { status: 409 }));
  await render(<SeoRoadmapView {...props} />);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('textbox', { name: 'Next action', exact: true }).fill('Keep this unsaved action');
  await page.getByRole('button', { name: 'Save initiative' }).click();

  await expect.element(page.getByRole('alert')).toHaveTextContent('The roadmap changed');
  await expect.element(page.getByRole('textbox', { name: 'Next action', exact: true })).toHaveValue('Keep this unsaved action');
});

it('shows a read-only plan without mutation controls to a non-owner', async () => {
  await render(<SeoRoadmapView {...props} canEdit={false} />);

  await expect.element(page.getByRole('button', { name: 'Add initiative' })).not.toBeInTheDocument();
  await expect.element(page.getByRole('button', { name: 'Update evidence' })).not.toBeInTheDocument();
  await expect.element(page.getByText(/approved strategy owner manages/)).toBeVisible();
});
