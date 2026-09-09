/**
 * The mission-run report helpers behind `/api/v1/missions/:slug/runs` and
 * `/api/v1/mission-runs/:id` (VEERIO-252). Before this route existed, the
 * agent's own report of what a task did — or why it proposed nothing — sat
 * only in `mission_run.plan.tasks[].output`, unreachable except by psql.
 * These tests pin the shape and the org/mission scoping, against PGlite.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { missionSchema, missionRunSchema } = await import('@/models/Schema');
const { getMissionRunReport, listMissionRunReportsForMission } = await import('@/services/MissionService');

const ORG = 'org_mission_reports';
const OTHER_ORG = 'org_mission_reports_other';

async function makeMission(slug: string, orgId = ORG): Promise<number> {
  const [row] = await db
    .insert(missionSchema)
    .values({
      orgId,
      slug,
      name: `Mission ${slug}`,
      goal: 'do the thing',
      agentSlug: 'event-ingestion-lead',
    })
    .returning({ id: missionSchema.id });
  return row!.id;
}

async function makeRun(opts: {
  missionId: number | null;
  orgId?: string;
  status?: string;
  error?: string | null;
  createdBy?: string;
  tasks?: Array<{ id: string; title: string; status: string; output?: string; error?: string }>;
}): Promise<number> {
  const [row] = await db
    .insert(missionRunSchema)
    .values({
      orgId: opts.orgId ?? ORG,
      missionId: opts.missionId,
      title: 'A run',
      brief: 'do the thing now',
      status: opts.status ?? 'completed',
      error: opts.error ?? null,
      createdBy: opts.createdBy ?? 'user_drew',
      team: { lead: 'event-ingestion-lead', members: [] },
      plan: {
        tasks: (opts.tasks ?? [{ id: 't1', title: 'Task one', ownerAgentSlug: 'event-ingestion-lead', type: 'action', status: 'completed' }]) as never,
      },
    })
    .returning({ id: missionRunSchema.id });
  return row!.id;
}

beforeEach(async () => {
  await db.delete(missionRunSchema);
  await db.delete(missionSchema);
});

afterAll(async () => {
  await db.delete(missionRunSchema);
  await db.delete(missionSchema);
});

describe('getMissionRunReport', () => {
  it('resolves the mission slug through the mission template', async () => {
    const missionId = await makeMission('veerio-event-ingestion');
    const runId = await makeRun({
      missionId,
      tasks: [{ id: 't1', title: 'Ingest events', status: 'failed', error: 'no matching skill', output: 'File \'/playbooks/veerio-event-ingestion/SKILL.md\' not found ... 0 proposals' }],
    });

    const report = await getMissionRunReport(runId, ORG);

    expect(report).toMatchObject({
      id: runId,
      missionSlug: 'veerio-event-ingestion',
      status: 'completed',
      error: null,
      invokedBy: 'user_drew',
    });
    expect(report!.plan.tasks[0]).toMatchObject({
      status: 'failed',
      error: 'no matching skill',
    });
    expect(report!.plan.tasks[0]!.output).toContain('0 proposals');
  });

  it('reports a null missionSlug for an ad-hoc run with no template', async () => {
    const runId = await makeRun({ missionId: null });

    const report = await getMissionRunReport(runId, ORG);

    expect(report!.missionSlug).toBeNull();
  });

  it('returns null for a run in another org rather than leaking it', async () => {
    const missionId = await makeMission('cross-org-mission', OTHER_ORG);
    const runId = await makeRun({ missionId, orgId: OTHER_ORG });

    expect(await getMissionRunReport(runId, ORG)).toBeNull();
  });

  it('returns null for a run id that does not exist', async () => {
    expect(await getMissionRunReport(999_999, ORG)).toBeNull();
  });
});

describe('listMissionRunReportsForMission', () => {
  it('returns null when the mission slug does not exist in this org', async () => {
    expect(await listMissionRunReportsForMission(ORG, 'no-such-mission', 50)).toBeNull();
  });

  it('returns null for a mission that exists only in another org', async () => {
    await makeMission('other-org-mission', OTHER_ORG);

    expect(await listMissionRunReportsForMission(ORG, 'other-org-mission', 50)).toBeNull();
  });

  it('returns an empty list for a mission with no runs yet', async () => {
    await makeMission('fresh-mission');

    expect(await listMissionRunReportsForMission(ORG, 'fresh-mission', 50)).toEqual([]);
  });

  it('lists only this mission\'s runs, newest first, with plan.tasks[0].output populated', async () => {
    const missionId = await makeMission('veerio-event-ingestion');
    const otherMissionId = await makeMission('unrelated-mission');
    const olderRunId = await makeRun({ missionId, tasks: [{ id: 't1', title: 'first pass', status: 'completed', output: 'found 3, refreshed 3, failed 0' }] });
    await new Promise(resolve => setTimeout(resolve, 5));
    const newerRunId = await makeRun({ missionId, tasks: [{ id: 't1', title: 'second pass', status: 'completed', output: 'found 5, refreshed 2, failed 1' }] });
    await makeRun({ missionId: otherMissionId });

    const reports = await listMissionRunReportsForMission(ORG, 'veerio-event-ingestion', 50);

    expect(reports).not.toBeNull();
    expect(reports!.map(r => r.id)).toEqual([newerRunId, olderRunId]);
    expect(reports!.every(r => r.missionSlug === 'veerio-event-ingestion')).toBe(true);
    expect(reports![0]!.plan.tasks[0]!.output).toBe('found 5, refreshed 2, failed 1');
  });

  it('clamps to the requested limit', async () => {
    const missionId = await makeMission('veerio-event-ingestion');
    for (let i = 0; i < 3; i++) {
      await makeRun({ missionId });
    }

    const reports = await listMissionRunReportsForMission(ORG, 'veerio-event-ingestion', 2);

    expect(reports).toHaveLength(2);
  });
});
