import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The rewrite audit record on action_run.revisions: each applied rewrite
 * appends `{contentId, step, version, body, ask, discardedEdit?, at, by}`,
 * a no-op rewrite records nothing, and the draft itself is never touched —
 * the reviewer still carries the copy back on approve.
 */

vi.mock('@/libs/DB');

let modelReply = 'rewritten body';
vi.mock('@/libs/llm', () => ({
  buildChatModelForOrg: async () => ({
    invoke: async () => ({ content: modelReply }),
  }),
}));

const { db } = await import('@/libs/DB');
const { actionRunSchema } = await import('@/models/Schema');
const { rewriteDraft } = await import('@/services/ReviewService');
const { eq } = await import('drizzle-orm');

const ORG = 'org_rev';

async function seedRun(): Promise<number> {
  const [row] = await db
    .insert(actionRunSchema)
    .values({
      orgId: ORG,
      actionId: 'personalization.enroll',
      status: 'pending',
      input: { sends: [{ step: 1, body: 'draft one' }, { step: 2, body: 'draft two' }] },
      invokedBy: 'agent:revenue-lead',
    })
    .returning({ id: actionRunSchema.id });
  return row!.id;
}

beforeEach(async () => {
  await db.delete(actionRunSchema);
  modelReply = 'rewritten body';
});

afterAll(async () => {
  await db.delete(actionRunSchema);
});

describe('rewriteDraft revision record', () => {
  it('records the revision without touching the draft', async () => {
    const id = await seedRun();
    const out = await rewriteDraft({ orgId: ORG, runId: id, hint: 'shorter', contentId: 'send-1', userId: 'user-v' });

    expect(out).toMatchObject({ body: 'rewritten body', prior: 'draft one' });

    const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, id));

    expect(run!.revisions).toHaveLength(1);
    expect(run!.revisions![0]).toMatchObject({ contentId: 'send-1', step: 1, version: 2, body: 'rewritten body', ask: 'shorter', by: 'user-v' });
    expect(run!.revisions![0]!.discardedEdit).toBeUndefined();
    expect(typeof run!.revisions![0]!.at).toBe('string');
    // The stored draft is untouched — only an approve changes what sends.
    expect((run!.input as { sends: Array<{ body: string }> }).sends[0]!.body).toBe('draft one');
  });

  it('a second rewrite on the same send versions up and records what it discarded', async () => {
    const id = await seedRun();
    await rewriteDraft({ orgId: ORG, runId: id, hint: 'shorter', contentId: 'send-1' });
    modelReply = 'regenerated body';
    const out = await rewriteDraft({ orgId: ORG, runId: id, hint: 'warmer', contentId: 'send-1' });

    expect(out.discardedEdit).toBe('rewritten body');

    const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, id));

    expect(run!.revisions).toHaveLength(2);
    expect(run!.revisions![1]).toMatchObject({ version: 3, body: 'regenerated body', discardedEdit: 'rewritten body' });
  });

  it('a rewrite that changed nothing records nothing', async () => {
    const id = await seedRun();
    modelReply = 'draft two';
    await rewriteDraft({ orgId: ORG, runId: id, hint: 'shorter', contentId: 'send-2' });

    const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, id));

    expect(run!.revisions).toBeNull();
  });
});
