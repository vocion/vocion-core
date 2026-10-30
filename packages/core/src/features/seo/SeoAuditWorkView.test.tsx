import type { SeoAuditRecord } from '@/services/seo/audits';
import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { SeoAuditWorkView } from './SeoAuditWorkView';
import '@/styles/global.css';

vi.mock('@/libs/tools/site/inventory', () => ({ inventoryIssues: () => [] }));
vi.mock('@/libs/I18nNavigation', () => ({ Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const audit: SeoAuditRecord = {
  id: 17,
  title: 'Audit · Northwind',
  createdAt: new Date(),
  meta: {
    projectId: 9,
    projectName: 'Northwind',
    site: 'https://northwind.example',
    checkedAt: '2026-10-30T10:00:00Z',
    pagesRead: 10,
    listed: 30,
    findings: [
      { key: 'title:a', check: 'title', category: 'content', severity: 'high', title: 'Missing title', evidence: 'No title was returned.', url: 'https://northwind.example/a', checkedAt: '2026-10-30', status: 'open', fix: { kind: 'task', id: 32, href: '/dashboard/inbox/32', at: '2026-10-30' } },
      { key: 'title:b', check: 'title', category: 'content', severity: 'high', title: 'Missing title', evidence: 'The second page also has no title.', url: 'https://northwind.example/b', checkedAt: '2026-10-30', status: 'open' },
      { key: 'old', check: 'schema', category: 'technical', severity: 'low', title: 'Old issue', evidence: 'An earlier observation.', checkedAt: '2026-10-30', status: 'fixed' },
    ],
    counts: { total: 999, open: 999, high: 999, fixed: 0, dismissed: 0, byCategory: { technical: 0, content: 0, ai_visibility: 0, local: 0 }, bySeverity: { high: 999, medium: 0, low: 0 } },
    openCount: 999,
    highCount: 999,
    nextSteps: [],
    report: '# Duplicate report title',
    reportArtifactId: 27,
  },
};

it('defines counts from findings, separates task status, and differentiates repeated titles by scope', async () => {
  await render(<SeoAuditWorkView audit={audit} linkedWork={[{ kind: 'task', id: 32, title: 'Fix page A', status: 'done', href: '/dashboard/inbox/32' }]} />);
  const body = page.getByTestId('seo-audit-workspace');

  await expect.element(body).not.toHaveTextContent('999');
  await expect.element(body).toHaveTextContent('Creating a task or page does not resolve the finding');
  await expect.element(body).toHaveTextContent('Recorded task status: done');

  const next = page.getByRole('region', { name: 'Recommended next steps' });

  await expect.element(next).toHaveTextContent('northwind.example/a');
  await expect.element(next).toHaveTextContent('northwind.example/b');
  await expect.element(page.getByRole('link', { name: 'Open task: Fix page A' })).toHaveAttribute('href', '/dashboard/inbox/32');
  await expect.element(page.getByRole('link', { name: 'Report snapshot' })).toHaveAttribute('href', '/dashboard/artifacts/27');
  await expect.element(body).not.toHaveTextContent('Duplicate report title');
  await expect.element(body).toHaveTextContent('30 pages were listed; 10 were read');
});

it('never invents status or a foreign-workspace link when linked work is unavailable', async () => {
  await render(<SeoAuditWorkView audit={audit} linkedWork={[]} />);

  await expect.element(page.getByTestId('seo-audit-workspace')).toHaveTextContent('Linked task is unavailable in this workspace');
  await expect.element(page.getByRole('link', { name: /^Open task/ })).not.toBeInTheDocument();

  const plan = page.getByRole('link', { name: 'Plan a fix' });

  await expect.element(plan).toHaveAttribute('href', expect.stringContaining('finding%20title%3Ab'));
});

it.each([
  { checkedAt: undefined, pagesRead: undefined, projectId: undefined },
  { checkedAt: 42, pagesRead: -1, projectId: -1 },
  { checkedAt: 'not a date', pagesRead: '10', projectId: '9' },
])('shows unknown legacy values without inventing counts or project links: %j', async (legacy) => {
  await render(<SeoAuditWorkView audit={{ ...audit, meta: { ...audit.meta, ...legacy } } as unknown as SeoAuditRecord} linkedWork={[]} />);
  const body = page.getByTestId('seo-audit-workspace');

  await expect.element(body).toHaveTextContent('Check date unknown');
  await expect.element(body).toHaveTextContent('Unknown');
  await expect.element(body).not.toHaveTextContent('were read');
  await expect.element(page.getByRole('link', { name: 'Client project' })).not.toBeInTheDocument();
});
