/**
 * `ads.set_status`: refused before queuing on a connection that can only
 * read, records the state it left, and Undo puts that state back.
 */
import type { AdsEntity, AdsProvider } from '@/services/ads/provider';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ provider: null as AdsProvider | null }));
vi.mock('@/services/ads/provider', () => ({ adsProviderFor: async () => state.provider }));

const { adsSetStatusAction } = await import('./ads-set-status');

const ctx = { orgId: 'org_acme' };

function fakeProvider(writable: boolean): { provider: AdsProvider; current: { state: 'active' | 'paused' }; writes: string[] } {
  const current = { state: 'active' as 'active' | 'paused' };
  const writes: string[] = [];
  const entity = (): AdsEntity => ({ id: '120000000000000001', name: 'Northwind Spring Sale', level: 'campaign', status: current.state.toUpperCase(), state: current.state, parentId: null, objective: null, dailyBudget: null, totalBudget: null, currency: 'USD', url: null });
  const provider: AdsProvider = {
    kind: writable ? 'meta-ads' : 'linkedin-ads',
    sourceSlug: 'ads',
    vendor: writable ? 'Meta Ads' : 'LinkedIn Ads',
    accountId: 'act_1',
    accountUrl: null,
    levelNames: { campaign: 'campaign', ad_set: 'ad set' },
    list: async () => [entity()],
    performance: async () => [],
    read: async () => entity(),
    ...(writable
      ? {
          setState: async (_level, _id, next) => {
            writes.push(next);
            current.state = next;
            return entity();
          },
        }
      : {}),
  };
  return { provider, current, writes };
}

describe('ads.set_status', () => {
  const input = { level: 'campaign' as const, id: '120000000000000001', state: 'paused' as const, reason: 'spent $412 in 7 days with 0 conversions' };

  it('refuses before anything is queued on a read-only connection, saying why', async () => {
    state.provider = fakeProvider(false).provider;

    await expect(adsSetStatusAction.precheck!(ctx, input)).resolves.toMatch(/LinkedIn Ads connection can only read/);
  });

  it('lets a writable connection through, pauses, records where it was, and Undo resumes it', async () => {
    const fake = fakeProvider(true);
    state.provider = fake.provider;

    await expect(adsSetStatusAction.precheck!(ctx, input)).resolves.toBeUndefined();

    const result = await adsSetStatusAction.execute(ctx, input);

    expect(result).toMatchObject({ changed: true, from: 'active', to: 'paused', name: 'Northwind Spring Sale' });
    expect(fake.current.state).toBe('paused');

    const undone = await adsSetStatusAction.undo!(ctx, input, result);

    expect(undone).toMatchObject({ restored: true, to: 'active' });
    expect(fake.writes).toEqual(['paused', 'active']);
  });

  it('cannot undo into a state it does not set, and says so', async () => {
    state.provider = fakeProvider(true).provider;

    await expect(adsSetStatusAction.undo!(ctx, input, { from: 'archived', fromStatus: 'ARCHIVED' })).resolves.toMatchObject({ restored: false });
  });

  it('reads as the decision it is on the card', async () => {
    state.provider = fakeProvider(true).provider;
    const card = await adsSetStatusAction.reviewCard!(ctx, input);

    expect(card.title).toBe('Pause campaign Northwind Spring Sale');
    expect(card.verbs).toEqual({ approve: 'Pause', reject: 'Leave it' });
  });
});
