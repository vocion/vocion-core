/**
 * `autonomy.set_goal`: setup records the rung a person wants the factory to
 * work toward, and never moves the rung itself. The rules someone could get
 * wrong: the rung read by the gate must not change, the goal carries who and
 * when, undo clears the goal and leaves the rung, a member cannot set one, and
 * the module cannot reach `promote`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, autonomyPolicySchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { autonomySetGoalAction } = await import('./autonomy-set-goal');
const { bindingProblem } = await import('./bindable');
const { getAction } = await import('./registry');
const { effectivePolicy } = await import('@/services/autonomy/AutonomyService');

const ORG = 'org_goal';
const ADMIN = 'user_goal_admin';
const MEMBER = 'user_goal_member';
const CTX = { orgId: ORG, reviewedBy: ADMIN };

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-goal', name: 'Northwind', slug: 'northwind-goal' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-goal', slug: 'northwind-goal', name: 'Northwind' });
  await db.insert(userSchema).values([{ id: ADMIN, email: 'admin-goal@northwind.example' }, { id: MEMBER, email: 'member-goal@northwind.example' }]);
  await db.insert(accountMembershipSchema).values([
    { accountId: 'acct-goal', userId: ADMIN, role: 'admin' },
    { accountId: 'acct-goal', userId: MEMBER, role: 'member' },
  ]);
});

function parse(input: unknown) {
  return autonomySetGoalAction.inputSchema.parse(input);
}

async function policyRow(actionId: string) {
  const [row] = await db.select().from(autonomyPolicySchema).where(and(eq(autonomyPolicySchema.orgId, ORG), eq(autonomyPolicySchema.actionId, actionId)));
  return row;
}

describe('autonomy.set_goal', () => {
  it('stores the goal with who and when, and the rung the gate reads does not move', async () => {
    const before = await effectivePolicy(ORG, 'git.merge');
    const input = parse({ actionIds: ['git.merge'], goal: 'execute-within-bounds' });

    await autonomySetGoalAction.execute(CTX, input);
    const after = await effectivePolicy(ORG, 'git.merge');
    const row = await policyRow('git.merge');

    expect(after.rung).toBe(before.rung);
    expect(after.rung).not.toBe('execute-within-bounds');
    expect(row?.goalRung).toBe('execute-within-bounds');
    expect(row?.goalSetBy).toBe(ADMIN);
    expect(row?.goalSetAt).toBeInstanceOf(Date);
  });

  it('keeps an existing row at its rung', async () => {
    await db.insert(autonomyPolicySchema).values({ orgId: ORG, actionId: 'test.assist', rung: 'assist', riskTier: 'medium', source: 'app' });

    await autonomySetGoalAction.execute(CTX, parse({ actionIds: ['test.assist'], goal: 'autonomous' }));

    expect((await effectivePolicy(ORG, 'test.assist')).rung).toBe('assist');
    expect((await policyRow('test.assist'))?.goalRung).toBe('autonomous');
  });

  it('undo clears the goal and the rung is still unchanged', async () => {
    const input = parse({ actionIds: ['test.undo'], goal: 'execute-within-bounds' });
    await autonomySetGoalAction.execute(CTX, input);
    const rung = (await effectivePolicy(ORG, 'test.undo')).rung;

    await autonomySetGoalAction.undo!(CTX, input, {});
    const row = await policyRow('test.undo');

    expect(row?.goalRung).toBeNull();
    expect(row?.goalSetBy).toBeNull();
    expect(row?.goalSetAt).toBeNull();
    expect((await effectivePolicy(ORG, 'test.undo')).rung).toBe(rung);
  });

  it('refuses a member at proposal time and at approval, and stores nothing', async () => {
    const input = parse({ actionIds: ['test.member'], goal: 'assist' });

    expect(await autonomySetGoalAction.precheck!({ orgId: ORG, invokedBy: MEMBER }, input)).toMatch(/Only a workspace admin/);
    await expect(autonomySetGoalAction.execute({ orgId: ORG, reviewedBy: MEMBER }, input)).rejects.toThrow(/Only a workspace admin/);
    expect(await policyRow('test.member')).toBeUndefined();
  });

  it('is registered, runs without leaving Vocion, and can ride on a choice option', () => {
    expect(getAction('autonomy.set_goal')).toBe(autonomySetGoalAction);
    expect(bindingProblem('autonomy.set_goal')).toBeNull();
  });

  it('never imports promote: a goal is not a way around the evidence rule', () => {
    const source = readFileSync(join(__dirname, 'autonomy-set-goal.ts'), 'utf8');

    const importLines = source.split('\n').filter(line => /\bimport\b/.test(line));

    expect(importLines.join('\n')).not.toMatch(/\bpromote\b/);
    expect(source).not.toMatch(/\bpromote\s*\(/);
  });
});
