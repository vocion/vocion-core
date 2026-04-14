import process from 'node:process';
import { defineSkill } from '@compiles/sdk';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { resetLLMClients } from '@/libs/llm';
import { skillRunSchema, skillSchema } from '@/models/Schema';
import { executeSkill } from '@/services/SkillService';
import { pluginRegistry } from './registry';

vi.mock('@/libs/DB');

vi.mock('@/libs/onyx/client', () => ({
  search: vi.fn(async () => ({ top_documents: [] })),
}));

vi.mock('openai', () => {
  return {
    default: class {
      chat = {
        completions: {
          create: vi.fn(async () => ({
            choices: [{ message: { content: 'unused — plugin skills do not hit this path' } }],
            usage: { prompt_tokens: 0, completion_tokens: 0 },
          })),
        },
      };
    },
  };
});

vi.mock('@/libs/Langfuse', () => ({
  langfuse: {
    trace: () => ({
      id: 'test-trace',
      generation: () => ({ end: vi.fn() }),
      update: vi.fn(),
      event: vi.fn(),
    }),
    flushAsync: vi.fn(async () => {}),
  },
}));

describe('plugin skill execution via SkillService', () => {
  const ORG = 'test_org_plugin';

  beforeEach(() => {
    pluginRegistry.clear();
    resetLLMClients();
  });

  afterEach(async () => {
    // Clean the skills created during tests so each run is hermetic.
    await db.delete(skillRunSchema).where(eq(skillRunSchema.orgId, ORG));
    await db.delete(skillSchema).where(eq(skillSchema.orgId, ORG));
    pluginRegistry.clear();
  });

  it('runs a plugin skill, stamps skill_run, and lazily upserts skill row', async () => {
    let ran = false;
    pluginRegistry.register(
      { id: 'test.pkg', version: '1.0.0' },
      [defineSkill({
        slug: 'echo_skill',
        name: 'Echo Skill',
        version: '1.0.0',
        requiresApproval: false,
        inputSchema: z.object({ msg: z.string() }),
        outputSchema: z.object({ echoed: z.string(), length: z.number() }),
        async run(_ctx, input) {
          ran = true;
          return { echoed: input.msg, length: input.msg.length };
        },
      })],
    );

    const result = await executeSkill({ orgId: ORG, skillSlug: 'echo_skill', input: { msg: 'hello plugins' } });

    expect(ran).toBe(true);
    expect(result.skill.slug).toBe('echo_skill');

    const parsed = JSON.parse(result.output) as { echoed: string; length: number };

    expect(parsed.echoed).toBe('hello plugins');
    expect(parsed.length).toBe(13);

    const [run] = await db.select().from(skillRunSchema).where(eq(skillRunSchema.id, result.runId));

    expect(run).toBeDefined();
    expect(run!.orgId).toBe(ORG);
    expect(run!.status).toBe('auto');
  });

  it('marks runs pending when the plugin requires approval', async () => {
    pluginRegistry.register(
      { id: 'test.mut', version: '1.0.0' },
      [defineSkill({
        slug: 'mutation_skill',
        name: 'Mutation',
        version: '1.0.0',
        category: 'mutation',
        requiresApproval: true,
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        async run() {
          return { ok: true };
        },
      })],
    );

    const result = await executeSkill({ orgId: ORG, skillSlug: 'mutation_skill', input: {} });

    const [run] = await db.select().from(skillRunSchema).where(eq(skillRunSchema.id, result.runId));

    expect(run!.status).toBe('pending');
  });

  it('rejects input that fails the Zod schema', async () => {
    pluginRegistry.register(
      { id: 'test.strict', version: '1.0.0' },
      [defineSkill({
        slug: 'strict_skill',
        name: 'Strict',
        version: '1.0.0',
        requiresApproval: false,
        inputSchema: z.object({ must: z.number().positive() }),
        outputSchema: z.object({}),
        async run() {
          return {};
        },
      })],
    );

    await expect(executeSkill({ orgId: ORG, skillSlug: 'strict_skill', input: { must: -1 } }))
      .rejects
      .toThrow(/invalid input/);
  });

  it('passes the provider-bound llm client through ctx', async () => {
    // Needed so getLLMClient('openai') doesn't throw.
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test-provider';
    let receivedProvider: string | undefined;
    try {
      pluginRegistry.register(
        { id: 'test.provider', version: '1.0.0' },
        [defineSkill({
          slug: 'provider_check',
          name: 'Provider Check',
          version: '1.0.0',
          provider: 'openai',
          requiresApproval: false,
          inputSchema: z.object({}),
          outputSchema: z.object({ provider: z.string() }),
          async run(ctx) {
            receivedProvider = ctx.llm.provider;
            return { provider: ctx.llm.provider };
          },
        })],
      );

      const result = await executeSkill({ orgId: ORG, skillSlug: 'provider_check', input: {} });

      expect(receivedProvider).toBe('openai');
      expect(JSON.parse(result.output)).toEqual({ provider: 'openai' });
    } finally {
      if (originalKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalKey;
      }
    }
  });

  it('rejects plugin output that fails the Zod schema', async () => {
    pluginRegistry.register(
      { id: 'test.bad-output', version: '1.0.0' },
      [defineSkill({
        slug: 'broken_output',
        name: 'Broken',
        version: '1.0.0',
        requiresApproval: false,
        inputSchema: z.object({}),
        outputSchema: z.object({ must_be_string: z.string() }),

        async run(): Promise<any> {
          return { must_be_string: 42 };
        },
      })],
    );

    await expect(executeSkill({ orgId: ORG, skillSlug: 'broken_output', input: {} }))
      .rejects
      .toThrow(/invalid output/);
  });
});
