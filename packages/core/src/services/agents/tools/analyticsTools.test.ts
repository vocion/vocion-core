/**
 * The analytics reads: present only for an agent with an analytics source,
 * each answering through the source's provider over a checked date range.
 * The provider is mocked; the events are invented.
 */
import type { RuntimeContext } from '../types';
import { toJsonSchema } from '@langchain/core/utils/json_schema';
import { describe, expect, it, vi } from 'vitest';

const provider = vi.hoisted(() => ({
  kind: 'amplitude',
  sourceSlug: 'amplitude',
  vendor: 'Amplitude',
  project: '412345',
  projectUrl: null,
  listEvents: vi.fn(async () => [{ name: 'Document Sent', volume: 120 }]),
  eventCounts: vi.fn(async (input: { events: string[]; interval: string; measure: string }) => input.events.map(event => ({ event, measure: input.measure, interval: input.interval, points: [{ date: '2026-09-01', value: 4 }], total: 4 }))),
  savedFunnels: vi.fn(async () => [] as Array<{ id: string; name: string }>),
  funnel: vi.fn(async (input: { steps?: string[]; from: string; to: string }) => ({ name: null, from: input.from, to: input.to, steps: (input.steps ?? []).map((event, i) => ({ event, count: 10 - i * 4, fromPrevious: i === 0 ? null : 0.6, fromStart: i === 0 ? 1 : 0.6 })) })),
  cohorts: vi.fn(async () => [{ id: 'c_1', name: 'Power senders', description: null, size: 42, updated: null }]),
}));
const resolved = vi.hoisted(() => ({ args: [] as unknown[] }));
vi.mock('@/services/productAnalytics/provider', () => ({
  analyticsProviderFor: async (_org: string, opts: unknown) => {
    resolved.args.push(opts);
    return provider;
  },
}));

const { analyticsTools } = await import('./analyticsTools');

type Invokable = { name: string; schema: unknown; invoke: (input: Record<string, unknown>) => Promise<string> };

function ctxFor(sources: string[], kinds?: Record<string, string>): RuntimeContext {
  return { orgId: 'org_1', agentSlug: 'analytics-planner', connectorSources: sources, sourceKinds: kinds, objectTypeSlugs: [], searchConfig: {}, harnessConfig: {}, emit: () => {}, citationSeq: { current: 0 } } as unknown as RuntimeContext;
}

describe('the analytics reads', () => {
  it('exist only for an agent with an analytics source, and can be bound to a model', () => {
    expect(analyticsTools(ctxFor(['posthog']))).toHaveLength(0);

    const tools = analyticsTools(ctxFor(['product-events'], { 'product-events': 'mixpanel' })) as unknown as Invokable[];

    expect(tools.map(t => t.name)).toEqual(['analytics_events', 'analytics_event_counts', 'analytics_funnel', 'analytics_cohorts']);

    for (const t of tools) {
      expect(() => toJsonSchema(t.schema as never)).not.toThrow();
    }
  });

  it('counts named events over the range asked for, scoped to the agent\'s sources', async () => {
    const [, counts] = analyticsTools(ctxFor(['amplitude'])) as unknown as Invokable[];
    const out = JSON.parse(await counts!.invoke({ events: ['Document Sent'], from: '2026-09-01', to: '2026-09-07', interval: 'week', measure: 'uniques' }));

    expect(resolved.args.at(-1)).toEqual({ sourceSlug: null, slugs: ['amplitude'] });
    expect(provider.eventCounts).toHaveBeenLastCalledWith({ from: '2026-09-01', to: '2026-09-07', events: ['Document Sent'], interval: 'week', measure: 'uniques' });
    expect(out).toMatchObject({ ok: true, analytics: 'Amplitude', from: '2026-09-01', to: '2026-09-07', series: [{ event: 'Document Sent', total: 4 }] });
    expect(out.note).toMatch(/per interval/);
  });

  it('refuses a malformed range before asking the vendor', async () => {
    const [, counts] = analyticsTools(ctxFor(['amplitude'])) as unknown as Invokable[];
    provider.eventCounts.mockClear();
    const out = JSON.parse(await counts!.invoke({ events: ['Document Sent'], from: '2026-09-08', to: '2026-09-01' }));

    expect(out).toEqual({ ok: false, error: 'from (2026-09-08) is after to (2026-09-01).' });
    expect(provider.eventCounts).not.toHaveBeenCalled();
  });

  it('builds a funnel from steps, and with neither steps nor a saved id lists what can be read', async () => {
    const [, , funnel] = analyticsTools(ctxFor(['amplitude'])) as unknown as Invokable[];

    expect(JSON.parse(await funnel!.invoke({ steps: ['Signed Up', 'Document Sent'], window_days: 3 }))).toMatchObject({ ok: true, funnel: { steps: [{ event: 'Signed Up', fromPrevious: null }, { event: 'Document Sent', fromPrevious: 0.6 }] } });
    expect(provider.funnel).toHaveBeenLastCalledWith(expect.objectContaining({ steps: ['Signed Up', 'Document Sent'], windowDays: 3 }));

    expect(JSON.parse(await funnel!.invoke({}))).toMatchObject({ ok: true, savedFunnels: [], note: expect.stringMatching(/steps/) });
  });

  it('lists events and cohorts', async () => {
    const [events, , , cohorts] = analyticsTools(ctxFor(['amplitude'])) as unknown as Invokable[];

    expect(JSON.parse(await events!.invoke({}))).toMatchObject({ ok: true, count: 1, events: [{ name: 'Document Sent' }] });
    expect(JSON.parse(await cohorts!.invoke({}))).toMatchObject({ ok: true, cohorts: [{ name: 'Power senders', size: 42 }] });
  });
});
