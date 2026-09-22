/**
 * The record a review run keeps per send: what was proposed, what was asked of
 * it, and what was approved.
 *
 * None of it used to survive. Regenerate stamped a note on the run and
 * redrafted; the redraft's dedup refresh replaced `input` and cleared the
 * stamp and the note with it. Approving then replaced `input` again. The
 * proposal, the instruction and the before-copy were all gone by the time
 * anyone could read them, which is what these tests hold shut.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

vi.mock('./AuthGuards', () => ({
  guardAuth: vi.fn(),
  guardRole: vi.fn(),
  loadProject: vi.fn(),
}));

vi.mock('@/services/WorkflowService', async () => {
  const actual = await vi.importActual<typeof import('@/services/WorkflowService')>('@/services/WorkflowService');
  return {
    resumeWorkflow: vi.fn(),
    cancelWorkflow: vi.fn(),
    getWorkflowRun: vi.fn(),
    listWorkflowRuns: vi.fn(),
    submitWorkflowRunFeedback: vi.fn(),
    WorkflowRunNotResumableError: actual.WorkflowRunNotResumableError,
  };
});

vi.mock('@/libs/actions/registry', () => ({
  getAction: vi.fn(),
}));

vi.mock('@/services/ReviewService', () => ({
  recordActionSignal: vi.fn(async () => {}),
  decide: vi.fn(async () => {}),
}));

const afterWork: unknown[] = [];
vi.mock('next/server', () => ({
  after: vi.fn((work: unknown) => afterWork.push(work)),
}));

const { db } = await import('@/libs/DB');
const { actionRunSchema } = await import('@/models/Schema');
const { guardAuth } = await import('./AuthGuards');
const { getAction } = await import('@/libs/actions/registry');
const { contentHash } = await import('@/libs/actions/contentHash');
const { approveContentRoute, regenerateActionRoute, unapproveContentRoute } = await import('./Review');

const ORG = 'org_content_record';

/** The four sends of the fixture sequence, as the run stores them. */
const SENDS = [
  { step: 1, day: 0, subject: 'Kestrel Capital and the AI line', body: 'First touch.' },
  { step: 2, day: 3, subject: 'Following up', body: 'Second touch.' },
  { step: 3, day: 6, subject: 'Re: the AI/Automation line', body: 'Musa, one more note. Apologies for the nudge.' },
  { step: 4, day: 10, subject: 'Last one', body: 'Closing the loop.' },
];

function call<T = unknown>(route: unknown, input: unknown): Promise<T> {
  const procedure = route as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<T> } };
  return procedure['~orpc'].handler({ input, context: {} });
}

/**
 * The action the tests register: a presenter that turns the run's sends into
 * `send-N` email content, which is how the record resolves the copy an id
 * names, and a regenerate capability so the route gets past its guard.
 */
function registerEnrollLike(): void {
  vi.mocked(getAction).mockReturnValue({
    regenerate: vi.fn(async () => {}),
    reviewCard: async (_ctx: unknown, input: { sends: typeof SENDS }) => ({
      title: 'New MQL ready to enroll',
      fields: [],
      content: input.sends.map(s => ({ kind: 'email' as const, id: `send-${s.step}`, label: `Day ${s.day}`, subject: s.subject, body: s.body })),
    }),
  } as unknown as ReturnType<typeof getAction>);
}

async function makeRun(over: Partial<typeof actionRunSchema.$inferInsert> = {}): Promise<number> {
  const [row] = await db
    .insert(actionRunSchema)
    .values({
      orgId: ORG,
      actionId: 'personalization.enroll',
      input: { contactRef: 'contacts:9412', sends: SENDS },
      status: 'pending',
      invokedBy: 'agent:revenue-lead',
      ...over,
    })
    .returning({ id: actionRunSchema.id });
  return row!.id;
}

/**
 * The two columns the walk reads, straight off the row.
 * @param runId
 */
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
  afterWork.length = 0;
  await db.delete(actionRunSchema);
  vi.mocked(guardAuth).mockResolvedValue({
    userId: 'usr-reviewer',
    orgId: ORG,
    accountId: 'acct-1',
    projectId: ORG,
    role: 'admin',
    has: () => true,
  } as unknown as Awaited<ReturnType<typeof guardAuth>>);
});

describe('the record survives a regenerate', () => {
  it('files the proposed copy and the ask, both keyed to the send they are about', async () => {
    registerEnrollLike();
    const runId = await makeRun();

    await call(regenerateActionRoute, { id: runId, contentId: 'send-3', feedback: 'Shorter, and drop the apology.' });

    const { revisions } = await recordOf(runId);
    const forSend3 = revisions.filter(r => r.contentId === 'send-3');

    expect(forSend3).toHaveLength(1);
    expect(forSend3[0]).toMatchObject({
      contentId: 'send-3',
      step: 3,
      kind: 'proposed',
      body: 'Musa, one more note. Apologies for the nudge.',
      ask: 'Shorter, and drop the apology.',
      by: 'usr-reviewer',
    });
    // The other three sends were not touched, so nothing is filed under them.
    expect(revisions.filter(r => r.contentId !== 'send-3')).toHaveLength(0);
  });

  it('keeps the pre-change body readable after the redraft has landed', async () => {
    registerEnrollLike();
    const runId = await makeRun();

    await call(regenerateActionRoute, { id: runId, contentId: 'send-3', feedback: 'Shorter, and drop the apology.' });

    // What the redraft's dedup refresh does: `input` replaced wholesale, the
    // stamp and the note cleared. This is the exact moment the old record
    // used to disappear.
    const { eq } = await import('drizzle-orm');
    await db
      .update(actionRunSchema)
      .set({
        input: { contactRef: 'contacts:9412', sends: SENDS.map(s => (s.step === 3 ? { ...s, body: 'Musa, one more note.' } : s)) },
        regeneratingSince: null,
        regenerateNote: null,
      })
      .where(eq(actionRunSchema.id, runId));

    const { revisions, input } = await recordOf(runId);

    expect(input.sends[2]!.body).toBe('Musa, one more note.');
    expect(revisions.find(r => r.contentId === 'send-3')?.body).toBe('Musa, one more note. Apologies for the nudge.');
    expect(revisions.find(r => r.contentId === 'send-3')?.ask).toBe('Shorter, and drop the apology.');
  });

  it('files a second ask as a regenerated version, not as a second proposal', async () => {
    registerEnrollLike();
    const runId = await makeRun();

    await call(regenerateActionRoute, { id: runId, contentId: 'send-3', feedback: 'Shorter.' });
    const { eq } = await import('drizzle-orm');
    await db
      .update(actionRunSchema)
      .set({
        input: { contactRef: 'contacts:9412', sends: SENDS.map(s => (s.step === 3 ? { ...s, body: 'A shorter note.' } : s)) },
        regeneratingSince: null,
      })
      .where(eq(actionRunSchema.id, runId));
    await call(regenerateActionRoute, { id: runId, contentId: 'send-3', feedback: 'Warmer.' });

    const forSend3 = (await recordOf(runId)).revisions.filter(r => r.contentId === 'send-3');

    expect(forSend3.map(r => [r.version, r.kind, r.body, r.ask])).toEqual([
      [1, 'proposed', 'Musa, one more note. Apologies for the nudge.', 'Shorter.'],
      [2, 'regenerated', 'A shorter note.', 'Warmer.'],
    ]);
  });

  it('leaves the payload alone — a regenerate records, it does not write copy', async () => {
    registerEnrollLike();
    const runId = await makeRun();

    await call(regenerateActionRoute, { id: runId, contentId: 'send-3', feedback: 'Shorter.' });

    expect((await recordOf(runId)).input.sends).toEqual(SENDS);
  });

  it('still regenerates when the record cannot be made', async () => {
    // An action with no presenter resolves no content, so there is nothing to
    // file. The regeneration must go ahead regardless: the audit trail never
    // blocks the work.
    const regenerate = vi.fn(async () => {});
    vi.mocked(getAction).mockReturnValue({ regenerate } as unknown as ReturnType<typeof getAction>);
    const runId = await makeRun();

    const res = await call<{ ok: boolean }>(regenerateActionRoute, { id: runId, feedback: 'shorter' });

    expect(res).toEqual({ ok: true });
    expect((await recordOf(runId)).revisions).toHaveLength(0);
  });
});

describe('approveContent', () => {
  it('records the approved copy and its hash, and sends nothing', async () => {
    registerEnrollLike();
    const runId = await makeRun();

    const res = await call<{ ok: boolean; hash: string }>(approveContentRoute, {
      id: runId,
      contentId: 'send-1',
      subject: 'Kestrel Capital and the AI line',
      body: 'First touch.',
    });

    const { revisions, contentReview, input } = await recordOf(runId);

    expect(res.hash).toBe(contentHash('Kestrel Capital and the AI line', 'First touch.'));
    expect(contentReview['send-1']).toMatchObject({ hash: res.hash, by: 'usr-reviewer' });
    expect(revisions.filter(r => r.kind === 'approved').map(r => [r.contentId, r.body])).toEqual([['send-1', 'First touch.']]);
    // A checkpoint, not an execution: the payload the action runs on is
    // untouched, and the run is still waiting for Enroll.
    expect(input.sends).toEqual(SENDS);

    const { eq } = await import('drizzle-orm');
    const [row] = await db.select({ status: actionRunSchema.status }).from(actionRunSchema).where(eq(actionRunSchema.id, runId)).limit(1);

    expect(row!.status).toBe('pending');
  });

  it('records the reviewer\'s edited copy, not the agent\'s', async () => {
    registerEnrollLike();
    const runId = await makeRun();

    await call(approveContentRoute, { id: runId, contentId: 'send-3', subject: 'Re: the AI/Automation line', body: 'Musa, one more note.' });

    const { revisions, contentReview } = await recordOf(runId);

    expect(revisions.find(r => r.kind === 'approved')?.body).toBe('Musa, one more note.');
    expect(contentReview['send-3']!.hash).toBe(contentHash('Re: the AI/Automation line', 'Musa, one more note.'));
  });

  it('is idempotent on the same copy — a second window does not grow the history', async () => {
    registerEnrollLike();
    const runId = await makeRun();
    const payload = { id: runId, contentId: 'send-1', subject: 'Kestrel Capital and the AI line', body: 'First touch.' };

    await call(approveContentRoute, payload);
    await call(approveContentRoute, payload);

    expect((await recordOf(runId)).revisions.filter(r => r.kind === 'approved')).toHaveLength(1);
  });

  it('moves the hash when the same send is approved again after an edit', async () => {
    registerEnrollLike();
    const runId = await makeRun();

    await call(approveContentRoute, { id: runId, contentId: 'send-1', subject: 'S', body: 'First touch.' });
    await call(approveContentRoute, { id: runId, contentId: 'send-1', subject: 'S', body: 'First touch, tightened.' });

    const { contentReview, revisions } = await recordOf(runId);

    expect(contentReview['send-1']!.hash).toBe(contentHash('S', 'First touch, tightened.'));
    expect(revisions.filter(r => r.kind === 'approved')).toHaveLength(2);
  });

  it('cannot reach another org\'s run', async () => {
    registerEnrollLike();
    const runId = await makeRun({ orgId: 'org_someone_else' });

    await expect(call(approveContentRoute, { id: runId, contentId: 'send-1', body: 'x' })).rejects.toMatchObject({ code: 'not-found' });
  });

  it('refuses a decided run — a check cannot be put against copy that already ran', async () => {
    registerEnrollLike();
    const runId = await makeRun({ status: 'done' });

    await expect(call(approveContentRoute, { id: runId, contentId: 'send-1', body: 'x' })).rejects.toMatchObject({ code: 'not-found' });
  });

  it('refuses while a regeneration is in flight', async () => {
    registerEnrollLike();
    const runId = await makeRun({ regeneratingSince: new Date() });

    await expect(call(approveContentRoute, { id: runId, contentId: 'send-1', body: 'x' })).rejects.toMatchObject({ code: 'bad-request' });
  });

  it('refuses an unauthenticated caller before touching anything', async () => {
    registerEnrollLike();
    const runId = await makeRun();
    vi.mocked(guardAuth).mockRejectedValue(new Error('UNAUTHORIZED'));

    await expect(call(approveContentRoute, { id: runId, contentId: 'send-1', body: 'x' })).rejects.toThrow('UNAUTHORIZED');
    expect((await recordOf(runId)).contentReview).toEqual({});
  });
});

describe('unapproveContent', () => {
  it('drops the check and leaves the history standing', async () => {
    registerEnrollLike();
    const runId = await makeRun();
    await call(approveContentRoute, { id: runId, contentId: 'send-1', subject: 'S', body: 'First touch.' });
    await call(approveContentRoute, { id: runId, contentId: 'send-2', subject: 'S2', body: 'Second touch.' });

    await call(unapproveContentRoute, { id: runId, contentId: 'send-1' });

    const { contentReview, revisions } = await recordOf(runId);

    expect(Object.keys(contentReview)).toEqual(['send-2']);
    expect(revisions.filter(r => r.kind === 'approved')).toHaveLength(2);
  });

  it('cannot reach another org\'s run', async () => {
    registerEnrollLike();
    const runId = await makeRun({ orgId: 'org_someone_else' });

    await expect(call(unapproveContentRoute, { id: runId, contentId: 'send-1' })).rejects.toMatchObject({ code: 'not-found' });
  });
});
