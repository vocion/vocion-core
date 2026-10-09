/**
 * A conversation's objective, against PGlite: started when a turn reads the
 * setup, read live against the plugin's steps, stopped and resumed by the
 * person, kept per workspace, and offered back on the next visit. The setup
 * state itself is its own module's business (and tests); here it is an input.
 * Fixtures are fictional (Northwind).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

type Setup = { plugin: string; name: string; complete: boolean; steps: Array<{ key: string; kind: 'connector' | 'records'; slug: string; label: string; done: boolean }> };
let setups: Setup[] = [];
vi.mock('@/services/plugins/setupState', () => ({ setupStateForOrg: vi.fn(async () => setups) }));

const { db } = await import('@/libs/DB');
const { conversationSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { currentObjective, keepForLater, setObjectiveState, setupScopeOf, startedSetups, startSetupObjective } = await import('./ObjectiveService');
const { eq } = await import('drizzle-orm');

const ACCT = 'acct-obj-northwind';
const FACTORY = 'proj-obj-factory';
const OTHER = 'proj-obj-other';
const DANA = 'usr-obj-dana';
const PAT = 'usr-obj-pat';

function factory(done: boolean[]): Setup {
  const steps = [
    { key: 'connector:github', kind: 'connector' as const, slug: 'github', label: 'Connect GitHub' },
    { key: 'records:product', kind: 'records' as const, slug: 'product', label: 'Create the first product record' },
    { key: 'records:repo', kind: 'records' as const, slug: 'repo', label: 'Create the first repo record' },
  ].map((s, i) => ({ ...s, done: done[i] ?? false }));
  return { plugin: 'software-factory', name: 'Software Factory', complete: steps.every(s => s.done), steps };
}

async function conversation(orgId: string, createdBy: string): Promise<number> {
  const [row] = await db.insert(conversationSchema).values({ orgId, projectId: orgId, agentSlug: 'lead', title: 'setup my software factory', createdBy }).returning({ id: conversationSchema.id });
  return row!.id;
}

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: ACCT, name: 'Northwind', slug: 'northwind-obj' });
  await db.insert(projectSchema).values([
    { id: FACTORY, accountId: ACCT, slug: 'factory', name: 'Factory' },
    { id: OTHER, accountId: ACCT, slug: 'other', name: 'Other' },
  ]);
});

beforeEach(() => {
  setups = [factory([true, false, false])];
});

describe('a setup objective', () => {
  it('starts when a turn reads the setup, and reads live against the plugin\'s steps', async () => {
    const id = await conversation(FACTORY, DANA);

    expect(await currentObjective(FACTORY, id)).toBeNull();
    expect(await startSetupObjective({ orgId: FACTORY, conversationId: id, plugin: 'software-factory' })).toBe('software-factory');

    const view = await currentObjective(FACTORY, id);

    expect(view).toMatchObject({ plugin: 'software-factory', name: 'Software Factory', state: 'running', done: 1, total: 3, current: 1 });

    // A step done anywhere else is done here too: nothing about progress is stored.
    setups = [factory([true, true, false])];

    expect((await currentObjective(FACTORY, id))!.current).toBe(2);
  });

  it('starts nothing when two plugins are left and none was named', async () => {
    const id = await conversation(FACTORY, DANA);
    setups = [factory([false]), { ...factory([false]), plugin: 'growth-loop', name: 'Growth Loop' }];

    expect(await startSetupObjective({ orgId: FACTORY, conversationId: id })).toBeNull();
    expect(await currentObjective(FACTORY, id)).toBeNull();
  });

  it('keeps when it began when started again, and starting again resumes a stopped one', async () => {
    const id = await conversation(FACTORY, DANA);
    await startSetupObjective({ orgId: FACTORY, conversationId: id });
    const [first] = await db.select({ o: conversationSchema.objective }).from(conversationSchema).where(eq(conversationSchema.id, id));

    await setObjectiveState(FACTORY, id, 'stopped');

    expect((await currentObjective(FACTORY, id))!.state).toBe('stopped');

    await startSetupObjective({ orgId: FACTORY, conversationId: id });
    const [again] = await db.select({ o: conversationSchema.objective }).from(conversationSchema).where(eq(conversationSchema.id, id));

    expect(again!.o!.state).toBe('running');
    expect(again!.o!.startedAt).toBe(first!.o!.startedAt);
  });

  it('is stopped and resumed by the person, and Resume undoes Stop', async () => {
    const id = await conversation(FACTORY, DANA);
    await startSetupObjective({ orgId: FACTORY, conversationId: id });

    expect((await setObjectiveState(FACTORY, id, 'stopped'))!.state).toBe('stopped');
    expect((await setObjectiveState(FACTORY, id, 'running'))!.state).toBe('running');
  });

  it('never reads or writes another workspace\'s conversation', async () => {
    const id = await conversation(FACTORY, DANA);
    await startSetupObjective({ orgId: FACTORY, conversationId: id });

    expect(await currentObjective(OTHER, id)).toBeNull();
    expect(await setObjectiveState(OTHER, id, 'stopped')).toBeNull();
    expect(await startSetupObjective({ orgId: OTHER, conversationId: id })).toBeNull();
    expect((await currentObjective(FACTORY, id))!.state).toBe('running');
  });
});

describe('the next visit', () => {
  it('knows the setups this person started here, by plugin — not another person\'s, not another workspace\'s', async () => {
    const mine = await conversation(FACTORY, PAT);
    await startSetupObjective({ orgId: FACTORY, conversationId: mine });
    await setObjectiveState(FACTORY, mine, 'stopped');
    const theirs = await conversation(FACTORY, DANA);
    await startSetupObjective({ orgId: FACTORY, conversationId: theirs });

    expect(Object.fromEntries(await startedSetups(FACTORY, PAT))).toEqual({ 'software-factory': mine });
    expect((await startedSetups(OTHER, PAT)).size).toBe(0);
  });
});

describe('what a running setup needs', () => {
  it('names the plugin\'s required connectors while it runs, and keeps extras for later', async () => {
    const id = await conversation(FACTORY, DANA);

    expect(await setupScopeOf(FACTORY, id)).toBeNull();

    await startSetupObjective({ orgId: FACTORY, conversationId: id });

    expect(await setupScopeOf(FACTORY, id)).toEqual({ plugin: 'software-factory', name: 'Software Factory', connectors: ['github'] });

    await keepForLater(FACTORY, id, [{ key: 'plugin:wiki', label: 'Turn on Wiki' }]);

    expect((await currentObjective(FACTORY, id))!.later).toEqual([{ key: 'plugin:wiki', label: 'Turn on Wiki' }]);

    await setObjectiveState(FACTORY, id, 'stopped');

    expect(await setupScopeOf(FACTORY, id)).toBeNull();
    expect(await setupScopeOf(OTHER, id)).toBeNull();
  });
});
