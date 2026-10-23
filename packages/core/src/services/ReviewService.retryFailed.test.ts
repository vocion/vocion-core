/**
 * A failed run's page says "fix the connection, then press the button again".
 * Pressing it approves with the card's choices, which is an edit. These pin
 * that the press works when the failure is recoverable, keeps the failure in
 * the run's history, and is still refused, with the reason, when it is not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/libs/DB');
vi.mock('@/services/MissionService', () => ({ cancelMission: vi.fn(), resumeMission: vi.fn() }));
vi.mock('@/services/SkillService', () => ({ approveSkillRun: vi.fn(), rejectSkillRun: vi.fn() }));
vi.mock('@/services/WorkflowService', () => ({ cancelWorkflow: vi.fn(), resumeWorkflow: vi.fn() }));

const { db } = await import('@/libs/DB');
const { actionRunSchema } = await import('@/models/Schema');
const { registerAction } = await import('@/libs/actions/registry');
const { decide } = await import('@/services/ReviewService');
const { updateActionInput } = await import('@/services/ActionService');
const { failedAttemptsOf } = await import('@/libs/actions/failureRecovery');
const { eq } = await import('drizzle-orm');

const ORG = 'org_retry_failed';
const REVIEWER = 'user_reviewer';
const SCOPE_403 = 'Gmail draft failed: 403 { "error": { "code": 403, "status": "PERMISSION_DENIED", "details": [ { "reason": "ACCESS_TOKEN_SCOPE_INSUFFICIENT" } ] } }';

const ran: Array<Record<string, unknown>> = [];

// Named in the gmail family so the permission reading knows its connector.
registerAction({
  id: 'gmail.test-draft',
  name: 'Test draft',
  description: 'test',
  inputSchema: z.object({ to: z.string(), body: z.string(), mode: z.enum(['draft', 'send']).optional() }),
  grant: 'test_write',
  external: true,
  execute: async (_ctx, input) => {
    ran.push(input as Record<string, unknown>);
    return { draftId: 'draft-1' };
  },
} as Parameters<typeof registerAction>[0]);

async function failedRun(error: string): Promise<number> {
  const [row] = await db
    .insert(actionRunSchema)
    .values({
      orgId: ORG,
      actionId: 'gmail.test-draft',
      status: 'failed',
      error,
      executedAt: new Date('2026-01-05T10:00:00Z'),
      decidedBy: REVIEWER,
      invokedBy: 'agent:revenue-lead',
      input: { to: 'pat@example.test', body: 'Thanks for the time.' },
      proposal: { confidence: 0.75 },
    })
    .returning({ id: actionRunSchema.id });
  return row!.id;
}

async function rowOf(runId: number) {
  const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, runId)).limit(1);
  return row!;
}

beforeEach(async () => {
  vi.clearAllMocks();
  ran.length = 0;
  await db.delete(actionRunSchema);
});

describe('pressing the button again on a failed run', () => {
  it('runs the edited copy once the connection is fixed, and keeps the failure', async () => {
    const runId = await failedRun(SCOPE_403);
    const edited = { to: 'pat@example.test', body: 'Thanks for the time.', mode: 'draft' };

    const out = await decide({ kind: 'action', id: runId }, 'approve', ORG, { reviewedBy: REVIEWER, editedInput: edited });

    expect(out.execution).toMatchObject({ status: 'done', error: null });
    expect(ran).toEqual([edited]);

    const row = await rowOf(runId);

    expect(row).toMatchObject({ status: 'done', error: null, input: edited });
    expect(row.result).toMatchObject({ draftId: 'draft-1' });
    expect(failedAttemptsOf(row.result)).toEqual([{ at: '2026-01-05T10:00:00.000Z', error: SCOPE_403 }]);
  });

  it('runs it again unedited too, keeping the failure', async () => {
    const runId = await failedRun(SCOPE_403);

    const out = await decide({ kind: 'action', id: runId }, 'approve', ORG, { reviewedBy: REVIEWER });

    expect(out.execution?.status).toBe('done');
    expect(failedAttemptsOf((await rowOf(runId)).result)).toHaveLength(1);
  });

  it('refuses an edit to a run that failed in a way that may have changed something, and says why', async () => {
    const runId = await failedRun('The record was half written');

    await expect(decide({ kind: 'action', id: runId }, 'approve', ORG, { reviewedBy: REVIEWER, editedInput: { to: 'pat@example.test', body: 'x' } }))
      .rejects
      .toMatchObject({ code: 'INVALID_STATE', message: expect.stringMatching(/cannot be edited and run again: .*safe to repeat/) });
    expect(ran).toEqual([]);
    expect(await rowOf(runId)).toMatchObject({ status: 'failed', error: 'The record was half written' });
  });
});

describe('editing a failed run without approving it', () => {
  it('puts a recoverable one back to pending with the failure kept', async () => {
    const runId = await failedRun(SCOPE_403);

    await updateActionInput(runId, ORG, { to: 'pat@example.test', body: 'Shorter.' });

    const row = await rowOf(runId);

    expect(row).toMatchObject({ status: 'pending', error: null, input: { to: 'pat@example.test', body: 'Shorter.' } });
    expect(failedAttemptsOf(row.result)).toHaveLength(1);
  });

  it('still refuses a run that is done', async () => {
    const runId = await failedRun(SCOPE_403);
    await db.update(actionRunSchema).set({ status: 'done', error: null }).where(eq(actionRunSchema.id, runId));

    await expect(updateActionInput(runId, ORG, { to: 'pat@example.test', body: 'x' })).rejects.toMatchObject({ code: 'INVALID_STATE', message: expect.stringContaining('not pending') });
  });
});
