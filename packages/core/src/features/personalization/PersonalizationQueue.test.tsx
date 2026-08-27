import type { BriefRow } from './PersonalizationQueue';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { PersonalizationQueue } from './PersonalizationQueue';

/**
 * The queue's job is to be trustworthy at a glance: the right leads in the
 * right lane, the count matching the rows, and the brief behind a row
 * reachable without leaving the page. These cover the parts a reviewer would
 * notice being wrong.
 */

function brief(over: Partial<BriefRow> & Pick<BriefRow, 'id' | 'contactName'>): BriefRow {
  return {
    contactRef: `contacts:${over.id}`,
    contactTitle: 'COO',
    companyName: 'Civic Grid',
    triggerType: 'new',
    entranceSource: 'ebook',
    utmCampaign: 'ai-construction',
    engagementSent: 2,
    engagementOpened: 1,
    status: 'ready_for_review',
    confidence: 0.82,
    claims: [],
    missing: [],
    draftSequence: [],
    briefedAt: '2026-08-25T10:00:00.000Z',
    ...over,
  };
}

const BRIEFS: BriefRow[] = [
  brief({ id: 1, contactName: 'Jamie Smith', companyName: 'Redpoint IT', confidence: 0.88, claims: [{ text: 'Runs a 14-person MSP.', kind: 'company', source: 'redpointit.com', date: '2026-08-24' }], draftSequence: [{ step: 1, subject: 'Ticket volume at Redpoint', body: 'Skipping the pitch.' }] }),
  brief({ id: 2, contactName: 'Rosa Lindqvist', companyName: 'Meridian Group', confidence: 0.64, missing: ['No engagement beyond the form fill.'] }),
  brief({ id: 3, contactName: 'Marta Kovac', companyName: 'Orlin Health', status: 'sent', confidence: 0.84 }),
];

describe('PersonalizationQueue', () => {
  it('opens on the review lane and counts each lane', async () => {
    await render(<PersonalizationQueue briefs={BRIEFS} />);

    // Two ready, one sent, three total — and the sent lead is not in view.
    await expect.element(page.getByRole('button', { name: /^Ready for review\s*2$/ })).toBeVisible();
    await expect.element(page.getByRole('button', { name: /^Sent\s*1$/ })).toBeVisible();
    await expect.element(page.getByRole('button', { name: /^All\s*3$/ })).toBeVisible();
    await expect.element(page.getByText('Jamie Smith')).toBeVisible();
    expect(page.getByText('Marta Kovac').elements()).toHaveLength(0);
  });

  it('switches lanes', async () => {
    await render(<PersonalizationQueue briefs={BRIEFS} />);

    await userEvent.click(page.getByRole('button', { name: /^Sent\s*1$/ }));

    await expect.element(page.getByText('Marta Kovac')).toBeVisible();
    expect(page.getByText('Jamie Smith').elements()).toHaveLength(0);
  });

  it('filters by lead or company', async () => {
    await render(<PersonalizationQueue briefs={BRIEFS} />);

    await userEvent.fill(page.getByPlaceholder('Find a lead or company'), 'meridian');

    await expect.element(page.getByText('Rosa Lindqvist')).toBeVisible();
    expect(page.getByText('Jamie Smith').elements()).toHaveLength(0);
  });

  it('shows the entrance path and engagement on every row', async () => {
    await render(<PersonalizationQueue briefs={BRIEFS} />);

    await expect.element(
      page.getByText('COO · Redpoint IT · ebook · utm=ai-construction · 2 sent · 1 opened'),
    ).toBeVisible();
  });

  it('expands a row to the brief, its sequence, and what research missed', async () => {
    await render(<PersonalizationQueue briefs={BRIEFS} />);

    await userEvent.click(page.getByRole('button', { name: 'Show brief for Jamie Smith' }));

    await expect.element(page.getByText('Runs a 14-person MSP.')).toBeVisible();
    await expect.element(page.getByText('Ticket volume at Redpoint')).toBeVisible();

    await userEvent.click(page.getByRole('button', { name: 'Show brief for Rosa Lindqvist' }));

    // A brief with gaps must show them rather than read as complete.
    await expect.element(page.getByText('Could not find')).toBeVisible();
    await expect.element(page.getByText('No engagement beyond the form fill.')).toBeVisible();
    await expect.element(page.getByText('No sequence drafted yet.')).toBeVisible();
  });

  it('offers lane actions only once leads are selected, and keeps them disabled until the review action ships', async () => {
    await render(<PersonalizationQueue briefs={BRIEFS} />);

    expect(page.getByRole('button', { name: /Hand off \d+ selected/ }).elements()).toHaveLength(0);

    await userEvent.click(page.getByRole('checkbox', { name: 'Select Jamie Smith' }));

    await expect.element(page.getByText('1 selected')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Hand off 1 selected' })).toBeDisabled();
  });
});
