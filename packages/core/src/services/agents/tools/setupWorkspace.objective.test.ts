import type { RuntimeContext } from '../types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * MID-OBJECTIVE, ONLY WHAT IT NEEDS (founder, 2026-10-09). "setup my
 * software factory" docked "Turn on Wiki" and "Turn on Red team" as steps of
 * a setup that needs neither. While the conversation is setting a plugin up,
 * propose_setup shows only the connections that plugin's setup declares; the
 * rest are kept on the objective as optional "Later" extras and drawn as no
 * card. Fixtures are fictional.
 */

const setupScopeOf = vi.fn();
const keepForLater = vi.fn(async () => {});
vi.mock('@/services/objectives/ObjectiveService', () => ({ setupScopeOf, keepForLater }));
vi.mock('@/services/WorkspaceAccessService', () => ({ memberWorkspace: vi.fn(async () => ({ accountRole: 'admin' })) }));
vi.mock('@/libs/workspace/plugins', () => ({
  loadPlugin: (slug: string) => ({ manifest: { name: ({ 'wiki': 'Wiki', 'red-team': 'Red team' } as Record<string, string>)[slug] ?? slug } }),
  listPlugins: () => [],
}));

const { proposeSetup } = await import('./setupWorkspace');

function ctx(emit = vi.fn()): RuntimeContext {
  return { orgId: 'proj-factory', userId: 'usr-dana', agentSlug: 'workspace-lead', conversationId: 12, workspaceKind: 'shared', harnessConfig: { grantTools: ['propose_setup'] }, connectorSources: [], emit } as unknown as RuntimeContext;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('propose_setup in a conversation setting a plugin up', () => {
  it('keeps what the setup does not need for later, and docks none of it', async () => {
    setupScopeOf.mockResolvedValue({ plugin: 'software-factory', name: 'Software factory', connectors: ['github'] });
    const emit = vi.fn();

    const said = await proposeSetup(ctx(emit), { steps: [
      { kind: 'plugin', id: 'wiki', why: 'So decisions are remembered.' },
      { kind: 'plugin', id: 'red-team', why: 'A second read before anything ships.' },
    ] });

    expect(emit).not.toHaveBeenCalled();
    expect(keepForLater).toHaveBeenCalledWith('proj-factory', 12, [{ key: 'plugin:wiki', label: 'Turn on Wiki' }, { key: 'plugin:red-team', label: 'Turn on Red team' }]);
    expect(said).toMatch(/Showed no cards: setting up Software factory needs only github connected/);
    expect(said).toMatch(/Kept for later, under its steps: Turn on Wiki; Turn on Red team\. Offer them once Software factory is set up/);
  });

  it('scopes nothing when the conversation is not setting anything up', async () => {
    setupScopeOf.mockResolvedValue(null);

    const said = await proposeSetup(ctx(), { steps: [{ kind: 'plugin', id: 'wiki', why: 'So decisions are remembered.' }] });

    expect(keepForLater).not.toHaveBeenCalled();
    expect(said).not.toMatch(/Kept for later/);
  });
});
