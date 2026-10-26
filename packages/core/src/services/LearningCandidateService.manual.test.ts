/**
 * A rule a person adds by hand — the workspace twin of the preference fast
 * lane. The person IS the decision, so the rule goes live at once and an
 * approved candidate is recorded with it: the decided list shows what shipped
 * and the rule can be taken back like any other. What is worth pinning: the
 * two always land together or not at all, the dedup guard still applies, and
 * the person, not the token, is on the record.
 */
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/adoption/track', () => ({ track: vi.fn() }));
vi.mock('@/services/adoption/attribution', () => ({ agentSlugFromPrincipal: vi.fn(() => undefined) }));

const { db } = await import('@/libs/DB');
const { learningCandidateSchema, memoryNamespaceSchema, memorySchema } = await import('@/models/Schema');
const { addManualLearning, unadoptCandidate } = await import('@/services/LearningCandidateService');
const { assembleAgentMemory } = await import('@/services/MemoryService');

const ORG = 'org_manual';
const STEP = 'crm-updates';
const PERSON = 'larkfield-admin:7';

async function rules() {
  return db.select().from(memorySchema).where(eq(memorySchema.orgId, ORG));
}

async function candidates() {
  return db.select().from(learningCandidateSchema).where(eq(learningCandidateSchema.orgId, ORG));
}

beforeEach(async () => {
  await db.delete(learningCandidateSchema).where(eq(learningCandidateSchema.orgId, ORG));
  await db.delete(memorySchema).where(eq(memorySchema.orgId, ORG));
  await db.delete(memoryNamespaceSchema).where(eq(memoryNamespaceSchema.orgId, ORG));
  await db.insert(memoryNamespaceSchema).values({ orgId: ORG, name: STEP, path: `workspace/${STEP}`, title: 'CRM updates', description: 'Rules for CRM update drafts.' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('addManualLearning', () => {
  it('puts the rule live and records an approved candidate naming the person', async () => {
    const result = await addManualLearning({ orgId: ORG, step: STEP, ruleText: ' Cite the invoice number. ', decidedBy: PERSON });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }
    const [rule] = await rules();

    expect(rule!.key).toBe(result.ruleKey);
    expect(rule!.value.meta).toMatchObject({ kind: 'rule', source: 'manual', createdBy: PERSON, polarity: 'correct' });
    expect(rule!.value.meta).not.toHaveProperty('type');
    expect(result.candidate).toMatchObject({
      status: 'approved',
      stepName: STEP,
      ruleText: 'Cite the invoice number.',
      polarity: 'correct',
      memoryType: null,
      decidedBy: PERSON,
      createdMemoryKey: result.ruleKey,
    });
    expect(result.candidate.decidedAt).toBeInstanceOf(Date);

    const files = await assembleAgentMemory(ORG, { workspaceSteps: [STEP] });

    expect(Object.values(files).join('\n')).toContain('Cite the invoice number.');
  });

  it('carries the polarity and memory type onto both the rule and the candidate', async () => {
    const result = await addManualLearning({ orgId: ORG, step: STEP, ruleText: 'Keep the greeting short.', decidedBy: PERSON, polarity: 'reinforce', memoryType: 'knowledge' });

    expect(result.ok).toBe(true);
    expect((await rules())[0]!.value.meta).toMatchObject({ polarity: 'reinforce', type: 'knowledge' });
    expect((await candidates())[0]).toMatchObject({ polarity: 'reinforce', memoryType: 'knowledge' });
  });

  it('refuses an unknown step and writes nothing at all', async () => {
    const result = await addManualLearning({ orgId: ORG, step: 'no-such-step', ruleText: 'Cite the invoice number.', decidedBy: PERSON });

    expect(result).toEqual({ ok: false, error: 'unknown_step' });
    expect(await rules()).toHaveLength(0);
    expect(await candidates()).toHaveLength(0);
  });

  it('refuses a near-duplicate with the rule it restates, and writes nothing', async () => {
    await addManualLearning({ orgId: ORG, step: STEP, ruleText: 'Always cite the invoice number on every update.', decidedBy: PERSON });

    const again = await addManualLearning({ orgId: ORG, step: STEP, ruleText: 'Always cite the invoice number on every update!', decidedBy: 'larkfield-admin:8' });

    expect(again.ok).toBe(false);

    if (again.ok || again.error !== 'near_duplicate') {
      throw new Error(`expected a near-duplicate, got ${JSON.stringify(again)}`);
    }

    expect(again.existing.existingRule).toBe('Always cite the invoice number on every update.');
    expect(await rules()).toHaveLength(1);
    expect(await candidates()).toHaveLength(1);
  });

  it('refuses a blank rule', async () => {
    expect(await addManualLearning({ orgId: ORG, step: STEP, ruleText: '   ', decidedBy: PERSON })).toEqual({ ok: false, error: 'empty_text' });
  });

  it('takes the rule back out when the candidate cannot be recorded, so no rule lives without one', async () => {
    const insert = db.insert.bind(db);
    vi.spyOn(db, 'insert').mockImplementation(((table: unknown) => {
      if (table === learningCandidateSchema) {
        throw new Error('candidate insert failed');
      }
      return insert(table as never);
    }) as typeof db.insert);

    await expect(addManualLearning({ orgId: ORG, step: STEP, ruleText: 'Cite the invoice number.', decidedBy: PERSON })).rejects.toThrow('candidate insert failed');

    vi.restoreAllMocks();

    expect(await rules()).toHaveLength(0);
    expect(await candidates()).toHaveLength(0);
  });

  it('can be taken back like any adopted rule', async () => {
    const result = await addManualLearning({ orgId: ORG, step: STEP, ruleText: 'Cite the invoice number.', decidedBy: PERSON });
    if (!result.ok) {
      throw new Error('fixture rule was not added');
    }

    await unadoptCandidate({ orgId: ORG, id: result.candidate.id, undoneBy: PERSON, reason: 'Too strict' });

    const [row] = await db.select().from(learningCandidateSchema).where(and(eq(learningCandidateSchema.orgId, ORG), eq(learningCandidateSchema.id, result.candidate.id)));

    expect(row).toMatchObject({ status: 'rejected', rejectedReason: 'Too strict', createdMemoryKey: null });
    expect(await rules()).toHaveLength(0);
  });
});
