/**
 * The people family's tools: present only with an HR source in scope, reading
 * through the provider the source decides, and saying plainly when none is
 * connected.
 */
import type { RuntimeContext } from '../types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolve = vi.fn();
vi.mock('@/services/people/provider', () => ({ peopleProviderFor: (...a: unknown[]) => resolve(...a) }));

const { peopleTools } = await import('./peopleTools');

function ctx(connectorSources: string[], sourceKinds: Record<string, string> = {}): RuntimeContext {
  return { orgId: 'org_a', connectorSources, sourceKinds, harnessConfig: {} } as unknown as RuntimeContext;
}

const WORKER = { kind: 'worker', id: 'w1', name: 'Sam Okafor', status: 'active', title: 'Support Engineer', department: 'Customer Success', manager: null, workEmail: 'sam.okafor@larkfield.example', type: null, location: null, startDate: '2025-01-06', endDate: null, payDate: null, totals: null, amount: null, url: null };

beforeEach(() => {
  resolve.mockReset();
});

describe('people tools', () => {
  it('are absent without an HR source in scope, and present with one', () => {
    expect(peopleTools(ctx(['jira', 'stripe']))).toEqual([]);
    expect(peopleTools(ctx(['hr'], { hr: 'rippling' })).map(t => t.name)).toEqual(['people_list', 'people_get']);
  });

  it('list through the agent\'s own HR sources, with the vendor and the records', async () => {
    const list = vi.fn(async () => ({ records: [WORKER], nextCursor: null }));
    resolve.mockResolvedValue({ kind: 'rippling', vendor: 'Rippling', sourceSlug: 'hr', kinds: ['worker', 'department', 'time_off'], list });
    const [listTool] = peopleTools(ctx(['hr', 'stripe'], { hr: 'rippling' }));
    const out = JSON.parse(await listTool!.invoke({ kind: 'worker', query: 'Sam' }) as string);

    expect(out).toMatchObject({ ok: true, vendor: 'Rippling', source: 'hr', kind: 'worker', count: 1, records: [{ name: 'Sam Okafor' }], nextCursor: null });
    expect(resolve).toHaveBeenCalledWith('org_a', { sourceSlug: null, allowed: ['hr'] });
    expect(list).toHaveBeenCalledWith('worker', expect.objectContaining({ query: 'Sam', limit: 50 }));
  });

  it('refuse a kind the vendor does not hold, naming the ones it does', async () => {
    resolve.mockResolvedValue({ kind: 'rippling', vendor: 'Rippling', sourceSlug: 'hr', kinds: ['worker', 'department', 'time_off'] });
    const [listTool] = peopleTools(ctx(['hr'], { hr: 'rippling' }));
    const out = JSON.parse(await listTool!.invoke({ kind: 'pay_run' }) as string);

    expect(out).toEqual({ ok: false, error: 'Rippling holds no pay run records here. It holds: worker, department, time_off.' });
  });

  it('say plainly when nothing is connected', async () => {
    resolve.mockRejectedValue(new Error('No HR system is connected for this agent. Connect one (gusto, rippling, workday) with offer_connection, and give this agent the source.'));
    const [, getTool] = peopleTools(ctx(['hr'], { hr: 'gusto' }));
    const out = JSON.parse(await getTool!.invoke({ kind: 'worker', id: 'w1' }) as string);

    expect(out).toEqual({ ok: false, error: expect.stringMatching(/No HR system is connected/) });
  });
});
