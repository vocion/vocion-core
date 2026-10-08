/**
 * `connect_system`: one tool for any registry connector. It builds the plan
 * and puts one "Connect your systems" card in the conversation whose link
 * carries the plan's input; it names no vendor of its own.
 */
import type { RuntimeContext } from '../types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const plan = vi.fn();
vi.mock('@/services/connect/recommendations', () => ({ recommendConnections: (...args: unknown[]) => plan(...args) }));

const { connectSystem } = await import('./connectSystems');

function ctx(): RuntimeContext & { emitted: unknown[] } {
  const emitted: unknown[] = [];
  return { orgId: 'proj-tool-northwind', userId: 'usr-tool-dana', agentSlug: 'workspace-lead', emit: (e: unknown) => emitted.push(e), emitted } as unknown as RuntimeContext & { emitted: unknown[] };
}

const candidate = (connector: string, name: string) => ({ connector, name, score: 100, recommended: true, evidence: [{ kind: 'named' }], method: { kind: 'page', href: '/x' }, unlocks: [] });

beforeEach(() => plan.mockReset());

describe('connect_system', () => {
  it('shows one card whose link starts the walk-through with what the person named', async () => {
    plan.mockResolvedValue({ candidates: [candidate('slack', 'Slack'), candidate('jira', 'Jira')], connected: [], question: null, scope: null, refused: null });
    const c = ctx();

    const said = await connectSystem(c, { named: ['slack', 'jira'] });

    expect(plan).toHaveBeenCalledWith({ orgId: 'proj-tool-northwind', userId: 'usr-tool-dana' }, { named: ['slack', 'jira'] });
    expect(c.emitted).toHaveLength(1);
    expect(c.emitted[0]).toMatchObject({ type: 'card', card: { kind: 'connect-systems', title: 'Connect your systems', href: '/dashboard/chat?objective=connect-systems&named=slack%2Cjira', actions: [] } });
    expect(said).toContain('Slack, Jira');
  });

  it('titles an app\'s plan with the app, and shows nothing when nothing is left', async () => {
    plan.mockResolvedValue({ candidates: [candidate('hubspot', 'HubSpot')], connected: [], question: null, scope: { app: 'gtm', appName: 'GTM' }, refused: null });
    const c = ctx();
    await connectSystem(c, { app: 'gtm' });

    expect(c.emitted[0]).toMatchObject({ card: { title: 'Connect the systems GTM uses' } });

    plan.mockResolvedValue({ candidates: [], connected: [{ connector: 'slack', name: 'Slack' }], question: null, scope: null, refused: null });
    const empty = ctx();

    expect(await connectSystem(empty, {})).toMatch(/Nothing left to connect: Slack already connected/);
    expect(empty.emitted).toHaveLength(0);
  });

  it('shows no card to someone who cannot connect, and says why', async () => {
    plan.mockResolvedValue({ candidates: [], connected: [], question: null, scope: null, refused: 'Only a workspace admin can connect a source' });
    const c = ctx();

    expect(await connectSystem(c, {})).toMatch(/admin/);
    expect(c.emitted).toHaveLength(0);
  });
});
