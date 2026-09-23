import type { BriefRow } from './PersonalizationQueue';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { BulkActionsView } from './BulkActionsView';

const push = vi.fn();
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
  useRouter: () => ({ push, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/gtm/personalization/bulk',
}));

function row(over: Partial<BriefRow> & Pick<BriefRow, 'id' | 'contactName'>): BriefRow {
  return {
    contactRef: `contacts:${over.id}`,
    contactTitle: null,
    companyName: 'Civic Grid',
    entranceSource: null,
    utmCampaign: null,
    engagementSent: 0,
    engagementOpened: 0,
    status: 'ready_for_review',
    confidence: 0.8,
    mqlAt: null,
    arrivedAt: null,
    briefedAt: '2026-08-25T10:00:00.000Z',
    ...over,
  };
}

describe('BulkActionsView', () => {
  it('lists the leads, needs an instruction, and posts every id with the note', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ jobId: 77, total: 2 }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await render(<BulkActionsView rows={[row({ id: 1, contactName: 'Ada' }), row({ id: 2, contactName: 'Bo' })]} viewLabel="Review · briefed earlier" max={100} />);

    await expect.element(page.getByTestId('bulk-rows')).toHaveTextContent('Ada');
    await expect.element(page.getByTestId('bulk-submit')).toHaveTextContent('Regenerate 2 briefs');
    await expect.element(page.getByTestId('bulk-submit')).toBeDisabled();

    await page.getByTestId('bulk-note').fill('Use a Personalized Nurture rung.');

    await expect.element(page.getByTestId('bulk-submit')).toBeEnabled();

    await page.getByTestId('bulk-submit').click();

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/gtm/personalization/bulk/77'));
    const [url, init] = fetchSpy.mock.calls[0]!;

    expect(url).toBe('/api/v1/personalization/bulk');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ kind: 'regenerate_brief', leadIds: [1, 2], note: 'Use a Personalized Nurture rung.' });

    fetchSpy.mockRestore();
  });

  it('offers nothing when a lead in the view is not waiting in Review, and says why', async () => {
    await render(<BulkActionsView rows={[row({ id: 1, contactName: 'Ada' }), row({ id: 3, contactName: 'Cy', status: 'handed_off' })]} viewLabel="All" max={100} />);

    await expect.element(page.getByTestId('bulk-blocked')).toHaveTextContent('1 of these leads is not waiting in Review');

    await page.getByTestId('bulk-note').fill('x');

    await expect.element(page.getByTestId('bulk-submit')).toBeDisabled();
  });
});
