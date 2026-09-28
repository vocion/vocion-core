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

const REVIEW_ALL = { lane: 'ready_for_review', q: '', chips: [], rung: '', magnet: '', before: '' };
const ALL = { ...REVIEW_ALL, lane: 'all' };
const NOW = Date.parse('2026-09-24T12:00:00.000Z');

describe('BulkActionsView', () => {
  it('opens with every lead the view shows selected, and posts the ticked ids with the note', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ jobId: 77, total: 2 }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await render(<BulkActionsView rows={[row({ id: 1, contactName: 'Ada' }), row({ id: 2, contactName: 'Bo' })]} initial={REVIEW_ALL} now={NOW} />);

    await expect.element(page.getByTestId('bulk-rows')).toHaveTextContent('Ada');
    await expect.element(page.getByTestId('bulk-count')).toHaveTextContent('2 of 2 selected');
    await expect.element(page.getByTestId('bulk-submit')).toHaveTextContent('Regenerate 2 briefs');
    await expect.element(page.getByTestId('bulk-submit')).toBeDisabled();

    await page.getByTestId('bulk-note').fill('Use a Personalized Nurture rung.');
    await page.getByTestId('bulk-submit').click();

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/gtm/personalization/bulk/77'));
    const [url, init] = fetchSpy.mock.calls[0]!;

    expect(url).toBe('/api/v1/personalization/bulk');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ kind: 'regenerate_brief', leadIds: [1, 2], note: 'Use a Personalized Nurture rung.' });

    fetchSpy.mockRestore();
  });

  it('takes more than a hundred leads in one job', async () => {
    const rows = Array.from({ length: 103 }, (_, i) => row({ id: i + 1, contactName: `Lead ${i + 1}` }));
    await render(<BulkActionsView rows={rows} initial={REVIEW_ALL} now={NOW} />);
    await page.getByTestId('bulk-note').fill('Redraft.');

    await expect.element(page.getByTestId('bulk-submit')).toHaveTextContent('Regenerate 103 briefs');
    await expect.element(page.getByTestId('bulk-submit')).toBeEnabled();
  });

  it('ticks and unticks one lead, all, and none', async () => {
    await render(<BulkActionsView rows={[row({ id: 1, contactName: 'Ada' }), row({ id: 2, contactName: 'Bo' })]} initial={REVIEW_ALL} now={NOW} />);

    await page.getByTestId('bulk-row-2').click();

    await expect.element(page.getByTestId('bulk-count')).toHaveTextContent('1 of 2 selected');
    await expect.element(page.getByTestId('bulk-submit')).toHaveTextContent('Regenerate 1 brief');

    await page.getByTestId('bulk-select-none').click();

    await expect.element(page.getByTestId('bulk-count')).toHaveTextContent('0 of 2 selected');

    await page.getByTestId('bulk-select-all').click();

    await expect.element(page.getByTestId('bulk-count')).toHaveTextContent('2 of 2 selected');
  });

  it('selects exactly what a filter shows when the filter changes', async () => {
    const rows = [
      row({ id: 1, contactName: 'Ada', utmContent: 'Marketing Industry eBook', recommendedSequence: 'Personalized Nurture · 4 Assertive v2' }),
      row({ id: 2, contactName: 'Bo', utmContent: 'Construction Industry eBook', recommendedSequence: 'Personalized Nurture · 1 Ambient v2' }),
      row({ id: 3, contactName: 'Cy', utmContent: null, recommendedSequence: null }),
    ];
    await render(<BulkActionsView rows={rows} initial={REVIEW_ALL} now={NOW} />);
    await page.getByTestId('bulk-row-1').click();
    await page.getByTestId('bulk-filter-magnet').selectOptions('Marketing Industry eBook');

    // The filter re-selects what it shows, even the lead just unticked.
    await expect.element(page.getByTestId('bulk-count')).toHaveTextContent('1 of 1 selected');
    await expect.element(page.getByTestId('bulk-tr-2')).not.toBeInTheDocument();

    await page.getByTestId('bulk-filter-clear').click();
    await page.getByTestId('bulk-filter-rung').selectOptions('Personalized Nurture · 1 Ambient v2');

    await expect.element(page.getByTestId('bulk-tr-2')).toBeInTheDocument();
    await expect.element(page.getByTestId('bulk-count')).toHaveTextContent('1 of 1 selected');

    await page.getByTestId('bulk-filter-q').fill('cy');

    await expect.element(page.getByTestId('bulk-rows')).toHaveTextContent('No leads match these filters.');
  });

  it('shows a lead outside Review greyed and never selects it', async () => {
    await render(<BulkActionsView rows={[row({ id: 1, contactName: 'Ada' }), row({ id: 3, contactName: 'Cy', status: 'handed_off' })]} initial={ALL} now={NOW} />);

    await expect.element(page.getByTestId('bulk-blocked')).toHaveTextContent('1 lead is not waiting in Review and cannot be selected');
    await expect.element(page.getByTestId('bulk-row-3')).toBeDisabled();
    await expect.element(page.getByTestId('bulk-count')).toHaveTextContent('1 of 1 selected');
  });

  it('narrows to leads with an error, and shows why each failed', async () => {
    await render(<BulkActionsView rows={[row({ id: 1, contactName: 'Ada', lastError: 'The last regenerate did not validate' }), row({ id: 2, contactName: 'Bo' })]} initial={REVIEW_ALL} now={NOW} />);
    await page.getByTestId('bulk-filter-window-errored').click();

    await expect.element(page.getByTestId('bulk-count')).toHaveTextContent('1 of 1 selected');
    await expect.element(page.getByTestId('bulk-tr-2')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('bulk-tr-1')).toHaveTextContent('The last regenerate did not validate');
  });
});
