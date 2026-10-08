import type { RuntimeContext } from '../types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolve = vi.fn();
vi.mock('@/services/finance/provider', () => ({ financeProviderFor: (...a: unknown[]) => resolve(...a) }));

const { financeTools } = await import('./financeTools');

function ctx(connectorSources: string[], sourceKinds: Record<string, string>, allowedSourceSlugs?: string[]): RuntimeContext {
  return { orgId: 'org_a', connectorSources, sourceKinds, allowedSourceSlugs, harnessConfig: {} } as unknown as RuntimeContext;
}

const RECORD = { kind: 'invoice', id: 'in_Fixture01', number: 'NW-0042', title: 'Invoice NW-0042 · Contoso Supply', party: 'Contoso Supply', status: 'open', amount: 12500, currency: 'USD', balance: 10000, date: '2026-09-21', dueDate: '2026-10-21', updatedAt: null, url: 'https://dashboard.stripe.com/invoices/in_Fixture01' };

const list = vi.fn();
const get = vi.fn();

beforeEach(() => {
  resolve.mockReset();
  list.mockReset();
  get.mockReset();
  resolve.mockResolvedValue({ kind: 'stripe', vendor: 'Stripe', sourceSlug: 'billing', kinds: ['customer', 'invoice'], list, get });
});

describe('the finance tools', () => {
  it('are present only for an agent with a finance source, narrowed by the person\'s source ACL', () => {
    expect(financeTools(ctx(['jira'], { jira: 'jira' }))).toEqual([]);
    expect(financeTools(ctx(['billing'], { billing: 'stripe' })).map(t => t.name)).toEqual(['finance_list', 'finance_get']);
    expect(financeTools(ctx(['billing'], { billing: 'stripe' }, ['jira']))).toEqual([]);
  });

  it('list through the agent\'s own finance sources, passing the filters and saying what it ignored', async () => {
    list.mockResolvedValue({ records: [RECORD], nextCursor: 'after:in_Fixture01', ignored: ['query'] });
    const [listTool] = financeTools(ctx(['billing', 'jira'], { billing: 'stripe', jira: 'jira' }));
    const out = JSON.parse(await listTool!.invoke({ kind: 'invoice', status: 'open', since: '2026-09-01', limit: 5 }) as string);

    expect(resolve).toHaveBeenCalledWith('org_a', { sourceSlug: null, allowed: ['billing'] });
    expect(list).toHaveBeenCalledWith('invoice', expect.objectContaining({ status: 'open', since: '2026-09-01', limit: 5, cursor: null }));
    expect(out).toMatchObject({ ok: true, vendor: 'Stripe', source: 'billing', kind: 'invoice', count: 1, nextCursor: 'after:in_Fixture01', ignored: ['query'] });
    expect(out.records[0].url).toBe(RECORD.url);
  });

  it('refuse a kind the connected vendor does not hold, and a date that is not one, in words', async () => {
    const [listTool] = financeTools(ctx(['billing'], { billing: 'stripe' }));

    expect(JSON.parse(await listTool!.invoke({ kind: 'bill' }) as string)).toEqual({ ok: false, error: 'Stripe holds no bill records here. It holds: customer, invoice.' });
    expect(JSON.parse(await listTool!.invoke({ kind: 'invoice', since: 'last week' }) as string)).toEqual({ ok: false, error: 'since is an ISO date, e.g. 2026-09-01.' });
    expect(list).not.toHaveBeenCalled();
  });

  it('get one record whole, and pass a vendor\'s failure on as data, not a thrown turn', async () => {
    get.mockResolvedValueOnce({ ...RECORD, lines: [{ description: 'Implementation', quantity: 1, amount: 12500 }] });
    const [, getTool] = financeTools(ctx(['billing'], { billing: 'stripe' }));
    const out = JSON.parse(await getTool!.invoke({ kind: 'invoice', id: 'in_Fixture01' }) as string);

    expect(out).toMatchObject({ ok: true, record: { id: 'in_Fixture01', lines: [{ amount: 12500 }] } });

    get.mockRejectedValueOnce(new Error('Stripe refused the credential (401).'));

    expect(JSON.parse(await getTool!.invoke({ kind: 'invoice', id: 'in_x' }) as string)).toEqual({ ok: false, error: 'Stripe refused the credential (401).' });
  });
});
