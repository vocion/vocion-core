import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * A goal peeks in the preview pane instead of taking the screen on a phone
 * (a phone walk, 2026-10-10). Only its owner reads it, as on its page.
 * Fixtures are fictional (Northwind Expo).
 */

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
await import('./descriptors');
const { resolvePreview } = await import('./registry');
const { createGoal } = await import('@/services/objectives/GoalService');
const { milestonesFrom, parseHorizon } = await import('@/libs/objectives/goal');

const ORG = 'proj-peek-goal';
let goalId = 0;

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-peek-goal', name: 'Northwind', slug: 'northwind-peek-goal' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-peek-goal', slug: 'gtm-peek', name: 'GTM' });
  await db.insert(userSchema).values([{ id: 'usr-peek-dana', email: 'dana@northwind.example', name: 'Dana Reyes' }, { id: 'usr-peek-pat', email: 'pat@northwind.example', name: 'Pat Lund' }]);
  const goal = await createGoal({
    orgId: ORG,
    ownerUserId: 'usr-peek-dana',
    title: 'Convert Northwind Expo leads',
    horizon: parseHorizon('2026-11-30')!,
    measure: { kind: 'milestones', milestones: milestonesFrom([{ label: 'Import the leads' }, { label: 'Sort them by fit' }, { label: 'Book five calls' }]) },
    createdBy: 'usr-peek-dana',
  });
  goalId = goal.id;
});

describe('a goal preview', () => {
  it('shows its owner the goal, its progress and its milestones, linking to its page', async () => {
    const doc = await resolvePreview({ type: 'goal', id: String(goalId) }, { orgId: ORG, userId: 'usr-peek-dana' });

    expect(doc.title).toBe('Convert Northwind Expo leads');
    expect(doc.facts?.map(f => f.label)).toEqual(['Progress', 'Horizon', 'Status']);
    expect(doc.body).toContain('Import the leads');
  });

  it('shows nobody else', async () => {
    const doc = await resolvePreview({ type: 'goal', id: String(goalId) }, { orgId: ORG, userId: 'usr-peek-pat' });

    expect(doc.title).not.toBe('Convert Northwind Expo leads');
  });
});
