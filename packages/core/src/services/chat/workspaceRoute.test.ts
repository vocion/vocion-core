import { describe, expect, it, vi } from 'vitest';
import { routePrompt, routeToWorkspace, WORKSPACE_ADD_BAR, WORKSPACE_ROUTE_BAR } from './workspaceRoute';

/**
 * Chris, 2026-10-05: "Specific channels should get (n) workspace associations to help with faster
 * routing, but allow addition if context is appropriate. Specific Slack threads should get affixed
 * to (1) specific workspace."
 */
const CANDIDATES = [
  { orgId: 'org_workforce', name: 'Vocion Workforce', description: 'The company that markets Vocion', products: [], agents: [{ slug: 'ceo', name: 'CEO', description: 'Runs the company' }] },
  { orgId: 'org_factory', name: 'Northwind Factory', description: null, products: ['Northwind Send', 'Kestrel Video'], agents: [{ slug: 'product-manager', name: 'Product manager', description: 'Owns the loop from the ask' }] },
  { orgId: 'org_revenue', name: 'Revenue', description: null, products: [], agents: [{ slug: 'seller', name: 'Seller', description: null }] },
];
const CATCH_ALL = { orgId: 'org_workforce', agentSlug: 'ceo', channelId: '*', surface: 'slack', teamId: 'T1' };
const CHANNEL = { id: 4, orgId: 'org_factory', agentSlug: 'product-manager', channelId: 'C42', surface: 'slack', teamId: 'T1', workspaceIds: ['org_revenue'] };
const said = (workspace: string, confidence: number) => vi.fn(async () => ({ workspace, confidence, reason: `it is about ${workspace}` }));
const deps = (over: Partial<Parameters<typeof routeToWorkspace>[2]> = {}) => ({
  threadOwner: vi.fn(async () => null),
  candidates: vi.fn(async () => CANDIDATES),
  channelName: vi.fn(async () => 'kestrel-internal'),
  read: said('org_factory', 0.92),
  agentIn: vi.fn(async () => 'product-manager'),
  remember: vi.fn(async () => undefined),
  ...over,
});

describe('a thread is fixed to one workspace', () => {
  it('every message after the first goes where the first went, with no read', async () => {
    const d = deps({ threadOwner: vi.fn(async () => ({ orgId: 'org_factory', agentSlug: 'product-manager' })) });

    expect(await routeToWorkspace(CATCH_ALL, { text: 'ship it', scopeRef: 'slack:C9:1.2', channelId: 'C9' }, d)).toMatchObject({ orgId: 'org_factory', routed: 'thread' });
    expect(d.read).not.toHaveBeenCalled();
  });
});

describe('what the read sees', () => {
  it('a catch-all mention is read with the real channel\'s name and the pictures on the ask (Chris, 2026-10-05)', async () => {
    const d = deps();
    const pictures = [{ contentType: 'image/png', base64: 'iVBORw0K' }];
    await routeToWorkspace(CATCH_ALL, { text: 'See this thread.', scopeRef: 'slack:C9:1.2', channelId: 'C9', pictures }, d);

    expect(d.channelName).toHaveBeenCalledWith(expect.objectContaining({ channelId: 'C9' }));
    expect((d.read as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![2]).toEqual(pictures);
  });
});

describe('a channel has its workspaces', () => {
  it('offers the channel\'s own workspaces first, marked, with the channel\'s name and each workspace\'s products', async () => {
    const d = deps();
    await routeToWorkspace(CHANNEL, { text: 'the control bar is cut off on mobile Firefox', scopeRef: 'slack:C42:1', channelId: 'C42' }, d);
    const prompt = ((d.read as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [string, string])[1];

    expect(prompt).toContain('#kestrel-internal');
    expect(prompt.indexOf('id: org_factory   (this channel is for it)')).toBeLessThan(prompt.indexOf('id: org_workforce'));
    expect(prompt).toContain('id: org_revenue   (this channel is for it)');
    expect(prompt).toContain('products: Northwind Send, Kestrel Video');
  });

  it('a pick among the channel\'s own answers at the ordinary bar; the binding\'s agent answers in its own workspace', async () => {
    const own = deps({ read: said('org_factory', WORKSPACE_ROUTE_BAR) });

    expect(await routeToWorkspace(CHANNEL, { text: 'x', scopeRef: 'slack:C42:1', channelId: 'C42' }, own)).toMatchObject({ orgId: 'org_factory', agentSlug: 'product-manager', routed: 'binding' });

    const other = deps({ read: said('org_revenue', WORKSPACE_ROUTE_BAR), agentIn: vi.fn(async () => 'seller') });

    expect(await routeToWorkspace(CHANNEL, { text: 'x', scopeRef: 'slack:C42:2', channelId: 'C42' }, other)).toMatchObject({ orgId: 'org_revenue', agentSlug: 'seller', routed: 'model', added: false });
    expect(other.remember).not.toHaveBeenCalled();
  });

  it('another workspace of the account wins only on the high bar, and is then added to the channel', async () => {
    const weak = deps({ read: said('org_workforce', WORKSPACE_ADD_BAR - 0.05) });

    expect(await routeToWorkspace(CHANNEL, { text: 'x', scopeRef: 'slack:C42:3', channelId: 'C42' }, weak)).toMatchObject({ orgId: 'org_factory', routed: 'binding' });
    expect(weak.remember).not.toHaveBeenCalled();

    const strong = deps({ read: said('org_workforce', WORKSPACE_ADD_BAR), agentIn: vi.fn(async () => 'ceo') });

    expect(await routeToWorkspace(CHANNEL, { text: 'x', scopeRef: 'slack:C42:4', channelId: 'C42' }, strong)).toMatchObject({ orgId: 'org_workforce', agentSlug: 'ceo', routed: 'model', added: true });
    expect(strong.remember).toHaveBeenCalledWith(expect.objectContaining({ channelId: 'C42' }), 'org_workforce', 'ceo');
  });

  it('a catch-all channel gets its own binding from a confident route; a direct message does not', async () => {
    const d = deps();

    expect(await routeToWorkspace(CATCH_ALL, { text: 'x', scopeRef: 'slack:C9:1', channelId: 'C9' }, d)).toMatchObject({ orgId: 'org_factory', added: true });
    expect(d.remember).toHaveBeenCalledWith(expect.objectContaining({ channelId: 'C9' }), 'org_factory', 'product-manager');

    const dm = deps();
    await routeToWorkspace(CATCH_ALL, { text: 'x', scopeRef: 'slack:D7:1', channelId: 'D7' }, dm);

    expect(dm.remember).not.toHaveBeenCalled();
  });

  it('keeps the binding when the read fails, picks what was not offered, or nothing answers there', async () => {
    for (const d of [deps({ read: vi.fn(async () => {
      throw new Error('model down');
    }) }), deps({ read: said('org_other_tenant', 0.99) }), deps({ read: said('org_workforce', 0.95), agentIn: vi.fn(async () => null) })]) {
      expect(await routeToWorkspace(CHANNEL, { text: 'x', scopeRef: 'slack:C42:9', channelId: 'C42' }, d)).toMatchObject({ orgId: 'org_factory', agentSlug: 'product-manager', routed: 'binding' });
    }
  });

  it('the prompt carries the words, the channel and every candidate', () => {
    const p = routePrompt('owner asked for their own passcode', CANDIDATES, { channel: 'kestrel-internal', own: ['org_factory'] });

    expect(p).toMatch(/^Said in the Slack channel #kestrel-internal\./);
    expect(p).toContain('owner asked for their own passcode');
    expect(p).toContain('Product manager (Owns the loop from the ask)');
  });
});

describe('who is asking decides where a mention may go (2026-10-07)', () => {
  it('resolves the sender and offers the candidates their reach, keeping the binding\'s and the channel\'s own', async () => {
    const d = deps({ sender: vi.fn(async () => 'usr-dana') });
    await routeToWorkspace(CHANNEL, { text: 'x', scopeRef: 'slack:C42:10', channelId: 'C42', externalUserId: 'U123' }, d);

    const reach = (d.candidates as unknown as { mock: { calls: Array<[string, { sender: () => Promise<string | null>; keep: string[] }]> } }).mock.calls[0]![1];

    expect(reach.keep).toEqual(['org_factory', 'org_revenue']);
    expect(await reach.sender()).toBe('usr-dana');
    expect(d.sender).toHaveBeenCalledWith(CHANNEL, 'U123');
  });

  it('a sender Vocion does not know is offered only what the channel already holds', async () => {
    const d = deps({ sender: vi.fn(async () => null) });
    await routeToWorkspace(CATCH_ALL, { text: 'x', scopeRef: 'slack:C9:11', channelId: 'C9', externalUserId: 'U999' }, d);

    const reach = (d.candidates as unknown as { mock: { calls: Array<[string, { sender: () => Promise<string | null>; keep: string[] }]> } }).mock.calls[0]![1];

    expect(reach.keep).toEqual(['org_workforce']);
    expect(await reach.sender()).toBeNull();
  });

  it('a mention whose sender reaches one workspace keeps the binding with no read', async () => {
    const d = deps({ sender: vi.fn(async () => null), candidates: vi.fn(async () => CANDIDATES.slice(0, 1)) });

    expect(await routeToWorkspace(CATCH_ALL, { text: 'x', scopeRef: 'slack:C9:12', channelId: 'C9', externalUserId: 'U999' }, d)).toMatchObject({ orgId: 'org_workforce', routed: 'binding' });
    expect(d.read).not.toHaveBeenCalled();
  });
});
