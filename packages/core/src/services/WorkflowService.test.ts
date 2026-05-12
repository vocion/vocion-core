import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { defineSkill, pluginRegistry } from '@/libs/plugins';
import { skillRunSchema, skillSchema, workflowRunSchema, workflowSchema } from '@/models/Schema';
import {
  cancelWorkflow,
  getWorkflowRun,
  listWorkflowRuns,
  resumeWorkflow,
  startWorkflow,
} from './WorkflowService';

vi.mock('@/libs/DB');

vi.mock('@/libs/onyx/client', () => ({
  search: vi.fn(async () => ({ top_documents: [] })),
}));

vi.mock('openai', () => ({
  default: class {
    chat = {
      completions: {
        create: vi.fn(async () => ({
          choices: [{ message: { content: 'unused' } }],
          usage: { prompt_tokens: 0, completion_tokens: 0 },
        })),
      },
    };
  },
}));

vi.mock('@/libs/Langfuse', () => {
  const fakeTrace = () => ({
    id: 'test-trace',
    generation: () => ({ end: vi.fn() }),
    span: () => ({ end: vi.fn() }),
    update: vi.fn(),
    event: vi.fn(),
  });
  return {
    langfuse: { trace: fakeTrace, flushAsync: vi.fn(async () => {}) },
    traceFor: fakeTrace,
    cleanUsageDetails: (x: Record<string, number | undefined>) => x,
  };
});

const ORG = 'test_org_workflow';

async function seedWorkflow(slug: string, steps: unknown): Promise<number> {
  const [row] = await db.insert(workflowSchema).values({
    orgId: ORG,
    slug,
    name: slug,
    version: 1,
    status: 'active',
    trigger: { type: 'manual' },
    steps: steps as Array<Record<string, unknown>>,
  }).returning();
  return row!.id;
}

describe('WorkflowService', () => {
  beforeEach(() => {
    pluginRegistry.clear();
  });

  afterEach(async () => {
    await db.delete(workflowRunSchema).where(eq(workflowRunSchema.orgId, ORG));
    await db.delete(workflowSchema).where(eq(workflowSchema.orgId, ORG));
    await db.delete(skillRunSchema).where(eq(skillRunSchema.orgId, ORG));
    await db.delete(skillSchema).where(eq(skillSchema.orgId, ORG));
    pluginRegistry.clear();
  });

  it('runs a happy-path workflow with skill + action steps', async () => {
    pluginRegistry.register(
      { id: 'test.wf', version: '1.0.0' },
      [defineSkill({
        slug: 'shout',
        name: 'Shout',
        version: '1.0.0',
        requiresApproval: false,
        inputSchema: z.object({ msg: z.string() }),
        outputSchema: z.object({ shouted: z.string() }),
        async run(_ctx, input) {
          return { shouted: input.msg.toUpperCase() };
        },
      })],
    );

    await seedWorkflow('shout_and_log', [
      { name: 'shout_step', type: 'skill', skill: 'shout', input: { msg: '{{input.text}}' } },
      { name: 'log_it', type: 'action', action: 'log', input: { text: '{{steps.shout_step.output.shouted}}' } },
    ]);

    const run = await startWorkflow({ orgId: ORG, slug: 'shout_and_log', input: { text: 'hello world' } });

    expect(run.status).toBe('completed');
    expect(run.stepResults.shout_step?.status).toBe('completed');
    expect(run.stepResults.shout_step?.output).toEqual({ shouted: 'HELLO WORLD' });
    expect(run.stepResults.log_it?.status).toBe('completed');
    expect((run.stepResults.log_it?.output as { input: { text: string } }).input.text).toBe('HELLO WORLD');
  });

  it('pauses at an approve step and resumes on approval', async () => {
    pluginRegistry.register(
      { id: 'test.approve', version: '1.0.0' },
      [defineSkill({
        slug: 'draft',
        name: 'Draft',
        version: '1.0.0',
        requiresApproval: false,
        inputSchema: z.object({}),
        outputSchema: z.object({ body: z.string() }),
        async run() {
          return { body: 'draft body' };
        },
      })],
    );

    await seedWorkflow('draft_then_approve', [
      { name: 'drafting', type: 'skill', skill: 'draft', input: {} },
      { name: 'check', type: 'approve', prompt: 'look good?' },
      { name: 'final', type: 'action', action: 'send', input: { body: '{{steps.drafting.output.body}}' } },
    ]);

    const first = await startWorkflow({ orgId: ORG, slug: 'draft_then_approve' });

    expect(first.status).toBe('paused');
    expect(first.pauseReason).toBe('awaiting_approval:check');
    expect(first.stepResults.drafting?.status).toBe('completed');
    expect(first.stepResults.check?.status).toBe('awaiting_approval');
    expect(first.stepResults.final).toBeUndefined();

    const resumed = await resumeWorkflow(first.id, ORG);

    expect(resumed.status).toBe('completed');
    expect(resumed.stepResults.final?.status).toBe('completed');
    expect((resumed.stepResults.final?.output as { input: { body: string } }).input.body).toBe('draft body');
  });

  it('fails a run when a step throws', async () => {
    pluginRegistry.register(
      { id: 'test.boom', version: '1.0.0' },
      [defineSkill({
        slug: 'boom',
        name: 'Boom',
        version: '1.0.0',
        requiresApproval: false,
        inputSchema: z.object({}),
        outputSchema: z.object({}),
        async run() {
          throw new Error('kaboom');
        },
      })],
    );

    await seedWorkflow('explodes', [
      { name: 'first_ok', type: 'action', action: 'log', input: {} },
      { name: 'goes_bad', type: 'skill', skill: 'boom', input: {} },
      { name: 'never_reached', type: 'action', action: 'log', input: {} },
    ]);

    const run = await startWorkflow({ orgId: ORG, slug: 'explodes' });

    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/kaboom/);
    expect(run.stepResults.first_ok?.status).toBe('completed');
    expect(run.stepResults.goes_bad?.status).toBe('failed');
    expect(run.stepResults.never_reached).toBeUndefined();
  });

  it('refuses to start when workflow is disabled', async () => {
    const [row] = await db.insert(workflowSchema).values({
      orgId: ORG,
      slug: 'disabled_wf',
      name: 'disabled',
      version: 1,
      status: 'disabled',
      trigger: { type: 'manual' },
      steps: [{ name: 's', type: 'action', action: 'log', input: {} }],
    }).returning();

    expect(row).toBeDefined();

    await expect(startWorkflow({ orgId: ORG, slug: 'disabled_wf' })).rejects.toThrow(/disabled/);
  });

  it('refuses to resume a run that is not paused', async () => {
    await seedWorkflow('simple', [{ name: 'a', type: 'action', action: 'log', input: {} }]);
    const run = await startWorkflow({ orgId: ORG, slug: 'simple' });

    expect(run.status).toBe('completed');

    await expect(resumeWorkflow(run.id, ORG)).rejects.toThrow(/completed/);
  });

  it('cancel sets status and records reason', async () => {
    pluginRegistry.register(
      { id: 'test.cancel', version: '1.0.0' },
      [defineSkill({
        slug: 'noop',
        name: 'noop',
        version: '1.0.0',
        requiresApproval: false,
        inputSchema: z.object({}),
        outputSchema: z.object({}),
        async run() {
          return {};
        },
      })],
    );
    await seedWorkflow('needs_approve', [
      { name: 's', type: 'skill', skill: 'noop', input: {} },
      { name: 'gate', type: 'approve', prompt: 'wait' },
    ]);

    const run = await startWorkflow({ orgId: ORG, slug: 'needs_approve' });

    expect(run.status).toBe('paused');

    const cancelled = await cancelWorkflow(run.id, ORG, 'no longer needed');

    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.error).toBe('no longer needed');
  });

  it('lists runs filtered by status', async () => {
    pluginRegistry.register(
      { id: 'test.list', version: '1.0.0' },
      [defineSkill({
        slug: 'done_skill',
        name: 'done',
        version: '1.0.0',
        requiresApproval: false,
        inputSchema: z.object({}),
        outputSchema: z.object({}),
        async run() {
          return {};
        },
      })],
    );
    await seedWorkflow('will_complete', [{ name: 's', type: 'skill', skill: 'done_skill', input: {} }]);
    await seedWorkflow('will_pause', [
      { name: 's', type: 'skill', skill: 'done_skill', input: {} },
      { name: 'g', type: 'approve', prompt: 'hold' },
    ]);

    await startWorkflow({ orgId: ORG, slug: 'will_complete' });
    await startWorkflow({ orgId: ORG, slug: 'will_pause' });

    const completed = await listWorkflowRuns(ORG, { status: 'completed' });
    const paused = await listWorkflowRuns(ORG, { status: 'paused' });

    expect(completed.length).toBe(1);
    expect(paused.length).toBe(1);
  });

  it('interpolates nested input through objects and arrays', async () => {
    pluginRegistry.register(
      { id: 'test.interp', version: '1.0.0' },
      [defineSkill({
        slug: 'echo',
        name: 'echo',
        version: '1.0.0',
        requiresApproval: false,
        inputSchema: z.object({}).passthrough(),
        outputSchema: z.object({}).passthrough(),
        async run(_ctx, input) {
          return input as Record<string, unknown>;
        },
      })],
    );
    await seedWorkflow('interp_nested', [
      {
        name: 'echoed',
        type: 'skill',
        skill: 'echo',
        input: {
          nested: { greeting: 'hi {{input.name}}', items: ['{{input.id}}', 'static'] },
          plain: '{{input.name}}',
        },
      },
    ]);

    const run = await startWorkflow({ orgId: ORG, slug: 'interp_nested', input: { name: 'world', id: 42 } });
    const output = run.stepResults.echoed?.output as { nested: { greeting: string; items: unknown[] }; plain: string };

    // whole-string {{input.id}} preserves number type; template string becomes interpolated text
    expect(output.nested.greeting).toBe('hi world');
    expect(output.nested.items).toEqual([42, 'static']);
    expect(output.plain).toBe('world');
  });

  it('getWorkflowRun returns null for missing id', async () => {
    const got = await getWorkflowRun(99999999, ORG);

    expect(got).toBeNull();
  });
});
