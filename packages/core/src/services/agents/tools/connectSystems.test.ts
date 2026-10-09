/**
 * `connect_system`: one tool for any registry connector. It builds the plan
 * and puts one "Connect your systems" card in the conversation whose link
 * carries the plan's input; it names no vendor of its own.
 */
import type { RuntimeContext } from '../types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const plan = vi.fn();
vi.mock('@/services/connect/recommendations', () => ({ recommendConnections: (...args: unknown[]) => plan(...args) }));

const kindCheck = vi.fn();
vi.mock('@/services/connect/connectorKindRouting', () => ({ connectKindCheck: (...args: unknown[]) => kindCheck(...args) }));

const { connectSystem } = await import('./connectSystems');

function ctx(): RuntimeContext & { emitted: unknown[] } {
  const emitted: unknown[] = [];
  return { orgId: 'proj-tool-northwind', userId: 'usr-tool-dana', agentSlug: 'workspace-lead', emit: (e: unknown) => emitted.push(e), emitted } as unknown as RuntimeContext & { emitted: unknown[] };
}

const candidate = (connector: string, name: string) => ({ connector, name, score: 100, recommended: true, evidence: [{ kind: 'named' }], method: { kind: 'page', href: '/x' }, unlocks: [] });

beforeEach(() => {
  plan.mockReset();
  kindCheck.mockReset();
});

describe('connect_system', () => {
  it('shows one card whose link starts the walk-through with what the person named', async () => {
    plan.mockResolvedValue({ candidates: [candidate('slack', 'Slack'), candidate('jira', 'Jira')], connected: [], question: null, scope: null, refused: null });
    const c = ctx();

    const said = await connectSystem(c, { named: ['slack', 'jira'] });

    expect(plan).toHaveBeenCalledWith({ orgId: 'proj-tool-northwind', userId: 'usr-tool-dana' }, { named: ['slack', 'jira'] });
    expect(c.emitted).toHaveLength(1);
    expect(c.emitted[0]).toMatchObject({ type: 'card', card: { kind: 'connect-systems', title: 'Connect your team connectors', href: '/dashboard/chat?objective=connect-systems&named=slack%2Cjira', actions: [] } });
    expect(said).toContain('Slack, Jira');
  });

  it('titles an app\'s plan with the app, and shows nothing when nothing is left', async () => {
    plan.mockResolvedValue({ candidates: [candidate('hubspot', 'HubSpot')], connected: [], question: null, scope: { app: 'gtm', appName: 'GTM' }, refused: null });
    const c = ctx();
    await connectSystem(c, { app: 'gtm' });

    expect(c.emitted[0]).toMatchObject({ card: { title: 'Connect the team connectors GTM uses' } });

    plan.mockResolvedValue({ candidates: [], connected: [{ connector: 'slack', name: 'Slack' }], question: null, scope: null, refused: null });
    const empty = ctx();

    expect(await connectSystem(empty, {})).toMatch(/Nothing left to connect: Slack already connected/);
    expect(empty.emitted).toHaveLength(0);
  });

  it('wears the lead\'s own words, composed from the facts it was handed (founder, 2026-10-09: "not hard coded … that gets stale")', async () => {
    plan.mockResolvedValue({ candidates: [{ ...candidate('github', 'GitHub'), evidence: [{ kind: 'app', app: 'software-factory', appName: 'Software Factory', needed: true }] }], connected: [], question: null, scope: { app: 'software-factory', appName: 'Software Factory' }, refused: null });
    const c = ctx();

    const said = await connectSystem(c, { app: 'software-factory', title: 'Connect GitHub so the factory can read your repos?', why: 'The release engineer tried to map northwind/api this morning and had no access.' });

    expect(c.emitted[0]).toMatchObject({ card: { title: 'Connect GitHub so the factory can read your repos?', body: 'The release engineer tried to map northwind/api this morning and had no access.' } });
    // Facts for the agent's own line, not copy to paste.
    expect(said).toContain('- GitHub: Software Factory needs it');
  });

  it('shows no card to someone who cannot connect, and says why', async () => {
    plan.mockResolvedValue({ candidates: [], connected: [], question: null, scope: null, refused: 'Only a workspace admin can connect a source' });
    const c = ctx();

    expect(await connectSystem(c, {})).toMatch(/admin/);
    expect(c.emitted).toHaveLength(0);
  });

  it('carries the lead\'s line for every step, not only the first, and says which steps have one', async () => {
    plan.mockResolvedValue({ candidates: [candidate('github', 'GitHub'), candidate('jira', 'Jira'), candidate('slack', 'Slack')], connected: [], question: null, scope: null, refused: null });
    const c = ctx();

    const said = await connectSystem(c, {
      named: ['github', 'jira', 'slack'],
      steps: [
        { connector: 'github', why: 'The factory reads your pull requests here.' },
        { connector: 'jira', why: 'Agents tried to file the Northwind bug three times this week.' },
        // Not in the walk: dropped rather than carried.
        { connector: 'hubspot', why: 'Not walked.' },
      ],
    });
    const { connectSystemsInputOfHref } = await import('@/libs/connect/systemsLink');
    const href = (c.emitted[0] as { card: { href: string } }).card.href;

    expect(connectSystemsInputOfHref(href)).toEqual({
      named: ['github', 'jira', 'slack'],
      say: { github: 'The factory reads your pull requests here.', jira: 'Agents tried to file the Northwind bug three times this week.' },
    });
    expect(said).toContain('Your lines lead the steps for GitHub, Jira. Slack shows its evidence.');
  });

  it('hands the lead what agents tried and failed, among each system\'s facts', async () => {
    plan.mockResolvedValue({ candidates: [{ ...candidate('slack', 'Slack'), evidence: [{ kind: 'tried', times: 3 }] }], connected: [], question: null, scope: null, refused: null });

    expect(await connectSystem(ctx(), { named: ['slack'] })).toContain('- Slack: Agents tried to use it 3 times this week and couldn\'t');
  });

  it('a request for the person\'s own account answers with one line pointing to Personal connectors, and no card', async () => {
    kindCheck.mockResolvedValue({ proceed: false, reply: 'Your own Gmail is a personal connector — only your personal assistant reads it, and only you can connect it. Connect it in Personal connectors. Say that in one line; show no card here.' });
    const c = ctx();

    const said = await connectSystem(c, { named: ['gmail'], kind: 'personal' });

    expect(kindCheck).toHaveBeenCalledWith(c, ['gmail'], 'personal');
    expect(said).toMatch(/^Your own Gmail is a personal connector/);
    expect(c.emitted).toEqual([]);
    expect(plan).not.toHaveBeenCalled();
  });

  it('in a Personal workspace, asks which kind before any team plan is built', async () => {
    kindCheck.mockResolvedValue({ proceed: false, reply: 'HubSpot is a team connector — your team\'s agents use it, and an admin connects it. Connect it in Team connectors.' });
    const c = { ...ctx(), workspaceKind: 'personal' as const };

    const said = await connectSystem(c, { named: ['hubspot'] });

    expect(said).toContain('HubSpot is a team connector');
    expect(plan).not.toHaveBeenCalled();
  });

  it('a team request in a shared workspace never asks', async () => {
    plan.mockResolvedValue({ candidates: [candidate('hubspot', 'HubSpot')], connected: [], question: null, scope: null, refused: null });

    await connectSystem(ctx(), { named: ['hubspot'], kind: 'team' });

    expect(kindCheck).not.toHaveBeenCalled();
  });
});
