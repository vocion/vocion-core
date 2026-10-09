/**
 * A Done line read back says what its run is now — scoped to the workspace.
 * Fixtures are fictional (Northwind).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema } = await import('@/models/Schema');
const { withLiveReceipts } = await import('./liveReceipts');

const ORG = 'org_live_receipts';

beforeEach(async () => {
  await db.delete(actionRunSchema);
});

describe('withLiveReceipts', () => {
  it('marks a receipt whose run was undone since, and leaves the rest as stored', async () => {
    const [undone] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'apps.install', input: {}, status: 'undone' }).returning();
    const [done] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'team.hire_agent', input: {}, status: 'done' }).returning();
    const rows = [
      { id: 1, runsJson: [{ type: 'text', text: 'Added.' }, { type: 'receipt', receipt: { runId: undone!.id, actionId: 'apps.install', label: 'Add Software Factory', undoable: true } }] },
      { id: 2, runsJson: [{ type: 'receipt', receipt: { runId: done!.id, actionId: 'team.hire_agent', label: 'Hire Reporting Analyst', undoable: true } }] },
      { id: 3, runsJson: null },
    ];

    const out = await withLiveReceipts(ORG, rows);

    expect((out[0]!.runsJson as Array<{ receipt?: { status?: string } }>)[1]!.receipt!.status).toBe('undone');
    expect(out[1]).toBe(rows[1]);
    expect(out[2]).toBe(rows[2]);
  });

  it('never reads another workspace\'s runs', async () => {
    const [theirs] = await db.insert(actionRunSchema).values({ orgId: 'org_someone_else', actionId: 'apps.install', input: {}, status: 'undone' }).returning();
    const rows = [{ runsJson: [{ type: 'receipt', receipt: { runId: theirs!.id, actionId: 'apps.install', label: 'Add', undoable: true } }] }];

    expect(await withLiveReceipts(ORG, rows)).toBe(rows);
  });
});
