import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureSeoBaseline, seoMeasurement } from './measurement';

const mocks = vi.hoisted(() => ({ getProject: vi.fn(), readSeoRoadmap: vi.fn(), updateSeoRoadmap: vi.fn(), searchConsoleAccess: vi.fn(), querySearchConsole: vi.fn() }));
vi.mock('@/services/DataRoomService', () => ({ getProject: mocks.getProject }));
vi.mock('./roadmap', () => ({ readSeoRoadmap: mocks.readSeoRoadmap, updateSeoRoadmap: mocks.updateSeoRoadmap }));
vi.mock('./searchConsole', () => ({ searchConsoleAccess: mocks.searchConsoleAccess }));
vi.mock('@/libs/searchConsole/client', async original => ({ ...await original<typeof import('@/libs/searchConsole/client')>(), querySearchConsole: mocks.querySearchConsole }));
const now = new Date('2026-10-30T12:00:00Z');
const roadmap = { revision: 2, initiatives: [], outcomes: [] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProject.mockResolvedValue({ meta: { searchConsoleProperty: { siteUrl: 'sc-domain:northwind.example' } } });
  mocks.readSeoRoadmap.mockResolvedValue({ canEdit: true, strategy: { id: 8 }, roadmap });
  mocks.searchConsoleAccess.mockResolvedValue({ ok: true, accessToken: 'fake-test-token' });
  mocks.querySearchConsole.mockResolvedValue({ rows: [{ clicks: 0, impressions: 120 }] });
});

describe('baseline capture', () => {
  it('records actual zero and aggregate counts with the selected client property and 28-day provenance', async () => {
    await captureSeoBaseline('org-a', 9, 'owner', 2, now);

    expect(mocks.searchConsoleAccess).toHaveBeenCalledWith('org-a', 9);
    expect(mocks.querySearchConsole).toHaveBeenCalledWith('fake-test-token', expect.objectContaining({ siteUrl: 'sc-domain:northwind.example', dimensions: [], startDate: '2026-10-01', endDate: '2026-10-28' }));
    expect(mocks.updateSeoRoadmap).toHaveBeenCalledWith('org-a', 9, 'owner', 2, expect.objectContaining({ outcomes: expect.arrayContaining([expect.objectContaining({ id: 'gsc_clicks', baseline: 0, current: 0, baselineWindowStart: '2026-10-01' })]) }));
  });

  it('does not turn no rows into zero or write a failed observation', async () => {
    mocks.querySearchConsole.mockResolvedValue({ rows: [] });

    await expect(captureSeoBaseline('org-a', 9, 'owner', 2, now)).rejects.toThrow('No zero baseline');
    expect(mocks.updateSeoRoadmap).not.toHaveBeenCalled();
  });

  it.each(['missing-project', 'not-owner', 'stale-revision', 'no-property'])('refuses %s before any external data access', async (reason) => {
    if (reason === 'missing-project') {
      mocks.getProject.mockResolvedValue(null);
    }
    if (reason === 'not-owner') {
      mocks.readSeoRoadmap.mockResolvedValue({ canEdit: false, roadmap });
    }
    if (reason === 'stale-revision') {
      mocks.readSeoRoadmap.mockResolvedValue({ canEdit: true, strategy: {}, roadmap: { ...roadmap, revision: 3 } });
    }
    if (reason === 'no-property') {
      mocks.getProject.mockResolvedValue({ meta: {} });
    }

    await expect(captureSeoBaseline('org-a', 9, 'owner', 2, now)).rejects.toThrow();
    expect(mocks.searchConsoleAccess).not.toHaveBeenCalled();
    expect(mocks.querySearchConsole).not.toHaveBeenCalled();
  });

  it('preserves a baseline and its original period on refresh, while recording a new observation', async () => {
    mocks.readSeoRoadmap.mockResolvedValue({ canEdit: true, strategy: {}, roadmap: { ...roadmap, outcomes: [{ id: 'gsc_clicks', label: 'Clicks', unit: 'clicks', baseline: 25, baselineWindowStart: '2026-09-01', baselineWindowEnd: '2026-09-28', baselineObservedAt: '2026-09-30T12:00:00Z', source: 'Google Search Console · sc-domain:northwind.example · web search' }] } });
    await captureSeoBaseline('org-a', 9, 'owner', 2, now);

    expect(mocks.updateSeoRoadmap.mock.calls[0]![4].outcomes[0]).toMatchObject({ baseline: 25, current: 0, baselineWindowStart: '2026-09-01', windowStart: '2026-10-01' });
  });

  it('refuses a changed property instead of comparing unrelated properties', async () => {
    mocks.readSeoRoadmap.mockResolvedValue({ canEdit: true, strategy: {}, roadmap: { ...roadmap, outcomes: [{ id: 'gsc_clicks', baseline: 25, source: 'other-property' }] } });

    await expect(captureSeoBaseline('org-a', 9, 'owner', 2, now)).rejects.toThrow('different source');
    expect(mocks.searchConsoleAccess).not.toHaveBeenCalled();
  });
});

it('never treats an unsourced number as a measured outcome or invents missing targets', () => {
  const result = seoMeasurement([{ id: 'leads', label: 'Organic leads', unit: 'leads', current: 5 }]);

  expect(result.outcomes[0]).toMatchObject({ current: null, target: null, baseline: null, state: 'unmeasured' });
  expect(result.measuredCount).toBe(0);
});

it('does not assign a baseline period retroactively to a legacy value', async () => {
  mocks.readSeoRoadmap.mockResolvedValue({ canEdit: true, strategy: {}, roadmap: { ...roadmap, outcomes: [{ id: 'gsc_clicks', label: 'Clicks', unit: 'clicks', baseline: 25, source: 'Google Search Console · sc-domain:northwind.example · web search' }] } });
  await captureSeoBaseline('org-a', 9, 'owner', 2, now);
  const saved = mocks.updateSeoRoadmap.mock.calls[0]![4].outcomes[0];

  expect(saved.baseline).toBe(25);
  expect(saved.baselineWindowStart).toBeUndefined();
  expect(seoMeasurement([saved]).outcomes[0]?.baseline).toBeNull();
});

it('refuses a property changed while the remote read was in flight', async () => {
  mocks.getProject.mockResolvedValueOnce({ meta: { searchConsoleProperty: { siteUrl: 'sc-domain:northwind.example' } } }).mockResolvedValueOnce({ meta: { searchConsoleProperty: { siteUrl: 'sc-domain:other.example' } } });

  await expect(captureSeoBaseline('org-a', 9, 'owner', 2, now)).rejects.toMatchObject({ status: 409 });
  expect(mocks.updateSeoRoadmap).not.toHaveBeenCalled();
});

it('sanitizes upstream exceptions without storing a partial measurement', async () => {
  mocks.querySearchConsole.mockRejectedValue(new Error('private provider internals'));

  await expect(captureSeoBaseline('org-a', 9, 'owner', 2, now)).rejects.toThrow('Search Console could not be read');
  expect(mocks.updateSeoRoadmap).not.toHaveBeenCalled();
});
