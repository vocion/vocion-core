/**
 * Writing a run's case rows, twice.
 *
 * `persistTranscripts` is the one write in the eval path that genuinely runs
 * more than once for the same work: a Temporal activity is at-least-once, and
 * a retry reuses the run it finds through its run group. So it clears the
 * run's rows and writes them again, and the rule that matters is that those
 * two statements are one thing. A delete that lands while the insert fails
 * would leave a finished-looking run holding no cases at all — worse than the
 * duplicate rows the delete exists to prevent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { evalCaseResultSchema, evalDatasetSchema, evalRunSchema } = await import('@/models/Schema');
const { persistTranscripts } = await import('./transcripts');
const { eq } = await import('drizzle-orm');

const ORG = 'org_persist_transcripts';

/**
 * One case as the runner hands it over.
 * @param itemIndex - Which case in the dataset this is.
 */
function transcript(itemIndex: number) {
  return {
    itemIndex,
    item: { input: `case ${itemIndex}` },
    output: 'here you go',
    errored: false,
    traceId: `trace-${itemIndex}`,
    latencyMs: 12,
    usage: { inputTokens: 1, outputTokens: 1, cents: 0, turns: 1 },
    trajectory: ['issue_refund'],
  };
}

async function seedRun(): Promise<number> {
  const [dataset] = await db.insert(evalDatasetSchema).values({
    orgId: ORG,
    slug: 'refund-quality',
    name: 'Refund quality',
    agentSlug: 'support-agent',
    items: [{ input: 'case 0' }, { input: 'case 1' }],
  }).returning({ id: evalDatasetSchema.id });
  const [run] = await db.insert(evalRunSchema).values({
    orgId: ORG,
    datasetId: dataset!.id,
    agentSlug: 'support-agent',
    status: 'running',
  }).returning({ id: evalRunSchema.id });
  return run!.id;
}

beforeEach(async () => {
  await db.delete(evalCaseResultSchema);
  await db.delete(evalRunSchema);
  await db.delete(evalDatasetSchema);
});

describe('persistTranscripts', () => {
  it('replaces a dead attempt\'s rows instead of adding to them', async () => {
    const runId = await seedRun();
    await persistTranscripts(runId, [transcript(0), transcript(1)] as never);
    await persistTranscripts(runId, [transcript(0), transcript(1)] as never);

    const rows = await db.select().from(evalCaseResultSchema).where(eq(evalCaseResultSchema.runId, runId));

    // Two cases ran, so the run holds two rows however many attempts it took.
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.itemIndex).sort()).toEqual([0, 1]);
  });

  it('keeps the previous rows when the rewrite fails partway', async () => {
    const runId = await seedRun();
    await persistTranscripts(runId, [transcript(0), transcript(1)] as never);
    const before = await db.select().from(evalCaseResultSchema).where(eq(evalCaseResultSchema.runId, runId));

    // The second case has no item index, which the column refuses. The delete
    // has already run by then, so without one transaction around both the run
    // would be left with nothing.
    const broken = [transcript(0), { ...transcript(1), itemIndex: undefined }];

    await expect(persistTranscripts(runId, broken as never)).rejects.toThrow();

    const after = await db.select().from(evalCaseResultSchema).where(eq(evalCaseResultSchema.runId, runId));

    expect(after.map(row => row.id).sort()).toEqual(before.map(row => row.id).sort());
  });

  it('records each row id against the case it belongs to', async () => {
    const runId = await seedRun();
    const transcripts = [transcript(0), transcript(1)];

    await persistTranscripts(runId, transcripts as never);

    const rows = await db.select().from(evalCaseResultSchema).where(eq(evalCaseResultSchema.runId, runId));
    const idByItemIndex = new Map(rows.map(row => [row.itemIndex, row.id]));

    // Scores are attached by this id, so a mismatch here files every case's
    // verdict against the wrong case.
    for (const written of transcripts as Array<{ itemIndex: number; caseResultId?: number }>) {
      expect(written.caseResultId).toBe(idByItemIndex.get(written.itemIndex));
    }
  });
});
