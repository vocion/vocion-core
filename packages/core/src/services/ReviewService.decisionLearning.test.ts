/**
 * A reviewer's approve/reject on an agent-proposed action → a learning rule
 * (VEERIO-252 item 2). Three bugs fixed here, against PGlite:
 *
 * - The rule always went to the literal `crm-updates` step, even for an
 *   agent that declares its own `learningSteps` — and the failure when that
 *   step didn't exist was swallowed by an empty `.catch(() => {})`.
 * - The candidate's field names were read from `input.properties`, which
 *   `objects-propose-candidate.ts` never writes (it writes `input.fields`),
 *   so every rule read "updating [n/a]".
 * - The operator's reject reason was truncated to 120 characters.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/libs/DB');
vi.mock('@/services/MissionService', () => ({ cancelMission: vi.fn(), resumeMission: vi.fn() }));
vi.mock('@/services/SkillService', () => ({ approveSkillRun: vi.fn(), rejectSkillRun: vi.fn() }));
vi.mock('@/services/WorkflowService', () => ({ cancelWorkflow: vi.fn(), resumeWorkflow: vi.fn() }));
vi.mock('@/services/adoption/track', () => ({ track: vi.fn() }));

const { db } = await import('@/libs/DB');
const { actionRunSchema, agentSchema, learningSchema, learningStepSchema } = await import('@/models/Schema');
const { registerAction } = await import('@/libs/actions/registry');
const { decide } = await import('@/services/ReviewService');
const { and, eq } = await import('drizzle-orm');

registerAction({
  id: 'test.decision-learning-write',
  name: 'Test decision-learning write',
  description: 'test',
  inputSchema: z.object({ objectType: z.string().optional(), fields: z.record(z.string(), z.unknown()).optional() }),
  grant: 'test_write',
  external: true,
  execute: async () => ({ ok: true }),
});

const ORG = 'org_decision_learning';

async function makeAgent(slug: string, learningSteps: string[]): Promise<void> {
  await db.insert(agentSchema).values({
    orgId: ORG,
    slug,
    name: slug,
    systemPrompt: 'Be helpful.',
    learningSteps,
  });
}

async function makeLearningStep(name: string): Promise<void> {
  await db.insert(learningStepSchema).values({
    orgId: ORG,
    name,
    title: name,
    description: name,
    agentSlugs: [],
  });
}

async function pendingAction(opts: { agentSlug: string; objectType?: string; fields?: Record<string, unknown>; confidence?: number; rationale?: string }): Promise<number> {
  const [row] = await db
    .insert(actionRunSchema)
    .values({
      orgId: ORG,
      actionId: 'test.decision-learning-write',
      input: { objectType: opts.objectType ?? 'contact', fields: opts.fields ?? { name: 'Ada', email: 'ada@example.com' } },
      status: 'pending',
      invokedBy: `agent:${opts.agentSlug}`,
      proposal: { confidence: opts.confidence, rationale: opts.rationale },
    })
    .returning({ id: actionRunSchema.id });
  return row!.id;
}

async function rulesFor(stepName: string): Promise<Array<{ ruleText: string; source: string | null }>> {
  const [step] = await db.select().from(learningStepSchema).where(and(eq(learningStepSchema.orgId, ORG), eq(learningStepSchema.name, stepName)));
  if (!step) {
    return [];
  }
  return db.select({ ruleText: learningSchema.ruleText, source: learningSchema.source }).from(learningSchema).where(eq(learningSchema.stepId, step.id));
}

beforeEach(async () => {
  await db.delete(learningSchema);
  await db.delete(learningStepSchema);
  await db.delete(actionRunSchema);
  await db.delete(agentSchema);
});

afterAll(async () => {
  await db.delete(learningSchema);
  await db.delete(learningStepSchema);
  await db.delete(actionRunSchema);
  await db.delete(agentSchema);
});

describe('recordActionDecisionLearning (via ReviewService.decide)', () => {
  it('files the rule under the proposing agent\'s own learning step, not the literal "crm-updates"', async () => {
    await makeAgent('event-ingestion-lead', ['event-ingestion-updates']);
    await makeLearningStep('event-ingestion-updates');
    const runId = await pendingAction({ agentSlug: 'event-ingestion-lead' });

    await decide({ kind: 'action', id: runId }, 'approve', ORG);

    const rules = await rulesFor('event-ingestion-updates');

    expect(rules).toHaveLength(1);
    expect(rules[0]!.source).toBe(`action_run:${runId}`);
    expect(await rulesFor('crm-updates')).toHaveLength(0);
  });

  it('falls back to "crm-updates" and warns when the agent declares no learningSteps', async () => {
    await makeAgent('no-steps-agent', []);
    await makeLearningStep('crm-updates');
    const runId = await pendingAction({ agentSlug: 'no-steps-agent' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await decide({ kind: 'action', id: runId }, 'approve', ORG);

    expect(await rulesFor('crm-updates')).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('declares no learningSteps'));

    warnSpy.mockRestore();
  });

  it('reads candidate field names from input.fields, not input.properties', async () => {
    await makeAgent('event-ingestion-lead', ['event-ingestion-updates']);
    await makeLearningStep('event-ingestion-updates');
    const runId = await pendingAction({
      agentSlug: 'event-ingestion-lead',
      objectType: 'lead',
      fields: { company: 'Acme', title: 'CTO' },
    });

    await decide({ kind: 'action', id: runId }, 'approve', ORG);

    const [rule] = await rulesFor('event-ingestion-updates');

    // jsonb does not preserve key insertion order, so match on membership
    // rather than a fixed "company, title" ordering.
    expect(rule!.ruleText).toMatch(/updating \[(company, title|title, company)\]/);
    expect(rule!.ruleText).not.toContain('[n/a]');
  });

  it('keeps the operator\'s reject reason whole rather than truncating at 120 characters', async () => {
    await makeAgent('event-ingestion-lead', ['event-ingestion-updates']);
    await makeLearningStep('event-ingestion-updates');
    const runId = await pendingAction({ agentSlug: 'event-ingestion-lead' });
    const longReason = 'x'.repeat(200);

    await decide({ kind: 'action', id: runId }, 'reject', ORG, { reason: longReason });

    const [rule] = await rulesFor('event-ingestion-updates');

    expect(rule!.ruleText).toContain(`Operator reason: ${longReason}.`);
  });

  it('logs a warning instead of swallowing when the resolved step still does not exist', async () => {
    // No learning_step row seeded at all for this agent's declared step —
    // addLearning throws "unknown learning step", and the fix is that the
    // decide() call site logs it instead of the old empty `.catch(() => {})`.
    await makeAgent('orphan-agent', ['ghost-step']);
    const runId = await pendingAction({ agentSlug: 'orphan-agent' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await decide({ kind: 'action', id: runId }, 'approve', ORG);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`could not record decision-learning rule for action run ${runId}`),
      expect.anything(),
    );

    warnSpy.mockRestore();
  });

  it('does nothing for an action a human proposed directly', async () => {
    const [row] = await db
      .insert(actionRunSchema)
      .values({
        orgId: ORG,
        actionId: 'test.decision-learning-write',
        input: { objectType: 'contact', fields: { name: 'Ada' } },
        status: 'pending',
        invokedBy: 'user_someone',
      })
      .returning({ id: actionRunSchema.id });

    await decide({ kind: 'action', id: row!.id }, 'approve', ORG);

    expect(await db.select().from(learningSchema)).toHaveLength(0);
  });
});
