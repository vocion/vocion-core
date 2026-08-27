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
    entranceSource: 'PAID_SOCIAL',
    utmCampaign: 'LinkedIn',
    engagementSent: 2,
    engagementOpened: 1,
    status: 'ready_for_review',
    confidence: 0.82,
    claims: [],
    missing: [],
    draftSequence: [],
    arrivedAt: '2026-08-24T09:00:00.000Z',
    briefedAt: '2026-08-25T10:00:00.000Z',
    ...over,
  };
}

const BRIEFS: BriefRow[] = [
  brief({ id: 1, contactName: 'Jamie Smith', companyName: 'Redpoint IT', confidence: 0.88, claims: [{ text: 'Runs a 14-person MSP.', kind: 'company', source: 'redpointit.com', date: '2026-08-24' }], draftSequence: [{ step: 1, subject: 'Ticket volume at Redpoint', body: 'Skipping the pitch.' }] }),
  brief({ id: 2, contactName: 'Rosa Lindqvist', companyName: 'Meridian Group', confidence: 0.64, missing: ['No engagement beyond the form fill.'] }),
  brief({ id: 3, contactName: 'Marta Kovac', companyName: 'Orlin Health', status: 'sent', confidence: 0.84 }),
];

/**
 * The phase-1 shape: picked up, nothing researched. Every one of these is
 * unscored, which is exactly the case the old confidence sort could not
 * order.
 */
const QUEUED: BriefRow[] = [
  brief({ id: 10, contactName: 'Anya Petrov', status: 'queued', confidence: null, arrivedAt: '2026-08-20T09:00:00.000Z' }),
  brief({ id: 11, contactName: 'Bo Ferreira', status: 'queued', confidence: null, arrivedAt: '2026-08-23T09:00:00.000Z' }),
  brief({ id: 12, contactName: 'Cai Okonkwo', status: 'queued', confidence: null, arrivedAt: '2026-08-22T09:00:00.000Z' }),
];

describe('PersonalizationQueue', () => {
  it('opens on the queued lane and counts each lane', async () => {
    await render(<PersonalizationQueue briefs={[...QUEUED, ...BRIEFS]} />);

    await expect.element(page.getByRole('button', { name: /^Queued\s*3$/ })).toBeVisible();
    await expect.element(page.getByRole('button', { name: /^Ready for review\s*2$/ })).toBeVisible();
    await expect.element(page.getByRole('button', { name: /^Sent\s*1$/ })).toBeVisible();
    await expect.element(page.getByRole('button', { name: /^All\s*6$/ })).toBeVisible();
    // Only the queued lane is in view.
    await expect.element(page.getByText('Anya Petrov')).toBeVisible();
    expect(page.getByText('Jamie Smith').elements()).toHaveLength(0);
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

    await userEvent.click(page.getByRole('button', { name: /^All\s*3$/ }));

    await expect.element(
      page.getByText('COO · Redpoint IT · arrived Aug 24 · Paid social · via LinkedIn · 2 sent · 1 opened'),
    ).toBeVisible();
  });

  it('leaves engagement out of the row when the CRM carries none', async () => {
    await render(<PersonalizationQueue briefs={[brief({ id: 20, contactName: 'Dee Nakamura', status: 'queued', confidence: null, entranceSource: null, utmCampaign: null, engagementSent: 0, engagementOpened: 0 })]} />);

    // A zero is not a reading — better absent than shown as "0 sent".
    await expect.element(page.getByText('COO · Civic Grid · arrived Aug 24')).toBeVisible();
  });

  it('orders unscored rows by arrival, which the confidence sort cannot', async () => {
    await render(<PersonalizationQueue briefs={QUEUED} />);

    // Default sort is arrival, descending: newest arrival first.
    const names = page.getByText(/Petrov|Ferreira|Okonkwo/).elements().map(e => e.textContent);

    expect(names).toStrictEqual(['Bo Ferreira', 'Cai Okonkwo', 'Anya Petrov']);
  });

  it('expands a row to the brief, its sequence, and what research missed', async () => {
    await render(<PersonalizationQueue briefs={BRIEFS} />);

    await userEvent.click(page.getByRole('button', { name: /^All\s*3$/ }));
    await userEvent.click(page.getByRole('button', { name: 'Show brief for Jamie Smith' }));

    await expect.element(page.getByText('Runs a 14-person MSP.')).toBeVisible();
    await expect.element(page.getByText('Ticket volume at Redpoint')).toBeVisible();

    await userEvent.click(page.getByRole('button', { name: 'Show brief for Rosa Lindqvist' }));

    // A brief with gaps must show them rather than read as complete.
    await expect.element(page.getByText('Could not find')).toBeVisible();
    await expect.element(page.getByText('No engagement beyond the form fill.')).toBeVisible();
    await expect.element(page.getByText('No sequence drafted yet.')).toBeVisible();
  });

  it('says a phase-1 row has no claims rather than leaving the panel blank', async () => {
    await render(<PersonalizationQueue briefs={QUEUED} />);

    await userEvent.click(page.getByRole('button', { name: 'Show brief for Anya Petrov' }));

    await expect.element(page.getByText('No claims recorded.')).toBeVisible();
    await expect.element(page.getByText('No sequence drafted yet.')).toBeVisible();
  });

  it('offers lane actions only once leads are selected, and keeps them disabled until the review action ships', async () => {
    await render(<PersonalizationQueue briefs={BRIEFS} />);

    await userEvent.click(page.getByRole('button', { name: /^All\s*3$/ }));

    expect(page.getByRole('button', { name: /Hand off \d+ selected/ }).elements()).toHaveLength(0);

    await userEvent.click(page.getByRole('checkbox', { name: 'Select Jamie Smith' }));

    await expect.element(page.getByText('1 selected')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Hand off 1 selected' })).toBeDisabled();
  });
});
