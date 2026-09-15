/**
 * What a reviewer did to the labels a proposal wrote about itself.
 *
 * The one fact these pin down: `updateActionInput` REPLACES `action_run.input`
 * and `onProposed` rewrites the object's metadata straight after it, so the
 * values the proposer chose exist nowhere once an edit-then-approve has
 * landed. Decide time is the last moment they can be compared against what the
 * reviewer left behind, and the comparison has to be enums, because the
 * adoption envelope carries counts and enums and never message content.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/libs/DB');
vi.mock('@/services/MissionService', () => ({ cancelMission: vi.fn(), resumeMission: vi.fn() }));
vi.mock('@/services/SkillService', () => ({ approveSkillRun: vi.fn(), rejectSkillRun: vi.fn() }));
vi.mock('@/services/WorkflowService', () => ({ cancelWorkflow: vi.fn(), resumeWorkflow: vi.fn() }));

const { db } = await import('@/libs/DB');
const { actionRunSchema, userActivityEventSchema } = await import('@/models/Schema');
const { registerAction } = await import('@/libs/actions/registry');
const { decide } = await import('@/services/ReviewService');

registerAction({
  id: 'test.label-verdicts',
  name: 'Test label verdicts',
  description: 'test',
  inputSchema: z.object({
    objectType: z.string().optional(),
    title: z.string().optional(),
    fields: z.record(z.string(), z.unknown()).optional(),
  }),
  grant: 'test_write',
  external: true,
  execute: async () => ({ ok: true }),
});

const ORG = 'org_label_verdicts';
const AGENT = 'event-ingestion-lead';
const REVIEWER = 'user_reviewer';

/** The payload the extractor proposed: two fields it read, two it judged. */
const PROPOSED_FIELDS = {
  title: 'Open Mic Night',
  startDate: '2026-11-19',
  seriesMatch: 'part of series 41',
  seriesKey: '41',
};

/**
 * One pending candidate, with the labels its proposer declared.
 * @param labels - Field names the proposal declares, or undefined for a proposal that declares none.
 * @param fields - The stored payload, when a test needs a different one.
 */
async function pendingCandidate(
  labels: string[] | undefined,
  fields: Record<string, unknown> = PROPOSED_FIELDS,
): Promise<number> {
  const [row] = await db
    .insert(actionRunSchema)
    .values({
      orgId: ORG,
      actionId: 'test.label-verdicts',
      status: 'pending',
      invokedBy: `agent:${AGENT}`,
      input: { objectType: 'event-candidate', title: 'Open Mic Night', fields },
      proposal: { confidence: 0.9, agentSlug: AGENT, ...(labels ? { labels } : {}) },
    })
    .returning({ id: actionRunSchema.id });
  return row!.id;
}

/**
 * The edited payload a reviewer sends back, in the shape the queue sends it.
 * @param fields - The payload the reviewer is approving.
 */
function editedInput(fields: Record<string, unknown>) {
  return { objectType: 'event-candidate', title: 'Open Mic Night', fields };
}

/** The metadata of the one decision event this org recorded. */
async function decidedMeta(): Promise<Record<string, unknown>> {
  const [event] = await db.select().from(userActivityEventSchema);
  return (event?.metadata ?? {}) as Record<string, unknown>;
}

async function clear(): Promise<void> {
  await db.delete(userActivityEventSchema);
  await db.delete(actionRunSchema);
}

beforeEach(clear);

afterAll(clear);

describe('label verdicts on a decision', () => {
  it('records a verdict of changed when the reviewer edited a labelled field', async () => {
    const runId = await pendingCandidate(['seriesMatch', 'seriesKey']);

    await decide({ kind: 'action', id: runId }, 'approve', ORG, {
      reviewedBy: REVIEWER,
      editedInput: editedInput({ ...PROPOSED_FIELDS, seriesKey: '57' }),
    });

    expect(await decidedMeta()).toMatchObject({
      decision: 'edited',
      labels: { seriesMatch: 'kept', seriesKey: 'changed' },
    });
  });

  it('records kept when the reviewer edited something else', async () => {
    const runId = await pendingCandidate(['seriesMatch', 'seriesKey']);

    await decide({ kind: 'action', id: runId }, 'approve', ORG, {
      reviewedBy: REVIEWER,
      editedInput: editedInput({ ...PROPOSED_FIELDS, title: 'Open Mic Night (all ages)' }),
    });

    expect(await decidedMeta()).toMatchObject({ labels: { seriesMatch: 'kept', seriesKey: 'kept' } });
  });

  it('records cleared when the reviewer emptied the label', async () => {
    // The misplacement signal itself: "this is not part of that series".
    const runId = await pendingCandidate(['seriesMatch', 'seriesKey']);

    await decide({ kind: 'action', id: runId }, 'approve', ORG, {
      reviewedBy: REVIEWER,
      editedInput: editedInput({ ...PROPOSED_FIELDS, seriesMatch: '', seriesKey: '' }),
    });

    expect(await decidedMeta()).toMatchObject({ labels: { seriesMatch: 'cleared', seriesKey: 'cleared' } });
  });

  it('records added when the reviewer filled in a label the proposal left empty', async () => {
    const runId = await pendingCandidate(['seriesMatch'], { ...PROPOSED_FIELDS, seriesMatch: '' });

    await decide({ kind: 'action', id: runId }, 'approve', ORG, {
      reviewedBy: REVIEWER,
      editedInput: editedInput({ ...PROPOSED_FIELDS, seriesMatch: 'part of series 41' }),
    });

    expect(await decidedMeta()).toMatchObject({ labels: { seriesMatch: 'added' } });
  });

  it('records kept on a plain approve, where the reviewer changed nothing', async () => {
    // Taking the card as it stands is a judgement on the labels too, and the
    // strongest "kept" there is.
    const runId = await pendingCandidate(['seriesMatch', 'seriesKey']);

    await decide({ kind: 'action', id: runId }, 'approve', ORG, { reviewedBy: REVIEWER });

    expect(await decidedMeta()).toMatchObject({
      decision: 'approved',
      labels: { seriesMatch: 'kept', seriesKey: 'kept' },
    });
  });

  it('records nothing for a label the edited payload never mentioned', async () => {
    // Omission is silence, not a clear. A reviewer clearing a label sends it
    // back as '', so a field the payload does not mention at all was simply
    // not edited, and counting it as cleared would invent a correction out of
    // whichever fields the queue happened to send.
    const runId = await pendingCandidate(['seriesMatch', 'seriesKey']);

    await decide({ kind: 'action', id: runId }, 'approve', ORG, {
      reviewedBy: REVIEWER,
      editedInput: editedInput({ title: 'Open Mic Night', startDate: '2026-11-19', seriesMatch: 'part of series 41' }),
    });

    expect((await decidedMeta()).labels).toEqual({ seriesMatch: 'kept' });
  });

  it('records nothing when the proposal declared no labels', async () => {
    // Every proposal made before this existed, and every proposer that judges
    // nothing. Absent must never read as "nothing was edited".
    const runId = await pendingCandidate(undefined);

    await decide({ kind: 'action', id: runId }, 'approve', ORG, {
      reviewedBy: REVIEWER,
      editedInput: editedInput({ ...PROPOSED_FIELDS, seriesKey: '57' }),
    });

    expect(await decidedMeta()).not.toHaveProperty('labels');
  });

  it('records nothing on a reject, where there is no edited input', async () => {
    // A rejected card was not corrected, it was turned down. Counting its
    // labels as kept would credit judgements nobody looked at.
    const runId = await pendingCandidate(['seriesMatch', 'seriesKey']);

    await decide({ kind: 'action', id: runId }, 'reject', ORG, { reviewedBy: REVIEWER });

    const meta = await decidedMeta();

    expect(meta).toMatchObject({ decision: 'rejected' });
    expect(meta).not.toHaveProperty('labels');
  });
});
