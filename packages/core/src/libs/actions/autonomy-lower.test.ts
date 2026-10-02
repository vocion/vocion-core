/**
 * `autonomy.lower`: setup may take trust away, never grant it. The rules
 * someone could get wrong: a retry must not lower twice (the target is a rung,
 * not a step), a rung already at or below the target is left alone, nothing
 * here can reach `promote`, and a failure part-way leaves no half-lowered set.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { autonomyPolicySchema } = await import('@/models/Schema');
const { autonomyLowerAction } = await import('./autonomy-lower');
const { bindingProblem } = await import('./bindable');
const { getAction } = await import('./registry');
const { effectivePolicy } = await import('@/services/autonomy/AutonomyService');

const ORG = 'org_lower';
const CTX = { orgId: ORG, invokedBy: 'user_admin' };

function parse(input: unknown) {
  return autonomyLowerAction.inputSchema.parse(input);
}

async function seedRung(actionId: string, rung: string) {
  await db.insert(autonomyPolicySchema).values({ orgId: ORG, actionId, rung, riskTier: 'medium', minConfidence: 0.8, source: 'app' });
}

type Lowered = { actionId: string; from: string; to: string };

/**
 * Run the action and read its result as the shape it documents.
 * @param input - Raw input, parsed by the action's schema.
 */
async function lower(input: unknown): Promise<{ lowered: Lowered[] }> {
  return (await autonomyLowerAction.execute(CTX, parse(input))) as { lowered: Lowered[] };
}

describe('autonomy.lower', () => {
  it('lands git.merge.pipeline on the target rung, and a second run changes nothing', async () => {
    const input = { actionIds: ['git.merge.pipeline'], to: 'execute-with-approval' };

    const first = await lower(input);
    const afterFirst = await effectivePolicy(ORG, 'git.merge.pipeline');
    const second = await lower(input);
    const afterSecond = await effectivePolicy(ORG, 'git.merge.pipeline');

    expect(afterFirst.rung).toBe('execute-with-approval');
    expect(afterSecond.rung).toBe('execute-with-approval');
    expect(second.lowered).toEqual([{ actionId: 'git.merge.pipeline', from: 'execute-with-approval', to: 'execute-with-approval' }]);
    expect(first.lowered[0]!.to).toBe('execute-with-approval');
  });

  it('steps a rung above the target down until it reaches it, in one call', async () => {
    await seedRung('test.high', 'autonomous');

    const result = await lower({ actionIds: ['test.high'], to: 'assist' });

    expect(result.lowered).toEqual([{ actionId: 'test.high', from: 'autonomous', to: 'assist' }]);
    expect((await effectivePolicy(ORG, 'test.high')).rung).toBe('assist');
  });

  it('never raises: a rung below the target stays where it is and is reported', async () => {
    await seedRung('test.low', 'recommend');

    const result = await lower({ actionIds: ['test.low'], to: 'execute-with-approval' });

    expect(result.lowered).toEqual([{ actionId: 'test.low', from: 'recommend', to: 'recommend' }]);
    expect((await effectivePolicy(ORG, 'test.low')).rung).toBe('recommend');
  });

  it('lowering to observe reaches the bottom without surfacing AT_BOTTOM', async () => {
    await seedRung('test.observe', 'recommend');

    const result = await lower({ actionIds: ['test.observe'], to: 'observe' });

    expect(result.lowered).toEqual([{ actionId: 'test.observe', from: 'recommend', to: 'observe' }]);
  });

  it('lowers every listed action in one call', async () => {
    await seedRung('test.a', 'autonomous');
    await seedRung('test.b', 'autonomous');
    const ids = ['test.a', 'test.b'];

    await lower({ actionIds: ids, to: 'assist' });
    const rows = await db.select().from(autonomyPolicySchema).where(eq(autonomyPolicySchema.orgId, ORG));

    expect(rows.filter(r => ids.includes(r.actionId)).map(r => r.rung)).toEqual(['assist', 'assist']);
  });

  it('rejects an empty list and a rung that is not on the ladder', () => {
    expect(() => parse({ actionIds: [], to: 'assist' })).toThrow();
    expect(() => parse({ actionIds: ['git.merge'], to: 'root' })).toThrow();
  });

  it('is registered, runs without leaving Vocion, and can ride on a choice option', () => {
    expect(getAction('autonomy.lower')).toBe(autonomyLowerAction);
    expect(autonomyLowerAction.external).toBe(false);
    expect(bindingProblem('autonomy.lower')).toBeNull();
  });

  it('never imports promote: setup cannot work around the evidence rule', () => {
    const source = readFileSync(join(__dirname, 'autonomy-lower.ts'), 'utf8');

    const importLines = source.split('\n').filter(line => /\bimport\b/.test(line));

    expect(importLines.join('\n')).not.toMatch(/\bpromote\b/);
    expect(source).not.toMatch(/\bpromote\s*\(/);
  });

  it('refuses undo, saying raising autonomy is earned', async () => {
    await expect(autonomyLowerAction.undo!(CTX, parse({ actionIds: ['git.merge'], to: 'assist' }), { lowered: [] }))
      .rejects
      .toThrow('Raising autonomy is earned; promote it from the Autonomy page when its evidence supports it.');
  });
});
