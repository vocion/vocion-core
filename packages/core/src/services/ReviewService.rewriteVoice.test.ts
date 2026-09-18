/**
 * The review queue's "Add change" rewrite, against the workspace voice rules.
 *
 * Before this, `rewriteDraft` built its own prompt out of one hardcoded
 * sentence of generic house style and validated nothing, so a rewrite could
 * hand back exactly the constructions the drafting pass is gated on. These
 * tests hold the two halves of the fix: the workspace's rules and playbook
 * reach the prompt, and the answer is checked with the same rules.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/llm', () => ({ buildChatModelForOrg: vi.fn() }));
vi.mock('@/services/playbooks/mount', () => ({ readByOrigin: vi.fn(() => null), mountSkills: vi.fn() }));

const { db } = await import('@/libs/DB');
const { actionRunSchema, playbookSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { buildChatModelForOrg } = await import('@/libs/llm');
const { readByOrigin } = await import('@/services/playbooks/mount');
const { rewriteDraft } = await import('@/services/ReviewService');
const { eq } = await import('drizzle-orm');

const ORG = 'org_rewrite_voice';
const ACCOUNT = 'acct_rewrite_voice';

/**
 * A scripted model: hands back the queued answers in order.
 * @param answers - Answers to return, one per invoke.
 */
function fakeModel(answers: string[]) {
  const seen: string[] = [];
  return {
    seen,
    model: {
      invoke: vi.fn(async (messages: Array<{ content: string }>) => {
        seen.push(messages.map(m => String(m.content)).join('\n---\n'));
        const next = answers.shift();
        if (next === undefined) {
          throw new Error('fake model ran out of scripted answers');
        }
        return { content: next };
      }),
    },
  };
}

async function seedProject(voiceRules: typeof projectSchema.$inferInsert.voiceRules) {
  await db.insert(tenantAccountSchema).values({ id: ACCOUNT, slug: 'rw', name: 'RW' }).onConflictDoNothing();
  await db.insert(projectSchema).values({ id: ORG, accountId: ACCOUNT, slug: 'rw', name: 'RW', voiceRules });
}

async function seedRun(body: string): Promise<number> {
  const [row] = await db.insert(actionRunSchema).values({
    orgId: ORG,
    actionId: 'gmail.send',
    status: 'pending',
    input: { body },
  }).returning({ id: actionRunSchema.id });
  return row!.id;
}

beforeEach(async () => {
  vi.mocked(readByOrigin).mockReset().mockReturnValue(null);
  await db.delete(actionRunSchema);
  await db.delete(playbookSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
});

afterAll(async () => {
  await db.delete(actionRunSchema);
  await db.delete(playbookSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
});

describe('rewriteDraft — the voice gate', () => {
  it('accepts a clean rewrite', async () => {
    await seedProject(null);
    const runId = await seedRun('Original draft.');
    const { model } = fakeModel(['Dana, good to meet you yesterday. Talk soon.']);
    vi.mocked(buildChatModelForOrg).mockResolvedValue(model as never);

    const out = await rewriteDraft({ orgId: ORG, runId });

    expect(out.body).toBe('Dana, good to meet you yesterday. Talk soon.');
    expect(out.voiceError).toBeUndefined();
    expect(model.invoke).toHaveBeenCalledTimes(1);
  });

  it('retries once, naming the offending phrase, and takes the clean second answer', async () => {
    await seedProject(null);
    const runId = await seedRun('Original draft.');
    const { model, seen } = fakeModel([
      'Curious about how the rollout works.',
      'How does the rollout work day to day?',
    ]);
    vi.mocked(buildChatModelForOrg).mockResolvedValue(model as never);

    const out = await rewriteDraft({ orgId: ORG, runId });

    expect(model.invoke).toHaveBeenCalledTimes(2);
    expect(seen[1]).toContain('"Curious about" is banned');
    expect(out.body).toBe('How does the rollout work day to day?');
    expect(out.voiceError).toBeUndefined();
  });

  it('keeps the original and says so when the rewrite fails the gate twice', async () => {
    await seedProject(null);
    const runId = await seedRun('Original draft.');
    const { model } = fakeModel([
      'Curious about how the rollout works.',
      'No pitch, just curious how the rollout works.',
    ]);
    vi.mocked(buildChatModelForOrg).mockResolvedValue(model as never);

    const out = await rewriteDraft({ orgId: ORG, runId });

    expect(out.body).toBe('Original draft.');
    expect(out.voiceError).toContain('voice rules');
    expect(out.voiceError).toContain('No pitch');
  });

  it('never records a revision for a rewrite that failed the gate', async () => {
    await seedProject(null);
    const runId = await seedRun('Original draft.');
    const { model } = fakeModel(['Curious about it.', 'Still curious about it.']);
    vi.mocked(buildChatModelForOrg).mockResolvedValue(model as never);

    await rewriteDraft({ orgId: ORG, runId });

    const [row] = await db.select({ revisions: actionRunSchema.revisions }).from(actionRunSchema).where(eq(actionRunSchema.id, runId));

    expect(row!.revisions ?? []).toHaveLength(0);
  });

  it('enforces the workspace\'s own rules, not just the platform floor', async () => {
    await seedProject({ never: [{ pattern: 'Quick one', match: 'phrase', reason: 'Register announcement.' }] });
    const runId = await seedRun('Original draft.');
    const { model, seen } = fakeModel(['Quick one on the build.', 'Dana, on the build.']);
    vi.mocked(buildChatModelForOrg).mockResolvedValue(model as never);

    const out = await rewriteDraft({ orgId: ORG, runId });

    expect(seen[1]).toContain('"Quick one" is banned');
    expect(seen[1]).toContain('Register announcement.');
    expect(out.body).toBe('Dana, on the build.');
  });

  it('composes the workspace voice playbook into the prompt', async () => {
    await seedProject({ never: [], playbook: 'founder-voice' });
    await db.insert(playbookSchema).values({
      orgId: ORG,
      slug: 'founder-voice',
      kind: 'playbook',
      origin: 'workspace',
      name: 'Founder Voice',
      description: 'how he writes',
      contentSha: 'sha',
    });
    vi.mocked(readByOrigin).mockReturnValue('# Founder Voice\n\nShort declaratives. Name, then one specific fact.');
    const runId = await seedRun('Original draft.');
    const { model, seen } = fakeModel(['Dana, the switching-costs section landed.']);
    vi.mocked(buildChatModelForOrg).mockResolvedValue(model as never);

    await rewriteDraft({ orgId: ORG, runId });

    expect(seen[0]).toContain('Short declaratives. Name, then one specific fact.');
    expect(seen[0]).toContain('sender\'s voice guide');
  });

  it('falls back to the floor when the named playbook is missing, without failing the rewrite', async () => {
    await seedProject({ never: [], playbook: 'not-applied' });
    const runId = await seedRun('Original draft.');
    const { model, seen } = fakeModel(['Dana, the section landed.']);
    vi.mocked(buildChatModelForOrg).mockResolvedValue(model as never);

    const out = await rewriteDraft({ orgId: ORG, runId });

    expect(out.body).toBe('Dana, the section landed.');
    expect(seen[0]).toContain('No voice guide is authored');
    // The banned list is still in the prompt.
    expect(seen[0]).toContain('"no pitch"');
  });

  it('keeps the original when the model call fails, and does not claim a voice failure', async () => {
    await seedProject(null);
    const runId = await seedRun('Original draft.');
    vi.mocked(buildChatModelForOrg).mockResolvedValue({
      invoke: vi.fn(async () => {
        throw new Error('timeout');
      }),
    } as never);

    const out = await rewriteDraft({ orgId: ORG, runId });

    expect(out.body).toBe('Original draft.');
    expect(out.voiceError).toBeUndefined();
  });
});
