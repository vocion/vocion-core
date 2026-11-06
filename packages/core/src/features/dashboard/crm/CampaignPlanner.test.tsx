import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import en from '@/locales/en.json';
import { CampaignPlanner } from './CampaignPlanner';

const fetchMock = vi.fn();
const plan = {
  list: { id: 'list-1', version: 12, fields: [{ key: 'name', label: 'Plan name', type: 'text' }, { key: 'body', label: 'Draft body', type: 'text' }] },
  canReview: true,
  nextOffset: null,
  rows: [{ id: 'row-1', version: 4, values: { name: 'Weekly draft', body: 'Copy to review' }, review: null, state: 'draft' }],
};
const response = (data: unknown, ok = true) => ({ ok, json: async () => data });

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(response(plan));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

const show = () => render(<NextIntlClientProvider locale="en" messages={en}><CampaignPlanner workspaceId="workspace-1" /></NextIntlClientProvider>);

it('shows copy before exposing review actions and submits the displayed revision', async () => {
  const screen = await show();

  await expect.element(screen.getByRole('heading', { name: 'Weekly draft' })).toBeVisible();

  await screen.getByText('Review complete draft · revision 4').click();

  await expect.element(screen.getByText('Copy to review')).toBeVisible();

  await screen.getByRole('textbox', { name: 'Review notes' }).fill('Ready for dry run');
  await screen.getByRole('button', { name: 'Approve dry-run slot' }).click();

  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('workspace=workspace-1'), expect.objectContaining({ method: 'POST' })));
  const post = fetchMock.mock.calls.find(call => call[1]?.method === 'POST')!;

  expect(JSON.parse(post[1].body)).toEqual({ action: 'review', id: 'list-1', expectedVersion: 12, recordId: 'row-1', recordVersion: 4, decision: 'approve', notes: 'Ready for dry run' });
});

it('preserves unsaved copy when a concurrent edit rejects the save', async () => {
  const screen = await show();
  await screen.getByRole('button', { name: 'Edit draft' }).click();
  await screen.getByRole('textbox', { name: 'Draft body' }).fill('My unsaved copy');
  fetchMock.mockResolvedValueOnce(response({ error: { message: 'The plan changed. Reload and review the latest copy.' } }, false));
  await screen.getByRole('button', { name: 'Save draft' }).click();

  await expect.element(screen.getByRole('alert')).toHaveTextContent('The plan changed');
  await expect.element(screen.getByRole('textbox', { name: 'Draft body' })).toHaveValue('My unsaved copy');
});
