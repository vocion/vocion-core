/**
 * A plugin's schedules wait for its setup (`plugins/setupGate.ts`).
 *
 *   - A schedule tick of a plugin automation is held while the plugin's
 *     setup is not done, as a `skipped` row naming the steps still to do.
 *   - An event fire of the same automation, and a person's Run now, run.
 *   - Once the setup is complete the tick runs.
 *   - The workspace's own automation is never held.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/WorkflowService', () => ({
  startWorkflow: vi.fn(async () => ({ id: 310 })),
}));

const state = vi.hoisted(() => ({
  enabled: ['software-factory'] as string[],
  complete: false,
}));
vi.mock('@/services/PluginService', () => ({ enabledPluginsForOrg: async () => state.enabled }));
vi.mock('@/services/plugins/setupState', () => ({
  setupStateForOrg: async () => [{
    plugin: 'software-factory',
    name: 'Software factory',
    complete: state.complete,
    steps: [
      { key: 'connector:github', kind: 'connector', slug: 'github', label: 'Connect github', done: state.complete },
      { key: 'records:product', kind: 'records', slug: 'product', label: 'Create the first product record', done: state.complete },
    ],
  }],
}));

const { db } = await import('@/libs/DB');
const { eq } = await import('drizzle-orm');
const { automationRunSchema, automationSchema } = await import('@/models/Schema');
const { fireAutomation } = await import('@/services/AutomationService');
const { pluginOfAutomation, PluginSetupIncompleteError } = await import('@/services/plugins/setupGate');

const ORG = 'org_setup_gate';
// A schedule the software factory ships: the two-hourly reply pass.
const PLUGIN_SLUG = 'tell-the-requester-check';
const OWN_SLUG = 'northwind-nightly';

async function seed(slug: string) {
  await db.insert(automationSchema).values({ orgId: ORG, slug, name: slug, status: 'active', whenConfig: { schedule: '0 */2 * * *' } as never, doConfig: { workflow: 'wf' } as never });
}

async function runs(slug: string) {
  return db.select({ kind: automationRunSchema.kind, status: automationRunSchema.status, result: automationRunSchema.result }).from(automationRunSchema).where(eq(automationRunSchema.slug, slug));
}

beforeEach(async () => {
  await db.delete(automationRunSchema);
  await db.delete(automationSchema);
  state.enabled = ['software-factory'];
  state.complete = false;
});

describe('pluginOfAutomation', () => {
  it('names the plugin an automation ships with, among the plugins that are on', () => {
    expect(pluginOfAutomation(PLUGIN_SLUG, ['software-factory'])).toBe('software-factory');
    expect(pluginOfAutomation(PLUGIN_SLUG, [])).toBeNull();
    expect(pluginOfAutomation(OWN_SLUG, ['software-factory'])).toBeNull();
  });
});

describe('a plugin schedule before its setup is done', () => {
  it('is held on a schedule tick, as a skipped row naming what is still to do', async () => {
    await seed(PLUGIN_SLUG);

    await expect(fireAutomation(ORG, PLUGIN_SLUG, { invokedBy: `automation:${PLUGIN_SLUG}` })).rejects.toBeInstanceOf(PluginSetupIncompleteError);

    const [row] = await runs(PLUGIN_SLUG);

    // Held like a paused workspace: a `skipped` row, status ok — nothing failed, the rule held.
    expect(row!.kind).toBe('skipped');
    expect(row!.status).toBe('ok');
    expect(row!.result).toMatchObject({ kind: 'skipped', reason: 'setup_incomplete', detail: expect.stringContaining('Connect github') });
  });

  it('runs on an event, and on a person\'s Run now', async () => {
    await seed(PLUGIN_SLUG);

    await fireAutomation(ORG, PLUGIN_SLUG, { invokedBy: 'event:record.created' });
    await fireAutomation(ORG, PLUGIN_SLUG, { invokedBy: 'dashboard:test-run' });

    expect((await runs(PLUGIN_SLUG)).map(r => r.kind)).not.toContain('skipped');
  });

  it('runs on its tick once the setup is complete', async () => {
    await seed(PLUGIN_SLUG);
    state.complete = true;

    await fireAutomation(ORG, PLUGIN_SLUG, { invokedBy: `automation:${PLUGIN_SLUG}` });

    expect((await runs(PLUGIN_SLUG)).map(r => r.kind)).not.toContain('skipped');
  });

  it('never holds the workspace\'s own automation', async () => {
    await seed(OWN_SLUG);

    await fireAutomation(ORG, OWN_SLUG, { invokedBy: `automation:${OWN_SLUG}` });

    expect((await runs(OWN_SLUG)).map(r => r.kind)).not.toContain('skipped');
  });
});
