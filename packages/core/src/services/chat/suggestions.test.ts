/**
 * The empty-state chips — the setup chip leads while a plugin that is on
 * still has setup steps undone, and is gone once they are done. The other
 * signals (synthesis, urgency, YAML filler) are covered in synthesis.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const setups = vi.hoisted(() => ({ value: [] as Array<{ plugin: string; name: string; complete: boolean; steps: unknown[] }> }));
vi.mock('@/services/plugins/setupState', () => ({ setupStateForOrg: async () => setups.value }));
vi.mock('./synthesis', () => ({
  synthesizeAgentChips: async () => [
    { label: 'What should I do?', prompt: 'What should I do right now?', source: 'capability' },
    { label: 'What can you do?', prompt: 'What can you do for me?', source: 'capability' },
  ],
}));

const { buildWorkspaceChips } = await import('./suggestions');

const agents = [{ slug: 'product-manager', name: 'Product manager', role: 'lead' as const }];

describe('buildWorkspaceChips — the setup chip', () => {
  beforeEach(() => {
    setups.value = [];
  });

  it('leads with "Set up your <plugin>" while a plugin that is on is not set up, routed to the lead', async () => {
    setups.value = [{ plugin: 'software-factory', name: 'Software factory', complete: false, steps: [{}] }];

    const chips = await buildWorkspaceChips({ orgId: 'org_1', agents });

    expect(chips[0]).toEqual({ label: 'Set up your software factory', prompt: 'Set up my software factory', agentSlug: 'product-manager', source: 'setup' });
    // The two anchors follow; the setup chip took one of the two visible slots.
    expect(chips.slice(1, 3).map(c => c.label)).toEqual(['What should I do?', 'What can you do?']);
  });

  it('is gone once every step is done, and absent when no plugin declares setup', async () => {
    setups.value = [{ plugin: 'software-factory', name: 'Software factory', complete: true, steps: [{}] }];

    expect((await buildWorkspaceChips({ orgId: 'org_1', agents })).some(c => c.source === 'setup')).toBe(false);

    setups.value = [];

    expect((await buildWorkspaceChips({ orgId: 'org_1', agents })).some(c => c.source === 'setup')).toBe(false);
  });
});
