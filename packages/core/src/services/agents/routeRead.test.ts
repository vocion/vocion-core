import { describe, expect, it } from 'vitest';
import { readRoute } from './routeRead';

/**
 * A classifier that answers with the given tool arguments.
 * @param args - What the model put in its report.
 */
function answering(args: unknown) {
  return { bindTools: () => ({ invoke: async () => ({ tool_calls: [{ name: 'report_route', args }] }) }) } as never;
}

const input = { orgId: 'org_route_read', message: 'Give me new consumer feature ideas for Northwind Share.', agents: [], leadSlug: 'product-manager' };

describe('readRoute', () => {
  it('keeps a reason that runs past the limit, cut to it, rather than refusing the read', async () => {
    const read = await readRoute(input, answering({ chosen: 'product-manager', confidence: 0.8, reason: 'x'.repeat(420) }));

    expect(read.chosen).toBe('product-manager');
    expect(read.reason).toHaveLength(300);
  });

  it('still refuses an answer missing what it routes on', async () => {
    await expect(readRoute(input, answering({ confidence: 0.8, reason: 'no seat named' }))).rejects.toThrow(/out of shape: chosen/);
  });
});

describe('the front door for new work', () => {
  it('tells the read who files new work, when the workspace declares it (conversation 474)', async () => {
    let said = '';
    const model = { bindTools: () => ({ invoke: async (messages: Array<{ content: unknown }>) => {
      said = String(messages[1]!.content);
      return { tool_calls: [{ name: 'report_route', args: { chosen: 'product-manager', confidence: 0.9, reason: 'New work is a request the product manager files.' } }] };
    } }) } as never;

    await readRoute({ ...input, message: 'On Northwind Share, give the library keyboard shortcuts.', intake: { label: 'Request', ownerSlug: 'product-manager' } }, model);

    expect(said).toContain('New work someone wants built, changed or fixed is filed as a Request by product-manager');
  });

  it('says nothing about it when the workspace has no front door', async () => {
    let said = '';
    const model = { bindTools: () => ({ invoke: async (messages: Array<{ content: unknown }>) => {
      said = String(messages[1]!.content);
      return { tool_calls: [{ name: 'report_route', args: { chosen: 'product-manager', confidence: 0.9, reason: 'r' } }] };
    } }) } as never;

    await readRoute({ ...input, intake: null }, model);

    expect(said).not.toContain('New work');
  });
});
