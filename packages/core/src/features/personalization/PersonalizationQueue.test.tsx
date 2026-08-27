import type { BriefRow } from './PersonalizationQueue';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { PersonalizationQueue } from './PersonalizationQueue';

// The regenerate control refreshes the route after a successful write. There
// is no router outside the app shell, so the hook is stubbed.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

/**
 * The queue's job is to be trustworthy at a glance: every row carries a brief,
 * the count matches the rows, and the brief behind a row is readable without
 * leaving the page. These cover the parts a reviewer would notice being wrong.
 */

const SECTIONS = [
  { heading: 'Prospect', body: 'Jamie Smith, COO at Redpoint IT.' },
  { heading: 'Recommended Angle', body: 'Ask how tickets get triaged out of hours.' },
  { heading: 'Brief Confidence', body: 'Score: 0.88. Reason: the role and the company are both confirmed.' },
];

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
    sections: SECTIONS,
    claims: [],
    missing: [],
    briefError: null,
    briefAttempts: 1,
    regenerateNote: null,
    arrivedAt: '2026-08-24T09:00:00.000Z',
    briefedAt: '2026-08-25T10:00:00.000Z',
    ...over,
  };
}

const BRIEFS: BriefRow[] = [
  brief({
    id: 1,
    contactName: 'Jamie Smith',
    companyName: 'Redpoint IT',
    confidence: 0.88,
    claims: [{ text: 'Runs a 14-person MSP.', kind: 'Fact', source: 'https://redpointit.com/about', date: '2026-08-24' }],
  }),
  brief({ id: 2, contactName: 'Rosa Lindqvist', companyName: 'Meridian Group', confidence: 0.64, missing: ['No engagement beyond the form fill.'] }),
  brief({ id: 3, contactName: 'Marta Kovac', companyName: 'Orlin Health', status: 'sent', confidence: 0.84 }),
];

/** A lead the sweep recorded but has not researched. Never on this screen. */
const UNBRIEFED: BriefRow[] = [
  brief({ id: 10, contactName: 'Anya Petrov', status: 'queued', confidence: null, sections: [], briefAttempts: 1 }),
  brief({ id: 11, contactName: 'Bo Ferreira', status: 'queued', confidence: null, sections: [], briefAttempts: 2 }),
];

/** A lead that used all three tries. It surfaces carrying the error. */
const FAILED = brief({
  id: 20,
  contactName: 'Dee Nakamura',
  confidence: null,
  sections: [],
  briefAttempts: 3,
  briefError: 'web_search returned "search provider unconfigured" on every query.',
});

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

  it('expands a row to the written sections, the claims with kind and source, and the confidence', async () => {
    await render(<PersonalizationQueue briefs={BRIEFS} />);

    await userEvent.click(page.getByRole('button', { name: 'Show brief for Jamie Smith' }));

    await expect.element(page.getByText('Jamie Smith, COO at Redpoint IT.')).toBeVisible();
    await expect.element(page.getByText('Ask how tickets get triaged out of hours.')).toBeVisible();
    await expect.element(page.getByText('Score: 0.88. Reason: the role and the company are both confirmed.')).toBeVisible();
    await expect.element(page.getByText('Runs a 14-person MSP.')).toBeVisible();
    // The kind separates a fact from an inference, and the source opens.
    await expect.element(page.getByText(/Fact · https:\/\/redpointit\.com\/about · 2026-08-24/)).toBeVisible();
    await expect.element(page.getByRole('link', { name: 'https://redpointit.com/about' })).toBeVisible();
  });

  it('shows what research could not reach rather than reading as complete', async () => {
    await render(<PersonalizationQueue briefs={BRIEFS} />);

    await userEvent.click(page.getByRole('button', { name: 'Show brief for Rosa Lindqvist' }));

    await expect.element(page.getByText('Missing')).toBeVisible();
    await expect.element(page.getByText('No engagement beyond the form fill.')).toBeVisible();
  });

  it('renders the error where the brief would be once the tries run out', async () => {
    await render(<PersonalizationQueue briefs={[FAILED]} />);

    await userEvent.click(page.getByRole('button', { name: 'Show brief for Dee Nakamura' }));

    await expect.element(page.getByText('No brief. Briefing failed 3 times')).toBeVisible();
    await expect.element(page.getByText('web_search returned "search provider unconfigured" on every query.')).toBeVisible();
  });

  it('shows the instruction behind a rewrite above the brief it produced', async () => {
    await render(<PersonalizationQueue briefs={[brief({ id: 30, contactName: 'Ines Duarte', regenerateNote: 'The angle is generic. Find something specific to them.' })]} />);

    await userEvent.click(page.getByRole('button', { name: 'Show brief for Ines Duarte' }));

    await expect.element(page.getByText('Rewritten on your instruction')).toBeVisible();
    await expect.element(page.getByText('The angle is generic. Find something specific to them.')).toBeVisible();
  });

  it('will not regenerate without an instruction', async () => {
    await render(<PersonalizationQueue briefs={BRIEFS} />);

    await userEvent.click(page.getByRole('button', { name: 'Show brief for Jamie Smith' }));
    await userEvent.click(page.getByRole('button', { name: 'Regenerate' }));

    const box = page.getByRole('textbox', { name: 'Regenerate instruction for Jamie Smith' });

    await expect.element(box).toBeVisible();
    // A rewrite with no reason gives the next pass nothing the last one lacked.
    await expect.element(page.getByRole('button', { name: 'Regenerate' })).toBeDisabled();

    await userEvent.fill(box, 'Lead with the ticket-triage angle.');

    await expect.element(page.getByRole('button', { name: 'Regenerate' })).toBeEnabled();
  });

  it('offers lane actions only once leads are selected, and keeps them disabled until the review action ships', async () => {
    await render(<PersonalizationQueue briefs={BRIEFS} />);

    expect(page.getByRole('button', { name: /Hand off \d+ selected/ }).elements()).toHaveLength(0);

    await userEvent.click(page.getByRole('checkbox', { name: 'Select Jamie Smith' }));

    await expect.element(page.getByText('1 selected')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Hand off 1 selected' })).toBeDisabled();
  });
});
