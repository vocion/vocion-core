import { afterEach, describe, expect, it, vi } from 'vitest';
import { compactArgs, labelStep, parseLabelsReply, resetStepLabelCache } from './stepLabeler';

afterEach(() => resetStepLabelCache());

describe('labelStep', () => {
  it('uses the model’s pair when it describes the act', async () => {
    const model = vi.fn(async (_system: string, _user: string) => '{"running":"Reading the brand guide","done":"Read the brand guide"}');

    await expect(labelStep({ orgId: 'o', tool: 'brand_thing', args: { a: 1 }, model })).resolves.toEqual({ running: 'Reading the brand guide…', done: 'Read the brand guide' });
    // The prompt carries the call and nothing else.
    expect(model.mock.calls[0]?.[1]).toBe('tool: brand_thing\narguments: {"a":1}');
  });

  it('one call per (tool, args) — the second ask is answered from the cache', async () => {
    const model = vi.fn(async () => '{"running":"Reading it","done":"Read it"}');
    await labelStep({ orgId: 'o', tool: 'x_tool', args: { q: 'a' }, model });
    await labelStep({ orgId: 'o', tool: 'x_tool', args: { q: 'a' }, model });
    await labelStep({ orgId: 'o', tool: 'x_tool', args: { q: 'b' }, model });

    expect(model).toHaveBeenCalledTimes(2);
  });

  it('falls back to the plain name when the model claims an outcome, errors, or writes junk', async () => {
    await expect(labelStep({ orgId: 'o', tool: 'hubspot_get_contact', model: async () => '{"running":"Searching","done":"Found 12 contacts"}' })).resolves.toEqual({ running: 'Reading the HubSpot contact…', done: 'Read the HubSpot contact' });
    await expect(labelStep({ orgId: 'o', tool: 'get_brand', args: { x: 1 }, model: async () => {
      throw new Error('no key');
    } })).resolves.toEqual({ running: 'Reading the brand guide…', done: 'Read the brand guide' });
    await expect(labelStep({ orgId: 'o', tool: 'get_brand', args: { x: 2 }, model: async () => 'sure! here you go' })).resolves.toEqual({ running: 'Reading the brand guide…', done: 'Read the brand guide' });
  });

  it('cuts long arguments and tolerates wrapped JSON', () => {
    expect(compactArgs({ text: 'x'.repeat(1000) }).length).toBeLessThanOrEqual(402);
    expect(parseLabelsReply('Here: {"running":"a","done":"b"} thanks')).toEqual({ running: 'a', done: 'b' });
    expect(parseLabelsReply('nope')).toBeNull();
  });
});
