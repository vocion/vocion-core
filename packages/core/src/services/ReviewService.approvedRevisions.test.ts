/**
 * The backstop: after Enroll, every send has an `approved` revision carrying
 * the copy that actually ran.
 *
 * The window these pin is the same one `labelVerdicts` and the voice diff
 * depend on — `updateActionInput` REPLACES `action_run.input`, so decide time
 * is the last moment the approved copy can be filed beside the proposal it
 * came from. Without it, "what did this run send" is answerable only by
 * reading the payload that a later regeneration is free to overwrite.
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
const { contentHash } = await import('@/libs/actions/contentHash');
const { recordApprovedContent } = await import('@/services/review/contentRecord');

const ORG = 'org_approved_revisions';
const REVIEWER = 'user_reviewer';

const SendSchema = z.object({ step: z.number(), day: z.number().optional(), subject: z.string().optional(), body: z.string() });

const sent: Array<Record<string, unknown>> = [];

registerAction({
  id: 'test.enroll-sequence',
  name: 'Test enroll sequence',
  description: 'test',
  inputSchema: z.object({ contactRef: z.string(), sends: z.array(SendSchema) }),
  grant: 'test_write',
  external: true,
  execute: async (_ctx, input) => {
    sent.push(input as Record<string, unknown>);
    return { ok: true };
  },
  reviewCard: async (_ctx, input) => ({
    title: 'New MQL ready to enroll',
    fields: [],
    content: (input as { sends: Array<z.infer<typeof SendSchema>> }).sends.map(s => ({
      kind: 'email' as const,
      id: `send-${s.step}`,
      label: `Day ${s.day ?? s.step}`,
      ...(s.subject !== undefined ? { subject: s.subject } : {}),
      body: s.body,
    })),
  }),
  applyContentEdits: (input, edits) => {
    const byId = new Map(edits.map(e => [e.id, e]));
    const typed = input as { sends: Array<z.infer<typeof SendSchema>> };
    return {
      ...typed,
      sends: typed.sends.map((s) => {
        const edit = byId.get(`send-${s.step}`);
        return edit ? { ...s, ...(edit.subject !== undefined ? { subject: edit.subject } : {}), ...(edit.body !== undefined ? { body: edit.body } : {}) } : s;
      }),
    };
  },
} as Parameters<typeof registerAction>[0]);

// An action that carries no card presenter, so nothing resolves content for
// it and the record has nothing to file.
registerAction({
  id: 'test.no-presenter',
  name: 'Test no presenter',
  description: 'test',
  inputSchema: z.object({ contactRef: z.string() }),
  grant: 'test_write',
  external: true,
  execute: async () => ({ ok: true }),
} as Parameters<typeof registerAction>[0]);

const SENDS = [
  { step: 1, day: 0, subject: 'First', body: 'First touch.' },
  { step: 2, day: 3, subject: 'Second', body: 'Second touch.' },
];

async function pendingEnroll(sends = SENDS): Promise<number> {
  const [row] = await db
    .insert(actionRunSchema)
    .values({
      orgId: ORG,
      actionId: 'test.enroll-sequence',
      status: 'pending',
      invokedBy: 'agent:revenue-lead',
      input: { contactRef: 'contacts:9412', sends },
      proposal: { confidence: 0.9 },
    })
    .returning({ id: actionRunSchema.id });
  return row!.id;
}

async function recordOf(runId: number) {
  const { eq } = await import('drizzle-orm');
  const [row] = await db
    .select({ revisions: actionRunSchema.revisions, contentReview: actionRunSchema.contentReview, input: actionRunSchema.input })
    .from(actionRunSchema)
    .where(eq(actionRunSchema.id, runId))
    .limit(1);
  return { revisions: row?.revisions ?? [], contentReview: row?.contentReview ?? {}, input: row?.input as { sends: typeof SENDS } };
}

beforeEach(async () => {
  vi.clearAllMocks();
  sent.length = 0;
  await db.delete(actionRunSchema);
});

describe('the record survives an approve', () => {
  it('gives every send an approved revision matching the copy that ran', async () => {
    const runId = await pendingEnroll();

    await decide({ kind: 'action', id: runId }, 'approve', ORG, { reviewedBy: REVIEWER });

    const { revisions, input } = await recordOf(runId);
    const approved = revisions.filter(r => r.kind === 'approved');

    expect(approved.map(r => [r.contentId, r.body])).toEqual([
      ['send-1', 'First touch.'],
      ['send-2', 'Second touch.'],
    ]);
    // The criterion in full: the record matches what the action ran on.
    expect(approved.map(r => r.body)).toEqual(input.sends.map(s => s.body));
    expect(sent[0]!.sends).toEqual(input.sends);
  });

  it('files the reviewer\'s edited copy, which is the copy that ran', async () => {
    const runId = await pendingEnroll();
    const edited = { contactRef: 'contacts:9412', sends: [SENDS[0]!, { ...SENDS[1]!, body: 'Second touch, tightened.' }] };

    await decide({ kind: 'action', id: runId }, 'approve', ORG, { reviewedBy: REVIEWER, editedInput: edited });

    const { revisions, input } = await recordOf(runId);

    expect(revisions.filter(r => r.kind === 'approved').map(r => r.body)).toEqual(['First touch.', 'Second touch, tightened.']);
    expect(input.sends[1]!.body).toBe('Second touch, tightened.');
  });

  it('leaves a send the reviewer already approved with one entry, not two', async () => {
    const runId = await pendingEnroll();
    await recordApprovedContent({ orgId: ORG, runId, contentId: 'send-1', subject: 'First', body: 'First touch.', by: REVIEWER });

    await decide({ kind: 'action', id: runId }, 'approve', ORG, { reviewedBy: REVIEWER });

    const { revisions, contentReview } = await recordOf(runId);

    expect(revisions.filter(r => r.contentId === 'send-1' && r.kind === 'approved')).toHaveLength(1);
    // The walk's own check stands, and the backstop supplied the one the
    // reviewer never clicked.
    expect(contentReview['send-1']!.hash).toBe(contentHash('First', 'First touch.'));
    expect(contentReview['send-2']!.hash).toBe(contentHash('Second', 'Second touch.'));
  });

  it('records nothing on a decline — nothing was approved', async () => {
    const runId = await pendingEnroll();

    await decide({ kind: 'action', id: runId }, 'reject', ORG, { reviewedBy: REVIEWER, reason: 'not a fit' });

    expect((await recordOf(runId)).revisions.filter(r => r.kind === 'approved')).toHaveLength(0);
  });

  it('approves even when the record cannot be written', async () => {
    // An action with no presenter resolves no content. The decision still
    // lands: a run must never fail on its audit trail.
    const [row] = await db
      .insert(actionRunSchema)
      .values({
        orgId: ORG,
        actionId: 'test.no-presenter',
        status: 'pending',
        invokedBy: 'agent:revenue-lead',
        input: { contactRef: 'contacts:1' },
        proposal: { confidence: 0.5 },
      })
      .returning({ id: actionRunSchema.id });

    const outcome = await decide({ kind: 'action', id: row!.id }, 'approve', ORG, { reviewedBy: REVIEWER });

    expect(outcome.execution?.status).toBe('done');
    expect((await recordOf(row!.id)).revisions).toHaveLength(0);
  });
});
