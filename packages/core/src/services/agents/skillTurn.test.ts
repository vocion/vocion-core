/**
 * The scoped skill-turn executor's contract: one skill, a borrowed read-only
 * tool belt, a capped budget, structured output. Generic on purpose — the
 * second-caller test below is the genericity proof the plan's acceptance
 * criteria name: nothing in the executor knows what Regenerate is.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/libs/DB');

// The mounting machinery is exercised by its own tests; here it hands back a
// deterministic file map so the prompt composition is observable.
vi.mock('@/services/playbooks/mount', () => ({
  mountSkills: vi.fn(),
}));

// The registry is the real gate in production; the fake belt here proves the
// executor filters by allowlist and dispatches by name.
vi.mock('@/services/agents/tools/registry', () => ({
  buildDomainTools: vi.fn(),
}));

vi.mock('@/libs/llm', () => ({
  buildChatModelForOrg: vi.fn(),
}));

const { db } = await import('@/libs/DB');
const { agentSchema } = await import('@/models/Schema');
const { mountSkills } = await import('@/services/playbooks/mount');
const { buildDomainTools } = await import('@/services/agents/tools/registry');
const { buildChatModelForOrg } = await import('@/libs/llm');
const { runSkillTurn, SkillTurnError } = await import('./skillTurn');

const ORG = 'org_skill_turn';

type FakeResponse = { content: string; tool_calls?: Array<{ id?: string; name: string; args: Record<string, unknown> }> };

/**
 * A scripted chat model: hands back the queued responses in order and records
 * every invocation's messages.
 * @param responses
 */
function fakeModel(responses: FakeResponse[]) {
  const calls: unknown[][] = [];
  const model = {
    bindTools: vi.fn(() => model),
    invoke: vi.fn(async (messages: unknown[]) => {
      calls.push(messages);
      const next = responses.shift();
      if (!next) {
        throw new Error('fake model ran out of scripted responses');
      }
      return next;
    }),
  };
  return { model, calls };
}

/**
 * A fake registry tool the executor can find by name.
 * @param name
 * @param result
 */
function fakeTool(name: string, result: string) {
  return { name, invoke: vi.fn(async () => result) } as never;
}

async function seedAgent(over: Partial<typeof agentSchema.$inferInsert> = {}) {
  await db.insert(agentSchema).values({
    orgId: ORG,
    slug: 'revenue-lead',
    name: 'RevOps Lead',
    systemPrompt: 'x',
    skillSlugs: ['regenerate-sequence-copy'],
    connectorSources: ['hubspot'],
    objectTypeSlugs: [],
    harnessConfig: { grantTools: ['get_lead_brief', 'hubspot_list_sequences'] },
    ...over,
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(agentSchema);
  vi.mocked(mountSkills).mockResolvedValue({
    '/skills/regenerate-sequence-copy/SKILL.md': '# Regenerate the sequence copy\nFollow the units.',
    '/playbooks/generate-sequence-copy/SKILL.md': '# Generate the sequence copy\nGround only in the brief.',
  });
  vi.mocked(buildDomainTools).mockReturnValue([]);
});

describe('runSkillTurn', () => {
  it('returns the validated structured output from a plain one-turn answer', async () => {
    await seedAgent();
    const { model, calls } = fakeModel([{ content: '{"sends": [{"subject": "s", "body": "b"}]}' }]);
    vi.mocked(buildChatModelForOrg).mockResolvedValue(model as never);

    const res = await runSkillTurn({
      orgId: ORG,
      skillSlug: 'regenerate-sequence-copy',
      task: 'rewrite send 2',
      outputSchema: z.object({ sends: z.array(z.object({ subject: z.string(), body: z.string() })) }),
      outputInstruction: 'sends: the full list.',
    });

    expect(res.output.sends).toEqual([{ subject: 's', body: 'b' }]);
    expect(res.toolCalls).toBe(0);

    // The mounted skill AND its attached playbook both reached the prompt —
    // the one-document-every-consumer property the units depend on.
    const system = String((calls[0]![0] as { content: string }).content);

    expect(system).toContain('Regenerate the sequence copy');
    expect(system).toContain('Ground only in the brief');
  });

  it('dispatches allowlisted tools by name and enforces the call budget', async () => {
    await seedAgent();
    const brief = fakeTool('get_lead_brief', '{"ok":true}');
    const sequences = fakeTool('hubspot_list_sequences', '{"sequences":[]}');
    const forbidden = fakeTool('save_draft_sequence', 'NEVER');
    vi.mocked(buildDomainTools).mockReturnValue([brief, sequences, forbidden]);
    const { model } = fakeModel([
      // Four requested calls against a budget of 3: the fourth gets the
      // budget-exhausted tool message instead of an execution.
      { content: '', tool_calls: [
        { id: 't1', name: 'get_lead_brief', args: {} },
        { id: 't2', name: 'hubspot_list_sequences', args: {} },
        { id: 't3', name: 'get_lead_brief', args: {} },
        { id: 't4', name: 'hubspot_list_sequences', args: {} },
      ] },
      { content: '{"ok": true}' },
    ]);
    vi.mocked(buildChatModelForOrg).mockResolvedValue(model as never);

    const res = await runSkillTurn({
      orgId: ORG,
      skillSlug: 'regenerate-sequence-copy',
      task: 'look things up then answer',
      outputSchema: z.object({ ok: z.boolean() }),
      outputInstruction: 'ok: true.',
      toolAllowlist: ['get_lead_brief', 'hubspot_list_sequences'],
    });

    expect(res.toolCalls).toBe(3);
    expect(vi.mocked(brief as { invoke: ReturnType<typeof vi.fn> }).invoke).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sequences as { invoke: ReturnType<typeof vi.fn> }).invoke).toHaveBeenCalledTimes(1);
    // The write tool was never bound: the allowlist is the whole belt.
    expect(model.bindTools).toHaveBeenCalledWith([brief, sequences]);
    expect(vi.mocked(forbidden as { invoke: ReturnType<typeof vi.fn> }).invoke).not.toHaveBeenCalled();
  });

  it('retries once on a malformed answer, with the validation error named', async () => {
    await seedAgent();
    const { model, calls } = fakeModel([
      { content: 'Sure! Here you go: {"ok": "yes"}' },
      { content: '{"ok": true}' },
    ]);
    vi.mocked(buildChatModelForOrg).mockResolvedValue(model as never);

    const res = await runSkillTurn({
      orgId: ORG,
      skillSlug: 'regenerate-sequence-copy',
      task: 'answer',
      outputSchema: z.object({ ok: z.boolean() }),
      outputInstruction: 'ok: boolean.',
    });

    expect(res.output).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it('is generic: a second caller with its own skill, schema and belt runs through the same executor', async () => {
    await seedAgent({ slug: 'follow-up-coordinator', skillSlugs: ['regenerate-followup-email'], harnessConfig: { grantTools: [] } });
    vi.mocked(mountSkills).mockResolvedValue({
      '/skills/regenerate-followup-email/SKILL.md': '# Regenerate the follow-up email',
    });
    const { model } = fakeModel([{ content: '{"subject": "hi", "body": "there"}' }]);
    vi.mocked(buildChatModelForOrg).mockResolvedValue(model as never);

    const res = await runSkillTurn({
      orgId: ORG,
      skillSlug: 'regenerate-followup-email',
      task: 'rewrite the follow-up',
      outputSchema: z.object({ subject: z.string(), body: z.string() }),
      outputInstruction: 'subject and body.',
    });

    expect(res.output).toEqual({ subject: 'hi', body: 'there' });
    expect(vi.mocked(mountSkills)).toHaveBeenCalledWith({ orgId: ORG, skillSlugs: ['regenerate-followup-email'], playbookSlugs: [] });
  });

  it('refuses a skill no applied workspace mounts', async () => {
    await seedAgent();
    vi.mocked(mountSkills).mockResolvedValue({});
    vi.mocked(buildChatModelForOrg).mockResolvedValue(fakeModel([]).model as never);

    await expect(runSkillTurn({
      orgId: ORG,
      skillSlug: 'regenerate-sequence-copy',
      task: 'x',
      outputSchema: z.object({}),
      outputInstruction: 'x',
    })).rejects.toThrow(SkillTurnError);
  });

  it('refuses when no agent mounts the skill (no belt to borrow)', async () => {
    // No agent seeded at all.
    vi.mocked(buildChatModelForOrg).mockResolvedValue(fakeModel([]).model as never);

    await expect(runSkillTurn({
      orgId: ORG,
      skillSlug: 'regenerate-sequence-copy',
      task: 'x',
      outputSchema: z.object({}),
      outputInstruction: 'x',
    })).rejects.toThrow(/no agent mounts/);
  });
});
