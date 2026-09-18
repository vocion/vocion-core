/**
 * The eval pass rate that sits beside the agreement rate on an agent's row.
 *
 * It is the one number on that row nobody voted on, so the ways it can lie
 * matter: a run that never finished has no pass rate and must not read as
 * zero, two graders of the same agent are two separate readings rather than an
 * average, and only the newest run from each grader is current.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ auth: vi.fn() }));

const { db } = await import('@/libs/DB');
const {
  evalDatasetSchema,
  evalRunSchema,
  projectSchema,
  tenantAccountSchema,
  userActivityEventSchema,
  userSchema,
} = await import('@/models/Schema');
const { getAgentRows } = await import('./AdoptionService');

const ORG = 'proj_evalscore_a';
const ACCT = 'acct_evalscore';
const AGENT = 'proposal-writer';

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

/**
 * The agent only appears on the adoption page if it has traffic, so every test
 * needs one event to hang the row off.
 */
async function giveTheAgentSomeTraffic() {
  await db.insert(userActivityEventSchema).values({
    orgId: ORG,
    userId: 'usr-e1',
    eventType: 'chat.message_sent',
    agentSlug: AGENT,
    metadata: {},
    createdAt: daysAgo(1),
  });
}

async function insertRun(values: {
  datasetId: number;
  provider: string;
  status: string;
  passRate: number | null;
  startedAt: Date;
}) {
  const [run] = await db.insert(evalRunSchema).values({
    orgId: ORG,
    datasetId: values.datasetId,
    agentSlug: AGENT,
    provider: values.provider,
    status: values.status,
    metrics: values.passRate === null ? {} : { passRate: values.passRate },
    startedAt: values.startedAt,
  }).returning({ id: evalRunSchema.id });
  return run!.id;
}

let datasetId: number;

beforeEach(async () => {
  await db.delete(evalRunSchema);
  await db.delete(evalDatasetSchema);
  await db.delete(userActivityEventSchema);
  await db.delete(userSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.insert(tenantAccountSchema).values({ id: ACCT, name: 'A', slug: 'evalscore-a' });
  await db.insert(projectSchema).values({ id: ORG, accountId: ACCT, slug: 'evalscore-a', name: 'A' });
  await db.insert(userSchema).values({ id: 'usr-e1', name: 'Eve', email: 'eve@a.test' });
  const [dataset] = await db.insert(evalDatasetSchema).values({
    orgId: ORG,
    slug: 'pw-quality',
    name: 'PW quality',
    agentSlug: AGENT,
    items: [{ input: 'x' }],
  }).returning({ id: evalDatasetSchema.id });
  datasetId = dataset!.id;
  await giveTheAgentSomeTraffic();
});

describe('getAgentRows evalScores', () => {
  it('reports the newest finished run, not the newest run', async () => {
    await insertRun({ datasetId, provider: 'vocion', status: 'succeeded', passRate: 0.8, startedAt: daysAgo(3) });
    await insertRun({ datasetId, provider: 'vocion', status: 'running', passRate: null, startedAt: daysAgo(1) });

    const [row] = await getAgentRows(ORG, 30);

    expect(row?.evalScores).toHaveLength(1);
    expect(row?.evalScores[0]?.passRate).toBe(0.8);
  });

  it('keeps each grader as its own reading rather than averaging them', async () => {
    await insertRun({ datasetId, provider: 'vocion', status: 'succeeded', passRate: 0.9, startedAt: daysAgo(2) });
    await insertRun({ datasetId, provider: 'agentcore', status: 'succeeded', passRate: 0.4, startedAt: daysAgo(2) });

    const [row] = await getAgentRows(ORG, 30);

    const byProvider = Object.fromEntries((row?.evalScores ?? []).map(score => [score.provider, score.passRate]));

    expect(byProvider).toEqual({ vocion: 0.9, agentcore: 0.4 });
  });

  it('takes the latest run from each grader', async () => {
    await insertRun({ datasetId, provider: 'vocion', status: 'succeeded', passRate: 0.2, startedAt: daysAgo(9) });
    const newest = await insertRun({ datasetId, provider: 'vocion', status: 'succeeded', passRate: 0.75, startedAt: daysAgo(1) });

    const [row] = await getAgentRows(ORG, 30);

    expect(row?.evalScores[0]?.runId).toBe(newest);
    expect(row?.evalScores[0]?.passRate).toBe(0.75);
  });

  it('never shows another workspace\'s eval score', async () => {
    // Same agent slug in both workspaces, which is ordinary — the slug is
    // scoped to a workspace, so a score must not cross that line.
    const otherOrg = 'proj_evalscore_other';
    await db.insert(projectSchema).values({ id: otherOrg, accountId: ACCT, slug: 'evalscore-b', name: 'B' });
    const [otherDataset] = await db.insert(evalDatasetSchema).values({
      orgId: otherOrg,
      slug: 'their-dataset',
      name: 'Theirs',
      agentSlug: AGENT,
      items: [{ input: 'x' }],
    }).returning({ id: evalDatasetSchema.id });
    await db.insert(evalRunSchema).values({
      orgId: otherOrg,
      datasetId: otherDataset!.id,
      agentSlug: AGENT,
      provider: 'vocion',
      status: 'succeeded',
      metrics: { passRate: 0.11 },
      startedAt: daysAgo(1),
    });
    await insertRun({ datasetId, provider: 'vocion', status: 'succeeded', passRate: 0.99, startedAt: daysAgo(2) });

    const [row] = await getAgentRows(ORG, 30);

    expect(row?.evalScores.map(score => score.passRate)).toEqual([0.99]);
  });

  it('leaves the list empty for an agent that has never been evaluated', async () => {
    const [row] = await getAgentRows(ORG, 30);

    expect(row?.evalScores).toEqual([]);
  });
});
