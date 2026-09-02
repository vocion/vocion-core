import type { BriefRow } from './PersonalizationQueue';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { PersonalizationQueue } from './PersonalizationQueue';

// The rows render through the locale-aware Link; the tests only need anchors
// with the right hrefs.
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

/**
 * The queue's job is to be trustworthy at a glance and to hand off: every row
 * carries a brief, the count matches the rows, and clicking a row opens the
 * lead's own page. Nothing expands and nothing decides here — the dossier and
 * the card live on `/gtm/lead/{id}` (covered in LeadDetail.test.tsx).
 */

function brief(over: Partial<BriefRow> & Pick<BriefRow, 'id' | 'contactName'>): BriefRow {
  return {
    contactRef: `contacts:${over.id}`,
    contactTitle: 'COO',
    companyName: 'Civic Grid',
    entranceSource: 'PAID_SOCIAL',
    utmCampaign: 'LinkedIn',
    engagementSent: 2,
    engagementOpened: 1,
    status: 'ready_for_review',
    confidence: 0.82,
    mqlAt: null,
    arrivedAt: '2026-08-24T09:00:00.000Z',
    briefedAt: '2026-08-25T10:00:00.000Z',
    ...over,
  };
}

const BRIEFS: BriefRow[] = [
  brief({ id: 1, contactName: 'Jamie Smith', companyName: 'Redpoint IT', confidence: 0.88 }),
  brief({ id: 2, contactName: 'Rosa Lindqvist', companyName: 'Meridian Group', confidence: 0.64 }),
  brief({ id: 3, contactName: 'Marta Kovac', companyName: 'Orlin Health', status: 'sent', confidence: 0.84 }),
];

/** A lead the sweep recorded but has not researched. Never on this screen. */
const UNBRIEFED: BriefRow[] = [
  brief({ id: 10, contactName: 'Anya Petrov', status: 'queued', confidence: null }),
  brief({ id: 11, contactName: 'Bo Ferreira', status: 'queued', confidence: null }),
];

describe('PersonalizationQueue', () => {
  it('opens on Review, and has no lane for unbriefed leads', async () => {
    await render(<PersonalizationQueue briefs={BRIEFS} />);

    await expect.element(page.getByRole('button', { name: /^Review\s*2$/ })).toBeVisible();
    await expect.element(page.getByRole('button', { name: /^Sent\s*1$/ })).toBeVisible();
    await expect.element(page.getByRole('button', { name: /^All\s*3$/ })).toBeVisible();
    expect(page.getByRole('button', { name: /^Queued/ }).elements()).toHaveLength(0);
    // Review is in view without touching anything.
    await expect.element(page.getByText('Jamie Smith')).toBeVisible();
    expect(page.getByText('Marta Kovac').elements()).toHaveLength(0);
  });

  it('keeps an unbriefed lead off the screen, including out of All and the search', async () => {
    await render(<PersonalizationQueue briefs={[...UNBRIEFED, ...BRIEFS]} />);

    await userEvent.click(page.getByRole('button', { name: /^All\s*3$/ }));

    expect(page.getByText('Anya Petrov').elements()).toHaveLength(0);
    expect(page.getByText('Bo Ferreira').elements()).toHaveLength(0);

    await userEvent.fill(page.getByPlaceholder('Find a lead or company'), 'petrov');

    await expect.element(page.getByText('No lead matches that search.')).toBeVisible();
  });

  it('switches lanes', async () => {
    await render(<PersonalizationQueue briefs={BRIEFS} />);

    await userEvent.click(page.getByRole('button', { name: /^Sent\s*1$/ }));

    await expect.element(page.getByText('Marta Kovac')).toBeVisible();
    expect(page.getByText('Jamie Smith').elements()).toHaveLength(0);
  });

  it('filters by lead or company', async () => {
    await render(<PersonalizationQueue briefs={BRIEFS} />);

    await userEvent.click(page.getByRole('button', { name: /^All\s*3$/ }));
    await userEvent.fill(page.getByPlaceholder('Find a lead or company'), 'meridian');

    await expect.element(page.getByText('Rosa Lindqvist')).toBeVisible();
    expect(page.getByText('Jamie Smith').elements()).toHaveLength(0);
  });

  it('shows when and how the lead arrived, and its engagement', async () => {
    await render(<PersonalizationQueue briefs={BRIEFS} />);

    await expect.element(
      page.getByText('COO · Redpoint IT · arrived Aug 24 · Paid social · via LinkedIn · 2 sent · 1 opened'),
    ).toBeVisible();
  });

  it('leaves engagement out of the row when the CRM carries none', async () => {
    await render(<PersonalizationQueue briefs={[brief({ id: 21, contactName: 'Dee Nakamura', entranceSource: null, utmCampaign: null, engagementSent: 0, engagementOpened: 0 })]} />);

    // A zero is not a reading — better absent than shown as "0 sent".
    await expect.element(page.getByText('COO · Civic Grid · arrived Aug 24')).toBeVisible();
  });

  it('links each row to the lead page, addressed by the HubSpot id', async () => {
    await render(<PersonalizationQueue briefs={BRIEFS} />);

    const row = page.getByRole('link', { name: /Jamie Smith/ });

    await expect.element(row).toBeVisible();
    await expect.element(row).toHaveAttribute('href', '/gtm/lead/1');
  });

  it('keeps the queue a pure list: nothing expands, nothing selects, nothing decides', async () => {
    await render(<PersonalizationQueue briefs={BRIEFS} />);

    expect(page.getByRole('checkbox').elements()).toHaveLength(0);
    expect(page.getByRole('button', { name: /Show brief/ }).elements()).toHaveLength(0);
    expect(page.getByRole('button', { name: 'Enroll' }).elements()).toHaveLength(0);
    expect(page.getByRole('button', { name: 'Regenerate' }).elements()).toHaveLength(0);
  });
});
