import { describe, expect, it, vi } from 'vitest';

/**
 * What a record offers a person, read once for its page and its preview.
 * Fixtures are fictional.
 */

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema } = await import('@/models/Schema');
const { recordActionsOf } = await import('./recordActions');

const ORG = 'org_record_actions';
const OWED = { slug: 'follow-up', schema: { 'type': 'object', 'x-owed': true, 'properties': {} } };

async function run(status: string): Promise<number> {
  const [r] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'objects.propose_candidate', status, input: {} } as never).returning({ id: actionRunSchema.id });
  return r!.id;
}

describe('recordActionsOf', () => {
  it('offers nothing on a type that did not say its records are owed', async () => {
    expect(await recordActionsOf(ORG, { status: 'active', type: { slug: 'company', schema: { properties: {} } } })).toBeNull();
  });

  it('gives a thing owed its type and where it stands', async () => {
    expect(await recordActionsOf(ORG, { status: 'active', type: OWED })).toEqual({ objectType: 'follow-up', status: 'active' });
  });

  it('hands a candidate the Review item still pending on it, and only while it is pending', async () => {
    const pending = await run('pending');
    const decided = await run('rejected');

    expect(await recordActionsOf(ORG, { status: 'candidate', reviewActionRunId: pending, type: OWED })).toEqual({ objectType: 'follow-up', status: 'candidate', decideRunId: pending });
    expect(await recordActionsOf(ORG, { status: 'candidate', reviewActionRunId: decided, type: OWED })).toEqual({ objectType: 'follow-up', status: 'candidate' });
  });

  it('carries a snooze that is still ahead, and drops one that has passed', async () => {
    const ahead = new Date(Date.now() + 86_400_000);

    expect(await recordActionsOf(ORG, { status: 'active', snoozedUntil: ahead, type: OWED })).toEqual({ objectType: 'follow-up', status: 'active', snoozedUntil: ahead.toISOString() });
    expect(await recordActionsOf(ORG, { status: 'active', snoozedUntil: new Date(Date.now() - 1000), type: OWED })).toEqual({ objectType: 'follow-up', status: 'active' });
  });
});
