import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
/**
 * The review decide path and read path for an item whose recommendation was
 * overtaken (`Action.stillHolds`): approve answers `stale` before anything is
 * recorded, `overrideStale` runs it, and the item read carries `stale`.
 */
import { z } from 'zod';

vi.mock('@/libs/DB');
vi.mock('@/services/MissionService', () => ({ cancelMission: vi.fn(), resumeMission: vi.fn() }));
vi.mock('@/services/SkillService', () => ({ approveSkillRun: vi.fn(), rejectSkillRun: vi.fn() }));
vi.mock('@/services/WorkflowService', () => ({ cancelWorkflow: vi.fn(), resumeWorkflow: vi.fn() }));
const audit = vi.hoisted(() => ({ approvedCopy: vi.fn(async () => {}), voiceEdits: vi.fn(async () => {}), pins: vi.fn(async () => []) }));
vi.mock('@/services/review/contentRecord', async importOriginal => ({ ...await importOriginal<typeof import('@/services/review/contentRecord')>(), recordApprovedRevisions: audit.approvedCopy }));
vi.mock('@/services/feedback/voiceLearning', async importOriginal => ({ ...await importOriginal<typeof import('@/services/feedback/voiceLearning')>(), recordVoiceEdits: audit.voiceEdits }));
vi.mock('@/services/personalization/artifacts', async importOriginal => ({ ...await importOriginal<typeof import('@/services/personalization/artifacts')>(), pinLeadArtifactsForRun: audit.pins }));

const { db } = await import('@/libs/DB');
const { actionRunSchema } = await import('@/models/Schema');
const { registerAction } = await import('@/libs/actions/registry');
const { decide, getReviewDetail } = await import('@/services/ReviewService');
const { eq } = await import('drizzle-orm');
const { StaleError } = await import('@/libs/actions/stale');

let moved = false;
let checks = 0;
let executed = 0;
let raiseOnExecute = false;
registerAction({
  id: 'test.review-stale',
  name: 'Test review stale',
  description: 'test',
  inputSchema: z.object({ value: z.string() }),
  grant: 'test_write',
  external: true,
  stillHolds: async () => {
    checks += 1;
    return moved ? { line: 'Dana Reyes wrote again on Oct 30', href: 'https://mail.example.test/t/1', keepOpen: true } : null;
  },
  applyContentEdits: input => input,
  execute: async () => {
    if (raiseOnExecute) {
      throw new StaleError({ line: 'Already in a sequence since Oct 25', code: 'already_enrolled:5501' });
    }
    executed += 1;
    return { ok: true };
  },
});

const ORG = 'org_rev_stale';
async function pending(): Promise<number> {
  const [r] = await db
    .insert(actionRunSchema)
    .values({ orgId: ORG, actionId: 'test.review-stale', input: { value: 'x' }, status: 'pending', proposal: { basis: { latest: 'm1' }, basisAt: '2026-10-25T10:00:00.000Z' } as never })
    .returning({ id: actionRunSchema.id });
  return r!.id;
}

beforeEach(async () => {
  await db.delete(actionRunSchema);
  moved = false;
  checks = 0;
  executed = 0;
  raiseOnExecute = false;
  audit.approvedCopy.mockClear();
  audit.voiceEdits.mockClear();
  audit.pins.mockClear();
});

afterAll(async () => {
  await db.delete(actionRunSchema);
});

describe('decide × stale', () => {
  it('approve answers stale with the line, runs nothing, and the item stays pending', async () => {
    const id = await pending();
    moved = true;
    const out = await decide({ kind: 'action', id }, 'approve', ORG, { reviewedBy: 'user_avery' });

    expect(out.execution).toMatchObject({ status: 'stale', error: 'Dana Reyes wrote again on Oct 30', stale: { line: 'Dana Reyes wrote again on Oct 30', href: 'https://mail.example.test/t/1', canRedraft: false } });
    expect(executed).toBe(0);
    expect(checks).toBe(1);

    const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, id));

    expect(row).toMatchObject({ status: 'pending', decidedBy: null });
  });

  it('approve with overrideStale runs it and records that the person proceeded', async () => {
    const id = await pending();
    moved = true;
    await decide({ kind: 'action', id }, 'approve', ORG, { reviewedBy: 'user_avery' });
    const out = await decide({ kind: 'action', id }, 'approve', ORG, { reviewedBy: 'user_avery', overrideStale: true });

    expect(out.execution?.status).toBe('done');
    expect(executed).toBe(1);

    const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, id));

    expect(row?.result).toMatchObject({ proceededPastStale: { line: 'Dana Reyes wrote again on Oct 30', by: 'user_avery' } });
  });

  it('approve of an item that still holds checks once and runs', async () => {
    const id = await pending();
    const out = await decide({ kind: 'action', id }, 'approve', ORG, { reviewedBy: 'user_avery' });

    expect(out.execution?.status).toBe('done');
    expect(checks).toBe(1);
  });
});

describe('read × stale', () => {
  it('the item read carries stale, and a second read within minutes answers from the stored check', async () => {
    const id = await pending();
    moved = true;
    const first = await getReviewDetail(ORG, 'action', id);

    expect(first?.stale).toMatchObject({ line: 'Dana Reyes wrote again on Oct 30', keepOpen: true });
    expect(typeof first?.stale?.checkedAt).toBe('string');

    const second = await getReviewDetail(ORG, 'action', id);

    expect(second?.stale?.line).toBe('Dana Reyes wrote again on Oct 30');
    expect(checks).toBe(1);
  });

  it('a decided item is not checked', async () => {
    const id = await pending();
    await db.update(actionRunSchema).set({ status: 'done' }).where(eq(actionRunSchema.id, id));
    moved = true;
    const read = await getReviewDetail(ORG, 'action', id);

    expect(read?.stale).toBeNull();
    expect(checks).toBe(0);
  });
});

describe('the audit trail is filed only once the approve ran', () => {
  it('an approve answered stale by the action as it ran files no approved copy, voice diff or pin; Proceed anyway files each once', async () => {
    const id = await pending();
    raiseOnExecute = true;
    const first = await decide({ kind: 'action', id }, 'approve', ORG, { reviewedBy: 'user_avery', editedInput: { value: 'edited' } });

    expect(first.execution?.status).toBe('stale');
    expect(audit.approvedCopy).not.toHaveBeenCalled();
    expect(audit.voiceEdits).not.toHaveBeenCalled();
    expect(audit.pins).not.toHaveBeenCalled();

    raiseOnExecute = false;
    const second = await decide({ kind: 'action', id }, 'approve', ORG, { reviewedBy: 'user_avery', editedInput: { value: 'edited again' }, overrideStale: true, staleFingerprint: first.execution!.stale!.fingerprint });

    expect(second.execution?.status).toBe('done');
    expect(audit.approvedCopy).toHaveBeenCalledTimes(1);
    expect(audit.voiceEdits).toHaveBeenCalledTimes(1);
    expect((audit.voiceEdits.mock.calls[0] as unknown as [unknown])[0]).toMatchObject({ before: { value: 'edited' }, after: { value: 'edited again' } });
    expect(audit.pins).toHaveBeenCalledTimes(1);
  });

  it('an approve answered stale before running files nothing', async () => {
    const id = await pending();
    moved = true;
    await decide({ kind: 'action', id }, 'approve', ORG, { reviewedBy: 'user_avery', editedInput: { value: 'edited' } });

    expect(audit.approvedCopy).not.toHaveBeenCalled();
    expect(audit.voiceEdits).not.toHaveBeenCalled();
    expect(audit.pins).not.toHaveBeenCalled();
  });
});

describe('background reads never call out', () => {
  it('getReviewDetail with liveStale: false serves the stored finding and makes no check', async () => {
    const id = await pending();
    moved = true;
    const none = await getReviewDetail(ORG, 'action', id, { liveStale: false });

    expect(none?.stale).toBeNull();
    expect(checks).toBe(0);

    await getReviewDetail(ORG, 'action', id);
    const stored = await getReviewDetail(ORG, 'action', id, { liveStale: false });

    expect(stored?.stale?.line).toBe('Dana Reyes wrote again on Oct 30');
    expect(checks).toBe(1);
  });
});
