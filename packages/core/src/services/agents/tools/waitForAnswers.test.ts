/**
 * What `wait_for_answers` parks: the mission run when it has tasks left, else
 * the scheduled automation whose check this is, else nothing — an event fire
 * is never held, and a run in another workspace is not found.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { automationSchema, missionRunSchema } = await import('@/models/Schema');
const { parkTargetFor, waitForAnswersTools } = await import('./waitForAnswers');

const ORG = 'org_wait_a';

type Task = { id: string; title: string; ownerAgentSlug: string; type: 'analysis'; status: 'pending' | 'running' | 'completed' };

async function run(tasks: Task[], causedBy: Array<{ automationSlug: string }> | null = null) {
  const [row] = await db.insert(missionRunSchema).values({ orgId: ORG, title: 'Check', brief: 'b', status: 'running', team: { lead: 'revenue-lead', members: [] }, plan: { tasks }, causedBy }).returning();
  return row!;
}

const task = (id: string, status: Task['status']): Task => ({ id, title: id, ownerAgentSlug: 'revenue-lead', type: 'analysis', status });

beforeEach(async () => {
  await db.delete(missionRunSchema);
  await db.delete(automationSchema);
  await db.insert(automationSchema).values([
    { orgId: ORG, slug: 'monday-check', name: 'Monday check', whenConfig: { schedule: '0 13 * * 1' }, doConfig: { checkMission: 'pipeline' } },
    { orgId: ORG, slug: 'on-reply', name: 'On reply', whenConfig: { event: 'prospect.reply' }, doConfig: { checkMission: 'pipeline' } },
  ]);
});

describe('parkTargetFor', () => {
  it('parks the run itself while it has tasks left — holding its schedule too when one fired it', async () => {
    const r = await run([task('t1', 'running'), task('t2', 'pending')], [{ automationSlug: 'monday-check' }]);

    expect(await parkTargetFor(ORG, r.id)).toEqual({ kind: 'mission_run', id: r.id, automationSlug: 'monday-check' });
  });

  it('parks the scheduled automation when the check has nothing left after this turn', async () => {
    const r = await run([task('scheduled-check', 'running')], [{ automationSlug: 'monday-check' }]);

    expect(await parkTargetFor(ORG, r.id)).toEqual({ kind: 'automation', slug: 'monday-check' });
  });

  it('parks nothing for an event fire or an ad-hoc run with nothing left, and finds no run in another workspace', async () => {
    const evented = await run([task('scheduled-check', 'running')], [{ automationSlug: 'on-reply' }]);
    const adHoc = await run([task('t1', 'running')]);

    expect(await parkTargetFor(ORG, evented.id)).toBeNull();
    expect(await parkTargetFor(ORG, adHoc.id)).toBeNull();
    expect(await parkTargetFor('org_wait_b', adHoc.id)).toBeNull();
  });
});

describe('waitForAnswersTools', () => {
  it('is only offered inside a mission run', () => {
    const base = { orgId: ORG, connectorSources: [], emit: () => {} } as never;

    expect(waitForAnswersTools(base)).toHaveLength(0);
    expect(waitForAnswersTools({ ...(base as object), missionRunId: 4 } as never).map(t => t.name)).toEqual(['wait_for_answers']);
  });
});
