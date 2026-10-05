import { describe, expect, it, vi } from 'vitest';
import { routePrompt, routeToWorkspace, WORKSPACE_ROUTE_BAR } from './workspaceRoute';

/** ONE SLACK TEAM, SEVERAL WORKSPACES (Chris, 2026-10-05): a catch-all mention goes where it is about. */
const CANDIDATES = [
  { orgId: 'org_workforce', name: 'Vocion Workforce', description: 'The company that markets Vocion', agents: [{ slug: 'ceo', name: 'CEO', description: 'Runs the company' }] },
  { orgId: 'org_factory', name: 'Northwind Factory', description: 'Builds Northwind Send', agents: [{ slug: 'product-manager', name: 'Product manager', description: 'Owns the loop from the ask' }] },
];
const CATCH_ALL = { orgId: 'org_workforce', agentSlug: 'ceo', channelId: '*' };
const deps = (over: Partial<Parameters<typeof routeToWorkspace>[2]> = {}) => ({
  threadOwner: vi.fn(async () => null),
  candidates: vi.fn(async () => CANDIDATES),
  read: vi.fn(async () => ({ workspace: 'org_factory', confidence: 0.92, reason: 'it is a bug on Send' })),
  agentIn: vi.fn(async () => 'product-manager'),
  ...over,
});

describe('which workspace a Slack mention is for', () => {
  it('an exactly bound channel answers as bound, with no read', async () => {
    const d = deps();

    expect(await routeToWorkspace({ ...CATCH_ALL, channelId: 'C7' }, { text: 'hi', scopeRef: 'slack:C7:1' }, d)).toMatchObject({ orgId: 'org_workforce', agentSlug: 'ceo', routed: 'binding' });
    expect(d.read).not.toHaveBeenCalled();
  });

  it('a catch-all mention about another workspace\'s product goes there, to the agent its own router picks', async () => {
    const d = deps();
    const out = await routeToWorkspace(CATCH_ALL, { text: 'On Send, the owner gets the passcode prompt on their own link', scopeRef: 'slack:C9:1.2' }, d);

    expect(out).toEqual({ orgId: 'org_factory', agentSlug: 'product-manager', routed: 'model', reason: 'it is a bug on Send' });
    expect(d.agentIn).toHaveBeenCalledWith('org_factory', 'On Send, the owner gets the passcode prompt on their own link');
  });

  it('the rest of a thread goes where its first message went, without another read', async () => {
    const d = deps({ threadOwner: vi.fn(async () => ({ orgId: 'org_factory', agentSlug: 'product-manager' })) });

    expect(await routeToWorkspace(CATCH_ALL, { text: 'ship it', scopeRef: 'slack:C9:1.2' }, d)).toMatchObject({ orgId: 'org_factory', routed: 'thread' });
    expect(d.read).not.toHaveBeenCalled();
    expect(d.threadOwner).toHaveBeenCalledWith('slack:C9:1.2', ['org_workforce', 'org_factory']);
  });

  it('keeps the catch-all when the read is unsure, fails, picks what was not offered, or nothing answers there', async () => {
    const unsure = deps({ read: vi.fn(async () => ({ workspace: 'org_factory', confidence: WORKSPACE_ROUTE_BAR - 0.1, reason: 'could be' })) });
    const failed = deps({ read: vi.fn(async () => {
      throw new Error('model down');
    }) });
    const offlist = deps({ read: vi.fn(async () => ({ workspace: 'org_other_tenant', confidence: 0.99, reason: 'x' })) });
    const nobody = deps({ agentIn: vi.fn(async () => null) });

    for (const d of [unsure, failed, offlist, nobody]) {
      expect(await routeToWorkspace(CATCH_ALL, { text: 'x', scopeRef: 'slack:C9:1' }, d)).toMatchObject({ orgId: 'org_workforce', agentSlug: 'ceo', routed: 'binding' });
    }
  });

  it('offers only the account\'s workspaces, each with what it is and who answers there', () => {
    const p = routePrompt('the owner is asked for the passcode', CANDIDATES);

    expect(p).toContain('id: org_factory');
    expect(p).toContain('name: Northwind Factory');
    expect(p).toContain('Product manager (Owns the loop from the ask)');
  });
});
