/**
 * A mission run reaches an end state when a task cannot run (vocion-core#121).
 *
 * The loop used to walk the plan once. The dependents of a failed task were
 * left `pending`, the plan never counted as done, and the run sat at
 * `running` for ever. A task listed before the task it depends on was
 * skipped over by the single pass for the same reason.
 *
 * `runAgentDeep` is mocked so no model is called: it fails any task whose
 * message names a title in `failingTitles` and completes the rest. The DB is
 * the PGlite test mock, so the run's status and plan are read back for real.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/AgentService', () => ({
  runAgentDeep: vi.fn(),
}));

const { db } = await import('@/libs/DB');
const { eq } = await import('drizzle-orm');
const { missionRunSchema } = await import('@/models/Schema');
const { runAgentDeep } = await import('@/services/AgentService');
const { executeMissionRun } = await import('@/services/missions/runtime');

const mockRunAgent = vi.mocked(runAgentDeep);

const ORG = 'org_unreachable_tasks';

type SeedTask = { id: string; title: string; dependsOn?: string[] };

let failingTitles = new Set<string>();

async function seedRun(tasks: SeedTask[]): Promise<number> {
  const [row] = await db
    .insert(missionRunSchema)
    .values({
      orgId: ORG,
      title: 'Unreachable task run',
      brief: 'do the thing',
      status: 'running',
      team: { lead: 'agent-x', members: [] },
      // Level 5: nothing is gated, so every task runs straight through.
      autonomyPolicy: { level: 5 },
      plan: {
        tasks: tasks.map(t => ({ ...t, ownerAgentSlug: 'agent-x', type: 'analysis' as const, status: 'pending' as const })),
      },
    })
    .returning({ id: missionRunSchema.id });
  return row!.id;
}

async function readRun(id: number) {
  const [row] = await db.select().from(missionRunSchema).where(eq(missionRunSchema.id, id));
  return { row: row!, tasks: new Map(row!.plan!.tasks.map(t => [t.id, t])) };
}

/**
 * The task title inside a task message (`missions/runtime.ts` taskMessage).
 * @param message - What the loop sent the agent.
 */
function taskTitleOf(message: string): string {
  return /Your task: (.+)/.exec(message)?.[1] ?? '';
}

/**
 * Which task titles the mocked agent was asked to work, in order.
 */
function titlesRun(): string[] {
  return mockRunAgent.mock.calls.map(([args]) => taskTitleOf(args.message));
}

/**
 * Stand-in for an agent turn: fails the tasks named in `failingTitles`, completes the rest.
 * @param args - The turn the loop asked for.
 * @param args.message - The task message.
 */
async function fakeAgentTurn(args: { message: string }): Promise<never> {
  const title = taskTitleOf(args.message);
  if (failingTitles.has(title)) {
    throw new Error(`${title} broke`);
  }
  return { response: `${title} done`, traceId: 'trace', toolCalls: [] } as never;
}

beforeEach(async () => {
  await db.delete(missionRunSchema);
  failingTitles = new Set();
  mockRunAgent.mockReset();
  mockRunAgent.mockImplementation(fakeAgentTurn);
});

afterAll(async () => {
  await db.delete(missionRunSchema);
});

describe('executeMissionRun when a task cannot run', () => {
  it('skips every task downstream of a failed task and ends the run failed', async () => {
    failingTitles = new Set(['Research']);
    const id = await seedRun([
      { id: 'research', title: 'Research' },
      { id: 'draft', title: 'Draft', dependsOn: ['research'] },
      { id: 'review', title: 'Review', dependsOn: ['draft'] },
      { id: 'logo', title: 'Logo' },
    ]);

    const status = await executeMissionRun(id, ORG);
    const { row, tasks } = await readRun(id);

    expect(status).toBe('failed');
    expect(row.status).toBe('failed');
    expect(row.completedAt).not.toBeNull();
    expect(tasks.get('research')!.status).toBe('failed');
    expect(tasks.get('draft')!.status).toBe('skipped');
    expect(tasks.get('draft')!.error).toBe('Skipped: it depends on "Research", which failed.');
    // Two steps from the failure, it still names the task it was waiting on.
    expect(tasks.get('review')!.status).toBe('skipped');
    expect(tasks.get('review')!.error).toBe('Skipped: it depends on "Draft", which was skipped.');
    // A task with no link to the failure still ran.
    expect(tasks.get('logo')!.status).toBe('completed');
    expect(titlesRun()).toEqual(['Research', 'Logo']);
  });

  it('runs a task listed before the task it depends on', async () => {
    const id = await seedRun([
      { id: 'draft', title: 'Draft', dependsOn: ['research'] },
      { id: 'research', title: 'Research' },
    ]);

    const status = await executeMissionRun(id, ORG);

    expect(status).toBe('completed');
    expect(titlesRun()).toEqual(['Research', 'Draft']);

    const { tasks } = await readRun(id);

    expect(tasks.get('draft')!.status).toBe('completed');
  });

  it('fails the run, not completes it, when a task depends on one the plan does not have', async () => {
    const id = await seedRun([
      { id: 'research', title: 'Research' },
      { id: 'draft', title: 'Draft', dependsOn: ['made-up-task'] },
    ]);

    const status = await executeMissionRun(id, ORG);
    const { row, tasks } = await readRun(id);

    expect(status).toBe('failed');
    expect(row.error).toBe('one or more tasks could not run because a task they depend on never completed');
    expect(tasks.get('research')!.status).toBe('completed');
    expect(tasks.get('draft')!.status).toBe('skipped');
    expect(tasks.get('draft')!.error).toBe('Skipped: it depends on "made-up-task", which is not in the plan.');
  });

  it('ends a run whose tasks depend on each other instead of waiting for ever', async () => {
    const id = await seedRun([
      { id: 'a', title: 'A', dependsOn: ['b'] },
      { id: 'b', title: 'B', dependsOn: ['a'] },
    ]);

    const status = await executeMissionRun(id, ORG);
    const { tasks } = await readRun(id);

    expect(status).toBe('failed');
    expect(mockRunAgent).not.toHaveBeenCalled();
    expect(tasks.get('a')!.status).toBe('skipped');
    expect(tasks.get('b')!.status).toBe('skipped');
  });

  it('gives the loop reason only to the tasks in the loop, and says what a task waiting on the loop was waiting on', async () => {
    const id = await seedRun([
      { id: 'a', title: 'A', dependsOn: ['b'] },
      { id: 'b', title: 'B', dependsOn: ['a'] },
      { id: 'c', title: 'C', dependsOn: ['a'] },
    ]);

    await executeMissionRun(id, ORG);
    const { tasks } = await readRun(id);

    expect(tasks.get('a')!.error).toMatch(/also depend on it/);
    expect(tasks.get('b')!.error).toMatch(/also depend on it/);
    expect(tasks.get('c')!.status).toBe('skipped');
    expect(tasks.get('c')!.error).toBe('Skipped: it depends on "A", which was skipped.');
  });

  it('runs both of two tasks that share an id, as in a plan saved before ids were made unique', async () => {
    const id = await seedRun([
      { id: 't2', title: 'Research' },
      { id: 't2', title: 'Draft' },
    ]);

    const status = await executeMissionRun(id, ORG);

    expect(status).toBe('completed');
    expect(titlesRun()).toEqual(['Research', 'Draft']);
  });

  it('still completes a run whose tasks all succeed', async () => {
    const id = await seedRun([
      { id: 'research', title: 'Research' },
      { id: 'draft', title: 'Draft', dependsOn: ['research'] },
    ]);

    const status = await executeMissionRun(id, ORG);
    const { row } = await readRun(id);

    expect(status).toBe('completed');
    expect(row.error).toBeNull();
    expect(titlesRun()).toEqual(['Research', 'Draft']);
  });
});
